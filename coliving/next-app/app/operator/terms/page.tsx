"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { FileText, CheckCircle, PenLine, Shield, ArrowLeft } from "lucide-react"
import { getTermsSaasOperator, signTermsSaasOperator } from "@/lib/operator-api"
import { useOperatorContext } from "@/contexts/operator-context"
import type { SignaturePadHandle } from "@/components/operator/signature-pad"

const SignaturePad = dynamic(
  () => import("@/components/operator/signature-pad").then((m) => m.SignaturePad),
  { ssr: false }
)

/** Simple markdown-like rendering: ## heading, **bold**, newlines. */
function renderTermsContent(content: string) {
  if (!content) return null
  const lines = content.split("\n")
  const out: React.ReactNode[] = []
  lines.forEach((line, i) => {
    const key = `line-${i}`
    if (line.startsWith("## ")) {
      out.push(<h2 key={key} className="text-lg font-bold mt-6 mb-2 text-foreground">{line.slice(3)}</h2>)
    } else if (line.startsWith("# ")) {
      out.push(<h1 key={key} className="text-xl font-bold mt-4 mb-2 text-foreground">{line.slice(2)}</h1>)
    } else if (line.trim() === "---") {
      out.push(<hr key={key} className="my-4 border-border" />)
    } else if (line.trim()) {
      const parts: React.ReactNode[] = []
      let rest = line
      let idx = 0
      while (rest.length) {
        const boldStart = rest.indexOf("**")
        if (boldStart === -1) {
          parts.push(rest)
          break
        }
        parts.push(rest.slice(0, boldStart))
        const boldEnd = rest.indexOf("**", boldStart + 2)
        if (boldEnd === -1) {
          parts.push(rest.slice(boldStart))
          break
        }
        parts.push(<strong key={idx++} className="font-semibold text-foreground">{rest.slice(boldStart + 2, boldEnd)}</strong>)
        rest = rest.slice(boldEnd + 2)
      }
      out.push(<p key={key} className="text-muted-foreground text-sm leading-relaxed mb-2">{parts}</p>)
    } else {
      out.push(<br key={key} />)
    }
  })
  return <div className="space-y-0">{out}</div>
}

export default function OperatorTermsPage() {
  const { refresh } = useOperatorContext()
  const [content, setContent] = useState<string>("")
  const [version, setVersion] = useState<string>("")
  const [contentHash, setContentHash] = useState<string>("")
  const [accepted, setAccepted] = useState<boolean>(false)
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null)
  const [signatureHash, setSignatureHash] = useState<string | null>(null)
  const signaturePadRef = useRef<SignaturePadHandle>(null)
  const [loading, setLoading] = useState(true)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSigned, setJustSigned] = useState(false)
  const [acceptChecked, setAcceptChecked] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getTermsSaasOperator()
      if (!res.ok) {
        const msg =
          (res as { reason?: string }).reason === "TERMS_TABLE_MISSING"
            ? "Terms are not configured yet. Please ask the administrator to run migration 0102_terms_acceptance.sql."
            : (res as { message?: string }).message || (res as { reason?: string }).reason || "Failed to load terms"
        setError(msg)
        return
      }
      setContent(res.content ?? "")
      setVersion(res.version ?? "")
      setContentHash(res.contentHash ?? "")
      setAccepted(res.accepted ?? false)
      setAcceptedAt(res.acceptedAt ?? null)
      setSignatureHash(res.signatureHash ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load terms (internal server error)")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleSign() {
    if (!acceptChecked) {
      setError("Please check the box to confirm you accept this term before signing.")
      return
    }
    const dataUrl = signaturePadRef.current?.getDataURL() ?? ""
    const isEmpty = signaturePadRef.current?.isEmpty() ?? true
    if (isEmpty || !dataUrl || dataUrl.length < 100) {
      setError("Please draw your signature in the box above before accepting.")
      return
    }
    setSigning(true)
    setError(null)
    try {
      const res = await signTermsSaasOperator(dataUrl)
      if (!res.ok) {
        setError(res.reason || "Signing failed")
        return
      }
      setJustSigned(true)
      setAccepted(true)
      setAcceptedAt(new Date().toISOString())
      setSignatureHash(res.signatureHash ?? null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing failed")
    } finally {
      setSigning(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading terms...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/operator"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} /> Back to Dashboard
        </Link>
      </div>

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2">
            <FileText size={22} style={{ color: "var(--brand)" }} />
            SaaS Platform – Operator Terms & Conditions
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Version {version}
            {contentHash && (
              <span className="ml-2 font-mono text-xs">
                Content hash: <span title={contentHash}>{contentHash.slice(0, 12)}…</span>
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          {accepted ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                <CheckCircle size={24} className="text-green-600 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-foreground">
                    {justSigned ? "You have signed the Terms & Conditions." : "You have already signed the Terms & Conditions."}
                  </p>
                  {acceptedAt && (
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Signed at: {new Date(acceptedAt).toLocaleString()}
                    </p>
                  )}
                  {signatureHash && (
                    <p className="text-xs font-mono text-muted-foreground mt-1 break-all" title="Signature hash (audit trail)">
                      Signature hash: {signatureHash}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                This record (signature + hash) is stored for audit and non-repudiation. You may re-sign if we publish a new version of the terms.
              </p>
              <Link href="/operator">
                <Button variant="outline">Back to Dashboard</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
                <Shield size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-foreground">
                  You must read and accept the Terms & Conditions below before using the operator platform. By signing, you agree to be bound by these terms. Your signature and a hash are stored for legal and audit purposes.
                </p>
              </div>

              <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-muted/30 p-6 mb-6">
                {content ? renderTermsContent(content) : (
                  <p className="text-muted-foreground text-sm">Terms content is not available. Please contact support.</p>
                )}
              </div>

              <div className="space-y-4 border-t border-border pt-6">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="accept-term"
                    checked={acceptChecked}
                    onCheckedChange={(checked) => setAcceptChecked(checked === true)}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="accept-term"
                    className="text-sm font-medium cursor-pointer leading-tight"
                  >
                    I have read and accept this term.
                  </Label>
                </div>
                <div>
                  <Label>Your signature (draw in the box below)</Label>
                  <p className="text-sm text-muted-foreground mt-1 mb-2">
                    Use your mouse or finger to sign in the box. Then click &quot;Sign & Accept Terms&quot;.
                  </p>
                  <SignaturePad ref={signaturePadRef} />
                </div>
                <Button
                  onClick={handleSign}
                  disabled={signing || !acceptChecked}
                  className="gap-2"
                  style={{ background: "var(--brand)" }}
                >
                  <PenLine size={16} />
                  {signing ? "Signing…" : "Sign & Accept Terms"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
