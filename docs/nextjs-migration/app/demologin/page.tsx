import { Suspense } from "react"
import DemoLoginClient from "./demo-login-client"

export default function DemoLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <DemoLoginClient />
    </Suspense>
  )
}
