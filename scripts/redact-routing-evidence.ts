import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { redactRoutingRunForPublic } from '../src/evaluation/public-redaction.ts'
import type { V2RoutingRunResult } from '../src/evaluation/v2-authentic-run.ts'

const [evidenceFile, ...outputs] = process.argv.slice(2)

if (!evidenceFile || outputs.length === 0) {
  console.error('Usage: npm run redact-routing-evidence -- <evidence/authentic/v2-routing-*.json> <output.json> [...]')
  process.exit(1)
}

const original = await readFile(evidenceFile)
const run = JSON.parse(original.toString('utf8')) as V2RoutingRunResult
if (run.evidence !== 'otari') {
  console.error('Refusing to redact evidence that is not labelled as authentic Otari evidence.')
  process.exit(1)
}

const sourceSha256 = createHash('sha256').update(original).digest('hex')
const redacted = `${JSON.stringify(redactRoutingRunForPublic(run, evidenceFile.replaceAll('\\', '/'), sourceSha256), null, 2)}\n`
for (const output of outputs) {
  await writeFile(output, redacted, { flag: 'wx' })
  console.log(`Wrote ${output}`)
}
console.log(`Redacted SHA-256 ${createHash('sha256').update(redacted).digest('hex').toUpperCase()}`)
