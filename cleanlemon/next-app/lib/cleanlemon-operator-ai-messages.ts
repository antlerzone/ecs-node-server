import { OPERATOR_SCHEDULE_AI_DISPLAY_NAME } from '@/lib/cleanlemon-operator-ai-brand'

/** Keep in sync with `OPERATOR_AI_AGENT_PAYMENT_HINT` in `src/modules/cleanlemon/cln-operator-ai.service.js`. */
export const OPERATOR_AI_AGENT_PAYMENT_HINT =
  `${OPERATOR_SCHEDULE_AI_DISPLAY_NAME} is not available or your model key has no quota. Please complete payment / top up and connect your AI model under Company → API Integration (${OPERATOR_SCHEDULE_AI_DISPLAY_NAME}), then try again.\n\n${OPERATOR_SCHEDULE_AI_DISPLAY_NAME} 暂不可用或模型没有额度。请到 Company → API Integration（${OPERATOR_SCHEDULE_AI_DISPLAY_NAME}）付款或连接模型后再试。`

/** Keep in sync with `OPERATOR_AI_PLATFORM_DISABLED_HINT` in `src/modules/cleanlemon/cln-operator-ai.service.js`. */
export const OPERATOR_AI_PLATFORM_DISABLED_HINT =
  `${OPERATOR_SCHEDULE_AI_DISPLAY_NAME} is turned off by the platform. You can still manage the schedule manually. If you believe this is a mistake, contact Cleanlemons support.\n\n平台已关闭 ${OPERATOR_SCHEDULE_AI_DISPLAY_NAME}，排班仍可手动操作。如需开通请联系 Cleanlemons。`

/** Dispatched on `window` after Jarvis server team apply succeeds so Schedule refetches without F5. */
export const OPERATOR_SCHEDULE_AI_TEAM_APPLIED_EVENT = 'cln_operator_schedule_ai_team_applied'

const SCHEDULE_AI_CONTEXT_LS = 'cln_operator_schedule_context_v1'

/** Schedule page writes; AI chat reads — Malaysia calendar YYYY-MM-DD (Asia/Kuala_Lumpur), matching UTC+0 DB via API. */
export function writeScheduleAiContextWorkingDay(operatorId: string, ymd: string): void {
  if (typeof window === 'undefined') return
  const id = String(operatorId || '').trim()
  if (!id) return
  const d = String(ymd || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
  try {
    localStorage.setItem(`${SCHEDULE_AI_CONTEXT_LS}_${id}`, d)
  } catch {
    /* ignore quota / private mode */
  }
}

export function readScheduleAiContextWorkingDay(operatorId: string): string | undefined {
  if (typeof window === 'undefined') return undefined
  const id = String(operatorId || '').trim()
  if (!id) return undefined
  try {
    const d = localStorage.getItem(`${SCHEDULE_AI_CONTEXT_LS}_${id}`)?.trim().slice(0, 10)
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined
  } catch {
    return undefined
  }
}
