"use client"

import Link from "next/link"
import Image from "next/image"
import { ArrowRight, MapPin, Users, Wifi, Shield, ChevronRight, Star, Building2, Phone, Mail } from "lucide-react"
import { LanguageSwitcher } from "@/components/language-switcher"
import { PortalSiteHeader } from "@/components/portal-site-header"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <PortalSiteHeader />
          <nav className="hidden md:flex items-center gap-8">
            {[
              { label: "About Us", href: "#about" },
              { label: "Available Units", href: "/available-unit" },
              { label: "Pricing", href: "/pricing" },
              { label: "Enquiry", href: "/enquiry" },
            ].map((item) => (
              item.href.startsWith("#") ? (
                <a
                  key={item.label}
                  href={item.href}
                  className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.label}
                  href={item.href}
                  className="text-xs font-semibold tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
                >
                  {item.label}
                </Link>
              )
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link
              href="/login"
              className="bg-primary text-primary-foreground text-xs font-bold tracking-widest uppercase px-5 py-2.5 rounded-full hover:bg-primary/90 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="border border-primary text-primary text-xs font-bold tracking-widest uppercase px-5 py-2.5 rounded-full hover:bg-primary/5 transition-colors hidden sm:inline-flex"
            >
              Register
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative h-screen flex items-center justify-center overflow-hidden">
        <Image
          src="/images/hero-bg.jpg"
          alt="Coliving building"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-black/55" />
        <div className="relative z-10 text-center px-6 max-w-3xl mx-auto">
          <p className="text-white/60 text-sm tracking-[0.4em] uppercase mb-4">Premium Coliving</p>
          <h1 className="text-6xl md:text-8xl font-black text-white leading-none mb-3 uppercase tracking-tight">
            Redefining
          </h1>
          <h1 className="text-6xl md:text-8xl font-black text-primary leading-none mb-8 uppercase tracking-tight">
            Urban Living
          </h1>
          <p className="text-white/80 text-lg leading-relaxed mb-10 text-pretty">
            Premium coliving spaces in Johor Bahru designed for comfort, community, and convenience.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <a
              href="/available-unit"
              className="bg-primary text-white text-sm font-bold tracking-widest uppercase px-8 py-4 rounded-full hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              Explore Units <ArrowRight size={16} />
            </a>
            <a
              href="#about"
              className="bg-white/10 border border-white/30 text-white text-sm font-bold tracking-widest uppercase px-8 py-4 rounded-full hover:bg-white/20 transition-colors"
            >
              Learn More
            </a>
          </div>
        </div>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 border-2 border-white/40 rounded-full flex justify-center pt-2">
            <div className="w-1 h-2 bg-white/60 rounded-full" />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-primary py-12">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: "200+", label: "Units Available" },
            { value: "98%", label: "Occupancy Rate" },
            { value: "500+", label: "Happy Tenants" },
            { value: "5★", label: "Average Rating" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-black text-white mb-1">{stat.value}</div>
              <div className="text-xs tracking-widest uppercase text-white/60">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="about" className="py-24 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-primary text-xs font-semibold tracking-[0.3em] uppercase mb-3">Why Choose Us</p>
          <h2 className="text-4xl font-black text-foreground text-balance">Everything you need, in one place</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { icon: MapPin, title: "Prime Locations", desc: "Strategically located near business hubs, universities, and transit." },
            { icon: Wifi, title: "Smart Living", desc: "Digital locks, smart meters, and seamless app-based management." },
            { icon: Users, title: "Community", desc: "Vibrant community of professionals and creatives." },
            { icon: Shield, title: "Secure & Managed", desc: "24/7 management and security for complete peace of mind." },
          ].map((f) => (
            <div key={f.title} className="bg-card border border-border rounded-2xl p-6 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-brand-muted flex items-center justify-center mb-4" style={{ background: "var(--brand-muted)" }}>
                <f.icon size={22} style={{ color: "var(--brand)" }} />
              </div>
              <h3 className="font-bold text-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Available Units */}
      <section id="units" className="py-24 px-6 bg-secondary/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-primary text-xs font-semibold tracking-[0.3em] uppercase mb-3">Our Properties</p>
            <h2 className="text-4xl font-black text-foreground text-balance">Available Units</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { name: "Vibrant", location: "Johor Bahru", rooms: 45, price: "RM 1,200", tag: "Popular" },
              { name: "Serenity", location: "Skudai", rooms: 32, price: "RM 980", tag: "New" },
              { name: "Horizon", location: "Iskandar Puteri", rooms: 58, price: "RM 1,450", tag: "Premium" },
            ].map((unit) => (
              <div key={unit.name} className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-shadow group">
                <div className="h-48 relative overflow-hidden" style={{ background: "var(--brand-light)" }}>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Building2 size={64} style={{ color: "var(--brand)" }} className="opacity-30" />
                  </div>
                  <span className="absolute top-4 right-4 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full text-white" style={{ background: "var(--brand)" }}>
                    {unit.tag}
                  </span>
                </div>
                <div className="p-6">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-black text-lg text-foreground">{unit.name}</h3>
                      <div className="flex items-center gap-1 text-muted-foreground text-sm">
                        <MapPin size={13} /> {unit.location}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-primary text-lg">{unit.price}</div>
                      <div className="text-xs text-muted-foreground">/ month</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-4">
                    <Users size={12} /> {unit.rooms} rooms available
                  </div>
                  <button className="w-full py-2.5 rounded-xl text-sm font-bold text-primary border border-primary hover:bg-primary hover:text-white transition-colors flex items-center justify-center gap-2">
                    View Details <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-primary text-xs font-semibold tracking-[0.3em] uppercase mb-3">Testimonials</p>
          <h2 className="text-4xl font-black text-foreground text-balance">What our tenants say</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { name: "Ahmad R.", room: "Room 205", text: "The app makes everything so easy - rent, access, utilities. Best coliving experience I've had." },
            { name: "Siti N.", room: "Room 112", text: "Super convenient location and the smart door feature is amazing. Feels very secure." },
            { name: "Wei Chen", room: "Room 318", text: "Professional management team and a wonderful community. Highly recommend to working professionals." },
          ].map((t) => (
            <div key={t.name} className="bg-card border border-border rounded-2xl p-6">
              <div className="flex gap-1 mb-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={14} fill="var(--brand)" style={{ color: "var(--brand)" }} />
                ))}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4 italic">&ldquo;{t.text}&rdquo;</p>
              <div>
                <div className="font-bold text-foreground text-sm">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.room}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6" style={{ background: "var(--brand)" }}>
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-black text-white mb-4 text-balance">Ready to move in?</h2>
          <p className="text-white/70 text-lg mb-8">Contact us today and find your perfect coliving space.</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <div className="flex items-center gap-2 text-white">
              <Phone size={16} /> <span className="text-sm">+60 7-000 0000</span>
            </div>
            <div className="flex items-center gap-2 text-white">
              <Mail size={16} /> <span className="text-sm">hello@colivingmgmt.com</span>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/enquiry"
              className="inline-flex items-center gap-2 bg-white font-bold text-sm tracking-widest uppercase px-8 py-4 rounded-full hover:bg-white/90 transition-colors"
              style={{ color: "var(--brand)" }}
            >
              Enquire Now <ArrowRight size={16} />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 bg-transparent border-2 border-white text-white font-bold text-sm tracking-widest uppercase px-8 py-4 rounded-full hover:bg-white/10 transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-foreground text-white/50 py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold tracking-widest text-white uppercase">Coliving</span>
            <span className="text-[9px] tracking-[0.3em] uppercase">Management</span>
          </div>
          <p className="text-xs">© 2024 Coliving Management Sdn Bhd. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
