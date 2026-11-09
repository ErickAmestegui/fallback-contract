export const CONTRACT_ID = 'support-card-classification-v1' as const
export const CONTRACT_VERSION = '1.0.0' as const

export const SUPPORT_CARD_CATEGORIES = [
  'lost_or_stolen_card',
  'change_pin',
  'card_arrival',
] as const

export const SUPPORT_CARD_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['category', 'urgency', 'action'],
  properties: {
    category: { type: 'string', enum: SUPPORT_CARD_CATEGORIES },
    urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
    action: { type: 'string', minLength: 1 },
  },
} as const

export const SUPPORT_CARD_CASES = [
  {
    id: 'lost-card-001',
    message: 'I lost my debit card and need to freeze it.',
    referenceCategory: 'lost_or_stolen_card',
  },
  {
    id: 'pin-001',
    message: 'I need to change the PIN on my card.',
    referenceCategory: 'change_pin',
  },
  {
    id: 'arrival-001',
    message: 'My replacement card has not arrived yet.',
    referenceCategory: 'card_arrival',
  },
] as const

export const MODEL_OPTIONS = {
  reference: 'openai/gpt-oss-20b',
  candidate: 'alibaba/qwen3-32b',
} as const

export const CONTRACT_RULES = [
  'Valid JSON according to the contract',
  'Category is in the allowed set',
  'Category matches the reference',
  'Required fields have the expected types',
  'No unknown fields are present',
] as const

export const SUPPORT_CARD_RULES = [
  { id: 'json-valid', label: 'Valid JSON according to the contract' },
  { id: 'category-allowed', label: 'Category is in the allowed set' },
  { id: 'category-matches-reference', label: 'Category matches the reference' },
  { id: 'required-fields', label: 'Required fields have the expected types' },
  { id: 'no-unknown-fields', label: 'No unknown fields are present' },
] as const

export type SupportCardCategory = typeof SUPPORT_CARD_CATEGORIES[number]
export type SupportCardCase = typeof SUPPORT_CARD_CASES[number]
export type SupportCardOutput = {
  category: SupportCardCategory
  urgency: 'low' | 'medium' | 'high'
  action: string
}

export interface SupportCardContract {
  id: typeof CONTRACT_ID
  version: typeof CONTRACT_VERSION
  schema: typeof SUPPORT_CARD_SCHEMA
  allowedCategories: readonly SupportCardCategory[]
  cases: readonly SupportCardCase[]
  rules: typeof SUPPORT_CARD_RULES
}

export const SUPPORT_CARD_CONTRACT: SupportCardContract = {
  id: CONTRACT_ID,
  version: CONTRACT_VERSION,
  schema: SUPPORT_CARD_SCHEMA,
  allowedCategories: SUPPORT_CARD_CATEGORIES,
  cases: SUPPORT_CARD_CASES,
  rules: SUPPORT_CARD_RULES,
}

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
