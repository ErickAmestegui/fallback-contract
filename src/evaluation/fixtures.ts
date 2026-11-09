import type { ModelEvaluation } from './types.js'
import { MODEL_OPTIONS, SUPPORT_CARD_CASES, SUPPORT_CARD_CONTRACT } from '../contracts/support-card.js'
import { validateOutput } from './validate.js'

const valid = [
  '{"category":"lost_or_stolen_card","urgency":"high","action":"Freeze the card"}',
  '{"category":"change_pin","urgency":"low","action":"Guide the customer through PIN change"}',
  '{"category":"card_arrival","urgency":"medium","action":"Check shipment status"}',
]

const wrongCandidate = [...valid]
wrongCandidate[1] = '{"category":"card_arrival","urgency":"low","action":"Guide the customer through PIN change"}'

function model(role: 'reference' | 'candidate', outputs: readonly (string | null)[], technicalError: string | null = null): ModelEvaluation {
  return {
    role,
    requestedModel: role === 'reference' ? MODEL_OPTIONS.reference : MODEL_OPTIONS.candidate,
    effectiveModel: role === 'reference' ? MODEL_OPTIONS.reference : MODEL_OPTIONS.candidate,
    technicalError,
    cases: SUPPORT_CARD_CASES.map((testCase, index) => ({
      caseId: testCase.id,
      role,
      rawOutput: outputs[index],
      validation: validateOutput(outputs[index], SUPPORT_CARD_CONTRACT, testCase),
      evidence: 'local-fixture',
    })),
  }
}

export const LOCAL_FIXTURES = {
  approve: { label: 'APPROVE · all rules pass', reference: model('reference', valid), candidate: model('candidate', valid) },
  reject: { label: 'REJECT · candidate regression', reference: model('reference', valid), candidate: model('candidate', wrongCandidate) },
  inconclusive: { label: 'INCONCLUSIVE · missing evidence', reference: model('reference', valid), candidate: model('candidate', [valid[0], null, valid[2]]) },
} as const
