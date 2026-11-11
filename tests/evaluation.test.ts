import { describe, expect, it } from 'vitest'
import {
  SUPPORT_CARD_CASES,
  SUPPORT_CARD_CONTRACT,
  SUPPORT_CARD_CONTRACT_V2,
  SUPPORT_CARD_V2_CASES,
  MODEL_OPTIONS,
} from '../src/contracts/support-card.js'
import { decideComparison } from '../src/evaluation/decision.js'
import { LOCAL_FIXTURES } from '../src/evaluation/fixtures.js'
import { parseStrictJson } from '../src/evaluation/parse.js'
import { validateOutput } from '../src/evaluation/validate.js'
import { validateOutputV2 } from '../src/evaluation/validate-v2.js'
import { compareV2Offline, type V2OfflineResponse } from '../src/evaluation/v2-adapter.js'

const validOutput = '{"category":"lost_or_stolen_card","urgency":"high","action":"Freeze the card"}'
const validV2Responses = (model: string): V2OfflineResponse[] => [
  {
    caseId: 'lost-card-001',
    requestedModel: model,
    effectiveModel: model,
    requestId: `${model}-lost`,
    rawOutput: '{"category":"lost_or_stolen_card","urgency":"high","actionId":"freeze_card"}',
  },
  {
    caseId: 'pin-001',
    requestedModel: model,
    effectiveModel: model,
    requestId: `${model}-pin`,
    rawOutput: '{"category":"change_pin","urgency":"medium","actionId":"change_pin"}',
  },
  {
    caseId: 'arrival-001',
    requestedModel: model,
    effectiveModel: model,
    requestId: `${model}-arrival`,
    rawOutput: '{"category":"card_arrival","urgency":"medium","actionId":"track_card_arrival"}',
  },
]

describe('support-card deterministic validation', () => {
  it('accepts a valid response', () => {
    expect(validateOutput(validOutput, SUPPORT_CARD_CONTRACT, SUPPORT_CARD_CASES[0]).status).toBe('passed')
  })

  it('rejects malformed, fenced and incomplete JSON', () => {
    expect(parseStrictJson('not json').error).toBe('Response is not valid JSON.')
    expect(validateOutput('```json\n' + validOutput + '\n```', SUPPORT_CARD_CONTRACT, SUPPORT_CARD_CASES[0]).status).toBe('failed')
    expect(validateOutput('{"category":"lost_or_stolen_card"}', SUPPORT_CARD_CONTRACT, SUPPORT_CARD_CASES[0]).status).toBe('failed')
  })

  it('rejects an incorrect or disallowed category', () => {
    const wrong = validateOutput('{"category":"card_arrival","urgency":"low","action":"Guide"}', SUPPORT_CARD_CONTRACT, SUPPORT_CARD_CASES[0])
    const disallowed = validateOutput('{"category":"refund","urgency":"low","action":"Guide"}', SUPPORT_CARD_CONTRACT, SUPPORT_CARD_CASES[0])
    expect(wrong.checks.find((check) => check.ruleId === 'category-matches-reference')?.status).toBe('failed')
    expect(disallowed.checks.find((check) => check.ruleId === 'category-allowed')?.status).toBe('failed')
  })

  it('rejects missing fields, wrong types and unknown fields', () => {
    const wrongType = validateOutput('{"category":"lost_or_stolen_card","urgency":4,"action":"Freeze"}', SUPPORT_CARD_CONTRACT, SUPPORT_CARD_CASES[0])
    const unknown = validateOutput('{"category":"lost_or_stolen_card","urgency":"high","action":"Freeze","score":1}', SUPPORT_CARD_CONTRACT, SUPPORT_CARD_CASES[0])
    expect(wrongType.status).toBe('failed')
    expect(wrongType.checks.find((check) => check.ruleId === 'json-valid')?.detail).toContain('must be string')
    expect(unknown.checks.find((check) => check.ruleId === 'no-unknown-fields')?.status).toBe('failed')
  })

  it('rejects an action that conflicts with the case category', () => {
    const result = validateOutput(
      '{"category":"change_pin","urgency":"low","action":"Check shipment status"}',
      SUPPORT_CARD_CONTRACT,
      SUPPORT_CARD_CASES[1],
    )
    expect(result.checks.find((check) => check.ruleId === 'action-compatible')?.status).toBe('failed')
    expect(result.status).toBe('failed')
  })

  it('accepts the authentic action semantics used in the recorded run', () => {
    expect(validateOutput(
      '{"category":"lost_or_stolen_card","urgency":"high","action":"freeze the card"}',
      SUPPORT_CARD_CONTRACT,
      SUPPORT_CARD_CASES[0],
    ).status).toBe('passed')
    expect(validateOutput(
      '{"category":"change_pin","urgency":"medium","action":"navigate to Change PIN in the app"}',
      SUPPORT_CARD_CONTRACT,
      SUPPORT_CARD_CASES[1],
    ).status).toBe('passed')
    expect(validateOutput(
      '{"category":"card_arrival","urgency":"medium","action":"check replacement card delivery status"}',
      SUPPORT_CARD_CONTRACT,
      SUPPORT_CARD_CASES[2],
    ).status).toBe('passed')
  })
})

