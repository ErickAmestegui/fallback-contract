import { describe, expect, it, vi } from 'vitest'
import { SUPPORT_CARD_V2_CASES } from '../src/contracts/support-card.js'
import { callOtari } from '../src/otari/client.js'
import {
  checkBudgetPreflight,
  routingRunConfigFromEnv,
  runAuthenticV2Comparison,
  type V2RoutingRunConfig,
} from '../src/evaluation/v2-authentic-run.js'
import { validateFailoverPolicyConfig } from '../src/evaluation/v2-adapter.js'
import { checkRoutingUsage } from '../src/evaluation/v2-routing-verify.js'
import type { OtariKeyBudgetResult } from '../src/otari/client.js'
import type { OtariChatRequest, OtariModelResult } from '../src/otari/types.js'

const config: V2RoutingRunConfig = {
  referenceModel: 'openai/gpt-oss-20b',
  policy: {
    kind: 'otari-failover-policy',
    policy: 'fc-failover',
    primary: 'deepinfra:openai/gpt-oss-20b',
    onFailure: ['bedrock:qwen.qwen3-32b-v1:0'],
  },
  maxRunCostUsd: 0.01,
  maxExposureUsd: 0.25,
}

const budget = (overrides: Partial<OtariKeyBudgetResult> = {}): OtariKeyBudgetResult => ({
  status: 'ok',
  budgetsEnforced: true,
  remainingUsd: 0.2,
  limits: [{ scope: 'api_token', provider: null, limitUsd: 0.25, usedUsd: 0.05, remainingUsd: 0.2, resetsAt: null }],
  error: null,
  ...overrides,
})

function structuredOutput(message: string): string {
  if (message.includes('PIN')) return '{"category":"change_pin","urgency":"medium","actionId":"change_pin"}'
  if (message.includes('arrived')) return '{"category":"card_arrival","urgency":"medium","actionId":"track_card_arrival"}'
  return '{"category":"lost_or_stolen_card","urgency":"high","actionId":"freeze_card"}'
}

const isPolicy = (request: OtariChatRequest) => request.model === config.policy.policy

function served(request: OtariChatRequest, index: number, overrides: Partial<OtariModelResult> = {}): OtariModelResult {
  const policy = isPolicy(request)
  return {
    requestedModel: request.model,
    effectiveModel: request.model,
    requestId: `mock-request-${index}`,
    provider: policy ? 'deepinfra' : 'groq',
    servedModel: 'openai/gpt-oss-20b',
    attemptCount: 1,
    fallback: false,
    responseDurationMs: 42,
    serverTiming: 'otari;dur=2.0, upstream;dur=40.0, total;dur=42.0',
    finishReason: 'stop',
    content: structuredOutput(request.messages[1].content),
    usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22, cost_usd: 0.000001 },
    status: 'ok',
    error: null,
    ...overrides,
  }
}

const secondary: Partial<OtariModelResult> = { provider: 'bedrock', servedModel: 'qwen.qwen3-32b-v1:0', attemptCount: 2, fallback: true }

function failure(status: number | null, code: string): Partial<OtariModelResult> {
  return {
    effectiveModel: null,
    provider: null,
    servedModel: null,
    attemptCount: null,
    fallback: null,
    content: null,
    finishReason: null,
    usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null, cost_usd: null },
    status: 'inconclusive',
    error: { status, code, message: 'mock failure' },
  }
}

function harness(policyOverrides: (index: number) => Partial<OtariModelResult> = () => ({}), budgets: OtariKeyBudgetResult[] = [budget()]) {
  const requests: OtariChatRequest[] = []
  let budgetReads = 0
  return {
    requests,
    get budgetReads() { return budgetReads },
    deps: {
      caller: async (_env: unknown, request: OtariChatRequest) => {
        requests.push(request)
        const index = requests.length
        return served(request, index, isPolicy(request) ? policyOverrides(index) : {})
      },
      budgetReader: async () => budgets[Math.min(budgetReads++, budgets.length - 1)],
    },
  }
}

