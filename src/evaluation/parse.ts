import type { SupportCardOutput } from '../contracts/support-card.js'

export function parseStrictJson(raw: string): { value: SupportCardOutput | null; error: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: null, error: 'Response is empty.' }
  if (trimmed.startsWith('```') || trimmed.endsWith('```')) {
    return { value: null, error: 'Response contains markdown fences.' }
  }

  try {
    const value = JSON.parse(trimmed) as SupportCardOutput
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { value: null, error: 'Response must be a JSON object.' }
    }
    return { value, error: null }
  } catch {
    return { value: null, error: 'Response is not valid JSON.' }
  }
}
