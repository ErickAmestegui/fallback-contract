import type { OtariRequestUsageResult } from '../otari/client.js'
import type { V2RoutingCall } from './v2-authentic-run.js'

export interface RoutingUsageCheck {
  caseId: string
  requestId: string | null
  fallback: boolean | null
  attemptCount: number | null
  rowCount: number | null
  requestStatus: string | null
  costUsd: number | null
  status: 'consistent' | 'mismatch' | 'inconclusive'
  detail: string
}

// Otari writes one usage row per attempt under the request's Otari-Request-ID,
// so row_count is an independent record of the attempts the headers report.
export function checkRoutingUsage(call: V2RoutingCall, usage: OtariRequestUsageResult | null): RoutingUsageCheck {
  const base = {
    caseId: call.caseId,
    requestId: call.result.requestId,
    fallback: call.result.fallback ?? null,
    attemptCount: call.result.attemptCount ?? null,
    rowCount: usage?.rowCount ?? null,
    requestStatus: usage?.requestStatus ?? null,
    costUsd: usage?.costUsd ?? null,
  }
  if (!call.result.requestId) return { ...base, status: 'inconclusive', detail: 'The call has no Otari-Request-ID to look up.' }
  if (!usage || usage.status !== 'ok') {
    return { ...base, status: 'inconclusive', detail: `Usage lookup unavailable (${usage?.error?.code ?? 'not requested'}).` }
  }
  if (base.attemptCount === null || base.rowCount === null) {
    return { ...base, status: 'inconclusive', detail: 'Attempt count or row count is missing.' }
  }
  if (base.rowCount !== base.attemptCount) {
    return { ...base, status: 'mismatch', detail: `Headers report ${base.attemptCount} attempts but Otari recorded ${base.rowCount} usage rows.` }
  }
  return { ...base, status: 'consistent', detail: `Headers and usage rows agree on ${base.rowCount} attempts.` }
}
