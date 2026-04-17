"use client"

import { useState } from "react"
import type { HomedemoScrollSlug } from "@/lib/homedemo-data"
import { cn } from "@/lib/utils"

export function HomedemoMiniDemo({ slug }: { slug: HomedemoScrollSlug }) {
  const [step, setStep] = useState(0)

  if (slug === "tenant") {
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">In the unit</p>
        <div className="rounded-xl border border-white/50 bg-white/50 p-4 text-center">
          <div className="mx-auto h-16 w-10 rounded-lg bg-violet-200/80 shadow-inner" aria-hidden />
          <p className="mt-2 text-xs text-stone-600">Tenant glances at the phone — scroll for the app.</p>
        </div>
      </div>
    )
  }

  if (slug === "tenant-phone") {
    const states = ["Due", "Partial", "Paid"] as const
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Tenant app</p>
        <div className="flex flex-wrap gap-2">
          {states.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                step === i ? "bg-stone-900 text-white" : "bg-white/60 text-stone-700 hover:bg-white"
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="text-xs text-stone-600">
          {step === 0 && "Invoice due — pay in flow without leaving the app."}
          {step === 1 && "Partial payment tied to the right line."}
          {step === 2 && "Cleared balance; operator sees reconciled rent."}
        </p>
      </div>
    )
  }

  if (slug === "owner-lounge") {
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Lounge</p>
        <div className="flex items-center gap-2 rounded-xl border border-white/40 bg-sky-100/40 p-3">
          <span className="text-lg" aria-hidden>
            ♪
          </span>
          <p className="text-xs text-stone-700">Music on — next screen opens owner reports.</p>
        </div>
      </div>
    )
  }

  if (slug === "owner-phone") {
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Owner reports</p>
        <div className="rounded-xl border border-white/40 bg-gradient-to-br from-sky-200/50 to-white/40 p-3">
          <div className="text-xs font-semibold text-stone-800">Revenue vs last quarter</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700">+12.4%</div>
          <div className="mt-4 flex h-8 items-end gap-1">
            {[40, 55, 48, 70, 62, 80].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-sky-500/70"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (slug === "operator-office") {
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Office</p>
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/80 p-4 text-center text-xs text-stone-700">
          Dim the apartment — welcome to ops. Coffee first, dashboard next.
        </div>
      </div>
    )
  }

  if (slug === "operator-dashboard") {
    const tabs = ["Rent roll", "Booking", "Approval"] as const
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Operator flow</p>
        <div className="flex gap-2">
          {tabs.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                step === i ? "bg-amber-600 text-white" : "bg-white/60 text-stone-700"
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-xs text-stone-600">
          {step === 0 && "Properties, rooms, and billing in one workspace."}
          {step === 1 && "Vacancy to deposit on one timeline."}
          {step === 2 && "Auditable roles — who approved what."}
        </p>
      </div>
    )
  }

  if (slug === "living") {
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Pain points</p>
        <ul className="list-inside list-disc text-xs text-stone-700">
          <li>Spreadsheets vs reality</li>
          <li>Chat as system of record</li>
          <li>Scaling by headcount, not software</li>
        </ul>
      </div>
    )
  }

  if (slug === "summary") {
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Stack</p>
        <div className="rounded-xl border border-white/40 bg-white/50 p-3 text-xs text-stone-700">
          Tenant · Owner · Operator — one building, one product story.
        </div>
      </div>
    )
  }

  return null
}
