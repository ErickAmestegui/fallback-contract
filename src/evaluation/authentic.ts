import type { ComparisonResult } from './types.js'
import type { OtariModelResult } from '../otari/types.js'

export interface AuthenticModelEvidence {
  role: 'reference' | 'candidate'
  cases: Array<{
    caseId: string
    result: OtariModelResult
  }>
}

export interface AuthenticComparisonResponse {
  comparison: ComparisonResult
  evidence: AuthenticModelEvidence[]
  totalCostUsd: number | null
}
