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
  code?: string
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

export interface OtariBudgetLimit {
  scope: string | null
  provider: string | null
  limitUsd: number | null
  usedUsd: number | null
  remainingUsd: number | null
  resetsAt: string | null
}

export interface OtariKeyBudgetResult {
  status: 'ok' | 'inconclusive'
  budgetsEnforced: boolean
  remainingUsd: number | null
  limits: OtariBudgetLimit[]
  error: { status: number | null; code: string | null; message: string } | null
}

export interface OtariRequestUsageResult {
  status: 'ok' | 'inconclusive'
  requestId: string
  requestStatus: string | null
  costUsd: number | null
  rowCount: number | null
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

function nullableInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  return Number(value)
}

function nullableBoolean(value: string | null): boolean | null {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function transportErrorCode(error: unknown): string {
  return error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'transport_error'
}

function routingMetadata(headers: Headers) {
  return {
    provider: headers.get('Otari-Provider'),
    servedModel: headers.get('Otari-Model'),
    attemptCount: nullableInteger(headers.get('Otari-Attempt-Count')),
    fallback: nullableBoolean(headers.get('Otari-Fallback')),
    responseDurationMs: nullableInteger(headers.get('Otari-Response-Duration-Ms')),
    serverTiming: headers.get('Server-Timing'),
  }
}

const emptyRoutingMetadata = () => ({
  provider: null,
  servedModel: null,
  attemptCount: null,
  fallback: null,
  responseDurationMs: null,
  serverTiming: null,
})

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
        ...routingMetadata(response.headers),
        finishReason: null,
        content: null,
        usage: emptyUsage(),
        status: 'inconclusive',
        error: {
          status: response.status,
          code: payload.error?.code ?? nullableString(payload.code) ?? response.headers.get('Otari-Error-Code') ?? `http_${response.status}`,
          message: 'Otari no pudo completar la solicitud.',
          budgetScope: response.headers.get('Otari-Budget-Scope'),
          retryAfterSeconds: nullableInteger(response.headers.get('Retry-After')),
          failedProvider: response.headers.get('Otari-Error-Provider'),
          failureTag: response.headers.get('Otari-Error-Tag'),
        },
      }
    }

    const usage = payload.usage ?? {}
    return {
      requestedModel: request.model,
      effectiveModel: payload.model ?? null,
      requestId,
      ...routingMetadata(response.headers),
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
      ...emptyRoutingMetadata(),
      finishReason: null,
      content: null,
      usage: emptyUsage(),
      status: 'inconclusive',
      error: {
        status: null,
        code: transportErrorCode(error),
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

interface OtariKeyBudgetResponse {
  budgets_enforced?: unknown
  remaining_usd?: unknown
  limits?: Array<{
    scope?: unknown
    provider?: unknown
    limit_usd?: unknown
    used_usd?: unknown
    remaining_usd?: unknown
    resets_at?: unknown
  }>
}

export async function getOtariKeyBudget(
  env: OtariEnv,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<OtariKeyBudgetResult> {
  const unavailable = (error: NonNullable<OtariKeyBudgetResult['error']>): OtariKeyBudgetResult => ({
    status: 'inconclusive',
    budgetsEnforced: false,
    remainingUsd: null,
    limits: [],
    error,
  })
  if (!env.OTARI_API_KEY) {
    return unavailable({ status: null, code: 'missing_secret', message: 'Otari no está configurado en el backend.' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(`${OTARI_BASE_URL}/key/budget`, {
      method: 'GET',
      headers: { 'Otari-Key': env.OTARI_API_KEY },
      signal: controller.signal,
    })
    if (!response.ok) {
      return unavailable({
        status: response.status,
        code: response.headers.get('Otari-Error-Code') ?? `http_${response.status}`,
        message: 'Otari no pudo consultar el presupuesto de la API key.',
      })
    }
    let payload: OtariKeyBudgetResponse
    try {
      payload = (await response.json()) as OtariKeyBudgetResponse
    } catch {
      return unavailable({ status: response.status, code: 'invalid_budget_payload', message: 'Respuesta de presupuesto ilegible.' })
    }
    return {
      status: 'ok',
      budgetsEnforced: payload.budgets_enforced === true,
      remainingUsd: nullableNumber(payload.remaining_usd),
      limits: (Array.isArray(payload.limits) ? payload.limits : []).map((limit) => ({
        scope: nullableString(limit.scope),
        provider: nullableString(limit.provider),
        limitUsd: nullableNumber(limit.limit_usd),
        usedUsd: nullableNumber(limit.used_usd),
        remainingUsd: nullableNumber(limit.remaining_usd),
        resetsAt: nullableString(limit.resets_at),
      })),
      error: null,
    }
  } catch (error) {
    return unavailable({ status: null, code: transportErrorCode(error), message: 'No se pudo consultar el presupuesto de Otari.' })
  } finally {
    clearTimeout(timeout)
  }
}

export async function getOtariRequestUsage(
  env: OtariEnv,
  requestId: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<OtariRequestUsageResult> {
  const unavailable = (error: NonNullable<OtariRequestUsageResult['error']>): OtariRequestUsageResult => ({
    status: 'inconclusive',
    requestId,
    requestStatus: null,
    costUsd: null,
    rowCount: null,
    error,
  })
  if (!env.OTARI_API_KEY) {
    return unavailable({ status: null, code: 'missing_secret', message: 'Otari no está configurado en el backend.' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(`${OTARI_BASE_URL}/usage/requests/${encodeURIComponent(requestId)}`, {
      method: 'GET',
      headers: { 'Otari-Key': env.OTARI_API_KEY },
      signal: controller.signal,
    })
    if (!response.ok) {
      return unavailable({
        status: response.status,
        code: response.headers.get('Otari-Error-Code') ?? `http_${response.status}`,
        message: response.status === 404
          ? 'La solicitud aún no está liquidada o no pertenece a esta API key.'
          : 'Otari no pudo consultar el uso de la solicitud.',
      })
    }
    const payload = (await response.json()) as { request_id?: unknown; status?: unknown; cost_usd?: unknown; row_count?: unknown }
    if (payload.request_id !== requestId) {
      return unavailable({ status: response.status, code: 'request_id_mismatch', message: 'El uso devuelto no corresponde a la solicitud.' })
    }
    const rowCount = nullableNumber(payload.row_count)
    return {
      status: 'ok',
      requestId,
      requestStatus: nullableString(payload.status),
      costUsd: nullableNumber(payload.cost_usd),
      rowCount: rowCount !== null && Number.isInteger(rowCount) ? rowCount : null,
      error: null,
    }
  } catch (error) {
    return unavailable({ status: null, code: transportErrorCode(error), message: 'No se pudo consultar el uso de Otari.' })
  } finally {
    clearTimeout(timeout)
  }
}
