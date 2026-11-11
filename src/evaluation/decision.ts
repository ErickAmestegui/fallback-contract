import type { ComparisonInput, ComparisonResult, ModelEvaluation } from './types.js'
import type { SupportCardOutput } from '../contracts/support-card.js'

function modelHasInconclusive<TParsed>(model: ModelEvaluation<TParsed>): boolean {
  return Boolean(model.technicalError) || model.modelIdentityMismatch === true || model.cases.some((item) => item.rawOutput === null
    || item.validation.status === 'inconclusive'
    || (item.validation.status === 'passed' && item.validation.parsed === null))
}

function modelHasFunctionalFailure<TParsed>(model: ModelEvaluation<TParsed>): boolean {
  return model.cases.some((item) => item.validation.status === 'failed')
}

function hasCompleteSharedEvidence<TParsed>(input: ComparisonInput<TParsed>): boolean {
  const contractIds = input.contract.cases.map((testCase) => testCase.id)
  const expectedIds = input.cases.map((testCase) => testCase.id)
  const referenceIds = input.reference.cases.map((item) => item.caseId)
  const candidateIds = input.candidate.cases.map((item) => item.caseId)
  const uniqueNonEmpty = (ids: string[]) => ids.length > 0 && new Set(ids).size === ids.length
  const sameIds = (left: string[], right: string[]) => left.length === right.length
    && left.every((id) => right.includes(id))

  return uniqueNonEmpty(contractIds)
    && uniqueNonEmpty(expectedIds)
    && uniqueNonEmpty(referenceIds)
    && uniqueNonEmpty(candidateIds)
    && sameIds(expectedIds, contractIds)
    && sameIds(referenceIds, expectedIds)
    && sameIds(candidateIds, expectedIds)
}

function evidenceKind<TParsed>(input: ComparisonInput<TParsed>): 'local-fixture' | 'otari' {
  return [...input.reference.cases, ...input.candidate.cases].every((item) => item.evidence === 'otari')
    ? 'otari'
    : 'local-fixture'
}

export function decideComparison<TParsed = SupportCardOutput>(
  input: ComparisonInput<TParsed>,
): ComparisonResult<TParsed> {
  const reasons: string[] = []
  const evidence = evidenceKind(input)
  const referenceInconclusive = modelHasInconclusive(input.reference)
  const candidateInconclusive = modelHasInconclusive(input.candidate)
  const referenceFailed = modelHasFunctionalFailure(input.reference)
  const candidateFailed = modelHasFunctionalFailure(input.candidate)

  if (!hasCompleteSharedEvidence(input)) {
    reasons.push('Reference and candidate must provide evidence for exactly the same contract cases.')
    return { ...input, contractId: input.contract.id, contractVersion: input.contract.version, decision: 'INCONCLUSIVE', reasons, evidence }
  }

  if (referenceInconclusive || candidateInconclusive) {
    if (referenceInconclusive) reasons.push('Reference evidence is incomplete or technically unavailable.')
    if (candidateInconclusive) reasons.push('Candidate evidence is incomplete or technically unavailable.')
    if (input.reference.modelIdentityMismatch) reasons.push(...(input.reference.modelIdentityReasons ?? ['Reference effective model differs from requested model.']))
    if (input.candidate.modelIdentityMismatch) reasons.push(...(input.candidate.modelIdentityReasons ?? ['Candidate effective model differs from requested model.']))
    return { ...input, contractId: input.contract.id, contractVersion: input.contract.version, decision: 'INCONCLUSIVE', reasons, evidence }
  }

  if (referenceFailed) {
    reasons.push('Reference output does not establish a valid baseline for comparison.')
    return { ...input, contractId: input.contract.id, contractVersion: input.contract.version, decision: 'INCONCLUSIVE', reasons, evidence }
  }

  if (candidateFailed) {
    const failedChecks = input.candidate.cases.flatMap((item) => item.validation.checks
      .filter((check) => check.status === 'failed')
      .map((check) => ({ caseId: item.caseId, check })))
    const hasFormatFailure = failedChecks.some(({ check }) => check.ruleId === 'json-valid')
    reasons.push(hasFormatFailure
      ? 'Candidate rejected: a mandatory JSON-format check failed.'
      : 'Candidate has at least one confirmed contract rule failure.')
    failedChecks.forEach(({ caseId, check }) => {
      reasons.push(`${caseId}: ${check.label} — ${check.detail}`)
    })
    return { ...input, contractId: input.contract.id, contractVersion: input.contract.version, decision: 'REJECT', reasons, evidence }
  }

  reasons.push('Candidate passed every mandatory rule on every shared test case.')
  return { ...input, contractId: input.contract.id, contractVersion: input.contract.version, decision: 'APPROVE', reasons, evidence }
}
