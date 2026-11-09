import { describe, expect, it, vi } from 'vitest'
import { callOtari } from '../src/otari/client'

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
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18, cost_usd: 0.0001 },
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
})
