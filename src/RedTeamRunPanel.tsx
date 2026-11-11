import { useEffect, useState } from 'react'
import { SUPPORT_CARD_V2_CASES } from './contracts/support-card'
import type { PublicRedTeamRunResult } from './evaluation/public-redaction'

interface RedTeamUsageRow {
  role: string
  otariUsageRow: { request_id: string; status: string; cost_usd: string; row_count: number }
}

interface RecordedRedTeamRun {
  run: PublicRedTeamRunResult
  sha256: string
  usage: RedTeamUsageRow[] | null
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
}

async function loadRecordedRedTeamRun(): Promise<RecordedRedTeamRun> {
  const response = await fetch('/redteam-run-01-result.redacted.json')
  if (!response.ok) throw new Error('Red-team evidence unavailable')
  const buffer = await response.arrayBuffer()
  const run = JSON.parse(new TextDecoder().decode(buffer)) as PublicRedTeamRunResult
  const usage = await fetch('/redteam-run-01-usage.json')
    .then(async (usageResponse) => usageResponse.ok ? ((await usageResponse.json()) as { rows: RedTeamUsageRow[] }).rows : null)
    .catch(() => null)
  return { run, sha256: await sha256Hex(buffer), usage }
}

const usd = (value: number | null | undefined) => typeof value === 'number' ? `$${value.toFixed(6)}` : 'not reported'
const served = (result: { provider?: string | null; servedModel?: string | null }) => `${result.provider ?? '?'} : ${result.servedModel ?? '?'}`

export function RedTeamRunPanel() {
  const [recorded, setRecorded] = useState<RecordedRedTeamRun | null>(null)

  useEffect(() => {
    loadRecordedRedTeamRun().then(setRecorded).catch(() => setRecorded(null))
  }, [])

  if (!recorded || recorded.run.evidence !== 'otari' || recorded.run.publicRedaction?.copy !== 'redacted') return null
  const { run, sha256, usage } = recorded
  const redaction = run.publicRedaction
  const generator = run.generator?.result ?? null
  const responderTargets = [...new Set(run.responses.map(({ result }) => served(result)))]
  const responderCost = run.responses.reduce((total, { result }) => total + (result.usage.cost_usd ?? 0), 0)
  const passed = run.responses.filter(({ validation }) => validation.status === 'passed').length

  return <section className="comparison-details panel routing-run redteam-run" id="redteam-run" aria-live="polite">
    <div className="panel-heading compact">
      <div><span className="panel-number">R2</span><div><h2>Authentic red-team run · two open-weight models · v2 contract</h2><p>RECORDED AUTHENTIC OTARI RUN · {run.startedAt} · PUBLIC REDACTED COPY · no request is made by this page.</p></div></div>
      <span className={`status-tag decision-${run.decision.toLowerCase()}`}>{run.decision}</span>
    </div>

    <ol className="redteam-roles" aria-label="Roles in this run">
      <li>
        <span className="role-step">1 · Generate</span>
        <strong>Qwen3 32B</strong>
        <p>Rewrites each contract case into one test variation. Its own labels are ignored.</p>
        <small>{generator ? <>Requested {generator.requestedModel} · served {served(generator)} · 1 request · {usd(generator.usage.cost_usd)}</> : 'No generator call recorded'}</small>
      </li>
      <li>
        <span className="role-step">2 · Respond</span>
        <strong>GPT OSS 20B</strong>
        <p>Answers each variation as structured JSON with the unchanged v2 prompt.</p>
        <small>Requested {run.config.responderModel} · served {responderTargets.join(', ')} · {run.responses.length} requests · {usd(responderCost)}</small>
      </li>
      <li>
        <span className="role-step">3 · Judge</span>
        <strong>{run.contractId}</strong>
        <p>Deterministic rules check every answer against the expectations of the original case, written before the run. No model judges.</p>
        <small>{passed} of {run.responses.length} answers passed every rule</small>
      </li>
    </ol>

    <div className="redteam-cases">
      {run.responses.map(({ seedId, technique, message, result, validation }) => {
        const seed = SUPPORT_CARD_V2_CASES.find((testCase) => testCase.id === seedId)
        const failedRules = validation.checks.filter((check) => check.status !== 'passed')
        return <article className="redteam-case" key={seedId}>
          <header><code>{seedId}</code><span>labelled {technique.replace('_', ' ')}</span><span className={`result-chip ${validation.status}`}>{validation.status}</span></header>
          {seed && <p className="redteam-seed">Original case: “{seed.message}”</p>}
          <blockquote>“{message}”</blockquote>
          <dl>
            <div><dt>Contract expects</dt><dd>{seed ? `${seed.referenceCategory} · urgency ${seed.minimumUrgency === 'high' ? 'high' : 'any'} · ${seed.expectedActionId}` : 'unknown case'}</dd></div>
            <div><dt>GPT OSS 20B answered</dt><dd>{validation.parsed ? `${validation.parsed.category} · urgency ${validation.parsed.urgency} · ${validation.parsed.actionId}` : 'no valid JSON'}</dd></div>
            <div><dt>Rules</dt><dd>{failedRules.length === 0 ? `${validation.checks.length} of ${validation.checks.length} passed` : failedRules.map((check) => `${check.ruleId}: ${check.detail}`).join(' · ')}</dd></div>
            <div><dt>Otari-Request-ID</dt><dd><code>{result.requestId ?? 'not reported'}</code></dd></div>
            <div><dt>Served · attempts · fallback · cost</dt><dd>{served(result)} · {result.attemptCount ?? '?'} · {String(result.fallback ?? 'not reported')} · {usd(result.usage.cost_usd)}</dd></div>
          </dl>
        </article>
      })}
    </div>

    <div className="routing-caveat redteam-limits">
      <strong>What this run does not show</strong>
      <ul>
        <li>Only three variations, one per contract case, in a single run. It is not a statistical robustness measure.</li>
        <li>The variation labelled prompt injection contains no injected instruction; it only adds an unrelated question. This run does not demonstrate resistance to prompt injection.</li>
        <li>Otari Web Fetch was not used ({run.reference === null ? 'no reference was fetched' : 'see the record'}), and no fallback was requested or occurred.</li>
        <li>The account number and charge in the PIN variation were invented by the generator; they are not real data.</li>
      </ul>
    </div>

    <div className="authentic-evidence">
      <strong>Verification</strong>
      {generator && <p>Generator request <code>{generator.requestId ?? 'not reported'}</code> · {generator.usage.prompt_tokens ?? '?'} prompt / {generator.usage.completion_tokens ?? '?'} completion tokens.</p>}
      <p>Total reported cost {usd(run.totalReportedCostUsd)} for {run.requestsSent} requests{redaction.budgetDeltaUsd !== null ? ` · key budget delta ${usd(redaction.budgetDeltaUsd)}` : ''}.</p>
      {usage && <p>Otari usage rows (GET /api/v1/usage/requests/&#123;id&#125;): {usage.map(({ role, otariUsageRow }) => `${role} ${otariUsageRow.status} $${otariUsageRow.cost_usd}`).join(' · ')}</p>}
      <p>Public redacted copy, SHA-256 computed in this browser: <code>{sha256}</code></p>
      <p>Original record SHA-256 (kept private, not published): <code>{redaction.sourceSha256}</code></p>
      <small>This copy is not byte-identical to the original: {redaction.removedFields.join(', ')} were removed (key balances, monthly limit and local exposure setting). Requests, model identities, outputs, validations and costs are unchanged.</small>
    </div>
  </section>
}
