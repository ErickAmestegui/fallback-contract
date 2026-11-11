import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { redactRoutingRunForPublic, type PublicRoutingRunResult } from '../src/evaluation/public-redaction.js'
import type { V2RoutingRunResult } from '../src/evaluation/v2-authentic-run.js'

const path = (file: string) => new URL(`../${file}`, import.meta.url)
const read = (file: string) => readFileSync(path(file))
const sha256 = (buffer: Buffer | string) => createHash('sha256').update(buffer).digest('hex').toUpperCase()
const RUN = 'v2-routing-2026-11-11T13-18-59-492Z'
const ORIGINAL = `evidence/authentic/${RUN}.json`
const REDACTED = `evidence/redacted/${RUN}.redacted.json`
const PUBLIC_RESULT = 'public/routing-run-01-result.redacted.json'
const PUBLIC_USAGE = 'public/routing-run-01-usage.json'
const REDACTED_SHA256 = 'ADBB84DC75B31D5AFDA5F741D1A424D16A1EA7AE2C73BF7D60F0A4FD9259D1C4'
const EXPECTED_CALLS = [
  ['reference', 'lost-card-001', '4edf75e3-d0c5-4927-b030-d5ada576f1e3', 0.000012],
  ['reference', 'pin-001', '25e669cb-32aa-4319-ac5a-31b4bedc3980', 0.000011],
  ['reference', 'arrival-001', 'e1464260-d6f6-45c0-8fd7-8ba6ee7ce76d', 0.000012],
  ['candidate', 'lost-card-001', '98db0040-8aa2-4f00-abf8-40f9db756d4d', 0.000017],
  ['candidate', 'pin-001', '14b12404-9dfe-4df0-b29d-87af6a993ddd', 0.000021],
  ['candidate', 'arrival-001', '92944bd4-42a6-4dab-bf94-6fac7b839272', 0.000025],
] as const

const publicRun = () => JSON.parse(read(PUBLIC_RESULT).toString('utf8')) as PublicRoutingRunResult

describe('public routing evidence', () => {
  it('serves the redacted record, labelled and hashed as a redacted copy', () => {
    expect(read(PUBLIC_RESULT).equals(read(REDACTED))).toBe(true)
    expect(sha256(read(PUBLIC_RESULT))).toBe(REDACTED_SHA256)
    expect(publicRun().publicRedaction).toMatchObject({ copy: 'redacted', sourceFile: ORIGINAL, budgetDeltaUsd: 0.000098 })
    expect(publicRun().publicRedaction.sourceSha256).not.toBe(REDACTED_SHA256)
  })

  it('serves the usage rows unmodified', () => {
    expect(read(PUBLIC_USAGE).equals(read(`evidence/authentic/${RUN}.usage.json`))).toBe(true)
  })

  it.skipIf(!existsSync(path(ORIGINAL)))('removes only the listed fields from the private original', () => {
    const original = read(ORIGINAL)
    const run = JSON.parse(original.toString('utf8')) as V2RoutingRunResult
    expect(sha256(original)).toBe(publicRun().publicRedaction.sourceSha256)
    expect(`${JSON.stringify(redactRoutingRunForPublic(run, ORIGINAL, sha256(original)), null, 2)}\n`).toBe(read(REDACTED).toString('utf8'))
    const { publicRedaction: _redaction, ...rest } = publicRun()
    expect({ ...run, config: rest.config, budgetBefore: rest.budgetBefore, budgetAfter: rest.budgetAfter }).toEqual(rest)
  })

  it('carries no key balance, limit or exposure setting', () => {
    const text = read(PUBLIC_RESULT).toString('utf8')
    expect(text).not.toMatch(/"(remainingUsd|limits|limitUsd|usedUsd|resetsAt|maxExposureUsd)":/)
    expect(Object.keys(publicRun().budgetBefore).sort()).toEqual(['budgetsEnforced', 'error', 'status'])
    expect(Object.keys(publicRun().budgetAfter ?? {}).sort()).toEqual(['budgetsEnforced', 'error', 'status'])
  })

  it('keeps the six calls, routing to the primary, APPROVE and no fallback', () => {
    const run = publicRun()
    expect(run.evidence).toBe('otari')
    expect(run.requestsSent).toBe(6)
    expect(run.comparison.decision).toBe('APPROVE')
    expect(run.totalReportedCostUsd).toBeCloseTo(0.000098, 9)
    expect(run.calls.map(({ role, caseId, result }) => [role, caseId, result.requestId, result.usage.cost_usd])).toEqual(EXPECTED_CALLS)
    run.calls.forEach(({ role, result }) => {
      expect(result).toMatchObject({ status: 'ok', provider: 'deepinfra', servedModel: 'openai/gpt-oss-20b', attemptCount: 1, fallback: false })
      expect(result.effectiveModel).toBe(role === 'candidate' ? 'fc-failover' : 'openai/gpt-oss-20b')
    })
  })

  it.each([PUBLIC_RESULT, PUBLIC_USAGE])('%s carries no credential or local path', (file) => {
    const text = read(file).toString('utf8')
    expect(text).not.toMatch(/Otari-Key|Bearer |OTARI_API_KEY|api_key|sk-[A-Za-z0-9]{8,}|[A-Za-z]:\\\\|\/Users\//)
  })
})
