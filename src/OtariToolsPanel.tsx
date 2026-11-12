import { useEffect, useState } from 'react'
import type { CodeCheckRunResult, ContractFetchRunResult } from './evaluation/otari-tools'
import type { PublicRedaction } from './evaluation/public-redaction'

type PublicCopy<T> = Omit<T, 'config' | 'budgetBefore' | 'budgetAfter'> & { publicRedaction: PublicRedaction }

interface Recorded<T> {
  run: PublicCopy<T>
  sha256: string
}

async function loadRecorded<T>(path: string): Promise<Recorded<T>> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path} unavailable`)
  const buffer = await response.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return {
    run: JSON.parse(new TextDecoder().decode(buffer)) as PublicCopy<T>,
    sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase(),
  }
}

const usd = (value: number | null | undefined) => typeof value === 'number' ? `$${value.toFixed(2)}` : 'not reported'
const rules = (failedRules: string[]) => failedRules.length ? failedRules.join(', ') : 'all 8 rules passed'

export function OtariToolsPanel() {
  const [code, setCode] = useState<Recorded<CodeCheckRunResult> | null>(null)
  const [fetched, setFetched] = useState<Recorded<ContractFetchRunResult> | null>(null)

  useEffect(() => {
    loadRecorded<CodeCheckRunResult>('/otari-code-execution-01.redacted.json').then(setCode).catch(() => setCode(null))
    loadRecorded<ContractFetchRunResult>('/otari-web-fetch-01.redacted.json').then(setFetched).catch(() => setFetched(null))
  }, [])

  const authentic = (run: { evidence: string; publicRedaction?: PublicRedaction }) => run.evidence === 'otari' && run.publicRedaction?.copy === 'redacted'
  if (!code || !fetched || !authentic(code.run) || !authentic(fetched.run)) return null
  const exec = code.run.execution
  const page = fetched.run.fetch
  const decision = code.run.decision === 'APPROVE' && fetched.run.decision === 'APPROVE' ? 'APPROVE' : 'INCONCLUSIVE'
  const totalCost = (code.run.usage?.costUsd ?? 0) + (fetched.run.usage?.costUsd ?? 0)

  return <section className="comparison-details panel routing-run redteam-run otari-tools" id="otari-tools" aria-live="polite">
    <div className="panel-heading compact">
      <div><span className="panel-number">R3</span><div><h2>Otari tools · independent contract check and contract provenance</h2><p>RECORDED AUTHENTIC OTARI RUNS · {code.run.startedAt} and {fetched.run.startedAt} · PUBLIC REDACTED COPIES · no request is made by this page.</p></div></div>
      <span className={`status-tag decision-${decision.toLowerCase()}`}>{decision}</span>
    </div>

    <ol className="redteam-roles" aria-label="Where the tools fit in the evaluation">
      <li>
        <span className="role-step">1 · Evaluate</span>
        <strong>TypeScript validator</strong>
        <p>The R2 run judged three real GPT OSS 20B answers against the v2 contract and passed all three.</p>
        <small>validateOutputV2 · support-card-classification-v2 · see R2 above</small>
      </li>
      <li>
        <span className="role-step">2 · Re-check</span>
        <strong>Code Execution</strong>
        <p>An independent Python re-implementation of the same 8 rules re-judges those answers plus two answers that must fail, inside Otari's sandbox. Any disagreement gives INCONCLUSIVE, never APPROVE.</p>
        <small>Request {exec?.requestId ?? 'not reported'} · {usd(code.run.usage?.costUsd)}</small>
      </li>
      <li>
        <span className="role-step">3 · Provenance</span>
        <strong>Web Fetch</strong>
        <p>Otari fetches the contract file from the public repository at a fixed commit, and its SHA-256 is compared with the contract the validators use.</p>
        <small>Request {page?.requestId ?? 'not reported'} · {usd(fetched.run.usage?.costUsd)}</small>
      </li>
    </ol>

    <div className="redteam-cases">
      {code.run.comparisons.map((comparison) => {
        const item = code.run.items.find(({ id }) => id === comparison.id)
        return <article className="redteam-case" key={comparison.id}>
          <header><code>{comparison.id}</code><span>{item?.source === 'negative-control' ? 'negative control' : 'real R2 answer'}</span><span className={`result-chip ${comparison.agree ? 'passed' : 'failed'}`}>{comparison.agree ? 'agree' : 'disagree'}</span></header>
          <blockquote><code>{item?.raw}</code></blockquote>
          <dl>
            <div><dt>Case · expected</dt><dd>{comparison.typescript.caseId} · {comparison.expectedStatus}</dd></div>
            <div><dt>TypeScript</dt><dd>{comparison.typescript.status} · {rules(comparison.typescript.failedRules)}</dd></div>
            <div><dt>Python in Otari sandbox</dt><dd>{comparison.python ? `${comparison.python.status} · ${rules(comparison.python.failedRules)}` : 'no verdict'}</dd></div>
          </dl>
        </article>
      })}
    </div>

    <div className="redteam-cases">
      <article className="redteam-case">
        <header><code>POST /api/v1/code/execute</code><span className={`result-chip ${code.run.decision === 'APPROVE' ? 'passed' : 'inconclusive'}`}>{code.run.decision}</span></header>
        <dl>
          <div><dt>Otari-Request-ID</dt><dd><code>{exec?.requestId ?? 'not reported'}</code></dd></div>
          <div><dt>HTTP · return code · stderr</dt><dd>{exec?.httpStatus ?? '?'} · {exec?.returnCode ?? '?'} · {exec?.stderr ? 'not empty' : 'empty'}</dd></div>
          <div><dt>Sandbox</dt><dd>timeout {code.run.program.timeoutSeconds} s · no persistent container · standard library only</dd></div>
          <div><dt>Usage row · cost</dt><dd>{code.run.usage?.requestStatus ?? '?'} · {code.run.usage?.rowCount ?? '?'} row · {usd(code.run.usage?.costUsd)}</dd></div>
          <div><dt>Program SHA-256 (exact code sent)</dt><dd><code>{code.run.program.codeSha256}</code></dd></div>
          <div><dt>Verifier SHA-256 ({code.run.program.verifierFile})</dt><dd><code>{code.run.program.verifierSha256}</code></dd></div>
          <div><dt>stdout SHA-256</dt><dd><code>{code.run.stdoutSha256 ?? 'none'}</code></dd></div>
        </dl>
      </article>
      <article className="redteam-case">
        <header><code>POST /api/v1/fetch</code><span className={`result-chip ${fetched.run.decision === 'APPROVE' ? 'passed' : 'inconclusive'}`}>{fetched.run.decision}</span></header>
        <dl>
          <div><dt>Otari-Request-ID</dt><dd><code>{page?.requestId ?? 'not reported'}</code></dd></div>
          <div><dt>Authorized URL</dt><dd><code>{fetched.run.request.url}</code></dd></div>
          <div><dt>Final URL · content type · truncated</dt><dd>{page?.finalUrl === fetched.run.request.url ? 'identical, no redirect' : page?.finalUrl ?? 'none'} · {page?.contentType ?? '?'} · {String(page?.truncated ?? '?')}</dd></div>
          <div><dt>Usage row · cost</dt><dd>{fetched.run.usage?.requestStatus ?? '?'} · {fetched.run.usage?.rowCount ?? '?'} row · {usd(fetched.run.usage?.costUsd)}</dd></div>
          <div><dt>Expected SHA-256 ({fetched.run.expected.length} chars)</dt><dd><code>{fetched.run.expected.sha256}</code></dd></div>
          <div><dt>Fetched SHA-256</dt><dd><code>{fetched.run.fetchedSha256 ?? 'none'}</code> · {fetched.run.checks?.contentMatches ? 'matches' : 'does not match'}</dd></div>
        </dl>
        {page?.text && <details className="otari-contract-text"><summary>Fetched contract (untrusted text, shown as-is)</summary><pre>{page.text}</pre></details>}
      </article>
    </div>

    <div className="routing-caveat redteam-limits">
      <strong>What these runs do not show</strong>
      <ul>
        <li>Both runs are recorded. This page makes no call to Otari; it only reads the published copies.</li>
        <li>Two validators written from the same contract agreeing is not a formal proof that either is correct; they could share a misreading.</li>
        <li>Only five answers ran in the sandbox: three real answers from R2 and two synthetic negative controls. The sandbox ran a fixed verifier, not a model.</li>
        <li>The fetched contract is this project's own public file at a fixed commit. This does not demonstrate general browsing or resistance to prompt injection.</li>
        <li>No fallback was requested or occurred in these runs.</li>
      </ul>
    </div>

    <div className="authentic-evidence">
      <strong>Verification</strong>
      <p>Reconciled cost: Otari usage rows {usd(code.run.usage?.costUsd)} + {usd(fetched.run.usage?.costUsd)} = {usd(totalCost)} · key budget deltas {usd(code.run.publicRedaction.budgetDeltaUsd)} and {usd(fetched.run.publicRedaction.budgetDeltaUsd)}.</p>
      <p>Public copies, SHA-256 computed in this browser: Code Execution <code>{code.sha256}</code> · Web Fetch <code>{fetched.sha256}</code></p>
      <p>Original records SHA-256 (kept private, not published): <code>{code.run.publicRedaction.sourceSha256}</code> · <code>{fetched.run.publicRedaction.sourceSha256}</code></p>
      <small>The copies are not byte-identical to the originals: {code.run.publicRedaction.removedFields.join(', ')} were removed (key balances, limits and local exposure setting). Requests, code, outputs, verdicts and costs are unchanged.</small>
    </div>
  </section>
}
