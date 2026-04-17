"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { ArrowLeft, CheckCircle, Send, Phone, Mail, MapPin } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"

export default function OwnerEnquiryPage() {
  const [submitted, setSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [country, setCountry] = useState<"MY" | "SG">("MY")
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    units: "",
    message: "",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    setIsLoading(true)
    try {
      const email = (form.email || "").trim().toLowerCase()
      if (!email) {
        setSubmitError("Please fill in Email.")
        return
      }
      const res = await fetch("/api/owner-enquiry/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: (form.name || "").trim() || undefined,
          company: (form.company || "").trim() || undefined,
          email,
          phone: (form.phone || "").trim() || undefined,
          units: (form.units || "").trim() || undefined,
          message: (form.message || "").trim() || undefined,
          country: country || undefined,
          currency: country === "SG" ? "SGD" : "MYR",
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        setSubmitError(data.reason === "MISSING_REQUIRED_FIELDS" ? "Please fill in Email." : "Something went wrong. Please try again.")
        return
      }
      setSubmitted(true)
    } finally {
      setIsLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={40} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-3">Request Received!</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            Thank you. We have received your details as an owner looking for an operator. Our team will get in touch with a tailored proposal.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/pricing">
              <Button variant="outline" className="w-full sm:w-auto">Back to Pricing</Button>
            </Link>
            <a href="https://www.colivingjb.com">
              <Button variant="outline" className="w-full sm:w-auto">Back to Home</Button>
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex flex-col leading-tight">
          <span className="text-lg font-bold tracking-widest text-primary uppercase">Coliving</span>
          <span className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Management</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/pricing" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Pricing
          </Link>
          <Link href="/privacy-policy" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Privacy Policy
          </Link>
          <Link href="/refund-policy" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Refund Policy
          </Link>
          <Link href="/terms-and-conditions" className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
            Terms & Conditions
          </Link>
          <a href="https://www.colivingjb.com" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={14} /> Back to Home
          </a>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] uppercase mb-3" style={{ color: "var(--brand)" }}>
              Owner looking for operator
            </p>
            <h1 className="text-3xl sm:text-4xl font-black text-foreground leading-tight mb-4 text-pretty">
              Get a tailored proposal
            </h1>
            <p className="text-muted-foreground leading-relaxed mb-8">
              Tell us about your property. We’ll contact you with management options (e.g. 10% of income per month or commission per tenancy).
            </p>
            <div className="space-y-4 mb-8">
              {[
                { icon: Mail, label: "Email", value: "colivingmanagement@gmail.com" },
                { icon: Phone, label: "Phone", value: "60198579627" },
                { icon: MapPin, label: "Office", value: "Johor Bahru, Malaysia" },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand-light)" }}>
                    <Icon size={16} style={{ color: "var(--brand)" }} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-semibold text-foreground">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-bold text-foreground mb-6">Submit your details</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-2 uppercase tracking-wide">Region</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCountry("MY")}
                    className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${country === "MY" ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40"}`}
                  >
                    Malaysia (MYR)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCountry("SG")}
                    className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${country === "SG" ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40"}`}
                  >
                    Singapore (SGD)
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Full Name</label>
                  <Input
                    placeholder="John Doe"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Company / Property</label>
                  <Input
                    placeholder="Your company or property name"
                    value={form.company}
                    onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Email *</label>
                  <Input
                    required
                    type="email"
                    placeholder="you@company.com"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Phone</label>
                  <Input
                    placeholder="+60 12-345 6789"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Number of Units</label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 50"
                  value={form.units}
                  onChange={e => setForm(f => ({ ...f, units: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wide">Message</label>
                <textarea
                  rows={3}
                  placeholder="Tell us about your property and what you need..."
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              {submitError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {submitError}
                </p>
              )}
              <Button
                type="submit"
                disabled={isLoading || !form.email}
                className="w-full gap-2"
                style={{ background: "var(--brand)" }}
              >
                {isLoading ? (
                  <><Spinner size="sm" /> Sending...</>
                ) : (
                  <><Send size={15} /> Submit</>
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
