import { MODEL_OPTIONS, SUPPORT_CARD_V2_CASES, type SupportCardV2Output } from '../contracts/support-card.js'
import { callOtari, getOtariKeyBudget, type OtariKeyBudgetResult } from '../otari/client.js'
import type { OtariChatRequest, OtariModelResult } from '../otari/types.js'
import {
  compareV2Responses,
  validateFailoverPolicyConfig,
  type EvidenceKind,
  type V2FailoverPolicyConfig,
  type V2OfflineResponse,
} from './v2-adapter.js'
import type { ComparisonResult } from './types.js'

export interface V2RoutingRunConfig {
  referenceModel: string
  policy: V2FailoverPolicyConfig
  /** Local stop: no further request once the reported cost reaches this. */
  maxRunCostUsd: number
  /** Otari's enforced remaining_usd must not exceed this, so a real ceiling bounds the worst case. */
  maxExposureUsd: number
}

type OtariEnv = { OTARI_API_KEY?: string }

export interface V2RoutingRunDeps {
  caller?: (env: OtariEnv, request: OtariChatRequest) => Promise<OtariModelResult>
  budgetReader?: (env: OtariEnv) => Promise<OtariKeyBudgetResult>
  evidence?: EvidenceKind
  now?: () => Date
}

export interface V2RoutingCall {
  role: 'reference' | 'candidate'
  caseId: string
  result: OtariModelResult
}

export interface V2RoutingRunResult {
  evidence: EvidenceKind
  startedAt: string
  config: V2RoutingRunConfig
  preflight: { passed: boolean; reasons: string[] }
  budgetBefore: OtariKeyBudgetResult
  budgetAfter: OtariKeyBudgetResult | null
  requestsPlanned: number
  requestsSent: number
  stoppedReason: string | null
  calls: V2RoutingCall[]
  totalReportedCostUsd: number | null
  comparison: ComparisonResult<SupportCardV2Output>
}

const STOP_ERROR_CODES = new Set([
  'budget_exceeded',
  'insufficient_funds',
  'rate_limited',
  'upstream_rate_limited',
  'user_blocked',
  'missing_secret',
  'timeout',
  'transport_error',
])

export function validateRoutingRunConfig(config: V2RoutingRunConfig): string[] {
  const errors = validateFailoverPolicyConfig(config.policy)
  if (!config.referenceModel) errors.push('A reference model is required.')
  if (!Number.isFinite(config.maxRunCostUsd) || config.maxRunCostUsd <= 0) errors.push('maxRunCostUsd must be a positive number.')
  if (!Number.isFinite(config.maxExposureUsd) || config.maxExposureUsd <= 0) errors.push('maxExposureUsd must be a positive number.')
  if (config.maxExposureUsd < config.maxRunCostUsd) errors.push('maxExposureUsd cannot be lower than maxRunCostUsd.')
  return errors
}

export function routingRunConfigFromEnv(env: Record<string, string | undefined>): { config: V2RoutingRunConfig | null; errors: string[] } {
  if (env.OTARI_LIVE_ROUTING_ENABLED !== '1') {
    return { config: null, errors: ['Live routing runs are disabled; set OTARI_LIVE_ROUTING_ENABLED=1 on the private backend.'] }
  }
  const value = (name: string) => env[name]?.trim() ?? ''
  const required = ['OTARI_ROUTING_POLICY', 'OTARI_ROUTING_PRIMARY', 'OTARI_ROUTING_ON_FAILURE', 'OTARI_RUN_MAX_COST_USD', 'OTARI_MAX_EXPOSURE_USD']
  const missing = required.filter((name) => !value(name))
  if (missing.length) return { config: null, errors: [`Missing private backend settings: ${missing.join(', ')}.`] }
  const config: V2RoutingRunConfig = {
    referenceModel: value('OTARI_V2_REFERENCE_MODEL') || MODEL_OPTIONS.reference,
    policy: {
      kind: 'otari-failover-policy',
      policy: value('OTARI_ROUTING_POLICY'),
      primary: value('OTARI_ROUTING_PRIMARY'),
      onFailure: value('OTARI_ROUTING_ON_FAILURE').split(',').map((target) => target.trim()).filter(Boolean),
    },
    maxRunCostUsd: Number(value('OTARI_RUN_MAX_COST_USD')),
    maxExposureUsd: Number(value('OTARI_MAX_EXPOSURE_USD')),
  }
  const errors = validateRoutingRunConfig(config)
  return errors.length ? { config: null, errors } : { config, errors: [] }
}

export function checkBudgetPreflight(budget: OtariKeyBudgetResult, config: V2RoutingRunConfig): string[] {
  if (budget.status !== 'ok') return [`Budget preflight unavailable (${budget.error?.code ?? 'unknown'}).`]
  if (!budget.budgetsEnforced) return ['Budget preflight: Otari reports budgets are not enforced for this key.']
  if (budget.remainingUsd === null) return ['Budget preflight: no dollar ceiling covering every provider applies to this key.']
  const reasons: string[] = []
  if (budget.remainingUsd < config.maxRunCostUsd) {
    reasons.push(`Budget preflight: remaining US$${budget.remainingUsd} is below the run cap US$${config.maxRunCostUsd}.`)
  }
  if (budget.remainingUsd > config.maxExposureUsd) {
    reasons.push(`Budget preflight: remaining US$${budget.remainingUsd} exceeds the allowed exposure US$${config.maxExposureUsd}; set a tighter Otari spend ceiling first.`)
  }
  return reasons
}

