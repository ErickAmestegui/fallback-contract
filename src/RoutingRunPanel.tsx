import { useEffect, useState } from 'react'
import type { PublicRoutingRunResult } from './evaluation/public-redaction'
import type { RoutingUsageCheck } from './evaluation/v2-routing-verify'

interface RecordedRoutingRun {
  run: PublicRoutingRunResult
  sha256: string
  usage: RoutingUsageCheck[] | null
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
}

async function loadRecordedRoutingRun(): Promise<RecordedRoutingRun> {
  const response = await fetch('/routing-run-01-result.redacted.json')
  if (!response.ok) throw new Error('Routing evidence unavailable')
  const buffer = await response.arrayBuffer()
  const run = JSON.parse(new TextDecoder().decode(buffer)) as PublicRoutingRunResult
  const usage = await fetch('/routing-run-01-usage.json')
    .then(async (usageResponse) => usageResponse.ok ? ((await usageResponse.json()) as { checks: RoutingUsageCheck[] }).checks : null)
    .catch(() => null)
  return { run, sha256: await sha256Hex(buffer), usage }
}

const usd = (value: number | null | undefined) => typeof value === 'number' ? `$${value.toFixed(6)}` : 'not reported'

export function RoutingRunPanel() {
  const [recorded, setRecorded] = useState<RecordedRoutingRun | null>(null)

  useEffect(() => {
    loadRecordedRoutingRun().then(setRecorded).catch(() => setRecorded(null))
  }, [])

  if (!recorded || recorded.run.evidence !== 'otari' || recorded.run.publicRedaction?.copy !== 'redacted') return null
  const { run, sha256, usage } = recorded
  const redaction = run.publicRedaction
  const policyCalls = run.calls.filter((call) => call.role === 'candidate')
  const referenceCalls = run.calls.filter((call) => call.role === 'reference')
  const servedTargets = [...new Set(policyCalls.map(({ result }) => `${result.provider ?? '?'}:${result.servedModel ?? '?'}`))]
  const referenceTargets = [...new Set(referenceCalls.map(({ result }) => `${result.provider ?? '?'}:${result.servedModel ?? '?'}`))]
  const fallbackCalls = policyCalls.filter(({ result }) => result.fallback === true)
  const caseStatus = (role: 'reference' | 'candidate', caseId: string) =>
    run.comparison[role].cases.find((item) => item.caseId === caseId)?.validation.status ?? 'inconclusive'
  const sameServedModel = servedTargets.length === 1 && referenceTargets.length === 1 && servedTargets[0] === referenceTargets[0]

  return <section className="comparison-details panel routing-run" id="routing-run" aria-live="polite">
    <div className="panel-heading compact">
      <div><span className="panel-number">R1</span><div><h2>Authentic routing run · v2 contract · Otari policy</h2><p>RECORDED AUTHENTIC OTARI RUN · {run.startedAt} · PUBLIC REDACTED COPY · no request is made by this page.</p></div></div>
      <span className={`status-tag decision-${run.comparison.decision.toLowerCase()}`}>{run.comparison.decision}</span>
    </div>

    <dl className="routing-facts">
      <div><dt>Policy requested</dt><dd>{run.config.policy.policy}</dd></div>
      <div><dt>Policy plan</dt><dd>{run.config.policy.primary} → on_failure {run.config.policy.onFailure.join(', ')}</dd></div>
      <div><dt>Served (Otari-Provider : Otari-Model)</dt><dd>{servedTargets.join(', ')}</dd></div>
      <div><dt>Requests</dt><dd>{run.requestsSent} of {run.requestsPlanned} · {referenceCalls.length} direct reference, {policyCalls.length} through the policy</dd></div>
      <div><dt>Fallback</dt><dd>{fallbackCalls.length === 0
        ? `No fallback occurred: Otari-Fallback was false on ${policyCalls.length} of ${policyCalls.length} policy requests. The on_failure path was not exercised.`
        : `Otari reported fallback on ${fallbackCalls.length} of ${policyCalls.length} policy requests.`}</dd></div>
      <div><dt>Reported cost</dt><dd>{usd(run.totalReportedCostUsd)}{redaction.budgetDeltaUsd !== null ? ` · key budget delta ${usd(redaction.budgetDeltaUsd)}` : ''}</dd></div>
    </dl>

    {sameServedModel && <p className="routing-caveat">The direct reference was served by the same provider and model ({referenceTargets[0]}), so this {run.comparison.decision} is a consistency check of the policy path, not a comparison between different models.</p>}

    <div className="routing-table-wrap">
      <table className="routing-table">
        <thead><tr><th>Role</th><th>Case</th><th>Otari-Request-ID</th><th>Requested</th><th>Body model</th><th>Provider</th><th>Served model</th><th>Attempts</th><th>Fallback</th><th>Cost</th><th>Contract</th></tr></thead>
        <tbody>{run.calls.map(({ role, caseId, result }) => <tr key={`${role}-${caseId}`}>
          <td>{role === 'candidate' ? 'policy' : 'reference'}</td>
          <td>{caseId}</td>
          <td><code>{result.requestId ?? 'not reported'}</code></td>
          <td>{result.requestedModel}</td>
          <td>{result.effectiveModel ?? 'not reported'}</td>
          <td>{result.provider ?? 'not reported'}</td>
          <td>{result.servedModel ?? 'not reported'}</td>
          <td>{result.attemptCount ?? 'not reported'}</td>
          <td>{result.fallback === null || result.fallback === undefined ? 'not reported' : String(result.fallback)}</td>
          <td>{usd(result.usage.cost_usd)}</td>
          <td><span className={`result-chip ${caseStatus(role, caseId)}`}>{caseStatus(role, caseId)}</span></td>
        </tr>)}</tbody>
      </table>
    </div>

    <div className="authentic-evidence">
      <strong>Verification</strong>
      {usage && <p>Otari usage rows (GET /api/v1/usage/requests/&#123;id&#125;): {usage.map((check) => `${check.caseId} row_count ${check.rowCount ?? '?'} (${check.status})`).join(' · ')}</p>}
      <p>Public redacted copy, SHA-256 computed in this browser: <code>{sha256}</code></p>
      <p>Original record SHA-256 (kept private, not published): <code>{redaction.sourceSha256}</code></p>
      <small>This copy is not byte-identical to the original: {redaction.removedFields.join(', ')} were removed (key balances, monthly limit and local exposure setting). Calls, request IDs, Otari headers, outputs and costs are unchanged.</small>
    </div>
  </section>
}
