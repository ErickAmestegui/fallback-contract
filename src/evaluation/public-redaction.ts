import type { OtariKeyBudgetResult } from '../otari/client'
import type { V2RoutingRunConfig, V2RoutingRunResult } from './v2-authentic-run'

export const REDACTED_ROUTING_FIELDS = [
  'config.maxExposureUsd',
  'budgetBefore.remainingUsd',
  'budgetBefore.limits',
  'budgetAfter.remainingUsd',
  'budgetAfter.limits',
] as const

export type PublicBudgetSnapshot = Pick<OtariKeyBudgetResult, 'status' | 'budgetsEnforced' | 'error'>

export interface PublicRedaction {
  copy: 'redacted'
  /** The original record is kept privately and is not part of the published files. */
  sourceFile: string
  sourceSha256: string
  removedFields: string[]
  /** budgetBefore.remainingUsd minus budgetAfter.remainingUsd of the original, rounded to 6 decimals. */
  budgetDeltaUsd: number | null
}

export interface PublicRoutingRunResult extends Omit<V2RoutingRunResult, 'config' | 'budgetBefore' | 'budgetAfter'> {
  publicRedaction: PublicRedaction
  config: Omit<V2RoutingRunConfig, 'maxExposureUsd'>
  budgetBefore: PublicBudgetSnapshot
  budgetAfter: PublicBudgetSnapshot | null
}

const publicBudget = ({ status, budgetsEnforced, error }: OtariKeyBudgetResult): PublicBudgetSnapshot => ({ status, budgetsEnforced, error })

export function redactRoutingRunForPublic(run: V2RoutingRunResult, sourceFile: string, sourceSha256: string): PublicRoutingRunResult {
  const { maxExposureUsd: _maxExposureUsd, ...config } = run.config
  const before = run.budgetBefore.remainingUsd
  const after = run.budgetAfter?.remainingUsd ?? null
  return {
    publicRedaction: {
      copy: 'redacted',
      sourceFile,
      sourceSha256: sourceSha256.toUpperCase(),
      removedFields: [...REDACTED_ROUTING_FIELDS],
      budgetDeltaUsd: before !== null && after !== null ? Number((before - after).toFixed(6)) : null,
    },
    ...run,
    config,
    budgetBefore: publicBudget(run.budgetBefore),
    budgetAfter: run.budgetAfter ? publicBudget(run.budgetAfter) : null,
  }
}