describe('v2 Otari failover policy run (mocked transport)', () => {
  it('approves a valid run without fallback and keeps the policy name apart from the served target', async () => {
    const run = harness()
    const result = await runAuthenticV2Comparison('test-secret', config, run.deps)

    expect(result.comparison.decision).toBe('APPROVE')
    expect(result.evidence).toBe('local-fixture')
    expect(result.comparison.evidence).toBe('local-fixture')
    expect(result.requestsSent).toBe(6)
    expect(result.comparison.candidate.requestedModel).toBe('fc-failover')
    expect(result.comparison.candidate.effectiveModel).toBe('deepinfra:openai/gpt-oss-20b')
    expect(result.comparison.candidate.routing).toMatchObject({ servedTargets: ['deepinfra:openai/gpt-oss-20b'], fallbackCaseIds: [], maxAttemptCount: 1 })
    expect(result.comparison.candidate.cases[0]).toMatchObject({ requestId: 'mock-request-4', provider: 'deepinfra', servedModel: 'openai/gpt-oss-20b', fallback: false })
    expect(result.totalReportedCostUsd).toBeCloseTo(0.000006)
    expect(run.requests.filter(isPolicy).map((request) => request.responseFormat)).toEqual([undefined, undefined, undefined])
    expect(run.requests.filter((request) => !isPolicy(request)).every((request) => request.responseFormat?.type === 'json_object')).toBe(true)
    expect(run.requests.filter(isPolicy).map((request) => request.messages[1].content)).toEqual(SUPPORT_CARD_V2_CASES.map((testCase) => testCase.message))
  })

  it('approves when the primary fails and Otari reports the on_failure target served', async () => {
    const result = await runAuthenticV2Comparison('test-secret', config, harness(() => secondary).deps)

    expect(result.comparison.decision).toBe('APPROVE')
    expect(result.comparison.candidate.routing).toMatchObject({
      servedTargets: ['bedrock:qwen.qwen3-32b-v1:0'],
      fallbackCaseIds: ['lost-card-001', 'pin-001', 'arrival-001'],
      maxAttemptCount: 2,
    })
  })

  it('accepts fallback after a skipped primary even when only one attempt was sent', async () => {
    const result = await runAuthenticV2Comparison('test-secret', config, harness(() => ({ ...secondary, attemptCount: 1 })).deps)

    expect(result.comparison.decision).toBe('APPROVE')
  })

  it('rejects a fallback model that breaks the semantic contract', async () => {
    const result = await runAuthenticV2Comparison('test-secret', config, harness((index) => index === 4
      ? { ...secondary, content: '{"category":"lost_or_stolen_card","urgency":"high","actionId":"keep_using_stolen_card"}' }
      : {}).deps)

    expect(result.comparison.decision).toBe('REJECT')
    expect(result.comparison.candidate.routing?.fallbackCaseIds).toEqual(['lost-card-001'])
  })

  it('returns INCONCLUSIVE, not REJECT, when every candidate fails', async () => {
    const run = harness(() => failure(502, 'provider_error'))
    const result = await runAuthenticV2Comparison('test-secret', config, run.deps)

    expect(result.comparison.decision).toBe('INCONCLUSIVE')
    expect(result.requestsSent).toBe(6)
    expect(result.comparison.candidate.technicalError).toContain('provider_error')
  })

  it.each([
    ['a served target outside the policy', { provider: 'mistral', servedModel: 'mistral-small' }, 'is not a candidate of policy'],
    ['missing served provider/model headers', { provider: null, servedModel: null }, 'served provider/model metadata is unavailable'],
    ['a response model other than the policy name', { effectiveModel: 'openai/gpt-5-mini' }, 'not the policy name'],
    ['fallback reported while the primary served', { fallback: true }, 'fallback reported but the primary'],
    ['no fallback reported after several attempts', { attemptCount: 2 }, 'no fallback reported'],
    ['no fallback reported while a backup served', { provider: 'bedrock', servedModel: 'qwen.qwen3-32b-v1:0' }, 'no fallback reported'],
  ])('returns INCONCLUSIVE for %s', async (_label, overrides, reason) => {
    const result = await runAuthenticV2Comparison('test-secret', config, harness(() => overrides).deps)

    expect(result.comparison.decision).toBe('INCONCLUSIVE')
    expect(result.comparison.reasons.some((item) => item.includes(reason))).toBe(true)
  })

  it.each([
    ['timeout', failure(null, 'timeout')],
    ['gateway rate limit', failure(429, 'rate_limited')],
    ['provider rate limit', failure(429, 'upstream_rate_limited')],
  ])('stops after a %s and returns INCONCLUSIVE', async (_label, overrides) => {
    const run = harness(() => overrides)
    const result = await runAuthenticV2Comparison('test-secret', config, run.deps)

    expect(result.comparison.decision).toBe('INCONCLUSIVE')
    expect(result.requestsSent).toBe(4)
    expect(result.stoppedReason).toContain(overrides.error?.code ?? '')
  })

  it.each([
    ['exhausted', budget({ remainingUsd: 0 }), 'below the run cap'],
    ['wider than the allowed exposure', budget({ remainingUsd: 7.5 }), 'exceeds the allowed exposure'],
    ['not enforced', budget({ budgetsEnforced: false }), 'not enforced'],
    ['without a dollar ceiling', budget({ remainingUsd: null }), 'no dollar ceiling'],
    ['unreadable', budget({ status: 'inconclusive', error: { status: 403, code: 'http_403', message: 'x' } }), 'unavailable'],
  ])('sends no completion when the budget is %s', async (_label, preflight, reason) => {
    const run = harness(() => ({}), [preflight])
    const result = await runAuthenticV2Comparison('test-secret', config, run.deps)

    expect(run.requests).toHaveLength(0)
    expect(result.requestsSent).toBe(0)
    expect(result.preflight.passed).toBe(false)
    expect(result.budgetAfter).toBeNull()
    expect(result.comparison.decision).toBe('INCONCLUSIVE')
    expect(result.comparison.reasons.some((item) => item.includes(reason))).toBe(true)
  })

  it('stops when Otari refuses a request for budget mid-run', async () => {
    const run = harness((index) => index === 5 ? failure(403, 'budget_exceeded') : {})
    const result = await runAuthenticV2Comparison('test-secret', config, run.deps)

    expect(result.requestsSent).toBe(5)
    expect(result.stoppedReason).toContain('budget_exceeded')
    expect(result.comparison.decision).toBe('INCONCLUSIVE')
    expect(run.budgetReads).toBe(2)
  })

  it('stops once reported cost reaches the local run cap', async () => {
    const run = harness(() => ({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost_usd: 0.02 } }))
    const result = await runAuthenticV2Comparison('test-secret', config, run.deps)

    expect(result.requestsSent).toBe(4)
    expect(result.stoppedReason).toContain('run cap')
    expect(result.comparison.decision).toBe('INCONCLUSIVE')
  })

  it.each([
    ['attempt count', { attemptCount: null }, 'attempt count is unavailable'],
    ['fallback flag', { fallback: null }, 'fallback flag is unavailable'],
    ['response model', { effectiveModel: null }, 'response model is unavailable'],
  ])('returns INCONCLUSIVE when the %s is missing', async (_label, overrides, reason) => {
    const result = await runAuthenticV2Comparison('test-secret', config, harness(() => overrides).deps)

    expect(result.comparison.decision).toBe('INCONCLUSIVE')
    expect(result.comparison.reasons.some((item) => item.includes(reason))).toBe(true)
  })

  it('stops when Otari reports no cost for a successful response', async () => {
    const run = harness(() => ({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost_usd: null } }))
    const result = await runAuthenticV2Comparison('test-secret', config, run.deps)

    expect(result.requestsSent).toBe(4)
    expect(result.stoppedReason).toContain('cost_usd')
    expect(result.comparison.decision).toBe('INCONCLUSIVE')
  })

  it('returns INCONCLUSIVE for duplicated request IDs inside the candidate evidence', async () => {
    const result = await runAuthenticV2Comparison('test-secret', config, harness(() => ({ requestId: 'same-id' })).deps)

    expect(result.comparison.decision).toBe('INCONCLUSIVE')
    expect(result.comparison.candidate.technicalError).toContain('Duplicate candidate request ID same-id')
  })

  it('returns INCONCLUSIVE for request IDs shared between reference and candidate', async () => {
    const result = await runAuthenticV2Comparison('test-secret', config, harness((index) => ({ requestId: `mock-request-${index - 3}` })).deps)

    expect(result.comparison.decision).toBe('INCONCLUSIVE')
    expect(result.comparison.candidate.technicalError).toContain('shared between reference and candidate')
  })

  it('returns INCONCLUSIVE for incomplete evidence after an early stop', async () => {
    const result = await runAuthenticV2Comparison('test-secret', config, harness((index) => index === 4 ? failure(null, 'transport_error') : {}).deps)

    expect(result.requestsSent).toBe(4)
    expect(result.comparison.decision).toBe('INCONCLUSIVE')
    expect(result.comparison.candidate.technicalError).toContain('Missing v2 response for pin-001')
  })

  it('labels evidence as authentic only when explicitly requested by the caller', async () => {
    const result = await runAuthenticV2Comparison('test-secret', config, { ...harness().deps, evidence: 'otari' })

    expect(result.evidence).toBe('otari')
  })

  it('refuses an invalid policy configuration before any request', async () => {
    const run = harness()
    await expect(runAuthenticV2Comparison('test-secret', {
      ...config,
      policy: { ...config.policy, onFailure: [] },
    }, run.deps)).rejects.toThrow('on_failure')
    expect(run.requests).toHaveLength(0)
    expect(run.budgetReads).toBe(0)
  })
})

