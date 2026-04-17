"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { getMember } from "@/lib/portal-session"
import { getApiDocsMyAccess } from "@/lib/portal-api"
import { BookOpen, KeyRound, Eye, EyeOff, Copy, Check, AlertCircle } from "lucide-react"
import { SwaggerSection } from "./SwaggerSection"

function getApiBase(): string {
  if (typeof window === "undefined") return "https://api.colivingjb.com"
  return (process.env.NEXT_PUBLIC_ECS_BASE_URL || "https://api.colivingjb.com").replace(/\/$/, "")
}

export default function ApiDocsPage() {
  const router = useRouter()
  const [access, setAccess] = useState<{ hasAccess: boolean; user?: { username: string; token: string } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const member = getMember()
    if (!member?.email) {
      router.replace("/login")
      return
    }
    getApiDocsMyAccess(member.email).then((r) => {
      setAccess({ hasAccess: r.hasAccess, user: r.user })
      setLoading(false)
    })
  }, [router])

  if (loading || !access) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!access.hasAccess || !access.user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4 bg-muted">
            <AlertCircle size={24} className="text-muted-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground">No API docs access</h1>
          <p className="text-sm text-muted-foreground">
            Your client has not been approved for API documentation access. Contact your platform administrator.
          </p>
          <Link href="/portal">
            <Button variant="outline">Back to Portal</Button>
          </Link>
        </div>
      </div>
    )
  }

  const user = access.user
  const baseUrl = getApiBase()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={20} style={{ color: "var(--brand)" }} />
            <h1 className="font-bold text-foreground">API Documentation</h1>
          </div>
          <Link href="/portal">
            <Button variant="outline" size="sm">Portal</Button>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-10">
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <KeyRound size={20} style={{ color: "var(--brand)" }} /> Your API credentials
          </h2>
          <p className="text-sm text-muted-foreground">
            Use these to call the API. Keep your API key secret; do not share it or commit it to code.
          </p>
          <div className="grid gap-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-1">Username (X-API-Username)</p>
              <code className="block bg-muted px-3 py-2 rounded text-sm break-all">{user.username}</code>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-1">API Key (Authorization: Bearer)</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-3 py-2 rounded text-sm break-all font-mono min-w-0">
                  {showToken ? user.token : "•".repeat(32)}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken((v) => !v)}
                  title={showToken ? "Hide" : "Reveal"}
                >
                  {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    if (user.token) {
                      await navigator.clipboard.writeText(user.token)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }
                  }}
                  title="Copy API key"
                >
                  {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">Overview</h2>
          <p className="text-muted-foreground text-sm">
            Operators can use this API to manage <strong>property</strong>, <strong>room</strong>, <strong>meter</strong>, <strong>smart door</strong>, and <strong>contact</strong> (add / update / delete / read). All requests use POST with JSON body and require the Bearer token and X-API-Username header above.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
            <KeyRound size={18} /> Authentication
          </h2>
          <p className="text-muted-foreground text-sm mb-3">
            Send the following headers with every request to protected endpoints:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
            <li><code className="bg-muted px-1 rounded">Authorization: Bearer &lt;your-api-token&gt;</code></li>
            <li><code className="bg-muted px-1 rounded">X-API-Username: &lt;your-api-username&gt;</code></li>
          </ul>
          <p className="text-muted-foreground text-sm mt-3">
            Your API key and username are shown above. They are created when a platform admin grants your client API docs access; keep your API key secret.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">Base URL</h2>
          <p className="text-muted-foreground text-sm mb-2">Use this base URL for all API requests:</p>
          <code className="block bg-muted px-3 py-2 rounded text-sm break-all">{baseUrl}/api</code>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">OpenAPI / Swagger 文档</h2>
          <p className="text-muted-foreground text-sm mb-4">
            每个 API 包含：<strong>Endpoint path</strong>、<strong>Headers</strong>、<strong>Request body 示例</strong>、<strong>Response 示例</strong>、<strong>字段说明</strong>。点击 “Try it out” 可填入参数并发送请求（需先在上方 “Authorize” 填入你的 API key 和 username）。
          </p>
          <SwaggerSection />
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">What operators can do (API scope)</h2>
          <p className="text-muted-foreground text-sm mb-3">
            We only expose these five areas. All endpoints use <strong>POST</strong> with JSON body. Send <code className="bg-muted px-1 rounded">Authorization: Bearer &lt;token&gt;</code> and <code className="bg-muted px-1 rounded">X-API-Username: &lt;username&gt;</code> on every request. You can only access your own client’s data.
          </p>
          <ul className="space-y-3 text-sm">
            <li>
              <strong className="text-foreground">1) Property</strong> – add / update / delete / read
              <br /><code className="bg-muted px-1 rounded text-xs">/api/propertysetting/*</code> (e.g. list, get, insert, update, set-active)
            </li>
            <li>
              <strong className="text-foreground">2) Room</strong> – add / update / delete / read
              <br /><code className="bg-muted px-1 rounded text-xs">/api/roomsetting/*</code> (e.g. list, get, insert, update, set-active)
            </li>
            <li>
              <strong className="text-foreground">3) Meter</strong> – add / update / delete / read
              <br /><code className="bg-muted px-1 rounded text-xs">/api/metersetting/*</code> (e.g. list, get, insert, update, delete)
            </li>
            <li>
              <strong className="text-foreground">4) Smart door</strong> – add / update / delete / read
              <br /><code className="bg-muted px-1 rounded text-xs">/api/smartdoorsetting/*</code> (e.g. list, get-lock, get-gateway, update-lock, update-gateway, insert-smartdoors)
            </li>
            <li>
              <strong className="text-foreground">5) Contact</strong> – add / update / delete / read
              <br /><code className="bg-muted px-1 rounded text-xs">/api/contact/*</code> (e.g. list, owner, tenant, supplier, owner/update-account, tenant/update-account, owner/delete, tenant/delete, supplier/delete, supplier/create, supplier/update)
            </li>
          </ul>
          <p className="text-muted-foreground text-sm mt-4">
            <strong className="text-foreground">How to get ids:</strong> Call <strong>list</strong> (e.g. <code className="bg-muted px-1 rounded">POST …/list</code>) — the response items include <code className="bg-muted px-1 rounded">id</code> (or <code className="bg-muted px-1 rounded">_id</code>) for each record. After <strong>insert</strong> / <strong>create</strong>, the response also returns the new record’s <code className="bg-muted px-1 rounded">id</code>. Use these ids for get, update, or delete.
          </p>
          <p className="text-muted-foreground text-sm mt-2">
            Exact path names and request/response fields: <code className="bg-muted px-1 rounded">src/modules/propertysetting</code>, <code className="bg-muted px-1 rounded">roomsetting</code>, <code className="bg-muted px-1 rounded">metersetting</code>, <code className="bg-muted px-1 rounded">smartdoorsetting</code>, <code className="bg-muted px-1 rounded">contact</code>.
          </p>
        </section>

        <section className="pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground">
            For exact endpoint paths and request/response fields, see the codebase or contact your platform administrator.
          </p>
        </section>
      </main>
    </div>
  )
}
