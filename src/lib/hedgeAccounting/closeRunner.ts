import {
  buildCloseAccountingPeriodPlan,
  type CloseAccountingPeriodInput,
  type CloseAccountingRpcName,
} from './closePeriod'

export interface CloseAccountingRepository {
  loadCloseInput(period: string): Promise<CloseAccountingPeriodInput>
  rpc(fn: CloseAccountingRpcName, args: Record<string, unknown>): Promise<void>
}

export interface CloseAccountingPeriodResult {
  period: string
  callCount: number
}

export async function closeAccountingPeriod(
  repository: CloseAccountingRepository,
  period: string,
): Promise<CloseAccountingPeriodResult> {
  const closeInput = await repository.loadCloseInput(period)
  if (closeInput.period !== period) {
    throw new Error(`Loaded close input period ${closeInput.period} does not match requested period ${period}`)
  }

  const plan = buildCloseAccountingPeriodPlan(closeInput)

  for (const call of plan.calls) {
    try {
      await repository.rpc(call.fn, call.args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${call.fn} failed: ${message}`)
    }
  }

  return {
    period: plan.period,
    callCount: plan.calls.length,
  }
}
