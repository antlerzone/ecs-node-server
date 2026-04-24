/** Must match `splitOptionsSuffixFromAssistantReply` in `src/modules/cleanlemon/cln-operator-ai.service.js`. */
const OPTIONS_MARKER = 'OPTIONS_JSON:'

/** Machine lines kept in DB for consent / apply — hidden in the operator chat UI. */
const MACHINE_LINE_PREFIXES = ['SCHEDULE_JOB_CREATE_JSON:', 'EXTRACT_JSON:'] as const

function stripOperatorScheduleAiMachineDisplayLines(raw: string): string {
  const lines = String(raw || '').split(/\r?\n/)
  const kept = lines.filter((line) => {
    const t = line.trimStart()
    return !MACHINE_LINE_PREFIXES.some((p) => t.startsWith(p))
  })
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

export type OperatorAiChatOption = { id: string; label: string }

export function parseAssistantMessageForOptions(content: string): {
  displayBody: string
  options: OperatorAiChatOption[]
} {
  const s = stripOperatorScheduleAiMachineDisplayLines(String(content || '')).trimEnd()
  const idx = s.lastIndexOf(OPTIONS_MARKER)
  if (idx === -1) return { displayBody: s.trim(), options: [] }
  const displayBody = s.slice(0, idx).trimEnd()
  const jsonPart = s.slice(idx + OPTIONS_MARKER.length).trim()
  try {
    const arr = JSON.parse(jsonPart) as unknown
    const options = Array.isArray(arr)
      ? arr
          .filter((o): o is Record<string, unknown> => Boolean(o && typeof o === 'object'))
          .map((o) => ({
            id: String(o.id != null ? o.id : o.label || '')
              .trim()
              .slice(0, 64),
            label: String(o.label != null ? o.label : o.id || '')
              .trim()
              .slice(0, 200),
          }))
          .filter((o) => o.id && o.label)
          .slice(0, 8)
      : []
    return { displayBody: (displayBody || '').trim() || s.trim(), options }
  } catch {
    return { displayBody: s.trim(), options: [] }
  }
}
