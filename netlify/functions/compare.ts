import { runAuthenticComparison } from '../../src/evaluation/authentic-run.js'

const recentRequests = new Map<string, number>()
let activeRequest = false

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function sameSecret(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

export default async (request: Request): Promise<Response> => {
  const enabled = process.env.PUBLIC_INFERENCE_ENABLED === 'true'
  const configuredToken = process.env.PUBLIC_INFERENCE_TOKEN
  const apiKey = process.env.OTARI_API_KEY

  if (!enabled) return json(404, { status: 'inconclusive', error: 'Public inference is disabled.' })
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' })
  if (!configuredToken || !apiKey) return json(503, { status: 'inconclusive', error: 'Inference is not configured.' })

  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!sameSecret(token, configuredToken)) return json(401, { error: 'Authentication required.' })

  const now = Date.now()
  const previous = recentRequests.get(token) ?? 0
  if (activeRequest) return json(429, { status: 'inconclusive', error: 'Another comparison is already running.' })
  if (now - previous < 60_000) return json(429, { status: 'inconclusive', error: 'Comparison rate limit reached.' })

  activeRequest = true
  recentRequests.set(token, now)
  try {
    return json(200, await runAuthenticComparison(apiKey))
  } catch {
    return json(503, { status: 'inconclusive', error: 'Authentic comparison could not be completed.' })
  } finally {
    activeRequest = false
  }
}