describe('fc-failover through callOtari with documented Otari headers', () => {
  type Served = { provider: string; model: string; attempts: string; fallback: string; content?: (message: string) => string }

  function otariFetch(policyServed: Served) {
    const bodies: Array<Record<string, unknown>> = []
    let index = 0
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> }
      bodies.push(body)
      index += 1
      const policy = body.model === 'fc-failover'
      const message = body.messages[1].content
      return new Response(JSON.stringify({
        model: body.model,
        choices: [{ finish_reason: 'stop', message: { content: policy && policyServed.content ? policyServed.content(message) : structuredOutput(message) } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost_usd: '0.000010' },
      }), {
        status: 200,
        headers: {
          'Otari-Request-ID': `req-${index}`,
          'Otari-Provider': policy ? policyServed.provider : 'deepinfra',
          'Otari-Model': policy ? policyServed.model : 'openai/gpt-oss-20b',
          'Otari-Attempt-Count': policy ? policyServed.attempts : '1',
          'Otari-Fallback': policy ? policyServed.fallback : 'false',
          'Otari-Response-Duration-Ms': '800',
          'Server-Timing': 'otari;dur=4.2, upstream;dur=795.0, total;dur=799.2',
        },
      })
    })
    const deps = {
      caller: (env: { OTARI_API_KEY?: string }, request: OtariChatRequest) => callOtari(env, request, fetcher),
      budgetReader: async () => budget(),
    }
    return { bodies, deps }
  }

  it('sends response_format only to the direct reference, never to the policy', async () => {
    const { bodies, deps } = otariFetch({ provider: 'deepinfra', model: 'openai/gpt-oss-20b', attempts: '1', fallback: 'false' })
    await runAuthenticV2Comparison('test-secret', config, deps)

    const policyBodies = bodies.filter((body) => body.model === 'fc-failover')
    expect(policyBodies).toHaveLength(3)
    policyBodies.forEach((body) => expect(body).not.toHaveProperty('response_format'))
    bodies.filter((body) => body.model !== 'fc-failover').forEach((body) => expect(body.response_format).toEqual({ type: 'json_object' }))
  })

  it('recognises the DeepInfra primary serving without fallback', async () => {
    const result = await runAuthenticV2Comparison('test-secret', config, otariFetch({ provider: 'deepinfra', model: 'openai/gpt-oss-20b', attempts: '1', fallback: 'false' }).deps)

    expect(result.comparison.decision).toBe('APPROVE')
    expect(result.comparison.candidate.routing).toMatchObject({ servedTargets: ['deepinfra:openai/gpt-oss-20b'], fallbackCaseIds: [] })
  })

  it('recognises the Bedrock backup serving after an Otari-reported fallback', async () => {
    const result = await runAuthenticV2Comparison('test-secret', config, otariFetch({ provider: 'bedrock', model: 'qwen.qwen3-32b-v1:0', attempts: '2', fallback: 'true' }).deps)

    expect(result.comparison.decision).toBe('APPROVE')
    expect(result.comparison.candidate.effectiveModel).toBe('bedrock:qwen.qwen3-32b-v1:0')
    expect(result.comparison.candidate.routing?.fallbackCaseIds).toEqual(['lost-card-001', 'pin-001', 'arrival-001'])
  })

  it.each([
    ['another Bedrock model', { provider: 'bedrock', model: 'openai.gpt-oss-20b-1:0', attempts: '2', fallback: 'true' }],
    ['the backup model on another provider', { provider: 'deepinfra', model: 'qwen.qwen3-32b-v1:0', attempts: '2', fallback: 'true' }],
    ['the policy alias as served model', { provider: 'bedrock', model: 'fc-failover', attempts: '2', fallback: 'true' }],
  ])('returns INCONCLUSIVE for an unauthorized fallback to %s', async (_label, servedBy) => {
    const result = await runAuthenticV2Comparison('test-secret', config, otariFetch(servedBy).deps)

    expect(result.comparison.decision).toBe('INCONCLUSIVE')
    expect(result.comparison.reasons.some((reason) => reason.includes('is not a candidate of policy fc-failover'))).toBe(true)
  })

  it('keeps strict JSON validation when the backup answers without JSON mode', async () => {
    const result = await runAuthenticV2Comparison('test-secret', config, otariFetch({
      provider: 'bedrock',
      model: 'qwen.qwen3-32b-v1:0',
      attempts: '2',
      fallback: 'true',
      content: (message) => `<think>classify</think>${structuredOutput(message)}`,
    }).deps)

    expect(result.comparison.decision).toBe('REJECT')
    expect(result.comparison.candidate.cases.every((item) => item.validation.checks.some((check) => check.ruleId === 'json-valid' && check.status === 'failed'))).toBe(true)
  })
})

