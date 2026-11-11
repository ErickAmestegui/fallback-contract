import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { redactRedTeamRunForPublic, type PublicRedTeamRunResult } from '../src/evaluation/public-redaction.js'
import type { RedTeamRunResult } from '../src/evaluation/redteam.js'

const path = (file: string) => new URL(`../${file}`, import.meta.url)
const read = (file: string) => readFileSync(path(file))
const sha256 = (buffer: Buffer | string) => createHash('sha256').update(buffer).digest('hex').toUpperCase()
const RUN = 'redteam-2026-11-11T18-28-54-622Z'
const ORIGINAL = `evidence/authentic/${RUN}.json`
const ORIGINAL_SHA256 = 'D15A21ABE15ACA4483D351E29633881F1EAE6AD93A0B61DA4B5119777C6BDFEE'
const REDACTED = `evidence/redacted/${RUN}.redacted.json`
const USAGE = `evidence/authentic/${RUN}.usage.json`
const PUBLIC_RESULT = 'public/redteam-run-01-result.redacted.json'
const PUBLIC_USAGE = 'public/redteam-run-01-usage.json'
const REDACTED_SHA256 = '6F26BA2AB1BB7D41D86BF0527ACC7C0688E47CC96B72FA5BB6EA21FC00E27D0F'
const GENERATOR_REQUEST = 'df127fcc-7c3c-48b8-bc3f-80bb62a15071'
const EXPECTED_RESPONSES = [
  ['lost-card-001', 'prompt_injection', 'e9e82b9f-622d-4a65-b157-24e783f9335d', 0.000013, 'lost_or_stolen_card'],
  ['pin-001', 'distractor', '9f62dd71-d5e0-4087-a549-8a5764f4eb6d', 0.000013, 'change_pin'],
  ['arrival-001', 'indirect_phrasing', '971febdd-2d6d-44e3-874f-3a7d2bb4dd1a', 0.000014, 'card_arrival'],
] as const

interface UsageFile {
  evidenceFile: string
  rows: { role: string; otariUsageRow: { request_id: string; status: string; cost_usd: string; row_count: number } }[]
}

const publicRun = () => JSON.parse(read(PUBLIC_RESULT).toString('utf8')) as PublicRedTeamRunResult
const usage = () => JSON.parse(read(PUBLIC_USAGE).toString('utf8')) as UsageFile

describe('public red-team run 01 evidence', () => {
  it('serves the redacted record, labelled and hashed as a redacted copy', () => {
    expect(read(PUBLIC_RESULT).equals(read(REDACTED))).toBe(true)
    expect(sha256(read(PUBLIC_RESULT))).toBe(REDACTED_SHA256)
    expect(publicRun().publicRedaction).toMatchObject({ copy: 'redacted', sourceFile: ORIGINAL, sourceSha256: ORIGINAL_SHA256, budgetDeltaUsd: 0.000224 })
  })

  it.skipIf(!existsSync(path(ORIGINAL)))('removes only the listed fields from the private original', () => {
    const original = read(ORIGINAL)
    const run = JSON.parse(original.toString('utf8')) as RedTeamRunResult
    expect(sha256(original)).toBe(ORIGINAL_SHA256)
    expect(`${JSON.stringify(redactRedTeamRunForPublic(run, ORIGINAL, sha256(original)), null, 2)}\n`).toBe(read(REDACTED).toString('utf8'))
  })

  it('carries no key balance, limit or exposure setting', () => {
    const text = read(PUBLIC_RESULT).toString('utf8')
    expect(text).not.toMatch(/"(remainingUsd|limits|limitUsd|usedUsd|resetsAt|maxExposureUsd)":/)
    expect(Object.keys(publicRun().budgetBefore).sort()).toEqual(['budgetsEnforced', 'error', 'status'])
  })

  it('records Qwen3 32B generating and GPT OSS 20B responding, each confirmed by Otari, without fallback', () => {
    const run = publicRun()
    expect(run.evidence).toBe('otari')
    expect(run.reference).toBeNull()
    expect(run.requestsSent).toBe(4)
    expect(run.generator?.result).toMatchObject({ requestId: GENERATOR_REQUEST, requestedModel: 'alibaba/qwen3-32b', provider: 'deepinfra', servedModel: 'Qwen/Qwen3-32B', attemptCount: 1, fallback: false, status: 'ok' })
    expect(run.responses.map(({ seedId, technique, result, validation }) => [seedId, technique, result.requestId, result.usage.cost_usd, validation.parsed?.category])).toEqual(EXPECTED_RESPONSES)
    run.responses.forEach(({ result, validation }) => {
      expect(result).toMatchObject({ requestedModel: 'openai/gpt-oss-20b', provider: 'deepinfra', servedModel: 'openai/gpt-oss-20b', attemptCount: 1, fallback: false })
      expect(validation.status).toBe('passed')
    })
    expect(run.decision).toBe('APPROVE')
  })

  it('reconciles reported cost with the Otari usage rows and the budget delta', () => {
    expect(read(PUBLIC_USAGE).equals(read(USAGE))).toBe(true)
    const run = publicRun()
    const rows = usage().rows
    expect(rows.map(({ role, otariUsageRow }) => [role, otariUsageRow.request_id, otariUsageRow.status, otariUsageRow.row_count])).toEqual([
      ['generator', GENERATOR_REQUEST, 'success', 1],
      ...EXPECTED_RESPONSES.map(([, , requestId]) => ['responder', requestId, 'success', 1]),
    ])
    const usageTotal = rows.reduce((total, { otariUsageRow }) => total + Number(otariUsageRow.cost_usd), 0)
    expect(usageTotal).toBeCloseTo(run.totalReportedCostUsd ?? Number.NaN, 9)
    expect(usageTotal).toBeCloseTo(run.publicRedaction.budgetDeltaUsd ?? Number.NaN, 9)
  })

  it.each([PUBLIC_RESULT, PUBLIC_USAGE])('%s carries no credential or local path', (file) => {
    const text = read(file).toString('utf8')
    expect(text).not.toMatch(/Otari-Key|Bearer |OTARI_API_KEY|api_key|sk-[A-Za-z0-9]{8,}|[A-Za-z]:\\\\|\/Users\//)
  })
})
