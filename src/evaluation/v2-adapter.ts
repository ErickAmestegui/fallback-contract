import {
  MODEL_OPTIONS,
  SUPPORT_CARD_CONTRACT_V2,
  SUPPORT_CARD_V2_CASES,
  type SupportCardV2Output,
} from '../contracts/support-card.js'
import { decideComparison } from './decision.js'
import type { CaseEvaluation, ComparisonResult, ModelEvaluation, RoutingSummary } from './types.js'
import { validateOutputV2 } from './validate-v2.js'

export interface V2OfflineResponse {
  caseId: string
  requestedModel: string
  effectiveModel: string | null
  requestId: string | null
  rawOutput: string | null
  provider?: string | null
  servedModel?: string | null
  attemptCount?: number | null
  fallback?: boolean | null
  responseDurationMs?: number | null
  serverTiming?: string | null
  responseStatus?: 'ok' | 'inconclusive'
  errorCode?: string | null
  technicalError?: string | null
}

export interface V2DirectModelConfig {
  kind: 'direct'
  requestedModel: string
}

// Mirrors an Otari policy `select: [{ default: primary }]` + `on_failure: onFailure`.
export interface V2FailoverPolicyConfig {
  kind: 'otari-failover-policy'
  policy: string
  primary: string
  onFailure: readonly string[]
}

export type V2ModelConfig = V2DirectModelConfig | V2FailoverPolicyConfig

export type EvidenceKind = 'local-fixture' | 'otari'

const OTARI_MAX_PLAN_CANDIDATES = 5
const TARGET_PATTERN = /^[A-Za-z0-9_.-]+:[^\s:][^\s]*$/

export function validateFailoverPolicyConfig(config: V2FailoverPolicyConfig): string[] {
  const errors: string[] = []
  if (!config.policy || /[:/\s]/.test(config.policy)) {
    errors.push('Policy name is required and cannot contain ":", "/" or whitespace.')
  }
  const targets = [config.primary, ...config.onFailure]
  targets.forEach((target) => {
    if (!TARGET_PATTERN.test(target)) errors.push(`Target "${target}" is not a concrete provider:model selector.`)
  })
  if (config.onFailure.length === 0) errors.push('A failover policy needs at least one on_failure target.')
  if (new Set(targets).size !== targets.length) errors.push('Policy targets must be distinct.')
  if (targets.length > OTARI_MAX_PLAN_CANDIDATES) errors.push(`An Otari plan holds at most ${OTARI_MAX_PLAN_CANDIDATES} candidates.`)
  return errors
}

function requestedModelOf(config: V2ModelConfig): string {
  return config.kind === 'direct' ? config.requestedModel : config.policy
}

function servedTarget(response: V2OfflineResponse): string | null {
  return response.provider && response.servedModel ? `${response.provider}:${response.servedModel}` : null
}

function failoverIdentityIssues(config: V2FailoverPolicyConfig, response: V2OfflineResponse, role: string): string[] {
  const issues: string[] = []
  const id = response.caseId
  if (response.effectiveModel === null) {
    issues.push(`${role} response model is unavailable for ${id}.`)
  } else if (response.effectiveModel !== config.policy) {
    issues.push(`${role} response model for ${id} is ${response.effectiveModel}, not the policy name ${config.policy}.`)
  }

  const target = servedTarget(response)
  if (target === null) {
    issues.push(`${role} served provider/model metadata is unavailable for ${id}.`)
    return issues
  }
  if (target !== config.primary && !config.onFailure.includes(target)) {
    issues.push(`${role} served target ${target} for ${id} is not a candidate of policy ${config.policy}.`)
  }

  const attempts = response.attemptCount
  if (attempts === null || attempts === undefined || attempts < 1 || attempts > OTARI_MAX_PLAN_CANDIDATES) {
    issues.push(`${role} attempt count is unavailable or out of range for ${id}.`)
  }
  if (response.fallback === null || response.fallback === undefined) {
    issues.push(`${role} fallback flag is unavailable for ${id}.`)
  } else if (response.fallback === false && (target !== config.primary || (attempts ?? 0) > 1)) {
    issues.push(`${role} metadata for ${id} is inconsistent: no fallback reported but served ${target} after ${attempts ?? 'unknown'} attempts.`)
  } else if (response.fallback === true && target === config.primary) {
    issues.push(`${role} metadata for ${id} is inconsistent: fallback reported but the primary ${target} served.`)
  }
  return issues
}

function routingSummary(config: V2FailoverPolicyConfig, responses: readonly V2OfflineResponse[]): RoutingSummary {
  const attempts = responses
    .map((response) => response.attemptCount)
    .filter((count): count is number => typeof count === 'number')
  return {
    policy: config.policy,
    primary: config.primary,
    onFailure: config.onFailure,
    servedTargets: [...new Set(responses.map(servedTarget).filter((target): target is string => target !== null))],
    fallbackCaseIds: responses.filter((response) => response.fallback === true).map((response) => response.caseId),
    maxAttemptCount: attempts.length ? Math.max(...attempts) : null,
  }
}