describe('failover policy configuration', () => {
  it.each([
    [{ policy: 'bad/name' }, 'Policy name'],
    [{ primary: 'gpt-5-mini' }, 'provider:model'],
    [{ onFailure: ['deepinfra:openai/gpt-oss-20b'] }, 'distinct'],
    [{ onFailure: ['a:1', 'b:2', 'c:3', 'd:4', 'e:5'] }, 'at most 5'],
  ])('rejects %o', (overrides, message) => {
    expect(validateFailoverPolicyConfig({ ...config.policy, ...overrides }).join(' ')).toContain(message)
  })

  it('keeps live routing disabled unless the private backend opts in', () => {
    expect(routingRunConfigFromEnv({}).config).toBeNull()
    expect(routingRunConfigFromEnv({ OTARI_LIVE_ROUTING_ENABLED: '1' }).errors[0]).toContain('OTARI_ROUTING_POLICY')
  })

  it('reads a configurable policy from private backend settings', () => {
    const { config: parsed, errors } = routingRunConfigFromEnv({
      OTARI_LIVE_ROUTING_ENABLED: '1',
      OTARI_ROUTING_POLICY: 'fc-failover',
      OTARI_ROUTING_PRIMARY: 'deepinfra:openai/gpt-oss-20b',
      OTARI_ROUTING_ON_FAILURE: 'bedrock:qwen.qwen3-32b-v1:0, gemini:gemini-2.5-flash',
      OTARI_RUN_MAX_COST_USD: '0.01',
      OTARI_MAX_EXPOSURE_USD: '0.25',
    })

    expect(errors).toEqual([])
    expect(parsed?.policy.onFailure).toEqual(['bedrock:qwen.qwen3-32b-v1:0', 'gemini:gemini-2.5-flash'])
    expect(parsed?.referenceModel).toBe('openai/gpt-oss-20b')
  })

  it('accepts a tight enforced ceiling in the budget preflight', () => {
    expect(checkBudgetPreflight(budget(), config)).toEqual([])
  })
})

describe('usage-row verification', () => {
  const call = (overrides: Partial<OtariModelResult> = {}) => ({
    role: 'candidate' as const,
    caseId: 'lost-card-001',
    result: served({ model: 'fc-failover', messages: [{ role: 'system', content: '' }, { role: 'user', content: 'lost' }], maxTokens: 1 }, 1, { ...secondary, ...overrides }),
  })
  const usage = (rowCount: number | null) => ({ status: 'ok' as const, requestId: 'mock-request-1', requestStatus: 'success', costUsd: 0.00002, rowCount, error: null })

  it('marks agreeing headers and usage rows as consistent', () => {
    expect(checkRoutingUsage(call(), usage(2)).status).toBe('consistent')
  })

  it('flags a disagreement between headers and usage rows', () => {
    expect(checkRoutingUsage(call(), usage(1))).toMatchObject({ status: 'mismatch' })
  })

  it('treats a missing lookup as inconclusive', () => {
    expect(checkRoutingUsage(call(), null).status).toBe('inconclusive')
    expect(checkRoutingUsage(call({ requestId: null }), usage(2)).status).toBe('inconclusive')
  })
})
