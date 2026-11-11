import { describe, expect, it, vi } from 'vitest'
import { callOtari, getOtariKeyBudget, getOtariRequestUsage, listOtariModels } from '../src/otari/client'

describe('callOtari', () => {
  it('returns an inconclusive result without exposing a missing secret', async () => {
    const result = await callOtari({}, {
      model: 'openai/gpt-oss-20b',
      messages: [{ role: 'user', content: 'test' }],
      maxTokens: 32,
    })

    expect(result.status).toBe('inconclusive')
    expect(result.error?.code).toBe('missing_secret')
    expect(result.content).toBeNull()
  })

  it('parses safe metadata from a successful response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: 'openai/gpt-oss-20b',
      choices: [{ finish_reason: 'stop', message: { content: '{"category":"lost_or_stolen_card"}' } }],
      usage: { prompt_tokens: '10', completion_tokens: '8', total_tokens: '18', cost_usd: '0.0001' },
    }), {
      status: 200,
      headers: { 'Otari-Request-ID': 'req-test-001', 'Content-Type': 'application/json' },
    }))

    const result = await callOtari(
      { OTARI_API_KEY: 'test-secret-never-logged' },
      { model: 'openai/gpt-oss-20b', messages: [{ role: 'user', content: 'test' }], maxTokens: 32 },
      fetcher,
    )

    expect(result).toMatchObject({
      status: 'ok',
      requestId: 'req-test-001',
      effectiveModel: 'openai/gpt-oss-20b',
      finishReason: 'stop',
      usage: { total_tokens: 18, cost_usd: 0.0001 },
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).not.toHaveProperty('tools')
  })

  it('maps upstream failures to inconclusive without returning the upstream body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'invalid_api_key', message: 'secret details' },
    }), { status: 401 }))

    const result = await callOtari(
      { OTARI_API_KEY: 'test-secret-never-logged' },
      { model: 'openai/gpt-oss-20b', messages: [{ role: 'user', content: 'test' }], maxTokens: 32 },
      fetcher,
    )

    expect(result.status).toBe('inconclusive')
    expect(result.error).toMatchObject({ status: 401, code: 'invalid_api_key' })
    expect(result.error?.message).not.toContain('secret details')
  })

  it('preserves a non-JSON upstream HTTP status for completions', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>forbidden</html>', {
      status: 403,
      headers: { 'Content-Type': 'text/html' },
    }))

    const result = await callOtari(
      { OTARI_API_KEY: 'test-secret-never-logged' },
      { model: 'openai/gpt-oss-20b', messages: [{ role: 'user', content: 'test' }], maxTokens: 32 },
      fetcher,
    )

    expect(result).toMatchObject({
      status: 'inconclusive',
      error: { status: 403, code: 'http_403' },
    })
  })

  it('lists models without sending a completion request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'openai/gpt-oss-20b' }, { id: 'alibaba/qwen3-32b' }],
    }), { status: 200 }))

    const result = await listOtariModels({ OTARI_API_KEY: 'test-secret-never-logged' }, fetcher)

    expect(result).toEqual({
      status: 'ok',
      models: ['openai/gpt-oss-20b', 'alibaba/qwen3-32b'],
      error: null,
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.otari.ai/api/v1/models',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('preserves an upstream HTTP error instead of misclassifying it as transport', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>forbidden</html>', {
      status: 403,
      headers: { 'Content-Type': 'text/html' },
    }))

    const result = await listOtariModels({ OTARI_API_KEY: 'test-secret-never-logged' }, fetcher)

    expect(result).toMatchObject({
      status: 'inconclusive',
      models: [],
      error: { status: 403, code: 'http_403' },
    })
  })

  it('reads the enforced monetary ceiling and its scopes from GET /key/budget', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      budgets_enforced: true,
      remaining_usd: 0.19,
      limits: [{
        scope: 'api_token',
        provider: null,
        resets_at: '2026-12-01T00:00:00Z',
        limit_usd: 0.5,
        used_usd: 0.31,
        remaining_usd: 0.19,
      }],
    }), { status: 200 }))

    const result = await getOtariKeyBudget({ OTARI_API_KEY: 'test-secret-never-logged' }, fetcher)

    expect(result).toEqual({
      status: 'ok',
      budgetsEnforced: true,
      remainingUsd: 0.19,
      limits: [{ scope: 'api_token', provider: null, limitUsd: 0.5, usedUsd: 0.31, remainingUsd: 0.19, resetsAt: '2026-12-01T00:00:00Z' }],
      error: null,
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.otari.ai/api/v1/key/budget',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('reports an unreadable budget as inconclusive', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>forbidden</html>', { status: 403 }))

    const result = await getOtariKeyBudget({ OTARI_API_KEY: 'test-secret-never-logged' }, fetcher)

    expect(result).toMatchObject({ status: 'inconclusive', budgetsEnforced: false, remainingUsd: null, error: { status: 403, code: 'http_403' } })
  })
})

