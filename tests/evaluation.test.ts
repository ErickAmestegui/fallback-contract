import { describe, expect, it } from 'vitest'
import { SUPPORT_CARD_CASES, SUPPORT_CARD_CONTRACT } from '../src/contracts/support-card.js'
import { decideComparison } from '../src/evaluation/decision.js'
import { LOCAL_FIXTURES } from '../src/evaluation/fixtures.js'
import { parseStrictJson } from '../src/evaluation/parse.js'
import { validateOutput } from '../src/evaluation/validate.js'

const validOutput = '{"category":"lost_or_stolen_card","urgency":"high","action":"Freeze the card"}'

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
    expect(unknown.checks.find((check) => check.ruleId === 'no-unknown-fields')?.status).toBe('failed')
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
})
