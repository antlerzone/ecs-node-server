'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { postClnReview, uploadEmployeeFileToOss } from '@/lib/cleanlemon-api'
import { useAuth } from '@/lib/auth-context'
import { Star, ImagePlus, Link2 } from 'lucide-react'

export type ClnReviewKind = 'client_to_operator' | 'operator_to_client' | 'operator_to_staff'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  reviewKind: ClnReviewKind
  /** cln_operatordetail id (operator context). */
  operatorId: string
  scheduleId?: string | null
  /** Staff: cln_employeedetail id or junction id (API resolves). */
  employeeContactId?: string | null
  /** Optional: pre-fill evidence from job completion photos. */
  syncPhotoUrls?: string[]
  title?: string
}

export function GiveReviewDialog({
  open,
  onOpenChange,
  reviewKind,
  operatorId,
  scheduleId,
  employeeContactId,
  syncPhotoUrls,
  title,
}: Props) {
  const { user } = useAuth()
  const oid = String(operatorId || '').trim()
  const [stars, setStars] = useState(5)
  const [remark, setRemark] = useState('')
  const [evidence, setEvidence] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setStars(5)
    setRemark('')
    setEvidence([])
  }, [open, reviewKind, scheduleId, employeeContactId])

  const appendUrls = useCallback((urls: string[]) => {
    setEvidence((prev) => [...new Set([...prev, ...urls.map((u) => String(u).trim()).filter(Boolean)])])
  }, [])

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    const uploadId = oid || String(user?.operatorId || '').trim()
    if (!uploadId) {
      toast.error('Missing operator context for upload')
      return
    }
    for (const file of Array.from(files)) {
      const r = await uploadEmployeeFileToOss(file, uploadId)
      if (r?.ok && r.url) setEvidence((prev) => [...prev, String(r.url)])
      else toast.error(r?.reason || 'Upload failed')
    }
    e.target.value = ''
  }

  const onSubmit = async () => {
    if (!oid) {
      toast.error('Missing operator')
      return
    }
    if (reviewKind !== 'operator_to_staff' && !String(scheduleId || '').trim()) {
      toast.error('Missing schedule')
      return
    }
    if (reviewKind === 'operator_to_staff' && !String(employeeContactId || '').trim()) {
      toast.error('Missing staff contact')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        reviewKind,
        stars,
        remark: remark.trim(),
        evidenceUrls: evidence,
        operatorId: oid,
      }
      if (scheduleId) body.scheduleId = String(scheduleId).trim()
      if (reviewKind === 'operator_to_staff') {
        body.contactId = String(employeeContactId || '').trim()
      }
      const out = await postClnReview(body)
      if (!out?.ok) {
        toast.error(out?.reason || 'Could not save review')
        return
      }
      toast.success('Review submitted')
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title || 'Give review'}</DialogTitle>
          <DialogDescription>1–5 stars, optional note and photos.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label>Rating</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="p-1 rounded hover:bg-muted"
                  aria-label={`${n} stars`}
                  onClick={() => setStars(n)}
                >
                  <Star
                    className={`h-8 w-8 ${n <= stars ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground'}`}
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cln-review-remark">Remark</Label>
            <Textarea
              id="cln-review-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={3}
              placeholder="Optional feedback…"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1" asChild>
              <label className="cursor-pointer">
                <ImagePlus className="h-4 w-4" />
                Add photo
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onPickFiles(e)} />
              </label>
            </Button>
            {Array.isArray(syncPhotoUrls) && syncPhotoUrls.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => appendUrls(syncPhotoUrls)}
              >
                <Link2 className="h-4 w-4" />
                Use job photos ({syncPhotoUrls.length})
              </Button>
            ) : null}
          </div>
          {evidence.length > 0 ? (
            <p className="text-xs text-muted-foreground">{evidence.length} photo(s) attached</p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={submitting} onClick={() => void onSubmit()}>
            {submitting ? 'Saving…' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
