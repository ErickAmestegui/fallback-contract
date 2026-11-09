import { callOtari } from '../otari/client.js'
import { MODEL_OPTIONS, SUPPORT_CARD_CASES, SUPPORT_CARD_CONTRACT } from '../contracts/support-card.js'
import { decideComparison } from './decision.js'
import type { AuthenticComparisonResponse, AuthenticModelEvidence } from './authentic.js'
import type { CaseEvaluation, ModelEvaluation } from './types.js'
import { validateOutput } from './validate.js'

export function requestForModel(model: string, message: string) {
  const isQwen = model === MODEL_OPTIONS.candidate
  return {
    model,
    messages: [
      {
        role: 'system' as const,
        content: [
          'Return exactly one JSON object and no markdown or commentary.',
          'The object must contain exactly these fields: category, urgency, action.',
          'category must be exactly one of: lost_or_stolen_card, change_pin, card_arrival.',
          'urgency must be exactly one of: low, medium, high.',
          'action must be a non-empty string.',
          'Use the category that best matches the user request; do not invent synonyms.',
        ].join(' '),
      },
      { role: 'user' as const, content: `${isQwen ? '/no_think\n' : ''}${message}` },
    ],
    maxTokens: isQwen ? 256 : 512,
    ...(isQwen ? {} : { reasoningEffort: 'low' as const, responseFormat: { type: 'json_object' as const } }),
  }
}

async function evaluateModel(role: 'reference' | 'candidate', apiKey: string): Promise<{ evaluation: ModelEvaluation; evidence: AuthenticModelEvidence }> {
  const model = role === 'reference' ? MODEL_OPTIONS.reference : MODEL_OPTIONS.candidate
  const cases: CaseEvaluation[] = []
  const evidence: AuthenticModelEvidence = { role, cases: [] }

  for (const testCase of SUPPORT_CARD_CASES) {
    const result = await callOtari({ OTARI_API_KEY: apiKey }, requestForModel(model, testCase.message))
    cases.push({
      caseId: testCase.id,
      role,
      rawOutput: result.content,
      validation: validateOutput(result.content, SUPPORT_CARD_CONTRACT, testCase),
      evidence: 'otari',
    })
    evidence.cases.push({ caseId: testCase.id, result })
  }

  const technicalErrors = evidence.cases
    .map(({ result }) => result.error?.code)
    .filter((code): code is string => Boolean(code))

  return {
    evaluation: {
      role,
      requestedModel: model,
      effectiveModel: evidence.cases.find(({ result }) => result.effectiveModel)?.result.effectiveModel ?? null,
      cases,
      technicalError: technicalErrors.length ? technicalErrors.join(', ') : null,
    },
    evidence,
  }
}

export async function runAuthenticComparison(apiKey: string): Promise<AuthenticComparisonResponse> {
  const reference = await evaluateModel('reference', apiKey)
  const candidate = await evaluateModel('candidate', apiKey)
  const comparison = decideComparison({
    contract: SUPPORT_CARD_CONTRACT,
    cases: SUPPORT_CARD_CASES,
    reference: reference.evaluation,
    candidate: candidate.evaluation,
  })
  const costs = [...reference.evidence.cases, ...candidate.evidence.cases]
    .map(({ result }) => result.usage.cost_usd)
    .filter((cost): cost is number => typeof cost === 'number')

  return {
    comparison,
    evidence: [reference.evidence, candidate.evidence],
    totalCostUsd: costs.length ? costs.reduce((total, cost) => total + cost, 0) : null,
  }
}