describe('comparison decisions', () => {
  it('approves when both models pass the same case', () => {
    const fixture = LOCAL_FIXTURES.approve
    const result = decideComparison({ contract: SUPPORT_CARD_CONTRACT, cases: SUPPORT_CARD_CASES, reference: fixture.reference, candidate: fixture.candidate })
    expect(result.decision).toBe('APPROVE')
  })

  it('rejects a confirmed candidate regression', () => {
    const fixture = LOCAL_FIXTURES.reject
    const result = decideComparison({ contract: SUPPORT_CARD_CONTRACT, cases: SUPPORT_CARD_CASES, reference: fixture.reference, candidate: fixture.candidate })
    expect(result.decision).toBe('REJECT')
    expect(result.reasons.some((reason) => reason.includes('pin-001'))).toBe(true)
  })

  it('returns inconclusive for missing evidence or technical error', () => {
    const fixture = LOCAL_FIXTURES.inconclusive
    const missing = decideComparison({ contract: SUPPORT_CARD_CONTRACT, cases: SUPPORT_CARD_CASES, reference: fixture.reference, candidate: fixture.candidate })
    const technical = decideComparison({
      contract: SUPPORT_CARD_CONTRACT,
      cases: SUPPORT_CARD_CASES,
      reference: { ...fixture.reference, technicalError: 'timeout' },
      candidate: fixture.candidate,
    })
    expect(missing.decision).toBe('INCONCLUSIVE')
    expect(technical.decision).toBe('INCONCLUSIVE')
  })

  it('never approves an empty or duplicated evidence suite', () => {
    const fixture = LOCAL_FIXTURES.approve
    const empty = decideComparison({
      contract: SUPPORT_CARD_CONTRACT,
      cases: SUPPORT_CARD_CASES,
      reference: { ...fixture.reference, cases: [] },
      candidate: { ...fixture.candidate, cases: [] },
    })
    const duplicate = decideComparison({
      contract: SUPPORT_CARD_CONTRACT,
      cases: SUPPORT_CARD_CASES,
      reference: { ...fixture.reference, cases: [fixture.reference.cases[0], fixture.reference.cases[0], fixture.reference.cases[1]] },
      candidate: fixture.candidate,
    })
    expect(empty.decision).toBe('INCONCLUSIVE')
    expect(duplicate.decision).toBe('INCONCLUSIVE')
  })

  it('never approves a suite with a missing case or missing raw evidence', () => {
    const fixture = LOCAL_FIXTURES.approve
    const missingCase = decideComparison({
      contract: SUPPORT_CARD_CONTRACT,
      cases: SUPPORT_CARD_CASES,
      reference: { ...fixture.reference, cases: fixture.reference.cases.slice(0, 2) },
      candidate: fixture.candidate,
    })
    const missingRawEvidence = decideComparison({
      contract: SUPPORT_CARD_CONTRACT,
      cases: SUPPORT_CARD_CASES,
      reference: fixture.reference,
      candidate: { ...fixture.candidate, cases: fixture.candidate.cases.map((item, index) => index === 1 ? { ...item, rawOutput: null } : item) },
    })
    expect(missingCase.decision).toBe('INCONCLUSIVE')
    expect(missingRawEvidence.decision).toBe('INCONCLUSIVE')
  })
})