export function evaluateV2Model(
  role: 'reference' | 'candidate',
  config: V2ModelConfig,
  responses: readonly V2OfflineResponse[],
  evidence: EvidenceKind,
): ModelEvaluation<SupportCardV2Output> {
  const requestedModel = requestedModelOf(config)
  const responseByCase = new Map<string, V2OfflineResponse>()
  const requestIds = new Set<string>()
  const structuralErrors: string[] = []
  for (const response of responses) {
    if (responseByCase.has(response.caseId)) structuralErrors.push(`Duplicate v2 response for ${response.caseId}.`)
    if (!SUPPORT_CARD_V2_CASES.some((testCase) => testCase.id === response.caseId)) structuralErrors.push(`Unknown v2 case ${response.caseId}.`)
    if (response.requestId !== null) {
      if (requestIds.has(response.requestId)) structuralErrors.push(`Duplicate ${role} request ID ${response.requestId}.`)
      requestIds.add(response.requestId)
    }
    responseByCase.set(response.caseId, response)
  }

  const identityReasons = new Set<string>()
  const cases: CaseEvaluation<SupportCardV2Output>[] = SUPPORT_CARD_V2_CASES.map((testCase) => {
    const response = responseByCase.get(testCase.id)
    if (!response) {
      structuralErrors.push(`Missing v2 response for ${testCase.id}.`)
      return {
        caseId: testCase.id,
        role,
        rawOutput: null,
        requestId: null,
        responseStatus: 'inconclusive',
        validation: validateOutputV2(null, SUPPORT_CARD_CONTRACT_V2, testCase),
        evidence,
      }
    }

    if (response.requestedModel !== requestedModel) {
      identityReasons.add(`${role} requested model metadata differs for ${testCase.id}.`)
    }
    const failedTechnically = Boolean(response.technicalError) || response.responseStatus === 'inconclusive'
    if (config.kind === 'otari-failover-policy') {
      if (!failedTechnically) failoverIdentityIssues(config, response, role).forEach((issue) => identityReasons.add(issue))
    } else if (response.effectiveModel === null) {
      identityReasons.add(`${role} effective model is unavailable for ${testCase.id}.`)
    } else if (response.effectiveModel !== requestedModel) {
      identityReasons.add(`${role} effective model differs for ${testCase.id}: requested ${requestedModel}, effective ${response.effectiveModel}.`)
    }

    return {
      caseId: testCase.id,
      role,
      rawOutput: response.rawOutput,
      requestId: response.requestId,
      provider: response.provider,
      servedModel: response.servedModel,
      attemptCount: response.attemptCount,
      fallback: response.fallback,
      responseDurationMs: response.responseDurationMs,
      serverTiming: response.serverTiming,
      responseStatus: response.responseStatus,
      errorCode: response.errorCode,
      validation: validateOutputV2(response.rawOutput, SUPPORT_CARD_CONTRACT_V2, testCase),
      evidence,
    }
  })

  const responseErrors = responses
    .map((response) => response.technicalError)
    .filter((error): error is string => Boolean(error))
  const technicalErrors = [...structuralErrors, ...responseErrors]

  let effectiveModel: string | null
  let routing: RoutingSummary | undefined
  if (config.kind === 'otari-failover-policy') {
    routing = routingSummary(config, responses)
    effectiveModel = routing.servedTargets.length === 1 ? routing.servedTargets[0] : null
  } else {
    effectiveModel = responses.find((response) => response.effectiveModel !== null)?.effectiveModel ?? null
  }

  return {
    role,
    requestedModel,
    effectiveModel,
    cases,
    technicalError: technicalErrors.length ? technicalErrors.join(' ') : null,
    modelIdentityMismatch: identityReasons.size > 0,
    modelIdentityReasons: [...identityReasons],
    ...(routing ? { routing } : {}),
  }
}

export function compareV2Offline(
  reference: readonly V2OfflineResponse[],
  candidate: readonly V2OfflineResponse[],
  models: { reference?: string; candidate?: string } = {},
): ComparisonResult<SupportCardV2Output> {
  return compareV2Responses(reference, candidate, {
    reference: { kind: 'direct', requestedModel: models.reference ?? MODEL_OPTIONS.reference },
    candidate: { kind: 'direct', requestedModel: models.candidate ?? MODEL_OPTIONS.candidate },
  }, 'local-fixture')
}

export function compareV2Responses(
  reference: readonly V2OfflineResponse[],
  candidate: readonly V2OfflineResponse[],
  models: { reference: V2ModelConfig; candidate: V2ModelConfig },
  evidence: EvidenceKind,
): ComparisonResult<SupportCardV2Output> {
  const referenceEvaluation = evaluateV2Model('reference', models.reference, reference, evidence)
  const candidateEvaluation = evaluateV2Model('candidate', models.candidate, candidate, evidence)
  const referenceIds = new Set(reference.map((response) => response.requestId).filter((id): id is string => id !== null))
  const shared = candidate.filter((response) => response.requestId !== null && referenceIds.has(response.requestId))
  if (shared.length) {
    const message = `Request IDs shared between reference and candidate: ${shared.map((response) => response.requestId).join(', ')}.`
    candidateEvaluation.technicalError = candidateEvaluation.technicalError ? `${candidateEvaluation.technicalError} ${message}` : message
  }
  return decideComparison({
    contract: SUPPORT_CARD_CONTRACT_V2,
    cases: SUPPORT_CARD_V2_CASES,
    reference: referenceEvaluation,
    candidate: candidateEvaluation,
  })
}
