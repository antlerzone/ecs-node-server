"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { Building2, User, Briefcase, Home, FileText, HelpCircle, Bookmark, ExternalLink } from "lucide-react"
import { TutorialStep } from "./components/TutorialStep"
import { OPERATOR_PDF_TUTORIALS, getOperatorPdfUrl, type OperatorPdfId } from "./operator-pdfs"
import { tenantInit } from "@/lib/tenant-api"
import {
  getTenantGateLayerFromInitPayload,
  getTenantGateRedirectUrl,
  type TenantProfileLite,
  type TenantTenancyLite,
} from "@/lib/tenant-gates"

const OperatorPdfViewer = dynamic(
  () => import("./components/OperatorPdfViewer").then((m) => m.OperatorPdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-b-lg border-t-0 border border-border bg-muted/20 min-h-[70vh] flex items-center justify-center text-sm text-muted-foreground">
        Loading viewer…
      </div>
    ),
  }
)

type Role = "owner" | "tenant" | "operator"

const SIDEBAR_SECTIONS: Record<Exclude<Role, "operator">, { id: string; label: string; icon?: React.ReactNode }[]> = {
  owner: [
    { id: "overview", label: "Overview", icon: <Home size={14} /> },
    { id: "before", label: "Before You Start", icon: <FileText size={14} /> },
    { id: "part-1", label: "Part 1: Log In" },
    { id: "part-2", label: "Part 2: Complete Profile" },
    { id: "part-3", label: "Part 3: View Properties" },
    { id: "part-4", label: "Part 4: Sign Agreements" },
    { id: "part-5", label: "Part 5: View Reports" },
    { id: "part-6", label: "Part 6: Cost & Support" },
    { id: "quick-ref", label: "Quick Reference", icon: <Bookmark size={14} /> },
    { id: "troubleshooting", label: "Troubleshooting", icon: <HelpCircle size={14} /> },
  ],
  tenant: [
    { id: "overview", label: "Overview", icon: <Home size={14} /> },
    { id: "before", label: "Before You Start", icon: <FileText size={14} /> },
    { id: "part-1", label: "Part 1: Log In" },
    { id: "part-2", label: "Part 2: Complete Profile" },
    { id: "part-3", label: "Part 3: Approve & Agreement" },
    { id: "part-4", label: "Part 4: Meter" },
    { id: "part-5", label: "Part 5: Smart Door" },
    { id: "part-6", label: "Part 6: Payment" },
    { id: "part-7", label: "Part 7: Feedback" },
    { id: "quick-ref", label: "Quick Reference", icon: <Bookmark size={14} /> },
    { id: "troubleshooting", label: "Troubleshooting", icon: <HelpCircle size={14} /> },
  ],
}

const TABS: { role: Role; label: string; icon: React.ReactNode }[] = [
  { role: "owner", label: "Owner Tutorial", icon: <Building2 size={18} /> },
  { role: "tenant", label: "Tenant Tutorial", icon: <User size={18} /> },
  { role: "operator", label: "Operator Tutorial", icon: <Briefcase size={18} /> },
]