describe('support-card v2 structured semantic contract', () => {
  it('accepts a structured action without relying on natural language', () => {
    const result = validateOutputV2(
      JSON.stringify({
        category: 'lost_or_stolen_card',
        urgency: 'high',
        actionId: 'freeze_card',
      }),
      SUPPORT_CARD_CONTRACT_V2,
      SUPPORT_CARD_V2_CASES[0],
    )
    expect(result.status).toBe('passed')
    expect(result.checks.every((check) => check.status === 'passed')).toBe(true)
  })

  it('rejects prohibited, contradictory, combined and ambiguous actions', () => {
    for (const actionId of ['share_pin', 'keep_using_stolen_card', 'do_not_freeze_card']) {
      const result = validateOutputV2(
        JSON.stringify({ category: 'lost_or_stolen_card', urgency: 'high', actionId }),
        SUPPORT_CARD_CONTRACT_V2,
        SUPPORT_CARD_V2_CASES[0],
      )
      expect(result.status).toBe('failed')
      expect(result.checks.find((check) => check.ruleId === 'action-not-prohibited')?.status).toBe('failed')
    }

    expect(validateOutputV2(
      '{"category":"lost_or_stolen_card","urgency":"high","actionId":["freeze_card","share_pin"]}',
      SUPPORT_CARD_CONTRACT_V2,
      SUPPORT_CARD_V2_CASES[0],
    ).status).toBe('failed')
    expect(validateOutputV2(
      '{"category":"lost_or_stolen_card","urgency":"high","actionId":"freeze_card","explanation":"Share your PIN"}',
      SUPPORT_CARD_CONTRACT_V2,
      SUPPORT_CARD_V2_CASES[0],
    ).status).toBe('failed')
  })

  it('enforces category-action and urgency relationships', () => {
    const wrongAction = validateOutputV2(
      '{"category":"change_pin","urgency":"medium","actionId":"freeze_card"}',
      SUPPORT_CARD_CONTRACT_V2,
      SUPPORT_CARD_V2_CASES[1],
    )
    const lowUrgency = validateOutputV2(
      '{"category":"lost_or_stolen_card","urgency":"low","actionId":"freeze_card"}',
      SUPPORT_CARD_CONTRACT_V2,
      SUPPORT_CARD_V2_CASES[0],
    )
    expect(wrongAction.status).toBe('failed')
    expect(wrongAction.checks.find((check) => check.ruleId === 'action-allowed')?.status).toBe('failed')
    expect(lowUrgency.status).toBe('failed')
    expect(lowUrgency.checks.find((check) => check.ruleId === 'urgency-compatible')?.status).toBe('failed')
  })

  it('does not treat natural-language synonyms as a substitute for actionId', () => {
    expect(validateOutputV2(
      '{"category":"lost_or_stolen_card","urgency":"high","actionId":"freeze_card","explanation":"Deactivate your card"}',
      SUPPORT_CARD_CONTRACT_V2,
      SUPPORT_CARD_V2_CASES[0],
    ).status).toBe('failed')
    expect(validateOutputV2(
      '{"category":"change_pin","urgency":"medium","actionId":"change_pin","explanation":"Change your secret code"}',
      SUPPORT_CARD_CONTRACT_V2,
      SUPPORT_CARD_V2_CASES[1],
    ).status).toBe('failed')
  })

  it('cannot approve a complete v2 suite containing a prohibited action', () => {
    const outputs = [
      { category: 'lost_or_stolen_card', urgency: 'high', actionId: 'freeze_card' },
      { category: 'change_pin', urgency: 'medium', actionId: 'change_pin' },
      { category: 'card_arrival', urgency: 'medium', actionId: 'track_card_arrival' },
    ] as const
    const prohibited = outputs.map((output, index) => index === 0 ? { ...output, actionId: 'share_pin' } : output)
    const model = (role: 'reference' | 'candidate', values: readonly typeof outputs[number][]) => ({
      role,
      requestedModel: role === 'reference' ? MODEL_OPTIONS.reference : MODEL_OPTIONS.candidate,
      effectiveModel: role === 'reference' ? MODEL_OPTIONS.reference : MODEL_OPTIONS.candidate,
      technicalError: null,
      cases: SUPPORT_CARD_V2_CASES.map((testCase, index) => {
        const rawOutput = JSON.stringify(values[index])
        return {
          caseId: testCase.id,
          role,
          rawOutput,
          validation: validateOutputV2(rawOutput, SUPPORT_CARD_CONTRACT_V2, testCase),
          evidence: 'local-fixture' as const,
        }
      }),
    })
    const result = decideComparison({
      contract: SUPPORT_CARD_CONTRACT_V2,
      cases: SUPPORT_CARD_V2_CASES,
      reference: model('reference', outputs),
      candidate: model('candidate', prohibited),
    })
    expect(result.decision).toBe('REJECT')
  })

  it('keeps v1 contract identity and v1 validation available', () => {
    expect(SUPPORT_CARD_CONTRACT.version).toBe('1.0.0')
    expect(SUPPORT_CARD_CONTRACT_V2.version).toBe('2.0.0')
    expect(validateOutput(validOutput, SUPPORT_CARD_CONTRACT, SUPPORT_CARD_CASES[0]).status).toBe('passed')
  })
})

