import type { ComparisonInput, ComparisonResult, ModelEvaluation } from './types.js'

function modelHasInconclusive(model: ModelEvaluation): boolean {
  return Boolean(model.technicalError) || model.cases.some((item) => item.validation.status === 'inconclusive')
}

function modelHasFunctionalFailure(model: ModelEvaluation): boolean {
  return model.cases.some((item) => item.validation.status === 'failed')
}

function hasCompleteSharedEvidence(input: ComparisonInput): boolean {
  const expected = new Set(input.cases.map((testCase) => testCase.id))
  const reference = new Set(input.reference.cases.map((item) => item.caseId))
  const candidate = new Set(input.candidate.cases.map((item) => item.caseId))
  return expected.size === reference.size && expected.size === candidate.size
    && [...expected].every((caseId) => reference.has(caseId) && candidate.has(caseId))
}

function evidenceKind(input: ComparisonInput): 'local-fixture' | 'otari' {
  return [...input.reference.cases, ...input.candidate.cases].every((item) => item.evidence === 'otari')
    ? 'otari'
    : 'local-fixture'
}

export function decideComparison(input: ComparisonInput): ComparisonResult {
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
    return { ...input, contractId: input.contract.id, contractVersion: input.contract.version, decision: 'INCONCLUSIVE', reasons, evidence }
  }

  if (referenceFailed) {
    reasons.push('Reference output does not establish a valid baseline for comparison.')
    return { ...input, contractId: input.contract.id, contractVersion: input.contract.version, decision: 'INCONCLUSIVE', reasons, evidence }
  }

  if (candidateFailed) {
    reasons.push('Candidate has at least one confirmed functional contract failure.')
    input.candidate.cases.forEach((item) => item.validation.checks.filter((check) => check.status === 'failed').forEach((check) => {
      reasons.push(`${item.caseId}: ${check.label} — ${check.detail}`)
    }))
    return { ...input, contractId: input.contract.id, contractVersion: input.contract.version, decision: 'REJECT', reasons, evidence }
  }

  reasons.push('Candidate passed every mandatory rule on every shared test case.')
  return { ...input, contractId: input.contract.id, contractVersion: input.contract.version, decision: 'APPROVE', reasons, evidence }
}
