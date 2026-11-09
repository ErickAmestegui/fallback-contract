import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callOtari } from '../src/otari/client.ts'
import { SUPPORT_CARD_CASES, SUPPORT_CARD_CONTRACT, MODEL_OPTIONS } from '../src/contracts/support-card.ts'
import { decideComparison } from '../src/evaluation/decision.ts'
import type { AuthenticComparisonResponse, AuthenticModelEvidence } from '../src/evaluation/authentic.ts'
import type { CaseEvaluation, ModelEvaluation } from '../src/evaluation/types.ts'
import { validateOutput } from '../src/evaluation/validate.ts'

const port = Number(process.env.PORT ?? 8788)
const root = fileURLToPath(new URL('..', import.meta.url))
const clientRoot = join(root, 'dist', 'client')
const apiKey = process.env.OTARI_API_KEY

function requestFor(model: string, message: string) {
  const isQwen = model === MODEL_OPTIONS.candidate
  return {
    model,
    messages: [
      { role: 'system' as const, content: 'Return only one JSON object with category, urgency, and action. Do not include markdown or commentary.' },
      { role: 'user' as const, content: `${isQwen ? '/no_think\n' : ''}${message}` },
    ],
    maxTokens: isQwen ? 256 : 512,
    ...(isQwen ? {} : { reasoningEffort: 'low' as const, responseFormat: { type: 'json_object' as const } }),
  }
}

async function evaluateModel(role: 'reference' | 'candidate'): Promise<{ evaluation: ModelEvaluation; evidence: AuthenticModelEvidence }> {
  const model = role === 'reference' ? MODEL_OPTIONS.reference : MODEL_OPTIONS.candidate
  const cases: CaseEvaluation[] = []
  const evidence: AuthenticModelEvidence = { role, cases: [] }

  for (const testCase of SUPPORT_CARD_CASES) {
    const result = await callOtari({ OTARI_API_KEY: apiKey }, requestFor(model, testCase.message))
    cases.push({
      caseId: testCase.id,
      role,
      rawOutput: result.content,
      validation: validateOutput(result.content, SUPPORT_CARD_CONTRACT, testCase),
      evidence: 'otari',
    })
    evidence.cases.push({ caseId: testCase.id, result })
  }

  const technicalErrors = evidence.cases
    .map(({ result }) => result.error?.code)
    .filter((code): code is string => Boolean(code))

  return {
    evaluation: {
      role,
      requestedModel: model,
      effectiveModel: evidence.cases.find(({ result }) => result.effectiveModel)?.result.effectiveModel ?? null,
      cases,
      technicalError: technicalErrors.length ? technicalErrors.join(', ') : null,
    },
    evidence,
  }
}

async function runComparison(): Promise<AuthenticComparisonResponse> {
  const reference = await evaluateModel('reference')
  const candidate = await evaluateModel('candidate')
  const comparison = decideComparison({
    contract: SUPPORT_CARD_CONTRACT,
    cases: SUPPORT_CARD_CASES,
    reference: reference.evaluation,
    candidate: candidate.evaluation,
  })
  const costs = [...reference.evidence.cases, ...candidate.evidence.cases]
    .map(({ result }) => result.usage.cost_usd)
    .filter((cost): cost is number => typeof cost === 'number')

  return {
    comparison,
    evidence: [reference.evidence, candidate.evidence],
    totalCostUsd: costs.length ? costs.reduce((total, cost) => total + cost, 0) : null,
  }
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
      json(response, 200, await runComparison())
    } catch (error) {
      console.error('Authentic comparison failed', error instanceof Error ? error.name : typeof error)
      json(response, 503, { status: 'inconclusive', error: 'Authentic comparison could not be completed.' })
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
