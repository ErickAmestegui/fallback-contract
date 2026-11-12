import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  CONTRACT_FETCH_URL,
  codeCheckItems,
  runCodeCheck,
  runContractFetch,
  toolConfigFromEnv,
  type CodeCheckRunResult,
} from '../src/evaluation/otari-tools.ts'

const CONTRACT_COMMIT = 'c2d9ae63ccbab16a60e67f620569ec6dfc88004e'
const VERIFIER_FILE = 'scripts/contract_v2_check.py'
const [tool, codeEvidenceFile] = process.argv.slice(2)

if (tool !== 'code' && !(tool === 'fetch' && codeEvidenceFile)) {
  console.error('Usage: npm run otari-tool-run -- code | fetch <evidence/authentic/otari-code-execution-*.json>')
  process.exit(1)
}

const apiKey = process.env.OTARI_API_KEY
const { config, errors } = toolConfigFromEnv(process.env)
if (!apiKey || !config) {
  console.error(apiKey ? errors.join('\n') : 'OTARI_API_KEY is not set.')
  process.exit(1)
}

let result
if (tool === 'code') {
  const recorded = JSON.parse(await readFile('public/redteam-run-01-result.redacted.json', 'utf8'))
  const source = await readFile(VERIFIER_FILE, 'utf8')
  result = await runCodeCheck(apiKey, config, { file: VERIFIER_FILE, source }, codeCheckItems(recorded))
} else {
  const codeRun = JSON.parse(await readFile(codeEvidenceFile, 'utf8')) as CodeCheckRunResult
  if (codeRun.evidence !== 'otari' || codeRun.kind !== 'otari-code-execution' || codeRun.execution?.status !== 'ok' || codeRun.execution.returnCode !== 0) {
    console.error('Web Fetch runs only after a recorded Code Execution run that completed in the sandbox.')
    process.exit(1)
  }
  const text = execFileSync('git', ['show', `${CONTRACT_COMMIT}:src/contracts/support-card.ts`], { encoding: 'utf8' })
  result = await runContractFetch(apiKey, config, { source: `git show ${CONTRACT_COMMIT}:src/contracts/support-card.ts`, text }, CONTRACT_FETCH_URL)
}

await mkdir('evidence/authentic', { recursive: true })
const file = `evidence/authentic/${result.kind}-${result.startedAt.replace(/[:.]/g, '-')}.json`
await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })

console.log(`Wrote ${file}`)
console.log(`Requests sent: ${result.requestsSent}; usage ${result.usage?.status ?? 'n/a'} cost US$${result.usage?.costUsd ?? 'n/a'}`)
console.log(`Decision: ${result.decision}`)
for (const reason of result.reasons) console.log(`- ${reason}`)
