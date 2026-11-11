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

export interface OtariTool {
  id: string
  available: boolean
  acceptedTypes: string[]
}

export interface OtariToolsResult {
  status: 'ok' | 'inconclusive'
  tools: OtariTool[]
  error: { status: number | null; code: string | null; message: string } | null
}

export async function listOtariTools(
  env: OtariEnv,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<OtariToolsResult> {
  const unavailable = (error: NonNullable<OtariToolsResult['error']>): OtariToolsResult => ({ status: 'inconclusive', tools: [], error })
  if (!env.OTARI_API_KEY) {
    return unavailable({ status: null, code: 'missing_secret', message: 'Otari no está configurado en el backend.' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(`${OTARI_BASE_URL}/tools`, {
      method: 'GET',
      headers: { 'Otari-Key': env.OTARI_API_KEY },
      signal: controller.signal,
    })
    if (!response.ok) {
      return unavailable({
        status: response.status,
        code: response.headers.get('Otari-Error-Code') ?? `http_${response.status}`,
        message: 'Otari no pudo listar sus herramientas.',
      })
    }
    const payload = (await response.json()) as { data?: Array<{ id?: unknown; available?: unknown; accepted_types?: unknown }> }
    return {
      status: 'ok',
      tools: (Array.isArray(payload.data) ? payload.data : [])
        .filter((tool) => typeof tool.id === 'string')
        .map((tool) => ({
          id: tool.id as string,
          available: tool.available === true,
          acceptedTypes: Array.isArray(tool.accepted_types) ? tool.accepted_types.filter((type): type is string => typeof type === 'string') : [],
        })),
      error: null,
    }
  } catch (error) {
    return unavailable({ status: null, code: transportErrorCode(error), message: 'No se pudo listar las herramientas de Otari.' })
  } finally {
    clearTimeout(timeout)
  }
}

export interface OtariFetchResult {
  status: 'ok' | 'inconclusive'
  requestId: string | null
  url: string
  finalUrl: string | null
  title: string | null
  contentType: string | null
  /** Untrusted page text extracted by Otari's fetcher. */
  text: string | null
  truncated: boolean | null
  error: { status: number | null; code: string | null; message: string } | null
}

/** `POST /api/v1/fetch` with the gateway's own fetcher. Billed per successful call. */
export async function fetchOtariPage(
  env: OtariEnv,
  url: string,
  maxChars: number,
  fetcher: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<OtariFetchResult> {
  const unavailable = (error: NonNullable<OtariFetchResult['error']>, requestId: string | null = null): OtariFetchResult => ({
    status: 'inconclusive',
    requestId,
    url,
    finalUrl: null,
    title: null,
    contentType: null,
    text: null,
    truncated: null,
    error,
  })
  if (!env.OTARI_API_KEY) {
    return unavailable({ status: null, code: 'missing_secret', message: 'Otari no está configurado en el backend.' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(`${OTARI_BASE_URL}/fetch`, {
      method: 'POST',
      headers: { 'Otari-Key': env.OTARI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, fetch_tool_name: 'builtin_fetch', max_chars: maxChars }),
      signal: controller.signal,
    })
    const requestId = response.headers.get('Otari-Request-ID')
    let payload: { code?: unknown; url?: unknown; final_url?: unknown; title?: unknown; content_type?: unknown; text?: unknown; truncated?: unknown }
    try {
      payload = (await response.json()) as typeof payload
    } catch {
      return unavailable({ status: response.status, code: response.ok ? 'invalid_fetch_payload' : `http_${response.status}`, message: 'Respuesta de fetch ilegible.' }, requestId)
    }
    if (!response.ok) {
      return unavailable({
        status: response.status,
        code: nullableString(payload.code) ?? response.headers.get('Otari-Error-Code') ?? `http_${response.status}`,
        message: 'Otari rechazó o no pudo completar el fetch.',
      }, requestId)
    }
    return {
      status: typeof payload.text === 'string' ? 'ok' : 'inconclusive',
      requestId,
      url: nullableString(payload.url) ?? url,
      finalUrl: nullableString(payload.final_url),
      title: nullableString(payload.title),
      contentType: nullableString(payload.content_type),
      text: typeof payload.text === 'string' ? payload.text : null,
      truncated: typeof payload.truncated === 'boolean' ? payload.truncated : null,
      error: typeof payload.text === 'string' ? null : { status: response.status, code: 'missing_fetch_text', message: 'Otari no devolvió texto.' },
    }
  } catch (error) {
    return unavailable({ status: null, code: transportErrorCode(error), message: 'No se pudo completar el fetch de Otari.' })
  } finally {
    clearTimeout(timeout)
  }
}
