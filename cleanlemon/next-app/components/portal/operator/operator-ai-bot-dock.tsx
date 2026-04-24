'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
} from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { fetchOperatorScheduleAiChat, postOperatorScheduleAiChat } from '@/lib/cleanlemon-api'
import { OPERATOR_SCHEDULE_AI_DISPLAY_NAME } from '@/lib/cleanlemon-operator-ai-brand'
import {
  OPERATOR_AI_AGENT_PAYMENT_HINT,
  OPERATOR_SCHEDULE_AI_TEAM_APPLIED_EVENT,
  readScheduleAiContextWorkingDay,
} from '@/lib/cleanlemon-operator-ai-messages'
import { parseAssistantMessageForOptions } from '@/lib/cleanlemon-operator-ai-chat-options'
import { cn } from '@/lib/utils'
import { Bot, Loader2, Maximize2, Minimize2, Send, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'

type ChatRow = { id: string; role: string; content: string; createdAt: string }

function formatChatMessageTime(iso: string): string {
  const s = String(iso || '').trim()
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d)
}

export type OperatorAiBotDockHandle = {
  /** Open the AI chat dialog (e.g. from the mobile header button). */
  open: () => void
}

export const OperatorAiBotDock = forwardRef(function OperatorAiBotDock(
  {
    operatorId,
    staffEmail,
    enabled,
  }: {
    operatorId: string
    staffEmail: string
    enabled: boolean
  },
  ref: ForwardedRef<OperatorAiBotDockHandle | null>
) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<ChatRow[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const listScrollRef = useRef<HTMLDivElement>(null)

  const emailOpt = useMemo(() => {
    const em = staffEmail.trim().toLowerCase()
    return em ? { email: em } : undefined
  }, [staffEmail])

  useImperativeHandle(ref, () => ({
    open: () => {
      if (enabled) setOpen(true)
    },
  }))

  const loadChat = useCallback(async () => {
    if (!operatorId || !enabled) return
    setLoading(true)
    try {
      const r = await fetchOperatorScheduleAiChat(operatorId, 50, emailOpt)
      if (r?.ok && Array.isArray(r.items)) setItems(r.items)
      else if (!r?.ok && (r?.reason === 'MISSING_EMAIL' || r?.reason === 'UNAUTHORIZED')) {
        setItems([
          {
            id: 'local-hint',
            role: 'assistant',
            content: OPERATOR_AI_AGENT_PAYMENT_HINT,
            createdAt: new Date().toISOString(),
          },
        ])
      }
    } finally {
      setLoading(false)
    }
  }, [operatorId, enabled, emailOpt])

  useEffect(() => {
    if (!open || !enabled) return
    void loadChat()
  }, [open, enabled, loadChat])

  useLayoutEffect(() => {
    if (!open) return
    const el = listScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [items, loading, sending, open])

  /** Only the latest assistant turn may show tappable options (avoids mis-tapping old choices). */
  const activeOptionsMessageId = useMemo(() => {
    if (items.length === 0) return null
    const last = items[items.length - 1]
    if (!last || last.role === 'user') return null
    if (last.role !== 'assistant') return null
    const { options } = parseAssistantMessageForOptions(last.content)
    return options.length > 0 ? last.id : null
  }, [items])

  const send = async (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || sending || !enabled) return
    const optimisticId = `optimistic-user-${Date.now()}`
    setSending(true)
    setItems((prev) => [...prev, { id: optimisticId, role: 'user', content: msg, createdAt: new Date().toISOString() }])
    setInput('')
    try {
      const contextWorkingDay = readScheduleAiContextWorkingDay(operatorId)
      const r = await postOperatorScheduleAiChat(operatorId, msg, true, {
        ...emailOpt,
        ...(contextWorkingDay ? { contextWorkingDay } : {}),
      })
      if (!r.ok) {
        setItems((prev) => prev.filter((row) => row.id !== optimisticId))
        setInput(msg)
        if (r.reason === 'MISSING_EMAIL' || r.reason === 'UNAUTHORIZED') {
          toast.error(`Please sign in again to use ${OPERATOR_SCHEDULE_AI_DISPLAY_NAME}.`)
        } else {
          toast.error(typeof r.reason === 'string' ? r.reason : 'Chat failed')
        }
        return
      }
      if (r.pinnedMerged || r.schedulePrefsMerged) {
        const parts = [r.pinnedMerged && 'pins', r.schedulePrefsMerged && 'schedule AI settings'].filter(Boolean)
        toast.success(`Saved: ${parts.join(' & ')}`)
      }
      const sa = r.scheduleSuggestApplied
      const st = r.scheduleStatusApplied
      const jc = r.scheduleJobCreated as {
        ok?: boolean
        id?: string
        ids?: string[]
        workingDay?: string
      } | undefined
      const sd = r.scheduleJobsDeleted as { ok?: boolean; applied?: number; workingDay?: string } | undefined
      const dispatchScheduleSync = () => {
        if (typeof window === 'undefined') return
        const oid = String(operatorId || '').trim()
        const wd = String(
          (sa?.workingDay ||
            st?.workingDay ||
            jc?.workingDay ||
            sd?.workingDay ||
            readScheduleAiContextWorkingDay(operatorId) ||
            '') as string
        ).slice(0, 10)
        const detail = { operatorId: oid, workingDay: wd }
        window.dispatchEvent(new CustomEvent(OPERATOR_SCHEDULE_AI_TEAM_APPLIED_EVENT, { detail }))
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent(OPERATOR_SCHEDULE_AI_TEAM_APPLIED_EVENT, { detail }))
        }, 280)
      }
      const teamN = sa?.ok ? Number(sa.applied) || 0 : 0
      const stN = st?.ok ? Number(st.applied) || 0 : 0
      const delN = sd?.ok ? Number(sd.applied) || 0 : 0
      const jcIds = Array.isArray(jc?.ids) ? jc.ids.filter(Boolean) : []
      const jcOk = jc?.ok !== false
      const jcHasIds = Boolean(jc && jcOk && (jc.id || jcIds.length > 0))
      const listRefresh = Boolean((r as { scheduleListRefresh?: boolean }).scheduleListRefresh)
      if (jcHasIds || listRefresh) {
        const dayLabel =
          String(jc?.workingDay || '').slice(0, 10) ||
          String(readScheduleAiContextWorkingDay(operatorId) || '').slice(0, 10) ||
          'that day'
        if (jcHasIds) {
          const n = jcIds.length || (jc?.id ? 1 : 0)
          toast.success(
            n > 1
              ? `${n} jobs added for ${dayLabel}. Refreshing the Job list.`
              : `Job added for ${dayLabel}. Refreshing the Job list.`
          )
        } else {
          toast.success(`New job(s) saved for ${dayLabel}. Refreshing the Job list.`)
        }
        dispatchScheduleSync()
      } else if (delN > 0) {
        const dayLabel = String(sd?.workingDay || '').slice(0, 10) || 'that day'
        toast.success(`Removed ${delN} job(s) for ${dayLabel}. Refreshing the Job list.`)
        dispatchScheduleSync()
      } else if (teamN > 0 || stN > 0) {
        const dayLabel = String(sa?.workingDay || st?.workingDay || '').slice(0, 10) || 'that day'
        const bits: string[] = []
        if (teamN > 0) bits.push(`${teamN} team assignment(s)`)
        if (stN > 0) bits.push(`${stN} status update(s)`)
        toast.success(`Schedule updated: ${bits.join('; ')} for ${dayLabel}.`)
        dispatchScheduleSync()
      } else if (sa && !sa.ok && sa.error) {
        toast.error(sa.error)
      }
      await loadChat()
    } finally {
      setSending(false)
    }
  }

  if (!enabled) return null

  return (
    <>
      <div className="pointer-events-none fixed bottom-6 right-6 z-40 hidden lg:block">
        <Button
          type="button"
          size="lg"
          className={cn(
            'pointer-events-auto h-14 w-14 rounded-full shadow-lg',
            'bg-primary text-primary-foreground hover:brightness-110'
          )}
          aria-label={`Open ${OPERATOR_SCHEDULE_AI_DISPLAY_NAME}`}
          onClick={() => setOpen(true)}
        >
          <Bot className="h-7 w-7" />
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setExpanded(false)
        }}
      >
        <DialogContent
          showCloseButton={false}
          className={cn(
            'relative gap-0 p-0 sm:max-w-none',
            '!fixed !top-auto !translate-x-0 !translate-y-0',
            'flex w-[min(100vw-1.5rem,440px)] flex-col overflow-hidden rounded-2xl border shadow-2xl',
            expanded
              ? 'h-[80dvh] max-h-[80dvh] max-lg:!h-[80dvh] max-lg:!max-h-[80dvh] lg:!h-[92dvh] lg:!max-h-[92dvh] lg:w-[min(94vw,720px)]'
              : 'h-[min(600px,86dvh)] max-lg:!h-[min(520px,76dvh)] lg:!h-[min(720px,90dvh)]',
            'max-lg:!left-3 max-lg:!right-3 max-lg:!bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))]',
            'lg:!bottom-6 lg:!right-6 lg:!left-auto'
          )}
        >
          <div className="absolute top-3 right-3 z-[60] flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-xs opacity-70 hover:opacity-100"
              aria-label={expanded ? 'Shrink chat' : 'Expand chat'}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <DialogClose
              className={cn(
                'ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground',
                'inline-flex h-9 w-9 items-center justify-center rounded-xs opacity-70 transition-opacity hover:opacity-100',
                'focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0'
              )}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
          <DialogHeader className="border-b border-border px-4 py-3 pr-20 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              {OPERATOR_SCHEDULE_AI_DISPLAY_NAME}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {OPERATOR_SCHEDULE_AI_DISPLAY_NAME} schedule chat for this operator.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
            <div
              ref={listScrollRef}
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-md border"
            >
              <div className="space-y-3 p-3 pr-2 text-sm">
                {loading ? (
                  <p className="text-muted-foreground flex items-center gap-2 text-xs">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                  </p>
                ) : null}
                {!loading && items.length === 0 ? (
                  <p className="text-muted-foreground text-xs">Ask about jobs or teams.</p>
                ) : null}
                {items.map((m) => {
                  const timeLabel = formatChatMessageTime(m.createdAt)
                  if (m.role === 'assistant') {
                    const { displayBody, options } = parseAssistantMessageForOptions(m.content)
                    return (
                      <div key={m.id} className="rounded-md border bg-background p-2">
                        <div className="text-muted-foreground mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[10px] font-medium uppercase">
                          <span>assistant</span>
                          {timeLabel ? (
                            <span className="font-normal normal-case tabular-nums">{timeLabel}</span>
                          ) : null}
                        </div>
                        <div className="whitespace-pre-wrap break-words">{displayBody}</div>
                        {options.length > 0 && m.id === activeOptionsMessageId ? (
                          <div className="mt-2 flex flex-col gap-1.5">
                            <p className="text-muted-foreground text-[11px] leading-snug">
                              Tap a choice or type your own reply below.
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {options.map((opt) => (
                                <Button
                                  key={`${m.id}-${opt.id}`}
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="h-auto min-h-8 max-w-full whitespace-normal px-2 py-1.5 text-left text-xs font-normal"
                                  disabled={sending}
                                  aria-label={`Send as message: ${opt.label}`}
                                  onClick={() => void send(opt.label)}
                                >
                                  {opt.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  }
                  return (
                    <div key={m.id} className="rounded-md bg-muted/60 p-2">
                      <div className="text-muted-foreground mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[10px] font-medium uppercase">
                        <span>{m.role}</span>
                        {timeLabel ? (
                          <span className="font-normal normal-case tabular-nums">{timeLabel}</span>
                        ) : null}
                      </div>
                      <div className="whitespace-pre-wrap break-words">{m.content}</div>
                    </div>
                  )
                })}
                {sending ? (
                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2 border-t border-border pt-2">
              <Textarea
                placeholder={
                  activeOptionsMessageId
                    ? 'Type your own reply, or use the buttons above…'
                    : 'Message…'
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="min-h-[72px] flex-1 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <Button
                type="button"
                className="shrink-0 self-end"
                disabled={sending || !input.trim()}
                onClick={() => void send()}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
})

OperatorAiBotDock.displayName = 'OperatorAiBotDock'
