import {
  buildCloseAccountingPeriodPlan,
  type CloseAccountingPeriodInput,
  type CloseAccountingRpcName,
} from './closePeriod'

export interface CloseAccountingRepository {
  loadCloseInput(period: string): Promise<CloseAccountingPeriodInput>
  rpc(fn: CloseAccountingRpcName, args: Record<string, unknown>): Promise<unknown>
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
  const fairValueMeasurementIds = new Map<string, string>()

  for (const call of plan.calls) {
    const args = { ...call.args }
    if (call.fn === 'append_derivative_accounting_entry') {
      const designationId = String(args.p_designation_id ?? '')
      const fairValueMeasurementId = fairValueMeasurementIds.get(designationId)
      if (!args.p_fair_value_measurement_id && fairValueMeasurementId) {
        args.p_fair_value_measurement_id = fairValueMeasurementId
        args.p_source_event_ref ??= `fair_value:${fairValueMeasurementId}`
      }
    }

    try {
      const result = await repository.rpc(call.fn, args)
      if (call.fn === 'append_fair_value_measurement' && typeof result === 'string') {
        const designationId = String(args.p_designation_id ?? '')
        if (designationId) fairValueMeasurementIds.set(designationId, result)
      }
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
