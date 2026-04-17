'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  createSaasadminAiMdRule,
  deleteSaasadminAiMdRule,
  fetchSaasadminAiMdRules,
  postSaasadminAiChat,
  type SaasadminAiChatMessage,
  type SaasadminAiMdItem,
} from '@/lib/cleanlemon-api'
import { Loader2, Send, Trash2 } from 'lucide-react'

function guessTitleFromAssistantText(text: string): string {
  const t = String(text || '').trim()
  if (!t) return 'Platform rule'
  const firstLine = t.split('\n')[0]?.trim() || t
  if (firstLine.startsWith('# ')) return firstLine.slice(2).trim().slice(0, 512)
  return firstLine.slice(0, 512)
}

/** Display stored UTC instant as Malaysia local date + time (product default). */
function formatRuleAddedAt(raw: string | undefined): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      dateStyle: 'medium',
      timeStyle: 'medium',
      hour12: false,
    }).format(d) + ' MYT'
  )
}

export default function AdminAiRulesPage() {
  const [rules, setRules] = useState<SaasadminAiMdItem[]>([])
  const [loadingRules, setLoadingRules] = useState(true)

  const [chatMessages, setChatMessages] = useState<SaasadminAiChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  const [saveOpen, setSaveOpen] = useState(false)
  const [saveTitle, setSaveTitle] = useState('')
  const [saveBody, setSaveBody] = useState('')
  const [saveSubmitting, setSaveSubmitting] = useState(false)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadRules = useCallback(async () => {
    setLoadingRules(true)
    const r = await fetchSaasadminAiMdRules()
    if (r.ok && r.items) setRules(r.items)
    setLoadingRules(false)
  }, [])

  useEffect(() => {
    void loadRules()
  }, [loadRules])

  function openSaveFromAssistant(content: string) {
    const body = String(content || '').trim()
    setSaveTitle(guessTitleFromAssistantText(body))
    setSaveBody(body)
    setSaveOpen(true)
  }

  async function handleConfirmSaveRule() {
    const title = saveTitle.trim()
    if (!title) return
    setSaveSubmitting(true)
    const r = await createSaasadminAiMdRule({
      title,
      bodyMd: saveBody,
      sortOrder: rules.length,
    })
    setSaveSubmitting(false)
    if (r.ok) {
      setSaveOpen(false)
      setSaveTitle('')
      setSaveBody('')
      await loadRules()
    }
  }

  async function handleSendChat() {
    const text = chatInput.trim()
    if (!text || chatSending) return
    setChatError(null)
    const nextUser: SaasadminAiChatMessage = { role: 'user', content: text }
    const history = [...chatMessages, nextUser]
    setChatInput('')
    setChatSending(true)
    const r = await postSaasadminAiChat({ messages: history })
    setChatSending(false)
    if (r.ok && r.reply) {
      setChatMessages([...history, { role: 'assistant', content: r.reply }])
    } else {
      setChatError(r.reason || 'Chat failed')
    }
  }

  async function confirmDelete() {
    if (!deleteId) return
    setDeleting(true)
    const r = await deleteSaasadminAiMdRule(deleteId)
    setDeleting(false)
    setDeleteId(null)
    if (r.ok) await loadRules()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operator AI — platform rules</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Rules are added from AI replies below (saved to MySQL and injected into every operator schedule-AI call).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI chat</CardTitle>
          <CardDescription>
            Ask the assistant to draft or refine platform rules. When you are happy with an assistant reply, use{' '}
            <strong>Save as platform rule</strong> to write it into the live rules list. Requires{' '}
            <code className="text-xs">CLEANLEMON_SAASADMIN_AI_API_KEY</code> on the API server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScrollArea className="h-[320px] rounded-md border p-3">
            <div className="space-y-3 pr-3 text-sm">
              {chatMessages.length === 0 && (
                <p className="text-muted-foreground">
                  Example: “Write a strict rule: operators’ AI may only change their own operator’s data and only use
                  schedule-related context.” Then save the assistant’s answer as a rule.
                </p>
              )}
              {chatMessages.map((m, i) => (
                <div
                  key={`${i}-${m.role}`}
                  className={m.role === 'user' ? 'rounded-md bg-muted/60 p-2' : 'rounded-md border bg-background p-2'}
                >
                  <div className="text-muted-foreground mb-1 text-xs font-medium uppercase">{m.role}</div>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  {m.role === 'assistant' && m.content.trim() ? (
                    <div className="mt-2">
                      <Button type="button" variant="secondary" size="sm" onClick={() => openSaveFromAssistant(m.content)}>
                        Save as platform rule
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
              {chatSending && (
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                </div>
              )}
            </div>
          </ScrollArea>
          {chatError && <p className="text-destructive text-sm">{chatError}</p>}
          <div className="flex gap-2">
            <Textarea
              placeholder="Message…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="min-h-[80px] flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSendChat()
                }
              }}
            />
            <Button type="button" onClick={() => void handleSendChat()} disabled={chatSending || !chatInput.trim()}>
              {chatSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active rules</CardTitle>
          <CardDescription>Sorted by <code className="text-xs">sort_order</code>, then created time.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingRules ? (
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          ) : rules.length === 0 ? (
            <p className="text-muted-foreground text-sm">No platform rules yet — add them from the chat above.</p>
          ) : (
            <ul className="space-y-4">
              {rules.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 rounded-lg border p-4 md:flex-row md:items-start md:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {row.ruleCode || '—'}
                      </Badge>
                      <span className="font-medium">{row.title}</span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      加入时间（马来西亚）: {formatRuleAddedAt(row.createdAt)}
                    </div>
                    <div className="text-muted-foreground whitespace-pre-wrap text-sm">{row.bodyMd || '—'}</div>
                    <div className="text-muted-foreground text-xs">order: {row.sortOrder}</div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 text-destructive hover:text-destructive"
                    aria-label="Delete rule"
                    onClick={() => setDeleteId(row.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Save as platform rule</DialogTitle>
            <DialogDescription>
              Title and text are prefilled from the assistant message. Edit if needed, then confirm — this goes live for
              all operators&apos; AI.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="save-title">Title</Label>
              <Input id="save-title" value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="save-body">Description (Markdown)</Label>
              <Textarea id="save-body" value={saveBody} onChange={(e) => setSaveBody(e.target.value)} className="min-h-[160px]" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveOpen(false)} disabled={saveSubmitting}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleConfirmSaveRule()} disabled={saveSubmitting || !saveTitle.trim()}>
              {saveSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Operators&apos; AI will no longer receive this block in its system prompt. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
