export const CONTRACT_ID = 'support-card-classification-v1' as const

export const MODEL_OPTIONS = {
  reference: 'openai/gpt-oss-20b',
  candidate: 'alibaba/qwen3-32b',
} as const

export const CONTRACT_RULES = [
  'JSON válido según el contrato',
  'Categoría dentro del conjunto permitido',
  'La categoría coincide con la referencia',
] as const

export type ModelRole = 'reference' | 'candidate'
export type ContractStatus = 'passed' | 'failed' | 'inconclusive'
export type Decision = 'APPROVE' | 'REJECT' | 'INCONCLUSIVE'

export interface ModelSelection {
  role: ModelRole
  model: string
}

export interface BackendStatus {
  service: 'fallback-contract-worker'
  status: 'ok'
  otari: 'not_checked'
  message: string
  contractId: typeof CONTRACT_ID
}
