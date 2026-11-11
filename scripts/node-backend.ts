import { createReadStream, existsSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUPPORT_CARD_CONTRACT } from '../src/contracts/support-card.ts'
import { runAuthenticComparison } from '../src/evaluation/authentic-run.ts'
import { routingRunConfigFromEnv, runAuthenticV2Comparison, type V2RoutingRunResult } from '../src/evaluation/v2-authentic-run.ts'

const port = Number(process.env.PORT ?? 8788)
const root = fileURLToPath(new URL('..', import.meta.url))
const clientRoot = join(root, 'dist', 'client')
const apiKey = process.env.OTARI_API_KEY
const routingEvidenceDir = join(root, 'evidence', 'authentic')

async function persistRoutingEvidence(result: V2RoutingRunResult): Promise<string> {
  await mkdir(routingEvidenceDir, { recursive: true })
  const file = join(routingEvidenceDir, `v2-routing-${result.startedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
  return file
}

function json(response: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(payload)
}

function serveClient(request: IncomingMessage, response: ServerResponse) {
  const requested = normalize((request.url ?? '/').split('?')[0]).replace(/^([.][.][\\/])+/, '')
  const candidate = requested === '/' ? 'index.html' : requested
  const file = join(clientRoot, candidate)
  const safe = file.startsWith(clientRoot) && existsSync(file) && statSync(file).isFile()
  const target = safe ? file : join(clientRoot, 'index.html')
  if (!existsSync(target)) {
    response.writeHead(503)
    response.end('Build the client before starting the private backend.')
    return
  }
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
  response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream' })
  createReadStream(target).pipe(response)
}

const server = createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/compare') {
    if (!apiKey) {
      json(response, 503, { status: 'inconclusive', error: 'Private backend secret is not configured.' })
      return
    }
    try {
      json(response, 200, await runAuthenticComparison(apiKey))
    } catch (error) {
      console.error('Authentic comparison failed', error instanceof Error ? error.name : typeof error)
      json(response, 503, { status: 'inconclusive', error: 'Authentic comparison could not be completed.' })
    }
    return
  }

  if (request.method === 'POST' && request.url === '/api/compare-v2-routing') {
    if (!apiKey) {
      json(response, 503, { status: 'inconclusive', error: 'Private backend secret is not configured.' })
      return
    }
    const { config, errors } = routingRunConfigFromEnv(process.env)
    if (!config) {
      json(response, 503, { status: 'inconclusive', error: 'Routing run is not configured.', reasons: errors })
      return
    }
    try {
      const result = await runAuthenticV2Comparison(apiKey, config)
      const evidenceFile = result.evidence === 'otari' ? await persistRoutingEvidence(result) : null
      json(response, 200, { ...result, evidenceFile })
    } catch (error) {
      console.error('Routing comparison failed', error instanceof Error ? error.name : typeof error)
      json(response, 503, { status: 'inconclusive', error: 'Routing comparison could not be completed.' })
    }
    return
  }

  if (request.method === 'GET' && request.url === '/api/status') {
    json(response, 200, { status: 'ok', backend: 'private-node', contractId: SUPPORT_CARD_CONTRACT.id })
    return
  }

  if (request.method === 'GET') {
    serveClient(request, response)
    return
  }

  json(response, 405, { error: 'Method not allowed.' })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Private Node backend listening on http://127.0.0.1:${port}`)
})