describe('offline v2 adapter', () => {
  it('approves valid structured reference and candidate outputs', () => {
    const result = compareV2Offline(
      validV2Responses(MODEL_OPTIONS.reference),
      validV2Responses(MODEL_OPTIONS.candidate),
    )
    expect(result.decision).toBe('APPROVE')
    expect(result.evidence).toBe('local-fixture')
    expect(result.reference.cases[0].requestId).toBe('openai/gpt-oss-20b-lost')
  })

  it('rejects prohibited actions and incompatible urgency', () => {
    const prohibited = validV2Responses(MODEL_OPTIONS.candidate)
    prohibited[0] = { ...prohibited[0], rawOutput: '{"category":"lost_or_stolen_card","urgency":"high","actionId":"share_pin"}' }
    expect(compareV2Offline(validV2Responses(MODEL_OPTIONS.reference), prohibited).decision).toBe('REJECT')

    const lowUrgency = validV2Responses(MODEL_OPTIONS.candidate)
    lowUrgency[0] = { ...lowUrgency[0], rawOutput: '{"category":"lost_or_stolen_card","urgency":"low","actionId":"freeze_card"}' }
    expect(compareV2Offline(validV2Responses(MODEL_OPTIONS.reference), lowUrgency).decision).toBe('REJECT')
  })

  it('returns inconclusive for missing evidence, technical errors and model identity changes', () => {
    const missing = validV2Responses(MODEL_OPTIONS.candidate)
    missing[1] = { ...missing[1], rawOutput: null }
    expect(compareV2Offline(validV2Responses(MODEL_OPTIONS.reference), missing).decision).toBe('INCONCLUSIVE')

    const technical = validV2Responses(MODEL_OPTIONS.candidate)
    technical[1] = { ...technical[1], technicalError: 'timeout', rawOutput: null }
    expect(compareV2Offline(validV2Responses(MODEL_OPTIONS.reference), technical).decision).toBe('INCONCLUSIVE')

    const fallback = validV2Responses(MODEL_OPTIONS.candidate)
    fallback[0] = { ...fallback[0], effectiveModel: 'fallback/model' }
    const result = compareV2Offline(validV2Responses(MODEL_OPTIONS.reference), fallback)
    expect(result.decision).toBe('INCONCLUSIVE')
    expect(result.reasons.some((reason) => reason.includes('effective model differs'))).toBe(true)
  })

  it('returns inconclusive for duplicate and missing case responses', () => {
    const duplicate = validV2Responses(MODEL_OPTIONS.candidate)
    duplicate[1] = { ...duplicate[0], requestId: 'duplicate-pin' }
    const result = compareV2Offline(validV2Responses(MODEL_OPTIONS.reference), duplicate)
    expect(result.decision).toBe('INCONCLUSIVE')

    const missing = validV2Responses(MODEL_OPTIONS.candidate).slice(0, 2)
    expect(compareV2Offline(validV2Responses(MODEL_OPTIONS.reference), missing).decision).toBe('INCONCLUSIVE')
  })
})
