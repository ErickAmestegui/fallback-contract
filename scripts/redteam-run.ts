import { mkdir, writeFile } from 'node:fs/promises'
import { redTeamConfigFromEnv, runRedTeam } from '../src/evaluation/redteam.ts'

const apiKey = process.env.OTARI_API_KEY
const { config, errors } = redTeamConfigFromEnv(process.env)

if (!apiKey || !config) {
  console.error(apiKey ? errors.join('\n') : 'OTARI_API_KEY is not set.')
  process.exit(1)
}

const result = await runRedTeam(apiKey, config)
await mkdir('evidence/authentic', { recursive: true })
const file = `evidence/authentic/redteam-${result.startedAt.replace(/[:.]/g, '-')}.json`
await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })

console.log(`Wrote ${file}`)
console.log(`Requests sent: ${result.requestsSent} of ${result.requestsPlanned}; reported completion cost US$${result.totalReportedCostUsd ?? 'n/a'}`)
if (result.reference) console.log(`Reference fetch: ${result.reference.status} ${result.reference.finalUrl ?? result.reference.url} (request ${result.reference.requestId ?? 'n/a'})`)
for (const response of result.responses) {
  console.log(`${response.seedId} ${response.technique}: ${response.validation.status} (served ${response.result.provider ?? '?'}:${response.result.servedModel ?? '?'}, request ${response.result.requestId ?? 'n/a'})`)
}
console.log(`Decision: ${result.decision}`)
for (const reason of result.reasons) console.log(`- ${reason}`)
