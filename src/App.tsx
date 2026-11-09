import { useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronDown, CircleAlert, FileCheck2, Gauge, Play, ShieldCheck, Sparkles } from 'lucide-react'
import type { BackendStatus } from './contracts/support-card'
import { CONTRACT_ID, CONTRACT_RULES, MODEL_OPTIONS } from './contracts/support-card'
import './App.css'

type ConnectionState = 'loading' | 'connected' | 'error'

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('loading')
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null)

  useEffect(() => {
    fetch('/api/status')
      .then(async (response) => {
        if (!response.ok) throw new Error('Backend unavailable')
        return (await response.json()) as BackendStatus
      })
      .then((data) => {
        setBackendStatus(data)
        setConnectionState('connected')
      })
      .catch(() => setConnectionState('error'))
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span /><span /></div>
          <div><strong>Fallback</strong><strong>Contract</strong></div>
        </div>
        <p className="brand-caption">Model replacement gate</p>
        <nav aria-label="Primary navigation">
          {['Overview', 'Compare models', 'Contracts', 'Executions', 'Evidence'].map((item, index) => (
            <button className={`nav-item ${index === 0 ? 'active' : ''}`} key={item} type="button">
              <span className="nav-icon" aria-hidden="true">{index === 0 ? '⌂' : ['⇄', '</>', '▷', '▤'][index - 1]}</span>{item}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="gateway-card">
            <div className="gateway-icon"><Sparkles size={18} /></div>
            <div><strong>Otari</strong><span>Gateway</span><small>api.otari.ai</small></div>
            <span className="external" aria-hidden="true">↗</span>
          </div>
          <p>Independent project<br />for <b>Mozilla Developers<br />Wilding 2026</b></p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="eyebrow"><span className="eyebrow-dot" /> Fallback Contract <span className="slash">/</span> Decision workspace</div>
          <div className="top-actions">
            <span className={`connection-pill ${connectionState}`}><span />{connectionState === 'loading' ? 'Connecting' : connectionState === 'connected' ? 'Backend connected' : 'Backend unavailable'}</span>
            <button className="icon-button" aria-label="Toggle theme" type="button">☼</button>
            <button className="avatar" aria-label="Account menu" type="button">EM</button>
          </div>
        </header>

        <section className="hero-row">
          <div>
            <p className="section-kicker">MODEL REPLACEMENT GATE</p>
            <h1>Verify behavior<br /><em>before</em> switching models.</h1>
            <p className="hero-copy">A functional contract is the boundary between a confident upgrade and an invisible regression.</p>
          </div>
          <div className="hero-note">
            <span className="note-line" />
            <p><b>Mission 07</b><br />Interface foundation</p>
            <span className="note-status"><span /> No live evaluation yet</span>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="panel config-panel">
            <div className="panel-heading">
              <div><span className="panel-number">01</span><div><h2>Configure a comparison</h2><p>Choose the models that will run against the same contract.</p></div></div>
              <span className="demo-badge">SETUP</span>
            </div>
            <div className="model-flow">
              <ModelSelect label="Current model · reference" value="GPT OSS 20B" model={MODEL_OPTIONS.reference} />
              <ArrowRight className="flow-arrow" aria-hidden="true" />
              <ModelSelect label="Candidate model" value="Qwen3 32B" model={MODEL_OPTIONS.candidate} />
            </div>
            <div className="contract-strip">
              <div className="contract-icon"><FileCheck2 size={18} /></div>
              <div><span className="muted-label">ACTIVE CONTRACT</span><strong>{CONTRACT_ID}</strong></div>
              <span className="contract-state"><Check size={14} /> Draft ready</span>
            </div>
            <button className="primary-button disabled-button" type="button" disabled><Play size={16} fill="currentColor" /> Run comparison <span>Available in Mission 08</span></button>
          </div>

          <div className="panel decision-panel">
            <div className="panel-heading compact"><div><span className="panel-number">02</span><h2>Decision</h2></div><span className="status-tag neutral">NOT RUN</span></div>
            <div className="decision-empty">
              <div className="decision-orbit"><Gauge size={28} /></div>
              <h3>No decision yet</h3>
              <p>Run a comparison to see whether the candidate preserves the contract.</p>
            </div>
            <div className="decision-legend"><span><i className="dot approve" /> APPROVE</span><span><i className="dot reject" /> REJECT</span><span><i className="dot inconclusive" /> INCONCLUSIVE</span></div>
          </div>
        </section>

        <section className="lower-grid">
          <div className="panel contract-panel">
            <div className="panel-heading compact"><div><span className="panel-number">03</span><h2>Contract rules</h2></div><button className="text-button" type="button">View schema <ChevronDown size={15} /></button></div>
            <div className="rules-list">
              {CONTRACT_RULES.map((rule) => <div className="rule-row" key={rule}><span className="check-box"><Check size={13} /></span><span>{rule}</span><span className="rule-lock">Required</span></div>)}
            </div>
            <div className="contract-meta"><div><span>TEST CASES</span><strong>0 configured</strong></div><div><span>VALIDATOR</span><strong><ShieldCheck size={15} /> Ajv + rules</strong></div><div><span>MODE</span><strong>Evidence only</strong></div></div>
          </div>
          <div className="panel evidence-panel">
            <div className="panel-heading compact"><div><span className="panel-number">04</span><h2>Evidence</h2></div><span className="status-tag neutral">EMPTY</span></div>
            <div className="evidence-empty"><CircleAlert size={20} /><p>Real request IDs, costs and outputs will appear here after an authenticated evaluation.</p><small>Nothing is simulated in this workspace.</small></div>
            <div className="security-note"><ShieldCheck size={15} /><span>Otari key stays server-side</span></div>
          </div>
        </section>

        <footer className="status-footer">
          <span><span className="footer-dot" /> {backendStatus?.message ?? 'Checking backend connection…'}</span>
          <span className="footer-contract">Contract <b>{CONTRACT_ID}</b></span>
        </footer>
      </main>
    </div>
  )
}

function ModelSelect({ label, value, model }: { label: string; value: string; model: string }) {
  return <div className="model-select">
    <span className="muted-label">{label}</span>
    <button type="button" aria-label={`${label}: ${value}`}><span className="model-glyph">{value.startsWith('GPT') ? '◉' : '✣'}</span><span><strong>{value}</strong><small>{model}</small></span><ChevronDown size={16} /></button>
  </div>
}

export default App
