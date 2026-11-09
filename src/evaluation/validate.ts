import Ajv from 'ajv'
import type { SupportCardCase, SupportCardContract, SupportCardOutput } from '../contracts/support-card.js'
import { parseStrictJson } from './parse.js'
import type { RuleCheck, ValidationResult } from './types.js'

const ajv = new Ajv({ allErrors: true, strict: true })

export function validateOutput(
  raw: string | null,
  contract: SupportCardContract,
  testCase: SupportCardCase,
): ValidationResult {
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

  const parsed = parseStrictJson(raw)
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

  const validSchema = ajv.compile(contract.schema)(parsed.value)
  const schemaError = validSchema ? null : ajv.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
  const hasAllowedCategory = contract.allowedCategories.includes(parsed.value.category)
  const categoryMatches = parsed.value.category === testCase.referenceCategory
  const requiredFieldsValid = typeof parsed.value.urgency === 'string'
    && ['low', 'medium', 'high'].includes(parsed.value.urgency)
    && typeof parsed.value.action === 'string'
    && parsed.value.action.trim().length > 0
  const knownKeys = Object.keys(parsed.value).every((key) => ['category', 'urgency', 'action'].includes(key))

  const checks: RuleCheck[] = [
    { ruleId: 'json-valid', label: 'Valid JSON according to the contract', status: validSchema ? 'passed' : 'failed', detail: schemaError ?? 'JSON matches the output schema.' },
    { ruleId: 'category-allowed', label: 'Category is in the allowed set', status: hasAllowedCategory ? 'passed' : 'failed', detail: hasAllowedCategory ? 'Category is allowed.' : `Unexpected category: ${String(parsed.value.category)}.` },
    { ruleId: 'category-matches-reference', label: 'Category matches the reference', status: categoryMatches ? 'passed' : 'failed', detail: categoryMatches ? 'Category matches the expected case label.' : `Expected ${testCase.referenceCategory}, received ${String(parsed.value.category)}.` },
    { ruleId: 'required-fields', label: 'Required fields have the expected types', status: requiredFieldsValid ? 'passed' : 'failed', detail: requiredFieldsValid ? 'Required fields are present and typed.' : 'Urgency or action is missing or invalid.' },
    { ruleId: 'no-unknown-fields', label: 'No unknown fields are present', status: knownKeys ? 'passed' : 'failed', detail: knownKeys ? 'No unknown fields found.' : 'Response contains an unknown field.' },
  ]

  return {
    status: checks.some((check) => check.status === 'failed') ? 'failed' : 'passed',
    parsed: parsed.value as SupportCardOutput,
    checks,
    error: null,
  }
}
