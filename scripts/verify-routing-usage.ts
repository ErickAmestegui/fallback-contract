import { readFile, writeFile } from 'node:fs/promises'
import { getOtariRequestUsage } from '../src/otari/client.ts'
import type { V2RoutingRunResult } from '../src/evaluation/v2-authentic-run.ts'
import { checkRoutingUsage } from '../src/evaluation/v2-routing-verify.ts'

const evidenceFile = process.argv[2]
const apiKey = process.env.OTARI_API_KEY

if (!evidenceFile || !apiKey) {
  console.error('Usage: OTARI_API_KEY=... npm run verify-routing-usage -- <evidence/authentic/v2-routing-*.json>')
  process.exit(1)
}

const run = JSON.parse(await readFile(evidenceFile, 'utf8')) as V2RoutingRunResult
if (run.evidence !== 'otari') {
  console.error('Refusing to verify evidence that is not labelled as authentic Otari evidence.')
  process.exit(1)
}

const checks = []
for (const call of run.calls.filter((item) => item.role === 'candidate')) {
  const usage = call.result.requestId ? await getOtariRequestUsage({ OTARI_API_KEY: apiKey }, call.result.requestId) : null
  checks.push(checkRoutingUsage(call, usage))
}

const output = evidenceFile.replace(/\.json$/, '.usage.json')
await writeFile(output, `${JSON.stringify({ evidenceFile, checkedAt: new Date().toISOString(), checks }, null, 2)}\n`, { flag: 'wx' })
console.log(`Wrote ${output}`)
for (const check of checks) console.log(`${check.caseId}: ${check.status} - ${check.detail}`)
