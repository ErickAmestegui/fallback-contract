import { useEffect, useState } from 'react'
import { ArrowDown, Check, ChevronDown, CircleAlert, FileCheck2, Gauge, Menu, Play, ShieldCheck, Sparkles, X } from 'lucide-react'
import { CONTRACT_ID, CONTRACT_RULES, MODEL_OPTIONS, SUPPORT_CARD_CONTRACT } from './contracts/support-card'
import { decideComparison } from './evaluation/decision'
import { LOCAL_FIXTURES } from './evaluation/fixtures'
import type { AuthenticComparisonResponse } from './evaluation/authentic'
import type { ComparisonResult } from './evaluation/types'
import './App.css'

const navigation = [
  { label: 'Overview', target: 'overview', icon: '⌂' },
  { label: 'Compare models', target: 'comparison', icon: '⇄' },
  { label: 'Contracts', target: 'contracts', icon: '</>' },
  { label: 'Executions', target: 'executions', icon: '▷' },
  { label: 'Evidence', target: 'evidence', icon: '▤' },
]

function App() {
  const [activeSection, setActiveSection] = useState('overview')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [demoMode, setDemoMode] = useState<keyof typeof LOCAL_FIXTURES>('approve')
  const [comparison, setComparison] = useState<ComparisonResult | null>(null)
  const [recordedRun, setRecordedRun] = useState<AuthenticComparisonResponse | null>(null)

  useEffect(() => {
    fetch('/mission-10-authentic-result.json')
      .then(async (response) => {
        if (!response.ok) throw new Error('Recorded evidence unavailable')
        return (await response.json()) as AuthenticComparisonResponse
      })
      .then(setRecordedRun)
      .catch(() => setRecordedRun(null))
  }, [])

  const goToSection = (target: string) => {
    setActiveSection(target)
    setMobileMenuOpen(false)
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const runLocalFixture = () => {
    const fixture = LOCAL_FIXTURES[demoMode]
    setComparison(decideComparison({
      contract: SUPPORT_CARD_CONTRACT,
      cases: SUPPORT_CARD_CONTRACT.cases,
      reference: fixture.reference,
      candidate: fixture.candidate,
    }))
    setActiveSection('executions')
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenuOpen ? 'menu-open' : ''}`}>
        <div className="brand-row">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true"><span /><span /></div>
            <div><strong>Fallback</strong><strong>Contract</strong></div>
          </div>
          <button className="mobile-menu-button" type="button" aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <p className="brand-caption">Model replacement gate</p>
        <nav className="primary-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <button className={`nav-item ${activeSection === item.target ? 'active' : ''}`} key={item.target} type="button" aria-current={activeSection === item.target ? 'page' : undefined} onClick={() => goToSection(item.target)}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="gateway-card">
            <div className="gateway-icon"><Sparkles size={18} /></div>
            <div><strong>Otari</strong><span>Gateway</span><small>api.otari.ai</small></div>
            <span className="external" aria-hidden="true">↗</span>
          </div>
          <p>Independent project<br />for model reliability</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="eyebrow"><span className="eyebrow-dot" /> Fallback Contract <span className="slash">/</span> Decision workspace</div>
          <div className="top-actions">
            <span className="connection-pill connected" role="status"><span />Recorded demo · no live backend</span>
            <button className="icon-button" aria-label="Toggle theme" type="button">☼</button>
            <button className="avatar" aria-label="Account menu" type="button">EM</button>
          </div>
        </header>

        <section className="hero-row" id="overview">
          <div>
            <p className="section-kicker">MODEL REPLACEMENT GATE</p>
            <h1>Verify behavior<br /><em>before</em> switching models.</h1>
            <p className="hero-copy">A functional contract is the boundary between a confident upgrade and an invisible regression.</p>
          </div>
          <div className="hero-note">
            <span className="note-line" />
            <p><b>Evaluation workspace</b><br />Evidence-first decisions</p>
            <span className="note-status"><span /> No live evaluation yet</span>
          </div>
        </section>

        <section className="workspace-grid" id="comparison">
          <div className="panel config-panel">
            <div className="panel-heading">
              <div><span className="panel-number">01</span><div><h2>Configure a comparison</h2><p>Choose the models that will run against the same contract.</p></div></div>
              <span className="demo-badge">LOCAL TEST / DEMO</span>
            </div>
            <div className="model-flow">
              <ModelSelect label="Current model · reference" value="GPT OSS 20B" model={MODEL_OPTIONS.reference} />
              <ArrowDown className="flow-arrow" aria-hidden="true" />
              <ModelSelect label="Candidate model" value="Qwen3 32B" model={MODEL_OPTIONS.candidate} />
            </div>
            <div className="contract-strip">
              <div className="contract-icon"><FileCheck2 size={18} /></div>
              <div><span className="muted-label">ACTIVE CONTRACT</span><strong>{CONTRACT_ID}</strong></div>
              <span className="contract-state"><Check size={14} /> Draft configured</span>
            </div>
            <button className="primary-button disabled-button" type="button" disabled><Play size={16} fill="currentColor" /> Run comparison <span>Evaluation unavailable</span></button>
            <p className="disabled-explanation">Connect an evaluation backend before running live requests.</p>
            <button className="authentic-button" type="button" disabled><Play size={15} fill="currentColor" /> Live inference disabled <span>Recorded run only</span></button>
            <div className="local-demo-controls">
              <label htmlFor="demo-mode">Local test fixture</label>
              <div>
                <select id="demo-mode" value={demoMode} onChange={(event) => setDemoMode(event.target.value as keyof typeof LOCAL_FIXTURES)}>
                  <option value="approve">APPROVE · all rules pass</option>
                  <option value="reject">REJECT · candidate regression</option>
                  <option value="inconclusive">INCONCLUSIVE · missing evidence</option>
                </select>
                <button className="local-run-button" type="button" onClick={runLocalFixture}>Run local test</button>
              </div>
            </div>
          </div>

          <div className="panel decision-panel" id="executions">
            <div className="panel-heading compact"><div><span className="panel-number">02</span><h2>Decision</h2></div><span className={`status-tag ${comparison ? `decision-${comparison.decision.toLowerCase()}` : 'neutral'}`}>{comparison?.decision ?? 'NOT RUN'}</span></div>
            <div className="decision-empty">
              <div className={`decision-orbit ${comparison ? `decision-orbit-${comparison.decision.toLowerCase()}` : ''}`}><Gauge size={28} /></div>
              <h3>{comparison?.decision ?? 'No decision yet'}</h3>
              <p>{comparison ? comparison.reasons[0] : 'Run a comparison to see whether the candidate preserves the contract.'}</p>
            </div>
            <div className="decision-legend"><span><i className="dot approve" /> APPROVE</span><span><i className="dot reject" /> REJECT</span><span><i className="dot inconclusive" /> INCONCLUSIVE</span></div>
          </div>
        </section>

        {recordedRun && <ComparisonDetails result={recordedRun.comparison} authenticEvidence={recordedRun} />}
        {comparison && <ComparisonDetails result={comparison} authenticEvidence={null} />}

        <section className="lower-grid" id="contracts">
          <div className="panel contract-panel">
            <div className="panel-heading compact"><div><span className="panel-number">03</span><h2>Contract rules</h2></div><button className="text-button" type="button">View schema <ChevronDown size={15} /></button></div>
            <div className="rules-list">
              {CONTRACT_RULES.map((rule) => <div className="rule-row" key={rule}><span className="rule-state configured" aria-hidden="true" /><span className="rule-copy"><strong>{rule}</strong><small>Configured · not evaluated</small></span><span className="rule-lock">Required</span></div>)}
            </div>
            <div className="contract-meta"><div><span>TEST CASES</span><strong>{SUPPORT_CARD_CONTRACT.cases.length} configured</strong></div><div><span>VALIDATOR</span><strong><ShieldCheck size={15} /> Ajv + rules</strong></div><div><span>MODE</span><strong>Evidence only</strong></div></div>
          </div>
          <div className="panel evidence-panel" id="evidence">
            <div className="panel-heading compact"><div><span className="panel-number">04</span><h2>Evidence</h2></div><span className="status-tag neutral">EMPTY</span></div>
            <div className="evidence-empty"><CircleAlert size={20} /><p>Real request IDs, costs and outputs will appear here after an authenticated evaluation.</p><small>Nothing is simulated in this workspace.</small></div>
            <div className="security-note"><ShieldCheck size={15} /><span>Otari key stays server-side</span></div>
          </div>
        </section>

        <footer className="status-footer">
          <span><span className="footer-dot" /> Recorded evidence · no live inference</span>
          <span className="footer-contract">Contract <b>{CONTRACT_ID}</b></span>
        </footer>
      </main>
    </div>
  )
}

function ComparisonDetails({ result, authenticEvidence }: { result: ComparisonResult; authenticEvidence: AuthenticComparisonResponse | null }) {
  const rows = result.reference.cases.map((referenceCase) => ({
    referenceCase,
    candidateCase: result.candidate.cases.find((candidateCase) => candidateCase.caseId === referenceCase.caseId),
  }))

  return <section className="comparison-details panel" id={authenticEvidence ? 'recorded-evidence' : 'local-comparison'} aria-live="polite">
    <div className="panel-heading compact">
      <div><span className="panel-number">{authenticEvidence ? '05' : '06'}</span><div><h2>{authenticEvidence ? 'Recorded live run' : 'Local comparison results'}</h2><p>{authenticEvidence ? 'RECORDED LIVE RUN · captured previously from authentic Otari requests.' : 'LOCAL TEST / DEMO fixture · no Otari request was made.'}</p></div></div>
      <span className="status-tag neutral">{result.evidence}</span>
    </div>
    <div className="comparison-table" role="table" aria-label="Local comparison results">
      <div className="comparison-row comparison-header" role="row"><span>Test case</span><span>Reference</span><span>Candidate</span><span>Contract</span><span>Rules</span></div>
      {rows.map(({ referenceCase, candidateCase }) => <details className="comparison-row comparison-case" key={referenceCase.caseId}>
        <summary><span>{referenceCase.caseId}</span><span className={`result-chip ${referenceCase.validation.status}`}>{referenceCase.validation.status}</span><span className={`result-chip ${candidateCase?.validation.status ?? 'inconclusive'}`}>{candidateCase?.validation.status ?? 'inconclusive'}</span><span className={`result-chip ${candidateCase?.validation.status ?? 'inconclusive'}`}>{candidateCase?.validation.status ?? 'inconclusive'}</span><span>{candidateCase?.validation.checks.filter((check) => check.status === 'passed').length ?? 0}/{candidateCase?.validation.checks.length ?? 0}</span></summary>
        <div className="comparison-expanded">
          <div><strong>Reference output</strong><code>{referenceCase.rawOutput ?? 'No evidence'}</code></div>
          <div><strong>Candidate output</strong><code>{candidateCase?.rawOutput ?? 'No evidence'}</code></div>
          <div className="verification-statuses">
            <StatusLine label="Reference · format" status={formatStatus(referenceCase)} />
            <StatusLine label="Candidate · format" status={formatStatus(candidateCase)} />
            <StatusLine label="Candidate · semantic category" status={semanticStatus(candidateCase)} />
            <StatusLine label="Candidate · overall contract" status={candidateCase?.validation.status ?? 'inconclusive'} />
          </div>
          <ul>{(candidateCase?.validation.checks ?? []).map((check) => <li key={check.ruleId} className={check.status}><span aria-hidden="true">{check.status === 'passed' ? '●' : check.status === 'failed' ? '×' : '!'}</span><span><b>{check.label}</b> — {check.detail}</span></li>)}</ul>
        </div>
      </details>)}
    </div>
    {authenticEvidence && <div className="authentic-evidence"><strong>Authentic request evidence</strong><p>Total reported cost: {authenticEvidence.totalCostUsd === null ? 'not reported' : `$${authenticEvidence.totalCostUsd.toFixed(6)}`}</p>{authenticEvidence.evidence.flatMap((model) => model.cases).map(({ caseId, result: modelResult }) => <div key={`${modelResult.requestedModel}-${caseId}`}><span>{caseId} · {modelResult.requestedModel}</span><small>HTTP {modelResult.error?.status ?? 200} · effective {modelResult.effectiveModel ?? 'not reported'} · request ID {modelResult.requestId ?? 'not reported'} · tokens {modelResult.usage.total_tokens ?? 'not reported'}</small></div>)}</div>}
    <div className="comparison-reasons"><strong>Decision reasons</strong>{result.reasons.map((reason) => <p key={reason}>{reason}</p>)}</div>
  </section>
}

function formatStatus(item: { rawOutput: string | null; validation: { checks: Array<{ ruleId: string; status: 'passed' | 'failed' | 'inconclusive' }> } } | undefined) {
  if (!item) return 'inconclusive'
  return item.validation.checks.find((check) => check.ruleId === 'json-valid')?.status ?? 'inconclusive'
}

function semanticStatus(item: { validation: { checks: Array<{ ruleId: string; status: 'passed' | 'failed' | 'inconclusive' }> } } | undefined) {
  if (!item) return 'inconclusive'
  const checks = item.validation.checks.filter((check) => check.ruleId === 'category-allowed' || check.ruleId === 'category-matches-reference')
  return checks.some((check) => check.status === 'failed') ? 'failed' : checks.every((check) => check.status === 'passed') ? 'passed' : 'inconclusive'
}

function StatusLine({ label, status }: { label: string; status: string }) {
  return <span className={`verification-status ${status}`}><b>{label}</b><strong>{status}</strong></span>
}

function ModelSelect({ label, value, model }: { label: string; value: string; model: string }) {
  return <div className="model-select">
    <span className="muted-label">{label}</span>
    <button type="button" aria-label={`${label}: ${value}`}><span className="model-glyph">{value.startsWith('GPT') ? '◉' : '✣'}</span><span><strong>{value}</strong><small>{model}</small></span><ChevronDown size={16} /></button>
  </div>
}

export default App