export default function TutorialPage() {
  const [role, setRole] = useState<Role>("owner")
  const [operatorPdfId, setOperatorPdfId] = useState<OperatorPdfId>(OPERATOR_PDF_TUTORIALS[0].id)
  const sections =
    role === "operator"
      ? OPERATOR_PDF_TUTORIALS.map(({ id, label }) => ({ id, label, icon: <FileText size={14} /> }))
      : SIDEBAR_SECTIONS[role]

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await tenantInit()
        if (cancelled || !res?.ok) return
        const layer = getTenantGateLayerFromInitPayload({
          tenant: (res.tenant ?? null) as TenantProfileLite | null,
          tenancies: (res.tenancies ?? []) as TenantTenancyLite[] | null,
          hasOverduePayment: !!res.hasOverduePayment,
          requiresPaymentMethodLink: !!res.requiresPaymentMethodLink,
        })
        if (layer !== "open") {
          window.location.replace(getTenantGateRedirectUrl(layer))
        }
      } catch {
        /* not a tenant session or offline — keep tutorial */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Building2 className="text-primary" size={22} />
            <div>
              <h1 className="text-lg font-bold text-foreground leading-tight">Portal Tutorial</h1>
              <p className="text-[10px] text-muted-foreground leading-tight">portal.colivingjb.com/tutorial</p>
            </div>
          </div>
          <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.role}
                onClick={() => setRole(tab.role)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  role === tab.role ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <Link href="/login" className="text-sm font-medium text-primary hover:underline whitespace-nowrap">
          Go to Portal →
        </Link>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 flex-shrink-0 border-r border-border bg-card/50 overflow-y-auto py-4 px-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-3">
            {role === "operator" ? "PDF guides" : "Tutorial Sections"}
          </p>
          <nav className="space-y-0.5">
            {role === "operator"
              ? sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setOperatorPdfId(s.id as OperatorPdfId)}
                    className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                      operatorPdfId === s.id
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {s.icon}
                    <span className="leading-snug">{s.label}</span>
                  </button>
                ))
              : sections.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {s.icon}
                    {s.label}
                  </a>
                ))}
          </nav>
          <div className="mt-4 mx-2 p-2 rounded-md bg-muted/50 text-[11px] text-muted-foreground">
            <p className="font-semibold text-foreground/90">Tip:</p>
            <p>
              {role === "operator"
                ? "Pick a guide from the list. Scroll the viewer below; use Open in new tab for full browser controls."
                : "Complete your Profile first before accessing other sections."}
            </p>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">
            {role === "owner" && <OwnerContent />}
            {role === "tenant" && <TenantContent />}
            {role === "operator" && <OperatorPdfContent selectedId={operatorPdfId} onSelectId={setOperatorPdfId} />}
          </div>
        </main>
      </div>
    </div>
  )
}

