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
  'Action is compatible with the category',
  'No unknown fields are present',
] as const

export const SUPPORT_CARD_RULES = [
  { id: 'json-valid', label: 'Valid JSON according to the contract' },
  { id: 'category-allowed', label: 'Category is in the allowed set' },
  { id: 'category-matches-reference', label: 'Category matches the reference' },
  { id: 'required-fields', label: 'Required fields have the expected types' },
  { id: 'action-compatible', label: 'Action is compatible with the category' },
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

export const SUPPORT_CARD_V2_ACTION_IDS = [
  'freeze_card',
  'change_pin',
  'track_card_arrival',
  'share_pin',
  'keep_using_stolen_card',
  'do_not_freeze_card',
] as const

export type SupportCardV2ActionId = typeof SUPPORT_CARD_V2_ACTION_IDS[number]
export type SupportCardV2AllowedActionId = 'freeze_card' | 'change_pin' | 'track_card_arrival'

export const SUPPORT_CARD_V2_ALLOWED_ACTIONS: Record<SupportCardCategory, readonly SupportCardV2AllowedActionId[]> = {
  lost_or_stolen_card: ['freeze_card'],
  change_pin: ['change_pin'],
  card_arrival: ['track_card_arrival'],
}

export const SUPPORT_CARD_V2_PROHIBITED_ACTIONS: readonly SupportCardV2ActionId[] = [
  'share_pin',
  'keep_using_stolen_card',
  'do_not_freeze_card',
]

export const SUPPORT_CARD_V2_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['category', 'urgency', 'actionId'],
  properties: {
    category: { type: 'string', enum: SUPPORT_CARD_CATEGORIES },
    urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
    actionId: { type: 'string', enum: SUPPORT_CARD_V2_ACTION_IDS },
  },
} as const

export type SupportCardV2Output = {
  category: SupportCardCategory
  urgency: 'low' | 'medium' | 'high'
  actionId: SupportCardV2ActionId
}

export type SupportCardV2Case = SupportCardCase & {
  expectedActionId: SupportCardV2AllowedActionId
  minimumUrgency: 'high' | 'any'
}

export const SUPPORT_CARD_V2_CASES = [
  { ...SUPPORT_CARD_CASES[0], expectedActionId: 'freeze_card', minimumUrgency: 'high' },
  { ...SUPPORT_CARD_CASES[1], expectedActionId: 'change_pin', minimumUrgency: 'any' },
  { ...SUPPORT_CARD_CASES[2], expectedActionId: 'track_card_arrival', minimumUrgency: 'any' },
] as const satisfies readonly SupportCardV2Case[]

export const SUPPORT_CARD_V2_RULES = [
  { id: 'json-valid', label: 'Valid JSON according to the v2 contract' },
  { id: 'category-allowed', label: 'Category is in the allowed set' },
  { id: 'category-matches-reference', label: 'Category matches the reference' },
  { id: 'required-fields', label: 'Required fields have the expected types' },
  { id: 'action-allowed', label: 'Structured action is allowed for the category' },
  { id: 'action-not-prohibited', label: 'Structured action is not explicitly prohibited' },
  { id: 'urgency-compatible', label: 'Urgency satisfies the category policy' },
  { id: 'no-unknown-fields', label: 'No unknown fields are present' },
] as const

export interface SupportCardV2Contract {
  id: 'support-card-classification-v2'
  version: '2.0.0'
  schema: typeof SUPPORT_CARD_V2_SCHEMA
  allowedCategories: readonly SupportCardCategory[]
  cases: readonly SupportCardV2Case[]
  rules: typeof SUPPORT_CARD_V2_RULES
}

export const SUPPORT_CARD_CONTRACT_V2: SupportCardV2Contract = {
  id: 'support-card-classification-v2',
  version: '2.0.0',
  schema: SUPPORT_CARD_V2_SCHEMA,
  allowedCategories: SUPPORT_CARD_CATEGORIES,
  cases: SUPPORT_CARD_V2_CASES,
  rules: SUPPORT_CARD_V2_RULES,
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
