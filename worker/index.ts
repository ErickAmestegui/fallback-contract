import type { BackendStatus } from '../src/contracts/support-card.js'
import { listOtariModels } from '../src/otari/client.js'

const status: BackendStatus = {
  service: 'fallback-contract-worker',
  status: 'ok',
  otari: 'not_checked',
  message: 'Backend connected. Otari will be checked during a live evaluation.',
  contractId: 'support-card-classification-v1',
}

export default {
  async fetch(request: Request, env: { OTARI_API_KEY?: string }): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/status' && request.method === 'GET') {
      return Response.json(status, { headers: { 'Cache-Control': 'no-store' } })
    }

    if (url.pathname === '/api/models' && request.method === 'GET') {
      const result = await listOtariModels(env)
      return Response.json(
        {
          status: result.status,
          models: result.models,
          error: result.error ? { status: result.error.status, code: result.error.code } : null,
        },
        { status: result.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Ruta no disponible en esta misión.' }, { status: 404 })
    }

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>
