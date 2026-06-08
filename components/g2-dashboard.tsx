"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Star,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Users,
  Eye,
  Zap,
  RefreshCw,
} from "lucide-react"
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts"
import type { G2Review, G2Product, G2ProfileView, G2Rank, G2Campaign, G2IntentCompany } from "@/lib/g2"
import type { G2WeeklyReport } from "@/lib/g2-weekly-report"
import type { AppEnrichment } from "@/lib/sensortower"

// ─── Design system (duplicated from self-serve-dashboard.tsx) ─────────────────
const C = {
  bg:           "#020d07",
  card:         "#071510",
  cardAlt:      "#0a1d14",
  border:       "#0e2b1d",
  borderAccent: "rgba(5,199,155,0.18)",
  accent:       "#05c79b",
  accentBright: "#00e8b0",
  accentDim:    "rgba(5,199,155,0.13)",
  sage:         "#c8ddd5",
  sageLight:    "#e8f3ef",
  muted:        "#3d6b56",
  slate:        "#7c8c94",
  amber:        "#f5a623",
  amberDim:     "rgba(245,166,35,0.12)",
  red:          "#ef4444",
  redDim:       "rgba(239,68,68,0.12)",
  blue:         "#4c9ef5",
  purple:       "#9b7ff5",
  grid:         "rgba(5,199,155,0.045)",
}

const MONO = "'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, monospace"

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "k"
  return n.toString()
}

function Panel({ children, style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      style={{
        background:   C.card,
        border:       `1px solid ${C.border}`,
        borderRadius: "16px",
        padding:      "22px",
        position:     "relative",
        overflow:     "hidden",
        ...style,
      }}
      {...rest}
    >
      <div style={{
        position:   "absolute",
        top: 0, left: "10%", right: "10%",
        height:     "1px",
        background: `linear-gradient(90deg, transparent, ${C.borderAccent}, transparent)`,
        pointerEvents: "none",
      }} />
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize:      "10px",
      fontWeight:    700,
      letterSpacing: "0.13em",
      textTransform: "uppercase",
      color:         C.muted,
      marginBottom:  "18px",
    }}>
      {children}
    </p>
  )
}

function LoadingSkeleton({ h = 200 }: { h?: number }) {
  return (
    <div style={{
      height:          h,
      borderRadius:    "10px",
      background:      C.card,
      backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
      backgroundSize:  "200% 100%",
      animation:       "bm-shimmer 1.6s ease infinite",
    }} />
  )
}

function DataError({ label }: { label: string }) {
  return (
    <div style={{
      height:         120,
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      gap:            "8px",
      color:          C.muted,
      fontSize:       "12px",
      border:         `1px dashed ${C.border}`,
      borderRadius:   "10px",
    }}>
      <AlertCircle size={14} color={C.red} style={{ flexShrink: 0 }} />
      Could not load {label}
    </div>
  )
}

function TrendBadge({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null
  const positive = value >= 0
  return (
    <span style={{
      display:       "inline-flex",
      alignItems:    "center",
      gap:           "3px",
      background:    positive ? C.accentDim : C.redDim,
      color:         positive ? C.accent : C.red,
      padding:       "2px 8px",
      borderRadius:  "999px",
      fontSize:      "11px",
      fontWeight:    600,
    }}>
      {positive ? <TrendingUp size={10} strokeWidth={2.5} /> : <TrendingDown size={10} strokeWidth={2.5} />}
      {positive ? "+" : ""}{value}% {label}
    </span>
  )
}

function KpiCard({
  label, value, sub, Icon, accent = C.accent,
}: {
  label: string; value: string; sub?: React.ReactNode; Icon?: React.ElementType; accent?: string
}) {
  return (
    <Panel style={{ paddingLeft: "26px" }}>
      <div style={{
        position: "absolute", left: 0, top: "18%", bottom: "18%",
        width: "3px", borderRadius: "0 3px 3px 0", background: accent, opacity: 0.9,
      }} />
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
        {Icon && (
          <span style={{
            width: "28px", height: "28px", borderRadius: "8px",
            background: `${accent}18`, border: `1px solid ${accent}30`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon size={13} color={accent} strokeWidth={2} />
          </span>
        )}
        <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.slate }}>
          {label}
        </span>
      </div>
      <p style={{ fontSize: "38px", fontWeight: 700, lineHeight: 1, color: C.sageLight, letterSpacing: "-0.025em", fontFamily: MONO, marginBottom: "8px" }}>
        {value}
      </p>
      {sub && <div style={{ marginTop: "4px" }}>{sub}</div>}
    </Panel>
  )
}

// ─── Data types for this dashboard ────────────────────────────────────────────
type ReviewsData  = { product: Pick<G2Product, "starRating" | "reviewsCount">; reviews: G2Review[] }
type ProfileData  = { rank: G2Rank; weeklyViews: G2ProfileView[]; totalViewsThisMonth: number; totalViewsLastMonth: number }
type CampaignsData = { campaigns: G2Campaign[] }
type IntentData   = { companies: G2IntentCompany[]; totalThisMonth: number; totalThisWeek: number; hubspotPortalId: string }

// ─── Star rating helper ───────────────────────────────────────────────────────
function StarRating({ rating }: { rating: number }) {
  const color = rating >= 4 ? C.accent : rating === 3 ? C.amber : C.red
  return (
    <span style={{ display: "inline-flex", gap: "1px" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={11}
          fill={i <= rating ? color : "transparent"}
          color={i <= rating ? color : C.muted}
          strokeWidth={1.5}
        />
      ))}
    </span>
  )
}