function OwnerContent() {
  return (
    <>
      <section id="overview" className="mb-12 scroll-mt-6">
        <h2 className="text-xl font-bold text-foreground mb-4">Overview: What the Owner Portal does</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-3 font-semibold w-[28%]">Area</th>
                <th className="text-left p-3 font-semibold">What you can do</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr><td className="p-3 font-medium">My Property</td><td className="p-3 text-muted-foreground">See your properties and units; view tenancies (who is renting, period, rent).</td></tr>
              <tr><td className="p-3 font-medium">Profile</td><td className="p-3 text-muted-foreground">Update your name, phone, address, bank details, NRIC (ID); upload NRIC front/back.</td></tr>
              <tr><td className="p-3 font-medium">My Agreement</td><td className="p-3 text-muted-foreground">View and sign agreements (owner–operator, owner–tenant); complete e-signature.</td></tr>
              <tr><td className="p-3 font-medium">My Report</td><td className="p-3 text-muted-foreground">Select a property and period; view Owner Report; download PDF.</td></tr>
              <tr><td className="p-3 font-medium">Cost / Support</td><td className="p-3 text-muted-foreground">View cost reports; download Cost PDF; contact support.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-amber-700 dark:text-amber-400 mt-3 font-medium">Important: Complete your Profile first.</p>
      </section>

      <section id="before" className="mb-12 scroll-mt-6">
        <h2 className="text-xl font-bold text-foreground mb-4">What you need before you start</h2>
        <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
          <li>An invitation from your operator linking your email to one or more properties.</li>
          <li>Your login to the platform (Wix or Portal, as provided by the operator).</li>
          <li>A browser (Chrome, Safari, or Edge recommended).</li>
        </ul>
      </section>

      <section id="part-1" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 1 of 6</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">Log in and open the Owner Portal</h2>
        <TutorialStep role="owner" num="1.1" title="Open the login page" doText="Go to the URL your operator gave you and open the Owner or Owner Portal page." seeText="A login screen (email + password, or “Log in with Google”, depending on setup)." img="login.png" imgAlt="Login screen" caption="Login: email, password, Log in." />
        <TutorialStep role="owner" num="1.2" title="Log in" doText="Enter your email and password, then click Log in." seeText="Main Owner Portal screen with sidebar: My Property, Profile, My Agreement, My Report, Cost, Approvals, Support." img="portal.png" imgAlt="Dashboard" caption="Dashboard: sidebar with main menu." />
      </section>

      <section id="part-2" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 2 of 6</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">Complete your Profile (do this first)</h2>
        <TutorialStep role="owner" num="2.1" title="Open Profile" doText="Click the Profile (or My Profile) button or tab." seeText="Profile section with fields: name, phone, address, bank details, NRIC and upload areas for NRIC front/back." img="owner.profile.png" imgAlt="Profile" caption="Profile: name, phone, address, bank, NRIC, Save." />
        <TutorialStep role="owner" num="2.2" title="Fill in your details" doText={<>Enter or correct your full name, phone, address; select bank and enter account number; if required, enter NRIC and upload front/back photos.</>} seeText="Fields update as you type; after upload you may see a preview or “Uploaded” message." tip="NRIC uploads are stored securely. Use clear, readable photos without glare." />
        <TutorialStep role="owner" num="2.3" title="Save your profile" doText="Click Save or Update at the bottom of the Profile form." seeText="Short loading, then a success message (e.g. “Profile updated”). Other menu items may become available." />
      </section>

      <section id="part-3" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 3 of 6</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">View your properties and tenancies</h2>
        <TutorialStep role="owner" num="3.1" title="Open My Property" doText="Click My Property (or Property) in the main menu." seeText="Property dropdown, operator dropdown (if multiple), and a list of tenancies: unit/room, tenant name, period (start–end), rent amount." img="owner.properties.png" imgAlt="My Properties" caption="My Properties: property list and tenancy list." />
        <TutorialStep role="owner" num="3.2" title="Change property (if you have several)" doText="Choose the property from the Property dropdown." seeText="The tenancy list updates to show only units and tenants for the selected property." />
      </section>

      <section id="part-4" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 4 of 6</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">Sign agreements (My Agreement)</h2>
        <TutorialStep role="owner" num="4.1" title="Open My Agreement" doText="Click My Agreement (or Agreement) in the main menu." seeText="A list of agreements with status (Pending / Ready to sign / Signed) and View or Sign buttons." img="owner.agreement.png" imgAlt="Agreement list" caption="Agreement list with View/Sign." />
        <TutorialStep role="owner" num="4.2" title="Open an agreement to sign" doText="Click View or Sign on the agreement you want to complete." seeText="The agreement content opens (document or HTML). At the bottom: signature area and Sign or Agree button." />
        <TutorialStep role="owner" num="4.3" title="Sign the agreement" doText={<>Enter your signature (type or draw); click Sign or Agree.</>} seeText="Short loading, then confirmation (e.g. “Agreement signed”); status changes to “Signed” or “Completed”." />
      </section>

      <section id="part-5" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 5 of 6</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">View and download reports (My Report)</h2>
        <TutorialStep role="owner" num="5.1" title="Open My Report" doText="Click My Report (or Report) in the main menu." seeText="Property dropdown, period/date selector, table (rental income, expenses, net payout), and Export PDF or Download PDF button." img="owner.report.png" imgAlt="Owner Report" caption="Owner Report: property, period, table, Export PDF." />
        <TutorialStep role="owner" num="5.2" title="Select property and period" doText="Select the property from the dropdown and the period (e.g. month/year) for the report." seeText="The table updates with figures for that property and period." />
        <TutorialStep role="owner" num="5.3" title="Download the Owner Report PDF" doText="Click Export PDF or Download PDF." seeText="The browser downloads a PDF file with the Owner Report for the selected property and period." tip="If the button is disabled, select both property and period and ensure data exists for that period." />
      </section>

      <section id="part-6" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 6 of 6</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">Cost report and support</h2>
        <TutorialStep role="owner" num="6.1" title="Open Cost report" doText="Click Cost or Cost Report (or find it under Report submenu)." seeText="Cost list/table for your property and a Download Cost PDF or Export Cost PDF button." img="owner.cost.png" imgAlt="Cost Report" caption="Cost Report: cost list and Download PDF." />
        <TutorialStep role="owner" num="6.2" title="Download Cost PDF" doText="Click Export PDF or Download Cost PDF." seeText="A PDF file downloads with the cost report for the selected scope." />
        <TutorialStep role="owner" num="6.3" title="Support" doText="Click Support (or Contact) if you need help." seeText="Contact details, a contact form, or a link to the operator’s support. Contact Support is in the sidebar on every page." />
      </section>

      <section id="quick-ref" className="mb-12 scroll-mt-6">
        <h2 className="text-xl font-bold text-foreground mb-4">Quick reference — Owner Portal</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li><span className="font-medium text-foreground">Log in</span> — Owner / Portal login page</li>
          <li><span className="font-medium text-foreground">Complete Profile</span> (name, phone, bank, NRIC) — Profile section</li>
          <li><span className="font-medium text-foreground">View properties and tenancies</span> — My Property</li>
          <li><span className="font-medium text-foreground">Sign agreements</span> — My Agreement → View/Sign → Sign</li>
          <li><span className="font-medium text-foreground">View report and download PDF</span> — My Report → select property & period → Export PDF</li>
          <li><span className="font-medium text-foreground">Cost report PDF / Support</span> — Cost section → Export; Support section</li>
        </ol>
      </section>

      <section id="troubleshooting" className="mb-12 scroll-mt-6">
        <h2 className="text-xl font-bold text-foreground mb-4">Troubleshooting</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-3 font-semibold w-[35%]">Problem</th>
                <th className="text-left p-3 font-semibold">What to try</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr><td className="p-3">Cannot log in</td><td className="p-3 text-muted-foreground">Check email and password; use “Forgot password” if available; contact operator.</td></tr>
              <tr><td className="p-3">Profile “Save” does nothing</td><td className="p-3 text-muted-foreground">Ensure required fields are filled; check for error messages; try another browser.</td></tr>
              <tr><td className="p-3">NRIC upload fails</td><td className="p-3 text-muted-foreground">Use a clear image (JPG/PNG); size within limit; try again.</td></tr>
              <tr><td className="p-3">No agreements in list</td><td className="p-3 text-muted-foreground">Your operator may not have sent any yet; contact them to create an agreement.</td></tr>
              <tr><td className="p-3">Export PDF disabled</td><td className="p-3 text-muted-foreground">Select both property and period; ensure there is data for that period.</td></tr>
              <tr><td className="p-3">Menu items greyed out</td><td className="p-3 text-muted-foreground">Complete Profile first; refresh the page and log in again.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function TenantContent() {
  return (
    <>
      <section id="overview" className="mb-12 scroll-mt-6">
        <h2 className="text-xl font-bold text-foreground mb-4">Overview: What the Tenant Dashboard does</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-3 font-semibold w-[28%]">Area</th>
                <th className="text-left p-3 font-semibold">What you can do</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr><td className="p-3 font-medium">Profile</td><td className="p-3 text-muted-foreground">Enter or update name, phone, address, bank, NRIC; upload NRIC. Do this first.</td></tr>
              <tr><td className="p-3 font-medium">Approve & Agreement</td><td className="p-3 text-muted-foreground">Approve the operator (if required); view and sign your tenancy agreement.</td></tr>
              <tr><td className="p-3 font-medium">Property</td><td className="p-3 text-muted-foreground">Select which property/unit you are viewing (if more than one).</td></tr>
              <tr><td className="p-3 font-medium">Meter</td><td className="p-3 text-muted-foreground">View electricity/utility usage; top up (if prepaid).</td></tr>
              <tr><td className="p-3 font-medium">Smart Door</td><td className="p-3 text-muted-foreground">See door/lock status; open door (e.g. Bluetooth or passcode).</td></tr>
              <tr><td className="p-3 font-medium">Payment</td><td className="p-3 text-muted-foreground">Pay rent or invoices (Stripe or Xendit checkout).</td></tr>
              <tr><td className="p-3 font-medium">Feedback</td><td className="p-3 text-muted-foreground">Submit feedback with text, photos, or video.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-amber-700 dark:text-amber-400 mt-3 font-medium">Complete your Profile first. Sign agreements before using Meter, Smart Door, or Payment.</p>
      </section>

      <section id="before" className="mb-12 scroll-mt-6">
        <h2 className="text-xl font-bold text-foreground mb-4">What you need before you start</h2>
        <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
          <li>An email address that the operator has registered for you as a tenant.</li>
          <li>Your login (Wix or Portal, as provided by the operator).</li>
          <li>A browser (Chrome, Safari, or Edge). For smart door (Bluetooth), use a supported device.</li>
        </ul>
      </section>

      <section id="part-1" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 1 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">Log in and open the Tenant Dashboard</h2>
        <TutorialStep role="tenant" num="1.1" title="Open the login page" doText="Go to the URL your operator gave you and open the Tenant or Tenant Dashboard page." seeText="A login screen: email + password, or “Log in with Google”, depending on setup." img="tenant-01-login.png" imgAlt="Login" caption="Login: email, password, Log in." />
        <TutorialStep role="tenant" num="1.2" title="Log in" doText="Enter your email and password, then click Log in." seeText="Main Tenant Dashboard with cards/buttons: Profile, Agreement, Meter, Smart Door, Payment, Feedback. Some may be greyed out until you complete profile and agreements." img="tenant-02-main.png" imgAlt="Dashboard" caption="Main dashboard with section buttons." />
      </section>

      <section id="part-2" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 2 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">Complete your Profile (do this first)</h2>
        <TutorialStep role="tenant" num="2.1" title="Open Profile" doText="Click the Profile button or tab." seeText="Profile section with fields: full name, phone, address, bank (dropdown + account number), NRIC number, and upload areas for NRIC front and back." img="tenant-03-profile-form.png" imgAlt="Profile form" caption="Profile form and NRIC upload buttons." />
        <TutorialStep role="tenant" num="2.2" title="Fill in your details" doText={<>Enter full name, phone, address; select bank and account number; enter NRIC; upload front and back photos of your ID.</>} seeText="Fields update as you type; after upload you may see a thumbnail or “Uploaded”." tip="Use clear, readable photos; avoid glare. Accepted formats: JPG/PNG." />
        <TutorialStep role="tenant" num="2.3" title="Save your profile" doText="Click Save or Update at the bottom of the Profile form." seeText="Loading, then a success message. Approve and Agreement options become available after profile is complete." img="tenant-05-profile-success.png" imgAlt="Profile saved" />
      </section>

      <section id="part-3" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 3 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">Approve operator and sign agreement</h2>
        <TutorialStep role="tenant" num="3.1" title="Approve the operator (if shown)" doText="If you see an “Approve client” or “Approve operator” button, click it and confirm." seeText="The request is sent; once approved, you can access Agreement and other sections." img="tenant-06-approve-operator.png" imgAlt="Approve operator" />
        <TutorialStep role="tenant" num="3.2" title="Open My Agreement" doText="Click Agreement in the menu." seeText="A list of agreements that need your signature, with View or Sign buttons." img="tenant-07-agreement-list.png" imgAlt="Agreement list" />
        <TutorialStep role="tenant" num="3.3" title="Open the agreement to sign" doText="Click View or Sign on the agreement you want to complete." seeText="The agreement content opens; at the bottom: signature area and Sign or Agree button." img="tenant-08-agreement-document.png" imgAlt="Agreement document" />
        <TutorialStep role="tenant" num="3.4" title="Sign the agreement" doText="Enter your signature (type or draw); click Sign or Agree." seeText="Confirmation (e.g. “Agreement signed”); status changes to “Signed” or “Completed”." img="tenant-09-agreement-signed.png" imgAlt="Agreement signed" />
      </section>

      <section id="part-4" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 4 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">Select property and view Meter</h2>
        <TutorialStep role="tenant" num="4.1" title="Select property (if you have more than one)" doText="Use the Property dropdown on the main screen to choose which property/unit to view." seeText="Meter, Smart Door, and Payment sections update for the selected property." img="tenant-10-property-dropdown.png" imgAlt="Property dropdown" />
        <TutorialStep role="tenant" num="4.2" title="Open Meter" doText="Click Meter in the menu." seeText="Meter section: usage summary, Top-up or Postpaid button (if prepaid)." img="tenant-11-meter-section.png" imgAlt="Meter section" />
        <TutorialStep role="tenant" num="4.3" title="Top up meter (if prepaid)" doText="Click Top-up, choose amount or plan, and complete payment (Stripe or Xendit)." seeText="After payment, balance updates; you may see a success message." img="tenant-12-meter-topup.png" imgAlt="Meter top-up" />
      </section>

      <section id="part-5" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 5 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">Smart Door (lock)</h2>
        <TutorialStep role="tenant" num="5.1" title="Open Smart Door" doText="Click Smart Door in the menu." seeText="Smart Door section: door/lock status, Open door or Passcode button." img="tenant-13-smartdoor-section.png" imgAlt="Smart Door" />
        <TutorialStep role="tenant" num="5.2" title="Open the door (Bluetooth)" doText="Tap Open door (or enter passcode if required). Follow on-screen instructions for Bluetooth." seeText="“Opening…” or “Door open” status; door unlocks when in range." img="tenant-14-smartdoor-opening.png" imgAlt="Opening door" />
      </section>

      <section id="part-6" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 6 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">Pay rent or invoices (Payment)</h2>
        <TutorialStep role="tenant" num="6.1" title="Open Payment" doText="Click Payment in the menu." seeText="List of rent or invoices; each row may have a Pay now button." img="tenant-15-payment-list.png" imgAlt="Payment list" />
        <TutorialStep role="tenant" num="6.2" title="Pay selected invoices" doText="Click Pay now on the invoice you want to pay; complete payment (Stripe or Xendit)." seeText="After payment, the invoice shows as Paid or you see a success message." img="tenant-16-payment-paid.png" imgAlt="Payment success" />
      </section>

      <section id="part-7" className="mb-12 scroll-mt-6">
        <p className="text-xs text-muted-foreground mb-2">Part 7 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-6">Submit feedback</h2>
        <TutorialStep role="tenant" num="7.1" title="Open Feedback" doText="Click Feedback in the menu." seeText="Feedback section: description box and optional photo/video upload." img="tenant-17-feedback-form.png" imgAlt="Feedback form" />
        <TutorialStep role="tenant" num="7.2" title="Write and attach files, then submit" doText="Enter your feedback text; attach photos or video if needed; click Submit." seeText="A success message; your feedback is sent to the operator." img="tenant-18-feedback-success.png" imgAlt="Feedback success" />
      </section>

      <section id="quick-ref" className="mb-12 scroll-mt-6">
        <h2 className="text-xl font-bold text-foreground mb-4">Quick reference — Tenant Dashboard</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li><span className="font-medium text-foreground">Log in</span> — Tenant / Portal login page</li>
          <li><span className="font-medium text-foreground">Complete Profile</span> — Profile section</li>
          <li><span className="font-medium text-foreground">Approve & sign agreement</span> — Approvals → Agreement → Sign</li>
          <li><span className="font-medium text-foreground">Meter</span> — View usage; Top-up if prepaid</li>
          <li><span className="font-medium text-foreground">Smart Door</span> — Open door (Bluetooth / passcode)</li>
          <li><span className="font-medium text-foreground">Payment</span> — Pay rent/invoices (Pay now)</li>
          <li><span className="font-medium text-foreground">Feedback</span> — Submit text, photos, or video</li>
        </ol>
      </section>

      <section id="troubleshooting" className="mb-12 scroll-mt-6">
        <h2 className="text-xl font-bold text-foreground mb-4">Troubleshooting</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-3 font-semibold w-[35%]">Problem</th>
                <th className="text-left p-3 font-semibold">What to try</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr><td className="p-3">Cannot log in</td><td className="p-3 text-muted-foreground">Check email and password; use “Forgot password”; contact operator.</td></tr>
              <tr><td className="p-3">Profile Save does nothing</td><td className="p-3 text-muted-foreground">Fill required fields; check errors; try another browser.</td></tr>
              <tr><td className="p-3">Meter / Smart Door greyed out</td><td className="p-3 text-muted-foreground">Complete Profile and sign your agreement first.</td></tr>
              <tr><td className="p-3">Payment fails</td><td className="p-3 text-muted-foreground">Check card details; try another card; contact operator.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function OperatorPdfContent({
  selectedId,
  onSelectId,
}: {
  selectedId: OperatorPdfId
  onSelectId: (id: OperatorPdfId) => void
}) {
  const active = OPERATOR_PDF_TUTORIALS.find((p) => p.id === selectedId) ?? OPERATOR_PDF_TUTORIALS[0]
  const src = getOperatorPdfUrl(active.file)

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Operator tutorial (PDF)</h2>
        <p className="text-sm text-muted-foreground">
          Choose a guide from the left menu or from the dropdown below. Pages scroll in the viewer; use Open in new tab for the browser PDF app (print / save).
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label htmlFor="operator-pdf-select" className="text-sm font-medium text-foreground shrink-0">
          Guide
        </label>
        <select
          id="operator-pdf-select"
          value={selectedId}
          onChange={(e) => onSelectId(e.target.value as OperatorPdfId)}
          className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {OPERATOR_PDF_TUTORIALS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground hover:bg-muted whitespace-nowrap"
        >
          <ExternalLink size={16} />
          Open in new tab
        </a>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
        <OperatorPdfViewer key={active.file} file={active.file} />
      </div>
    </div>
  )
}
