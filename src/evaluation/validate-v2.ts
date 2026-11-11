import Ajv from 'ajv'
import {
  SUPPORT_CARD_V2_ALLOWED_ACTIONS,
  SUPPORT_CARD_V2_PROHIBITED_ACTIONS,
} from '../contracts/support-card.js'
import type {
  SupportCardV2Case,
  SupportCardV2Contract,
  SupportCardV2Output,
} from '../contracts/support-card.js'
import { parseStrictJson } from './parse.js'
import type { RuleCheck, ValidationResult } from './types.js'

const ajv = new Ajv({ allErrors: true, strict: true })

export function validateOutputV2(
  raw: string | null,
  contract: SupportCardV2Contract,
  testCase: SupportCardV2Case,
): ValidationResult<SupportCardV2Output> {
  const baseChecks: RuleCheck[] = contract.rules.map((rule) => ({
    ruleId: rule.id,
    label: rule.label,
    status: 'inconclusive',
    detail: 'Not evaluated.',
  }))

  if (raw === null) {
    return {
      status: 'inconclusive',
      parsed: null,
      checks: baseChecks,
      error: 'No model evidence was provided.',
    }
  }

  const parsed = parseStrictJson<SupportCardV2Output>(raw)
  if (parsed.error || !parsed.value) {
    return {
      status: 'failed',
      parsed: null,
      checks: baseChecks.map((check) => check.ruleId === 'json-valid'
        ? { ...check, status: 'failed', detail: parsed.error ?? 'Invalid JSON.' }
        : check),
      error: parsed.error,
    }
  }

  const value = parsed.value
  const validateSchema = ajv.compile(contract.schema)
  const validSchema = validateSchema(value)
  const schemaError = validSchema
    ? null
    : validateSchema.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
      ?? 'Response does not match the v2 output schema.'
  const hasAllowedCategory = contract.allowedCategories.includes(value.category)
  const categoryMatches = value.category === testCase.referenceCategory
  const requiredFieldsValid = typeof value.urgency === 'string'
    && ['low', 'medium', 'high'].includes(value.urgency)
    && typeof value.actionId === 'string'
  const actionAllowed = SUPPORT_CARD_V2_ALLOWED_ACTIONS[testCase.referenceCategory]
    .some((actionId) => actionId === value.actionId)
    && testCase.expectedActionId === value.actionId
  const actionProhibited = !SUPPORT_CARD_V2_PROHIBITED_ACTIONS.includes(value.actionId)
  const urgencyCompatible = testCase.minimumUrgency === 'any'
    || value.urgency === 'high'
  const knownKeys = Object.keys(value).every((key) => ['category', 'urgency', 'actionId'].includes(key))

  const checks: RuleCheck[] = [
    { ruleId: 'json-valid', label: 'Valid JSON according to the v2 contract', status: validSchema ? 'passed' : 'failed', detail: schemaError ?? 'JSON matches the v2 schema.' },
    { ruleId: 'category-allowed', label: 'Category is in the allowed set', status: hasAllowedCategory ? 'passed' : 'failed', detail: hasAllowedCategory ? 'Category is allowed.' : `Unexpected category: ${String(value.category)}.` },
    { ruleId: 'category-matches-reference', label: 'Category matches the reference', status: categoryMatches ? 'passed' : 'failed', detail: categoryMatches ? 'Category matches the expected case label.' : `Expected ${testCase.referenceCategory}, received ${String(value.category)}.` },
    { ruleId: 'required-fields', label: 'Required fields have the expected types', status: requiredFieldsValid ? 'passed' : 'failed', detail: requiredFieldsValid ? 'Required fields are present and typed.' : 'Urgency or actionId is missing or invalid.' },
    { ruleId: 'action-allowed', label: 'Structured action is allowed for the category', status: actionAllowed ? 'passed' : 'failed', detail: actionAllowed ? `Action ${value.actionId} is allowed for this case.` : `Action ${value.actionId} is not the required action for this case.` },
    { ruleId: 'action-not-prohibited', label: 'Structured action is not explicitly prohibited', status: actionProhibited ? 'passed' : 'failed', detail: actionProhibited ? 'Action is not prohibited.' : `Action ${value.actionId} is explicitly prohibited.` },
    { ruleId: 'urgency-compatible', label: 'Urgency satisfies the category policy', status: urgencyCompatible ? 'passed' : 'failed', detail: urgencyCompatible ? 'Urgency satisfies the case policy.' : 'Lost or stolen cards require high urgency in v2.' },
    { ruleId: 'no-unknown-fields', label: 'No unknown fields are present', status: knownKeys ? 'passed' : 'failed', detail: knownKeys ? 'No unknown fields found.' : 'Response contains an unknown field.' },
  ]

  return {
    status: checks.some((check) => check.status === 'failed') ? 'failed' : 'passed',
    parsed: value,
    checks,
    error: null,
  }
}