describe('Otari routing metadata', () => {
  it('keeps the policy name from the body apart from the served provider and model headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: 'fc-failover',
      choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
      usage: { cost_usd: '0.000020' },
    }), {
      status: 200,
      headers: {
        'Otari-Request-ID': 'req-routed-001',
        'Otari-Provider': 'anthropic',
        'Otari-Model': 'claude-haiku-4-5',
        'Otari-Attempt-Count': '2',
        'Otari-Fallback': 'true',
        'Otari-Response-Duration-Ms': '816',
        'Server-Timing': 'otari;dur=4.2, upstream;dur=812.5, total;dur=816.7',
      },
    }))

    const result = await callOtari(
      { OTARI_API_KEY: 'test-secret-never-logged' },
      { model: 'fc-failover', messages: [{ role: 'user', content: 'test' }], maxTokens: 32 },
      fetcher,
    )

    expect(result).toMatchObject({
      status: 'ok',
      requestedModel: 'fc-failover',
      effectiveModel: 'fc-failover',
      provider: 'anthropic',
      servedModel: 'claude-haiku-4-5',
      attemptCount: 2,
      fallback: true,
      responseDurationMs: 816,
      usage: { cost_usd: 0.00002 },
    })
  })

  it('preserves documented refusal headers when every candidate fails', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      detail: 'provider failure', code: 'provider_error',
    }), {
      status: 502,
      headers: {
        'Otari-Request-ID': 'req-routed-002',
        'Otari-Error-Provider': 'anthropic',
        'Otari-Error-Tag': 'timeout',
      },
    }))

    const result = await callOtari(
      { OTARI_API_KEY: 'test-secret-never-logged' },
      { model: 'fc-failover', messages: [{ role: 'user', content: 'test' }], maxTokens: 32 },
      fetcher,
    )

    expect(result).toMatchObject({
      status: 'inconclusive',
      requestId: 'req-routed-002',
      provider: null,
      servedModel: null,
      error: { status: 502, code: 'provider_error', failedProvider: 'anthropic', failureTag: 'timeout' },
    })
    expect(result.error?.message).not.toContain('provider failure')
  })

  it('reads budget scope and Retry-After from a budget refusal', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      detail: 'exceeded', code: 'budget_exceeded',
    }), {
      status: 403,
      headers: { 'Otari-Error-Code': 'budget_exceeded', 'Otari-Budget-Scope': 'api_token', 'Retry-After': '3600' },
    }))

    const result = await callOtari(
      { OTARI_API_KEY: 'test-secret-never-logged' },
      { model: 'fc-failover', messages: [{ role: 'user', content: 'test' }], maxTokens: 32 },
      fetcher,
    )

    expect(result.error).toMatchObject({ status: 403, code: 'budget_exceeded', budgetScope: 'api_token', retryAfterSeconds: 3600 })
  })
})

describe('getOtariRequestUsage', () => {
  it('reads the usage rows written under one Otari-Request-ID', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      request_id: 'req/routed 003',
      status: 'success',
      cost_usd: '0.000020',
      row_count: 2,
    }), { status: 200 }))

    const result = await getOtariRequestUsage({ OTARI_API_KEY: 'test-secret-never-logged' }, 'req/routed 003', fetcher)

    expect(result).toEqual({ status: 'ok', requestId: 'req/routed 003', requestStatus: 'success', costUsd: 0.00002, rowCount: 2, error: null })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.otari.ai/api/v1/usage/requests/req%2Frouted%20003',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('treats an unsettled request as inconclusive', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 404 }))

    const result = await getOtariRequestUsage({ OTARI_API_KEY: 'test-secret-never-logged' }, 'req-pending', fetcher)

    expect(result).toMatchObject({ status: 'inconclusive', rowCount: null, error: { status: 404, code: 'http_404' } })
  })
})
