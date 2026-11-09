import type { BackendStatus } from '../src/contracts/support-card.js'

const status: BackendStatus = {
  service: 'fallback-contract-worker',
  status: 'ok',
  otari: 'not_checked',
  message: 'Backend conectado. Otari se verificará durante la evaluación real.',
  contractId: 'support-card-classification-v1',
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/status' && request.method === 'GET') {
      return Response.json(status, { headers: { 'Cache-Control': 'no-store' } })
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Ruta no disponible en esta misión.' }, { status: 404 })
    }

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>
