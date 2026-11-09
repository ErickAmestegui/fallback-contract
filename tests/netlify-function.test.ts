import { afterEach, describe, expect, it } from 'vitest'
import handler from '../netlify/functions/compare'

const original = {
  enabled: process.env.PUBLIC_INFERENCE_ENABLED,
  token: process.env.PUBLIC_INFERENCE_TOKEN,
  key: process.env.OTARI_API_KEY,
}

afterEach(() => {
  for (const [name, value] of Object.entries({
    PUBLIC_INFERENCE_ENABLED: original.enabled,
    PUBLIC_INFERENCE_TOKEN: original.token,
    OTARI_API_KEY: original.key,
  })) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('Netlify comparison function controls', () => {
  it('keeps public inference disabled by default', async () => {
    delete process.env.PUBLIC_INFERENCE_ENABLED
    const response = await handler(new Request('http://localhost/.netlify/functions/compare', { method: 'POST' }))
    expect(response.status).toBe(404)
  })

  it('rejects unauthenticated enabled requests without contacting Otari', async () => {
    process.env.PUBLIC_INFERENCE_ENABLED = 'true'
    process.env.PUBLIC_INFERENCE_TOKEN = 'local-token'
    process.env.OTARI_API_KEY = 'test-secret-never-logged'
    const response = await handler(new Request('http://localhost/.netlify/functions/compare', { method: 'POST' }))
    expect(response.status).toBe(401)
  })
})
