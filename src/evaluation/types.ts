import type { Decision, ModelRole, SupportCardCase, SupportCardContract, SupportCardOutput } from '../contracts/support-card.js'

export type CheckStatus = 'passed' | 'failed' | 'inconclusive'

export interface RuleCheck {
  ruleId: string
  label: string
  status: CheckStatus
  detail: string
}

export interface ValidationResult {
  status: CheckStatus
  parsed: SupportCardOutput | null
  checks: RuleCheck[]
  error: string | null
}

export interface CaseEvaluation {
  caseId: string
  role: ModelRole
  rawOutput: string | null
  validation: ValidationResult
  evidence: 'local-fixture' | 'otari'
}

export interface ModelEvaluation {
  role: ModelRole
  requestedModel: string
  effectiveModel: string | null
  cases: CaseEvaluation[]
  technicalError: string | null
}

export interface ComparisonInput {
  contract: SupportCardContract
  cases: readonly SupportCardCase[]
  reference: ModelEvaluation
  candidate: ModelEvaluation
}

export interface ComparisonResult {
  contractId: string
  contractVersion: string
  decision: Decision
  reasons: string[]
  reference: ModelEvaluation
  candidate: ModelEvaluation
  evidence: 'local-fixture' | 'otari'
}
