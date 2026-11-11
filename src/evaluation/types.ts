import type { Decision, ModelRole, SupportCardCase, SupportCardContract, SupportCardOutput } from '../contracts/support-card.js'

export type CheckStatus = 'passed' | 'failed' | 'inconclusive'

export interface RuleCheck {
  ruleId: string
  label: string
  status: CheckStatus
  detail: string
}

export interface ValidationResult<TParsed = SupportCardOutput> {
  status: CheckStatus
  parsed: TParsed | null
  checks: RuleCheck[]
  error: string | null
}

export interface CaseEvaluation<TParsed = SupportCardOutput> {
  caseId: string
  role: ModelRole
  rawOutput: string | null
  requestId?: string | null
  provider?: string | null
  servedModel?: string | null
  attemptCount?: number | null
  fallback?: boolean | null
  responseDurationMs?: number | null
  serverTiming?: string | null
  responseStatus?: 'ok' | 'inconclusive'
  errorCode?: string | null
  validation: ValidationResult<TParsed>
  evidence: 'local-fixture' | 'otari'
}

export interface ModelEvaluation<TParsed = SupportCardOutput> {
  role: ModelRole
  requestedModel: string
  effectiveModel: string | null
  cases: CaseEvaluation<TParsed>[]
  technicalError: string | null
  modelIdentityMismatch?: boolean
  modelIdentityReasons?: string[]
  routing?: RoutingSummary
}

export interface RoutingSummary {
  policy: string
  primary: string
  onFailure: readonly string[]
  servedTargets: string[]
  fallbackCaseIds: string[]
  maxAttemptCount: number | null
}

export interface ComparisonInput<TParsed = SupportCardOutput> {
  contract: SupportCardContract | { id: string; version: string; cases: readonly SupportCardCase[] }
  cases: readonly SupportCardCase[]
  reference: ModelEvaluation<TParsed>
  candidate: ModelEvaluation<TParsed>
}

export interface ComparisonResult<TParsed = SupportCardOutput> {
  contractId: string
  contractVersion: string
  decision: Decision
  reasons: string[]
  reference: ModelEvaluation<TParsed>
  candidate: ModelEvaluation<TParsed>
  evidence: 'local-fixture' | 'otari'
}