// ─── Relative time helper ─────────────────────────────────────────────────────
function relTime(iso: string): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return "today"
  if (days === 1) return "1d ago"
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

// ─── App badge helper ─────────────────────────────────────────────────────────
function AppBadge({ enrichment, loading }: { enrichment: AppEnrichment | undefined; loading: boolean }) {
  if (loading && !enrichment) {
    return (
      <span style={{
        display: "inline-block", width: 52, height: 16, borderRadius: 4,
        background: C.card,
        backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
        backgroundSize: "200% 100%",
        animation: "bm-shimmer 1.6s ease infinite",
      }} />
    )
  }
  if (!enrichment) return null
  if (!enrichment.hasApp) {
    return (
      <span style={{ padding: "2px 7px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: "rgba(124,140,148,0.10)", color: C.slate }}>
        No app
      </span>
    )
  }
  const label = enrichment.platform === "both" ? "iOS + Android"
    : enrichment.platform === "ios" ? "iOS" : "Android"
  const bg    = enrichment.platform === "both" ? C.accentDim
    : enrichment.platform === "ios" ? "rgba(76,158,245,0.12)" : "rgba(76,245,130,0.12)"
  const color = enrichment.platform === "both" ? C.accent
    : enrichment.platform === "ios" ? C.blue : "#4cf582"
  return (
    <span style={{ padding: "2px 7px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: bg, color }}>
      {label}
    </span>
  )
}

// ─── Week label helper ────────────────────────────────────────────────────────
function fmtWeek(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export function G2Dashboard() {
  const [reviews,   setReviews]   = useState<ReviewsData | null>(null)
  const [profile,   setProfile]   = useState<ProfileData | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignsData | null>(null)
  const [intent,    setIntent]    = useState<IntentData | null>(null)

  const [reviewsErr,   setReviewsErr]   = useState(false)
  const [profileErr,   setProfileErr]   = useState(false)
  const [campaignsErr, setCampaignsErr] = useState(false)
  const [intentErr,    setIntentErr]    = useState(false)

  const [appEnrichments, setAppEnrichments] = useState<Map<string, AppEnrichment>>(new Map())
  const [appEnrichmentsLoading, setAppEnrichmentsLoading] = useState(false)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [filterStage,     setFilterStage]     = useState<string>("all")
  const [filterScore,     setFilterScore]     = useState<number>(0)
  const [filterLifecycle, setFilterLifecycle] = useState<string>("all")
  const [filterApp,       setFilterApp]       = useState<string>("all")

  const [g2Report,           setG2Report]           = useState<G2WeeklyReport | null>(null)
  const [g2ReportLoading,    setG2ReportLoading]    = useState(true)
  const [g2ReportGenerating, setG2ReportGenerating] = useState(false)
  const [g2ReportErr,        setG2ReportErr]        = useState<string | null>(null)

  const filteredCompanies = useMemo(() => {
    if (!intent) return []
    return intent.companies.filter((co) => {
      if (filterStage !== "all" && co.buyingStage !== filterStage) return false
      if (filterScore > 0 && (co.intentScore === null || co.intentScore < filterScore)) return false
      if (filterLifecycle !== "all" && (co.lifecycleStage?.toLowerCase() ?? "") !== filterLifecycle) return false
      if (filterApp === "yes" && !appEnrichments.get(co.id)?.hasApp) return false
      if (filterApp === "no"  && appEnrichments.get(co.id)?.hasApp)  return false
      return true
    })
  }, [intent, filterStage, filterScore, filterLifecycle, filterApp, appEnrichments])

  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [intentDays, setIntentDays] = useState(30)
  const intentDaysRef = useRef(30)

  const fetchIntent = useCallback((days: number) => {
    setIntent(null)
    setIntentErr(false)
    setAppEnrichments(new Map())
    fetch(`/api/g2/intent?days=${days}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((intentData: IntentData) => {
        setIntent(intentData)
        if (intentData.companies.length > 0) {
          setAppEnrichmentsLoading(true)
          fetch("/api/g2/app-enrichment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companies: intentData.companies.map((co) => ({ id: co.id, name: co.name })),
            }),
          })
            .then((r) => r.ok ? r.json() : Promise.reject(r.status))
            .then((data: { enrichments: AppEnrichment[] }) => {
              const map = new Map<string, AppEnrichment>()
              for (const e of data.enrichments) map.set(e.companyId, e)
              setAppEnrichments(map)
            })
            .catch(() => { /* silent */ })
            .finally(() => setAppEnrichmentsLoading(false))
        }
      })
      .catch(() => setIntentErr(true))
  }, [])

  const fetchAll = useCallback(() => {
    setReviews(null)
    setProfile(null)
    setCampaigns(null)
    setIntent(null)
    setReviewsErr(false)
    setProfileErr(false)
    setCampaignsErr(false)
    setIntentErr(false)
    setAppEnrichments(new Map())
    setSyncing(true)
    setG2ReportLoading(true)

    Promise.allSettled([
      fetch("/api/g2/reviews").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
      fetch("/api/g2/profile").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
      fetch("/api/g2/campaigns").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
      fetch(`/api/g2/intent?days=${intentDaysRef.current}`).then((r) => r.ok ? r.json() : Promise.reject(r.status)),
      fetch("/api/g2/weekly-report").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
    ]).then(([r, p, c, i, wr]) => {
      if (r.status === "fulfilled") setReviews(r.value as ReviewsData); else setReviewsErr(true)
      if (p.status === "fulfilled") setProfile(p.value as ProfileData); else setProfileErr(true)
      if (c.status === "fulfilled") setCampaigns(c.value as CampaignsData); else setCampaignsErr(true)
      if (i.status === "fulfilled") {
        const intentData = i.value as IntentData
        setIntent(intentData)
        if (intentData.companies.length > 0) {
          setAppEnrichmentsLoading(true)
          fetch("/api/g2/app-enrichment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companies: intentData.companies.map((co) => ({ id: co.id, name: co.name })),
            }),
          })
            .then((r) => r.ok ? r.json() : Promise.reject(r.status))
            .then((data: { enrichments: AppEnrichment[] }) => {
              const map = new Map<string, AppEnrichment>()
              for (const e of data.enrichments) map.set(e.companyId, e)
              setAppEnrichments(map)
            })
            .catch(() => { /* silent — badges stay absent */ })
            .finally(() => setAppEnrichmentsLoading(false))
        }
      } else {
        setIntentErr(true)
      }
      if (wr.status === "fulfilled") {
        setG2Report(wr.value as G2WeeklyReport | null)
      }
      setG2ReportLoading(false)
      setLastSynced(new Date())
      setSyncing(false)
    })
  }, [])

  // Keep ref in sync so fetchAll always reads the current days value
  useEffect(() => { intentDaysRef.current = intentDays }, [intentDays])

  // Initial load
  useEffect(() => { fetchAll() }, [fetchAll])

  // Auto-refresh at 9am local time every day
  useEffect(() => {
    function msUntilNextNineAm() {
      const now = new Date()
      const next = new Date(now)
      next.setHours(9, 0, 0, 0)
      if (next <= now) next.setDate(next.getDate() + 1)
      return next.getTime() - now.getTime()
    }
    let timeoutId: ReturnType<typeof setTimeout>
    function schedule() {
      timeoutId = setTimeout(() => { fetchAll(); schedule() }, msUntilNextNineAm())
    }
    schedule()
    return () => clearTimeout(timeoutId)
  }, [fetchAll])

  // ── MoM profile views change ─────────────────────────────────────────────
  const viewsMoMPct = profile && profile.totalViewsLastMonth > 0
    ? Math.round(((profile.totalViewsThisMonth - profile.totalViewsLastMonth) / profile.totalViewsLastMonth) * 100)
    : null

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "32px 36px", fontFamily: "system-ui, sans-serif" }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "32px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: C.sageLight, letterSpacing: "-0.02em", margin: 0 }}>
            G2
          </h1>
          <p style={{ fontSize: "12px", color: C.muted, marginTop: "4px" }}>
            Reviews, profile analytics, paid campaigns, and buyer intent signals
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {lastSynced && (
            <span style={{ fontSize: "11px", color: C.muted }}>
              Synced {lastSynced.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={fetchAll}
            disabled={syncing}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              background: "transparent",
              border: `1px solid ${C.borderAccent}`,
              borderRadius: "8px",
              padding: "7px 14px",
              color: syncing ? C.muted : C.accent,
              fontSize: "12px",
              fontWeight: 600,
              cursor: syncing ? "not-allowed" : "pointer",
            }}
          >
            <RefreshCw size={12} strokeWidth={2.5} style={{ animation: syncing ? "g2-spin 1s linear infinite" : "none" }} />
            {syncing ? "Syncing…" : "Sync"}
          </button>
        </div>
      </div>

      {/* ── KPI Strip ──────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", marginBottom: "24px" }}>
        <KpiCard
          label="Star Rating"
          value={reviews ? `${reviews.product.starRating.toFixed(1)} ★` : "—"}
          Icon={Star}
          accent={C.accent}
          sub={reviews && (
            <span style={{ fontSize: "11px", color: C.muted }}>
              {fmtNum(reviews.product.reviewsCount)} reviews
            </span>
          )}
        />
        <KpiCard
          label="Total Reviews"
          value={reviews ? fmtNum(reviews.product.reviewsCount) : "—"}
          Icon={Users}
          accent={C.blue}
          sub={<span style={{ fontSize: "11px", color: C.muted }}>all time</span>}
        />
        <KpiCard
          label={`Intent Signals · Last ${intentDays}d`}
          value={intent ? String(intent.companies.length) : "—"}
          Icon={Zap}
          accent={C.amber}
          sub={<span style={{ fontSize: "11px", color: C.muted }}>rolling {intentDays} days</span>}
        />
      </div>

      {/* ── Panel 1: Buyer Intent ──────────────────────────────────────────── */}
      <Panel style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
          <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.muted, margin: 0 }}>
            G2 Buyer Intent
          </p>
          <div style={{ display: "flex", gap: "4px" }}>
            {[7, 30, 60, 90].map((d) => (
              <button
                key={d}
                onClick={() => { setIntentDays(d); fetchIntent(d) }}
                style={{
                  padding: "3px 10px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${intentDays === d ? C.borderAccent : C.border}`,
                  background: intentDays === d ? C.accentDim : "transparent",
                  color: intentDays === d ? C.accent : C.muted,
                }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* ── Filter bar ─────────────────────────────────────────────────────── */}
        {intent && intent.companies.length > 0 && (() => {
          const lifecycleOptions = ["all", ...Array.from(new Set(
            intent.companies.map((c) => c.lifecycleStage?.toLowerCase() ?? "").filter(Boolean)
          )).sort()]

          function FilterPills<T extends string | number>({
            label, options, active, onSelect,
          }: {
            label: string
            options: { value: T; display: string }[]
            active: T
            onSelect: (v: T) => void
          }) {
            return (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, whiteSpace: "nowrap" }}>{label}</span>
                {options.map(({ value, display }) => {
                  const on = active === value
                  return (
                    <button
                      key={String(value)}
                      onClick={() => onSelect(value)}
                      style={{
                        padding: "2px 9px", borderRadius: "6px", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                        border: `1px solid ${on ? C.borderAccent : C.border}`,
                        background: on ? C.accentDim : "transparent",
                        color: on ? C.accent : C.muted,
                      }}
                    >
                      {display}
                    </button>
                  )
                })}
              </div>
            )
          }

          const lifecycleLabel = (s: string) =>
            s === "all" ? "All"
            : s === "salesqualifiedlead" ? "SQL"
            : s === "marketingqualifiedlead" ? "MQL"
            : s.charAt(0).toUpperCase() + s.slice(1)

          const hasActiveFilter = filterStage !== "all" || filterScore > 0 || filterLifecycle !== "all" || filterApp !== "all"

          return (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center",
              borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
              padding: "10px 0", marginBottom: "16px",
            }}>
              <FilterPills
                label="Stage"
                options={[
                  { value: "all", display: "All" },
                  { value: "awareness", display: "Awareness" },
                  { value: "consideration", display: "Consideration" },
                  { value: "decision", display: "Decision" },
                ]}
                active={filterStage}
                onSelect={setFilterStage}
              />
              <div style={{ width: "1px", height: "18px", background: C.border }} />
              <FilterPills
                label="Score"
                options={[
                  { value: 0,  display: "All" },
                  { value: 50, display: "50+" },
                  { value: 70, display: "70+" },
                  { value: 90, display: "90+" },
                ]}
                active={filterScore}
                onSelect={setFilterScore}
              />
              <div style={{ width: "1px", height: "18px", background: C.border }} />
              <FilterPills
                label="Lifecycle"
                options={lifecycleOptions.map((s) => ({ value: s, display: lifecycleLabel(s) }))}
                active={filterLifecycle}
                onSelect={setFilterLifecycle}
              />
              <div style={{ width: "1px", height: "18px", background: C.border }} />
              <FilterPills
                label="App"
                options={[
                  { value: "all", display: "All" },
                  { value: "yes", display: "Has App" },
                  { value: "no",  display: "No App"  },
                ]}
                active={filterApp}
                onSelect={setFilterApp}
              />
              {hasActiveFilter && (
                <button
                  onClick={() => { setFilterStage("all"); setFilterScore(0); setFilterLifecycle("all"); setFilterApp("all") }}
                  style={{ marginLeft: "auto", fontSize: "11px", color: C.muted, background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px" }}
                >
                  Clear filters ×
                </button>
              )}
            </div>
          )
        })()}

        {intentErr ? (
          <DataError label="buyer intent" />
        ) : !intent ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[40, 40, 40, 40, 40].map((h, i) => <LoadingSkeleton key={i} h={h} />)}
          </div>
        ) : intent.companies.length === 0 ? (
          <p style={{ fontSize: "13px", color: C.muted, textAlign: "center", padding: "32px 0" }}>
            No intent signals found. Verify G2–HubSpot integration is active.
          </p>
        ) : (
          <>
          {/* ── Intelligence summary bar ─────────────────────────────── */}
          {(() => {
            const productTally = new Map<string, number>()
            for (const co of filteredCompanies) {
              if (co.productName) productTally.set(co.productName, (productTally.get(co.productName) ?? 0) + 1)
              for (const p of co.relatedProducts) productTally.set(p, (productTally.get(p) ?? 0) + 1)
            }
            const topProducts = [...productTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

            const industryTally = new Map<string, number>()
            for (const co of filteredCompanies) {
              if (co.industry) industryTally.set(co.industry, (industryTally.get(co.industry) ?? 0) + 1)
            }
            const topIndustries = [...industryTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)

            if (topProducts.length === 0 && topIndustries.length === 0) return null
            return (
              <div style={{
                display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "center",
                background: C.cardAlt, border: `1px solid ${C.border}`,
                borderRadius: "10px", padding: "10px 14px", marginBottom: "16px",
                fontSize: "11px",
              }}>
                {topProducts.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ color: C.muted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "10px" }}>Top researched</span>
                    {topProducts.map(([name, count]) => (
                      <span key={name} style={{ padding: "2px 8px", borderRadius: "999px", background: C.amberDim, color: C.amber, fontWeight: 600 }}>
                        {name} × {count}
                      </span>
                    ))}
                  </div>
                )}
                {topProducts.length > 0 && topIndustries.length > 0 && (
                  <div style={{ width: "1px", height: "18px", background: C.border, flexShrink: 0 }} />
                )}
                {topIndustries.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ color: C.muted, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "10px" }}>Industries</span>
                    {topIndustries.map(([name, count]) => (
                      <span key={name} style={{ padding: "2px 8px", borderRadius: "999px", background: "rgba(76,158,245,0.10)", color: C.blue, fontWeight: 600 }}>
                        {name} × {count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
          <div style={{ overflowX: "auto" }}>
            <table aria-label="G2 Buyer Intent Companies" style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr>
                  {["Company", "Activity", "Stage", "Intent Score", "Last Signal", "In HubSpot", "Lifecycle", "Products", "App"].map((col) => (
                    <th key={col} scope="col" style={{ textAlign: col === "Company" ? "left" : "center", padding: "6px 10px", color: C.muted, fontWeight: 600, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}` }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredCompanies.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: "32px 0", textAlign: "center", color: C.muted, fontSize: "12px" }}>No companies match the current filters.</td></tr>
                ) : filteredCompanies.map((co, i) => {
                  const activityColor = co.activityLevel === "high" ? C.accent : co.activityLevel === "medium" ? C.amber : C.slate
                  const activityBg   = co.activityLevel === "high" ? C.accentDim : co.activityLevel === "medium" ? C.amberDim : "rgba(124,140,148,0.10)"
                  const stageColor   = co.buyingStage === "decision" ? C.accent : co.buyingStage === "consideration" ? C.blue : C.slate
                  const stageBg      = co.buyingStage === "decision" ? C.accentDim : co.buyingStage === "consideration" ? "rgba(76,158,245,0.12)" : "rgba(124,140,148,0.10)"
                  const hsUrl        = `https://app.hubspot.com/contacts/${intent.hubspotPortalId}/company/${co.id}`
                  return (
                    <React.Fragment key={co.id}>
                      <tr
                        onClick={() => setExpandedRow(expandedRow === co.id ? null : co.id)}
                        style={{ borderBottom: expandedRow === co.id ? "none" : i < filteredCompanies.length - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer" }}
                      >
                        <td style={{ padding: "10px 10px", maxWidth: "240px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <a href={hsUrl} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} style={{ color: C.sage, textDecoration: "none", fontWeight: 500 }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = C.accentBright)}
                              onMouseLeave={(e) => (e.currentTarget.style.color = C.sage)}>
                              {co.name || "—"}
                            </a>
                            {co.signalsPage && (
                              <a href={co.signalsPage} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} title="G2 Signals page" style={{ color: C.muted, textDecoration: "none", fontSize: "10px", lineHeight: 1 }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
                                onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}>
                                ↗
                              </a>
                            )}
                          </div>
                          {co.industry && (
                            <span style={{ display: "inline-block", marginTop: "4px", padding: "1px 6px", borderRadius: "999px", fontSize: "9px", fontWeight: 600, background: "rgba(76,158,245,0.10)", color: C.blue }}>
                              {co.industry}
                            </span>
                          )}
                          {co.intentDetails && (
                            <p style={{ fontSize: "10px", color: C.muted, marginTop: "3px", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as React.CSSProperties}>
                              {co.intentDetails}
                            </p>
                          )}
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "center" }}>
                          {co.activityLevel ? (
                            <span style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: activityBg, color: activityColor, textTransform: "capitalize" }}>
                              {co.activityLevel}
                            </span>
                          ) : <span style={{ color: C.muted }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "center" }}>
                          {co.buyingStage ? (
                            <span style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: stageBg, color: stageColor, textTransform: "capitalize" }}>
                              {co.buyingStage}
                            </span>
                          ) : <span style={{ color: C.muted }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "center", fontFamily: MONO, color: co.intentScore !== null ? C.sageLight : C.muted }}>
                          {co.intentScore !== null ? co.intentScore : "—"}
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "center", color: C.muted, fontSize: "11px" }}>
                          {relTime(co.lastSignalAt)}
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "center" }}>
                          <span style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: C.accentDim, color: C.accent }}>
                            Yes
                          </span>
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "center" }}>
                          {co.lifecycleStage ? (() => {
                            const stage = co.lifecycleStage.toLowerCase()
                            const color = stage === "customer" ? C.accent
                              : stage === "opportunity" || stage === "salesqualifiedlead" ? C.blue
                              : stage === "marketingqualifiedlead" || stage === "lead" ? C.amber
                              : C.slate
                            const bg = stage === "customer" ? C.accentDim
                              : stage === "opportunity" || stage === "salesqualifiedlead" ? "rgba(76,158,245,0.12)"
                              : stage === "marketingqualifiedlead" || stage === "lead" ? C.amberDim
                              : "rgba(124,140,148,0.10)"
                            const label = stage === "salesqualifiedlead" ? "SQL"
                              : stage === "marketingqualifiedlead" ? "MQL"
                              : stage.charAt(0).toUpperCase() + stage.slice(1)
                            return (
                              <span style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: bg, color }}>
                                {label}
                              </span>
                            )
                          })() : <span style={{ color: C.muted }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "center", maxWidth: "160px" }}>
                          {(() => {
                            const all = [
                              ...(co.productName ? [co.productName] : []),
                              ...co.relatedProducts,
                            ]
                            if (all.length === 0) return <span style={{ color: C.muted }}>—</span>
                            const visible = all.slice(0, 2)
                            const extra = all.length - visible.length
                            return (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", justifyContent: "center" }}>
                                {visible.map((p) => (
                                  <span key={p} style={{ padding: "2px 7px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: C.amberDim, color: C.amber, whiteSpace: "nowrap" }}>
                                    {p}
                                  </span>
                                ))}
                                {extra > 0 && (
                                  <span style={{ padding: "2px 7px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: "rgba(124,140,148,0.10)", color: C.slate }}>
                                    +{extra}
                                  </span>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "center" }}>
                          <AppBadge enrichment={appEnrichments.get(co.id)} loading={appEnrichmentsLoading} />
                        </td>
                      </tr>
                      {expandedRow === co.id && (
                        <tr style={{ borderBottom: i < filteredCompanies.length - 1 ? `1px solid ${C.border}` : "none", background: C.cardAlt }}>
                          <td colSpan={9} style={{ padding: "0 10px 14px 10px" }}>
                            <div style={{ display: "flex", gap: "32px", flexWrap: "wrap", padding: "10px 0" }}>
                              {/* G2 Research section */}
                              {(co.relatedProducts.length > 0 || co.relatedProductDetails) && (
                                <div style={{ minWidth: "220px", maxWidth: "380px" }}>
                                  <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, marginBottom: "8px" }}>G2 Research</p>
                                  {co.relatedProducts.length > 0 && (
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px" }}>
                                      {co.relatedProducts.map((p) => (
                                        <span key={p} style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600, background: C.amberDim, color: C.amber }}>
                                          {p}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {co.relatedProductDetails && (
                                    <p style={{ fontSize: "11px", color: C.slate, lineHeight: 1.5 }}>{co.relatedProductDetails}</p>
                                  )}
                                </div>
                              )}
                              {/* App section */}
                              {(() => {
                                const e = appEnrichments.get(co.id)
                                if (!e || !e.hasApp) {
                                  return (
                                    <p style={{ fontSize: "12px", color: C.muted, alignSelf: "center" }}>
                                      No mobile app found for this publisher.
                                    </p>
                                  )
                                }
                                return (
                                  <div style={{ display: "flex", gap: "24px", alignItems: "center", flexWrap: "wrap" }}>
                                    <div>
                                      <p style={{ fontSize: "11px", color: C.muted, marginBottom: "2px" }}>App</p>
                                      <p style={{ fontSize: "13px", fontWeight: 600, color: C.sageLight }}>{e.appName}</p>
                                    </div>
                                    {e.monthlyDownloads && (
                                      <div>
                                        <p style={{ fontSize: "11px", color: C.muted, marginBottom: "2px" }}>Downloads / mo</p>
                                        <p style={{ fontSize: "13px", fontFamily: MONO, color: C.sageLight }}>{e.monthlyDownloads}</p>
                                      </div>
                                    )}
                                    {e.storeUrl && (
                                      <a
                                        href={e.storeUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(ev) => ev.stopPropagation()}
                                        style={{ fontSize: "12px", color: C.accent, textDecoration: "none", border: `1px solid ${C.borderAccent}`, padding: "4px 12px", borderRadius: "6px" }}
                                      >
                                        View in Store ↗
                                      </a>
                                    )}
                                  </div>
                                )
                              })()}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Panel>

      {/* ── Panel 2: Recent Reviews ─────────────────────────────────────────── */}
      <Panel style={{ marginBottom: "24px" }}>
        <SectionLabel>Recent Reviews</SectionLabel>
        {reviewsErr ? (
          <DataError label="reviews" />
        ) : !reviews ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[200, 160, 180].map((h, i) => <LoadingSkeleton key={i} h={h} />)}
          </div>
        ) : reviews.reviews.length === 0 ? (
          <p style={{ fontSize: "13px", color: C.muted, textAlign: "center", padding: "32px 0" }}>No reviews found.</p>
        ) : (
          <div>
            {reviews.reviews.map((review, i) => (
              <div key={review.id} style={{
                padding:     "14px 0",
                borderBottom: i < reviews.reviews.length - 1 ? `1px solid ${C.border}` : "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                  <StarRating rating={review.rating} />
                  <span style={{ fontSize: "13px", fontWeight: 600, color: C.sageLight, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {review.title || "Untitled Review"}
                  </span>
                </div>
                <p style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>
                  {[review.reviewerRole, review.companySize, review.createdAt ? new Date(review.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""].filter(Boolean).join(" · ")}
                </p>
                {review.body && (
                  <p style={{
                    fontSize:   "12px",
                    color:      C.slate,
                    overflow:   "hidden",
                    display:    "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    lineHeight: "1.5",
                  } as React.CSSProperties}>
                    {review.body}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ── Panel 3: Profile Analytics ──────────────────────────────────────── */}
      <Panel style={{ marginBottom: "24px" }}>
        <SectionLabel>Profile Analytics</SectionLabel>
        {profileErr ? (
          <DataError label="profile analytics" />
        ) : !profile ? (
          <LoadingSkeleton h={220} />
        ) : (
          <div style={{ display: "flex", gap: "24px", alignItems: "stretch" }}>
            {/* Product Ratings card */}
            <div style={{
              width: "38%", flexShrink: 0,
              background: C.cardAlt, border: `1px solid ${C.border}`,
              borderRadius: "12px", padding: "20px",
              display: "flex", flexDirection: "column", gap: "14px",
            }}>
              <div>
                <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: "4px" }}>
                  Product Ratings
                </p>
                <p style={{ fontSize: "11px", color: C.slate }}>{profile.rank.category || "—"}</p>
              </div>
              {([
                { label: "Ease of Use",    prod: profile.rank.productScores?.easeOfUse       ?? 0, cat: profile.rank.categoryScores?.easeOfUse       ?? 0 },
                { label: "Support",        prod: profile.rank.productScores?.qualityOfSupport ?? 0, cat: profile.rank.categoryScores?.qualityOfSupport ?? 0 },
                { label: "Ease of Setup",  prod: profile.rank.productScores?.easeOfSetup      ?? 0, cat: profile.rank.categoryScores?.easeOfSetup      ?? 0 },
              ]).map(({ label, prod, cat }) => (
                <div key={label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                    <span style={{ fontSize: "11px", color: C.slate }}>{label}</span>
                    <span style={{ fontSize: "11px", fontFamily: MONO, color: C.sageLight, fontWeight: 600 }}>
                      {prod > 0 ? prod.toFixed(1) : "—"}
                      {cat > 0 && <span style={{ color: C.muted, fontWeight: 400 }}> / {cat.toFixed(1)} avg</span>}
                    </span>
                  </div>
                  {prod > 0 && (
                    <div style={{ position: "relative", height: "6px", borderRadius: "999px", background: C.border, overflow: "visible" }}>
                      {/* category avg marker */}
                      {cat > 0 && (
                        <div style={{
                          position: "absolute", top: "-3px", bottom: "-3px", width: "2px",
                          left: `${(cat / 10) * 100}%`, background: C.muted, borderRadius: "1px",
                        }} />
                      )}
                      {/* product bar */}
                      <div style={{
                        height: "100%", borderRadius: "999px",
                        width: `${(prod / 10) * 100}%`,
                        background: `linear-gradient(90deg, ${C.accent}, ${C.accentBright})`,
                      }} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Weekly views chart */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.muted, marginBottom: "18px" }}>
                Weekly Profile Views
              </p>
              {profile.weeklyViews.length === 0 ? (
                <p style={{ fontSize: "12px", color: C.muted }}>No view data available.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={profile.weeklyViews.map((v) => ({ ...v, label: fmtWeek(v.week) }))} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={36} tickFormatter={fmtNum} />
                    <Tooltip
                      contentStyle={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "11px" }}
                      labelStyle={{ color: C.sage }}
                      itemStyle={{ color: C.accent }}
                    />
                    <Line
                      type="monotone"
                      dataKey="views"
                      stroke={C.accent}
                      strokeWidth={2}
                      dot={{ fill: C.accent, r: 3, strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: C.accentBright }}
                    >
                      <LabelList dataKey="views" position="top" style={{ fill: C.slate, fontSize: "10px" }} formatter={(v: unknown) => fmtNum(v as number)} />
                    </Line>
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </Panel>

      {/* ── Panel 4: Weekly Intent Report ─────────────────────────────────────── */}
      <Panel style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
          <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.muted, margin: 0 }}>
            Weekly Intent Report
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {g2Report && (
              <span style={{ fontSize: "11px", color: C.muted }}>
                {new Date(g2Report.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={async () => {
                setG2ReportGenerating(true)
                setG2ReportErr(null)
                try {
                  const res = await fetch("/api/g2/weekly-report", { method: "POST" })
                  if (!res.ok) throw new Error(`${res.status}`)
                  const report = await res.json() as G2WeeklyReport
                  setG2Report(report)
                } catch (e) {
                  setG2ReportErr(String(e))
                } finally {
                  setG2ReportGenerating(false)
                }
              }}
              disabled={g2ReportGenerating}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                background: "transparent",
                border: `1px solid ${C.borderAccent}`,
                borderRadius: "8px",
                padding: "7px 14px",
                color: g2ReportGenerating ? C.muted : C.accent,
                fontSize: "12px", fontWeight: 600,
                cursor: g2ReportGenerating ? "not-allowed" : "pointer",
              }}
            >
              <RefreshCw size={12} strokeWidth={2.5} style={{ animation: g2ReportGenerating ? "g2-spin 1s linear infinite" : "none" }} />
              {g2ReportGenerating ? "Generating…" : "Generate"}
            </button>
          </div>
        </div>

        {g2ReportErr && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: C.red, fontSize: "12px", marginBottom: "16px" }}>
            <AlertCircle size={14} /> {g2ReportErr}
          </div>
        )}

        {g2ReportLoading ? (
          <LoadingSkeleton h={180} />
        ) : !g2Report ? (
          <p style={{ fontSize: "13px", color: C.muted, textAlign: "center", padding: "32px 0" }}>
            No report generated yet. Click Generate to create the first one.
          </p>
        ) : (
          <div>
            {/* KPI chips */}
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
              {([
                { label: "Qualified this week", value: String(g2Report.kpis.qualifiedThisWeek), accent: C.accent },
                {
                  label: "vs last week",
                  value: (() => {
                    const d = g2Report.kpis.qualifiedThisWeek - g2Report.kpis.qualifiedLastWeek
                    return `${d >= 0 ? "+" : ""}${d}`
                  })(),
                  accent: (g2Report.kpis.qualifiedThisWeek - g2Report.kpis.qualifiedLastWeek) >= 0 ? C.accent : C.red,
                },
                { label: "New this week", value: String(g2Report.kpis.newThisWeek), accent: C.blue },
                { label: "Escalations", value: String(g2Report.kpis.escalatedCount), accent: C.amber },
              ]).map(({ label, value, accent }) => (
                <div key={label} style={{
                  background: C.cardAlt, border: `1px solid ${C.border}`,
                  borderRadius: "10px", padding: "10px 16px",
                }}>
                  <p style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, marginBottom: "4px" }}>{label}</p>
                  <p style={{ fontSize: "24px", fontWeight: 700, fontFamily: MONO, color: accent, lineHeight: 1 }}>{value}</p>
                </div>
              ))}
            </div>
            {/* Claude insights */}
            <div style={{
              background: C.cardAlt, border: `1px solid ${C.border}`,
              borderRadius: "10px", padding: "16px 20px",
              fontSize: "12px", color: C.slate, lineHeight: "1.7",
              whiteSpace: "pre-wrap", fontFamily: "inherit",
            }}>
              {g2Report.insights}
            </div>
          </div>
        )}
      </Panel>

    </div>
  )
}
