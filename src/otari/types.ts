export interface OtariUsage {
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost_usd: number | null
}

export interface OtariModelResult {
  requestedModel: string
  /** Body `model`. For a routing policy Otari keeps the policy name here, so it is not the served model. */
  effectiveModel: string | null
  requestId: string | null
  /** `Otari-Provider`: the provider instance that served the request. */
  provider?: string | null
  /** `Otari-Model`: the model the serving provider was sent, without the instance prefix. */
  servedModel?: string | null
  attemptCount?: number | null
  fallback?: boolean | null
  responseDurationMs?: number | null
  serverTiming?: string | null
  finishReason: string | null
  content: string | null
  usage: OtariUsage
  status: 'ok' | 'inconclusive'
  error: {
    status: number | null
    code: string | null
    message: string
    budgetScope?: string | null
    retryAfterSeconds?: number | null
    failedProvider?: string | null
    failureTag?: string | null
  } | null
}

export interface OtariChatRequest {
  model: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
  maxTokens: number
  reasoningEffort?: 'low'
  responseFormat?: { type: 'json_object' }
}