const SYSTEM_PROMPT = [
  'Return exactly one JSON object and no markdown or commentary.',
  'The object must contain exactly category, urgency, and actionId.',
  'category must be one of lost_or_stolen_card, change_pin, card_arrival.',
  'urgency must be one of low, medium, high.',
  'actionId must be freeze_card for lost_or_stolen_card, change_pin for change_pin, and track_card_arrival for card_arrival.',
  'A lost or stolen card always has high urgency.',
].join(' ')

// The policy request carries no response_format: Otari never strips it, and its Bedrock
// adapter refuses it for non-Claude models, so a Bedrock backup could never serve.
export function requestForModelV2(model: string, message: string, role: 'reference' | 'candidate'): OtariChatRequest {
  const reasoningReference = role === 'reference' && model === MODEL_OPTIONS.reference
  return {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message },
    ],
    maxTokens: reasoningReference ? 512 : 256,
    ...(reasoningReference ? { reasoningEffort: 'low' as const } : {}),
    ...(role === 'reference' ? { responseFormat: { type: 'json_object' as const } } : {}),
  }
}

function toResponse({ caseId, result }: V2RoutingCall): V2OfflineResponse {
  return {
    caseId,
    requestedModel: result.requestedModel,
    effectiveModel: result.effectiveModel,
    requestId: result.requestId,
    provider: result.provider ?? null,
    servedModel: result.servedModel ?? null,
    attemptCount: result.attemptCount ?? null,
    fallback: result.fallback ?? null,
    responseDurationMs: result.responseDurationMs ?? null,
    serverTiming: result.serverTiming ?? null,
    responseStatus: result.status,
    errorCode: result.error?.code ?? null,
    rawOutput: result.content,
    technicalError: result.error?.code ?? null,
  }
}

function stopReasonAfter(result: OtariModelResult, totalCost: number, config: V2RoutingRunConfig): string | null {
  const code = result.error?.code ?? null
  if (code && STOP_ERROR_CODES.has(code)) return `Stopped after ${code}; no further requests were sent.`
  if (result.status === 'ok' && result.usage.cost_usd === null) return 'Stopped: Otari did not report usage.cost_usd, so spend cannot be accounted.'
  if (totalCost >= config.maxRunCostUsd) return `Stopped: reported cost US$${totalCost} reached the run cap US$${config.maxRunCostUsd}.`
  return null
}

export async function runAuthenticV2Comparison(
  apiKey: string,
  config: V2RoutingRunConfig,
  deps: V2RoutingRunDeps = {},
): Promise<V2RoutingRunResult> {
  const configErrors = validateRoutingRunConfig(config)
  if (configErrors.length) throw new Error(`Invalid routing run configuration: ${configErrors.join(' ')}`)

  const caller = deps.caller ?? ((env, request) => callOtari(env, request))
  const budgetReader = deps.budgetReader ?? ((env) => getOtariKeyBudget(env))
  const evidence: EvidenceKind = deps.evidence ?? (deps.caller || deps.budgetReader ? 'local-fixture' : 'otari')
  const startedAt = (deps.now?.() ?? new Date()).toISOString()
  const env = { OTARI_API_KEY: apiKey }
  const models = {
    reference: { kind: 'direct' as const, requestedModel: config.referenceModel },
    candidate: config.policy,
  }
  const plan = [
    ...SUPPORT_CARD_V2_CASES.map((testCase) => ({ role: 'reference' as const, testCase, model: config.referenceModel })),
    ...SUPPORT_CARD_V2_CASES.map((testCase) => ({ role: 'candidate' as const, testCase, model: config.policy.policy })),
  ]

  const budgetBefore = await budgetReader(env)
  const preflightReasons = checkBudgetPreflight(budgetBefore, config)
  if (preflightReasons.length) {
    const comparison = compareV2Responses([], [], models, evidence)
    comparison.reasons.push(...preflightReasons)
    return {
      evidence,
      startedAt,
      config,
      preflight: { passed: false, reasons: preflightReasons },
      budgetBefore,
      budgetAfter: null,
      requestsPlanned: plan.length,
      requestsSent: 0,
      stoppedReason: 'Budget preflight failed; no completion was requested.',
      calls: [],
      totalReportedCostUsd: null,
      comparison,
    }
  }

  const calls: V2RoutingCall[] = []
  let totalCost = 0
  let stoppedReason: string | null = null
  for (const step of plan) {
    const result = await caller(env, requestForModelV2(step.model, step.testCase.message, step.role))
    calls.push({ role: step.role, caseId: step.testCase.id, result })
    if (typeof result.usage.cost_usd === 'number') totalCost += result.usage.cost_usd
    stoppedReason = stopReasonAfter(result, totalCost, config)
    if (stoppedReason && calls.length < plan.length) break
    stoppedReason = null
  }

  const budgetAfter = await budgetReader(env)
  const comparison = compareV2Responses(
    calls.filter((call) => call.role === 'reference').map(toResponse),
    calls.filter((call) => call.role === 'candidate').map(toResponse),
    models,
    evidence,
  )
  if (stoppedReason) comparison.reasons.push(stoppedReason)
  const reportedCosts = calls.map(({ result }) => result.usage.cost_usd).filter((cost): cost is number => typeof cost === 'number')

  return {
    evidence,
    startedAt,
    config,
    preflight: { passed: true, reasons: [] },
    budgetBefore,
    budgetAfter,
    requestsPlanned: plan.length,
    requestsSent: calls.length,
    stoppedReason,
    calls,
    totalReportedCostUsd: reportedCosts.length ? reportedCosts.reduce((total, cost) => total + cost, 0) : null,
    comparison,
  }
}
