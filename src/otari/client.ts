import type { OtariChatRequest, OtariModelResult, OtariUsage } from './types.js'

export const OTARI_BASE_URL = 'https://api.otari.ai/api/v1'

interface OtariEnv {
  OTARI_API_KEY?: string
}

interface OtariChatResponse {
  model?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: { content?: string | null }
  }>
  usage?: Partial<OtariUsage>
  error?: { code?: string; message?: string }
}

interface OtariModelsResponse {
  data?: Array<{ id?: string }>
}

export interface OtariModelsResult {
  status: 'ok' | 'inconclusive'
  models: string[]
  error: { status: number | null; code: string | null; message: string } | null
}

const emptyUsage = (): OtariUsage => ({
  prompt_tokens: null,
  completion_tokens: null,
  total_tokens: null,
  cost_usd: null,
})

function nullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

export async function callOtari(
  env: OtariEnv,
  request: OtariChatRequest,
  fetcher: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<OtariModelResult> {
  if (!env.OTARI_API_KEY) {
    return {
      requestedModel: request.model,
      effectiveModel: null,
      requestId: null,
      finishReason: null,
      content: null,
      usage: emptyUsage(),
      status: 'inconclusive',
      error: { status: null, code: 'missing_secret', message: 'Otari no está configurado en el Worker.' },
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const body = {
      model: request.model,
      messages: request.messages,
      temperature: 0,
      stream: false,
      max_tokens: request.maxTokens,
      ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
      ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
    }
    const response = await fetcher(`${OTARI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Otari-Key': env.OTARI_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const requestId = response.headers.get('Otari-Request-ID')
    let payload: OtariChatResponse = {}
    try {
      payload = (await response.json()) as OtariChatResponse
    } catch {
      payload = {}
    }

    if (!response.ok) {
      return {
        requestedModel: request.model,
        effectiveModel: payload.model ?? null,
        requestId,
        finishReason: null,
        content: null,
        usage: emptyUsage(),
        status: 'inconclusive',
        error: {
          status: response.status,
          code: payload.error?.code ?? response.headers.get('Otari-Error-Code') ?? `http_${response.status}`,
          message: 'Otari no pudo completar la solicitud.',
        },
      }
    }

    const usage = payload.usage ?? {}
    return {
      requestedModel: request.model,
      effectiveModel: payload.model ?? null,
      requestId,
      finishReason: payload.choices?.[0]?.finish_reason ?? null,
      content: payload.choices?.[0]?.message?.content ?? null,
      usage: {
        prompt_tokens: nullableNumber(usage.prompt_tokens),
        completion_tokens: nullableNumber(usage.completion_tokens),
        total_tokens: nullableNumber(usage.total_tokens),
        cost_usd: nullableNumber(usage.cost_usd),
      },
      status: 'ok',
      error: null,
    }
  } catch (error) {
    return {
      requestedModel: request.model,
      effectiveModel: null,
      requestId: null,
      finishReason: null,
      content: null,
      usage: emptyUsage(),
      status: 'inconclusive',
      error: {
        status: null,
        code: error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'transport_error',
        message: 'No se pudo completar la conexión con Otari.',
      },
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function listOtariModels(
  env: OtariEnv,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<OtariModelsResult> {
  if (!env.OTARI_API_KEY) {
    return {
      status: 'inconclusive',
      models: [],
      error: { status: null, code: 'missing_secret', message: 'Otari no está configurado en el Worker.' },
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetcher(`${OTARI_BASE_URL}/models`, {
      method: 'GET',
      headers: { 'Otari-Key': env.OTARI_API_KEY },
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        status: 'inconclusive',
        models: [],
        error: {
          status: response.status,
          code: response.headers.get('Otari-Error-Code') ?? `http_${response.status}`,
          message: 'Otari no pudo listar los modelos.',
        },
      }
    }

    const payload = (await response.json()) as OtariModelsResponse
    return {
      status: 'ok',
      models: (payload.data ?? []).flatMap((model) => model.id ? [model.id] : []),
      error: null,
    }
  } catch (error) {
    console.error('Otari models request failed', error instanceof Error ? error.name : typeof error)
    return {
      status: 'inconclusive',
      models: [],
      error: {
        status: null,
        code: error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'transport_error',
        message: 'No se pudo consultar los modelos de Otari.',
      },
    }
  } finally {
    clearTimeout(timeout)
  }
}
