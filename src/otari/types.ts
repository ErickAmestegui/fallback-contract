export interface OtariUsage {
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost_usd: number | null
}

export interface OtariModelResult {
  requestedModel: string
  effectiveModel: string | null
  requestId: string | null
  finishReason: string | null
  content: string | null
  usage: OtariUsage
  status: 'ok' | 'inconclusive'
  error: {
    status: number | null
    code: string | null
    message: string
  } | null
}

export interface OtariChatRequest {
  model: string
  messages: Array<{ role: 'system' | 'user'; content: string }>
  maxTokens: number
  reasoningEffort?: 'low'
  responseFormat?: { type: 'json_object' }
}
