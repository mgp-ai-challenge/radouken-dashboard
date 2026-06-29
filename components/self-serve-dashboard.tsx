"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Globe,
  Zap,
  Users,
  AlertTriangle,
  AlertCircle,
  Target,
} from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
  Cell,
  LabelList,
} from "recharts"

// ─── Design system — Muzli payment analytics dark fintech ─────────────────────
const C = {
  bg:           "#020d07",
  card:         "#071510",
  cardAlt:      "#0a1d14",
  border:       "#0e2b1d",
  borderAccent: "rgba(5,199,155,0.18)",
  borderGlow:   "rgba(5,199,155,0.10)",
  accent:       "#05c79b",
  accentBright: "#00e8b0",
  accentDim:    "rgba(5,199,155,0.13)",
  accentGlow:   "rgba(5,199,155,0.06)",
  sage:         "#c8ddd5",
  sageLight:    "#e8f3ef",
  muted:        "#3d6b56",
  slate:        "#7c8c94",
  amber:        "#f5a623",
  amberDim:     "rgba(245,166,35,0.12)",
  red:          "#ef4444",
  redDim:       "rgba(239,68,68,0.12)",
  blue:         "#4c9ef5",
  blueDim:      "rgba(76,158,245,0.15)",
  purple:       "#9b7ff5",
  grid:         "rgba(5,199,155,0.045)",
}

// ─── Types ────────────────────────────────────────────────────────────────────
type KpisData = {
  qtdNormDau:      number
  q1NormDau:       number
  thisWeekNormDau: number
  prevWeekNormDau: number
  q2Submissions:   number
  q1Submissions:   number
  apacNormDau:     number
  q1ApacNormDau:   number
}
type DealInfo  = { id: string; name: string; normDau: number; url: string }
type StageRow  = { stageId: string; name: string; normDau: number; normDauQ1: number; count: number; countQ1: number; deals: DealInfo[]; dealsQ1: DealInfo[] }
type WeekRow     = { week: string; normDau: number; isCurrent: boolean }
type MonthRow    = { month: string; submissions: number; approved: number; approvalRate: number; isPartial: boolean }
type AdMobRow       = { month: string; count: number; quarter: "Q1" | "Q2" }
type AdMob2025Deal  = { id: string; name: string; normDau: number; signupDate: string; url: string }
type IronSourceDeal = { id: string; name: string; normDau: number; stage: string; stageId: string; createDate: string; url: string }
type EmailSplit  = {
  q1: { business: number; free: number; unknown: number }
  q2: { business: number; free: number; unknown: number }
}
type SourceRow = { source: string; count: number; pct: number; normDau: number; q1NormDau: number; qoqPct: number | null }

type WeeklyReportData = {
  generatedAt: string
  weekLabel: string
  kpis: {
    qtdNormDau: number
    q1NormDau: number
    thisWeekNormDau: number
    prevWeekNormDau: number
    q2Submissions: number
    q1Submissions: number
    apacNormDau: number
    q1ApacNormDau: number
  }
  insights: string
} | null

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDau(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k"
  return n.toString()
}
function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "k"
  return n.toString()
}

const MONO = "'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, monospace"

// ─── Primitives ───────────────────────────────────────────────────────────────
function Panel({
  children,
  style,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
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
      {/* Top shimmer line */}
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

// ─── Delta chip ───────────────────────────────────────────────────────────────
function DeltaChip({ current, prev, label = "WoW" }: { current: number; prev: number; label?: string }) {
  if (prev === 0) return null
  const pct      = ((current - prev) / prev) * 100
  const positive = pct >= 0
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
      letterSpacing: "0.01em",
    }}>
      {positive
        ? <TrendingUp  size={10} strokeWidth={2.5} />
        : <TrendingDown size={10} strokeWidth={2.5} />}
      {Math.abs(pct).toFixed(0)}% {label}
    </span>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  sub,
  Icon,
  accent = C.accent,
  progress,
  progressTarget,
}: {
  label:           string
  value:           string
  sub?:            React.ReactNode
  Icon?:           React.ElementType
  accent?:         string
  progress?:       number
  progressTarget?: string
}) {
  return (
    <Panel style={{ paddingLeft: "26px" }}>
      {/* Left accent stripe */}
      <div style={{
        position:     "absolute",
        left:         0, top: "18%", bottom: "18%",
        width:        "3px",
        borderRadius: "0 3px 3px 0",
        background:   accent,
        opacity:      0.9,
      }} />

      {/* Icon + label row */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
        {Icon && (
          <span style={{
            width:          "28px",
            height:         "28px",
            borderRadius:   "8px",
            background:     `${accent}18`,
            border:         `1px solid ${accent}30`,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            flexShrink:     0,
          }}>
            <Icon size={13} color={accent} strokeWidth={2} />
          </span>
        )}
        <span style={{
          fontSize:      "9.5px",
          fontWeight:    700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color:         C.slate,
        }}>
          {label}
        </span>
      </div>

      {/* Value */}
      <p style={{
        fontSize:      "38px",
        fontWeight:    700,
        lineHeight:    1,
        color:         C.sageLight,
        letterSpacing: "-0.025em",
        fontFamily:    MONO,
        marginBottom:  "8px",
      }}>
        {value}
      </p>

      {sub && <div style={{ marginTop: "4px" }}>{sub}</div>}

      {/* Progress bar */}
      {progress !== undefined && (
        <div style={{ marginTop: "14px" }}>
          <div style={{
            height:       "2px",
            background:   C.border,
            borderRadius: "99px",
            overflow:     "hidden",
          }}>
            <div style={{
              height:     "100%",
              width:      `${Math.min(progress * 100, 100)}%`,
              background: `linear-gradient(90deg, ${C.accent}, ${C.accentBright})`,
              borderRadius: "99px",
              transition: "width 1.2s cubic-bezier(0.4,0,0.2,1)",
            }} />
          </div>
          <p style={{ fontSize: "10px", color: C.muted, marginTop: "5px" }}>
            {Math.round(progress * 100)}% of {progressTarget ?? "1M"} target
          </p>
        </div>
      )}
    </Panel>
  )
}


// ─── Stage accordion ──────────────────────────────────────────────────────────
function StageGroup({ stage, quarter }: { stage: StageRow; quarter: "Q1" | "Q2" }) {
  const [open, setOpen] = useState(false)
  const color = STAGE_COLOR[stage.stageId] ?? C.muted
  const isActive = stage.stageId === "107224655" || stage.stageId === "107224657"
  const displayDau   = quarter === "Q1" ? stage.normDauQ1 : stage.normDau
  const displayCount = quarter === "Q1" ? stage.countQ1  : stage.count
  const displayDeals = quarter === "Q1" ? stage.dealsQ1  : stage.deals

  return (
    <div style={{
      border:       `1px solid ${open ? color + "40" : C.border}`,
      borderRadius: "10px",
      overflow:     "hidden",
      transition:   "border-color 0.2s",
    }}>
      {/* Stage header row — clickable */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width:          "100%",
          display:        "flex",
          alignItems:     "center",
          gap:            "10px",
          padding:        "9px 12px",
          background:     open ? `${color}0d` : "transparent",
          border:         "none",
          cursor:         "pointer",
          textAlign:      "left",
          transition:     "background 0.2s",
        }}
      >
        <span style={{
          width:        "7px",
          height:       "7px",
          borderRadius: "50%",
          background:   color,
          flexShrink:   0,
          boxShadow:    isActive ? `0 0 6px ${color}` : "none",
        }} />
        <span style={{ flex: 1, fontSize: "12.5px", fontWeight: 600, color: C.sage }}>
          {stage.name}
        </span>
        <span style={{
          fontSize:   "11px",
          color:      C.muted,
          marginRight: "6px",
        }}>
          {displayCount} deal{displayCount !== 1 ? "s" : ""}
        </span>
        <span style={{
          fontFamily: MONO,
          fontSize:   "12px",
          fontWeight: 600,
          color:      displayDau > 0 ? color : C.muted,
          minWidth:   "52px",
          textAlign:  "right",
        }}>
          {displayDau > 0 ? fmtDau(displayDau) : "—"}
        </span>
        {/* QoQ DAU chip — only shown in Q2 mode */}
        {quarter === "Q2" && (stage.normDauQ1 > 0 ? (() => {
          const pct      = ((stage.normDau - stage.normDauQ1) / stage.normDauQ1) * 100
          const positive = pct >= 0
          return (
            <span style={{
              display:        "inline-flex",
              alignItems:     "center",
              gap:            "2px",
              background:     positive ? C.accentDim : C.redDim,
              color:          positive ? C.accent : C.red,
              padding:        "1px 6px",
              borderRadius:   "999px",
              fontSize:       "10px",
              fontWeight:     600,
              minWidth:       "74px",
              justifyContent: "center",
              flexShrink:     0,
            }}
            title={`vs Q1 ${fmtDau(stage.normDauQ1)} Norm DAU`}
            >
              {positive ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% DAU QoQ
            </span>
          )
        })() : (
          <span style={{ minWidth: "74px", flexShrink: 0 }} />
        ))}
        {/* Avg DAU per deal */}
        {displayCount > 0 && (
          <span style={{
            fontFamily:  MONO,
            fontSize:    "10px",
            color:       C.muted,
            minWidth:    "64px",
            textAlign:   "right",
            flexShrink:  0,
          }}
          title="Avg Norm DAU per deal"
          >
            ~{fmtDau(Math.round(displayDau / displayCount))}/deal
          </span>
        )}
        <span style={{
          fontSize:   "10px",
          color:      C.muted,
          transform:  open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.2s",
          lineHeight: 1,
        }}>
          ▾
        </span>
      </button>

      {/* Deal rows */}
      {open && (
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          {displayDeals.map((deal, i) => (
            <div
              key={deal.id}
              style={{
                display:       "flex",
                alignItems:    "center",
                gap:           "10px",
                padding:       "7px 12px 7px 29px",
                borderBottom:  i < displayDeals.length - 1 ? `1px solid ${C.border}` : "none",
                background:    "transparent",
              }}
            >
              <span style={{
                flex:       1,
                fontSize:   "12px",
                color:      C.sage,
                whiteSpace: "nowrap",
                overflow:   "hidden",
                textOverflow: "ellipsis",
              }}>
                {deal.name}
              </span>
              <span style={{
                fontFamily: MONO,
                fontSize:   "11px",
                color:      deal.normDau > 0 ? C.slate : C.muted,
                minWidth:   "48px",
                textAlign:  "right",
                flexShrink: 0,
              }}>
                {deal.normDau > 0 ? fmtDau(deal.normDau) : "—"}
              </span>
              <a
                href={deal.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "center",
                  width:          "22px",
                  height:         "22px",
                  borderRadius:   "6px",
                  background:     C.accentGlow,
                  border:         `1px solid ${C.border}`,
                  color:          C.muted,
                  fontSize:       "10px",
                  textDecoration: "none",
                  flexShrink:     0,
                  transition:     "background 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = C.accentDim
                  e.currentTarget.style.color = C.accent
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = C.accentGlow
                  e.currentTarget.style.color = C.muted
                }}
                title="Open in HubSpot"
              >
                ↗
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Stage colors ─────────────────────────────────────────────────────────────
const STAGE_COLOR: Record<string, string> = {
  "107224655": C.accent,
  "114401160": C.red,
  "1275149844": C.purple,
  "1347884654": C.amber,
  "107224657": C.blue,
  "1079394475": C.muted,
  "107224653": C.muted,
  "107224654": C.muted,
  "1319309459": C.muted,
  "107224658": C.muted,
  "1062161234": C.muted,
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: {
  active?:  boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?:   string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background:    C.cardAlt,
      border:        `1px solid ${C.borderAccent}`,
      borderRadius:  "10px",
      padding:       "10px 14px",
      fontSize:      "12px",
      boxShadow:     "0 12px 40px rgba(0,0,0,0.5)",
      minWidth:      "120px",
    }}>
      <p style={{ color: C.sage, fontWeight: 600, marginBottom: "6px" }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color, marginBottom: "2px", fontFamily: MONO, fontSize: "11px" }}>
          {p.name}: {p.name.includes("Rate") ? p.value + "%" : fmtNum(p.value)}
        </p>
      ))}
    </div>
  )
}

// ─── Alert banners ────────────────────────────────────────────────────────────
function WarnBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display:      "flex",
      alignItems:   "flex-start",
      gap:          "8px",
      background:   C.amberDim,
      border:       "1px solid rgba(245,166,35,0.2)",
      borderRadius: "10px",
      padding:      "10px 13px",
      fontSize:     "12px",
      color:        C.amber,
      marginTop:    "14px",
      lineHeight:   1.5,
    }}>
      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: "2px" }} />
      <span>{children}</span>
    </div>
  )
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display:      "flex",
      alignItems:   "flex-start",
      gap:          "8px",
      background:   C.redDim,
      border:       "1px solid rgba(239,68,68,0.2)",
      borderRadius: "10px",
      padding:      "10px 13px",
      fontSize:     "12px",
      color:        C.red,
      marginTop:    "14px",
      lineHeight:   1.5,
    }}>
      <AlertCircle size={13} style={{ flexShrink: 0, marginTop: "2px" }} />
      <span>{children}</span>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export function SelfServeDashboard() {
  const [kpis,           setKpis]           = useState<KpisData | null>(null)
  const [kpisError,      setKpisError]      = useState(false)
  const [stages,         setStages]         = useState<StageRow[] | null>(null)
  const [stagesError,    setStagesError]    = useState(false)
  const [stageQuarter,   setStageQuarter]   = useState<"Q1" | "Q2">("Q2")
  const [weekly,         setWeekly]         = useState<WeekRow[] | null>(null)
  const [weeklyError,    setWeeklyError]    = useState(false)
  const [monthly,        setMonthly]        = useState<MonthRow[] | null>(null)
  const [monthlyError,   setMonthlyError]   = useState(false)
  const [admob,          setAdmob]          = useState<AdMobRow[] | null>(null)
  const [admobError,     setAdmobError]     = useState(false)
  const [admob2025,       setAdmob2025]       = useState<AdMob2025Deal[] | null>(null)
  const [admob2025Error,  setAdmob2025Error]  = useState(false)
  const [ironSource,      setIronSource]      = useState<IronSourceDeal[] | null>(null)
  const [ironSourceError, setIronSourceError] = useState(false)
  const [isYear,          setIsYear]          = useState<"All" | "YTD" | "2024" | "2025" | "2026">("All")
  const [isQuarter,       setIsQuarter]       = useState<"All" | "Q1" | "Q2" | "Q3" | "Q4">("All")

  const filteredIronSource = useMemo(() => {
    if (!ironSource) return null
    if (isYear === "All") return ironSource

    const TODAY = new Date().toISOString().slice(0, 10)
    const QUARTER_RANGES: Record<string, [string, string]> = {
      Q1: ["-01-01", "-04-01"],
      Q2: ["-04-01", "-07-01"],
      Q3: ["-07-01", "-10-01"],
      Q4: ["-10-01", "-12-31T99"], // inclusive year-end
    }

    let start: string
    let end: string

    if (isYear === "YTD") {
      start = "2026-01-01"
      end   = TODAY
    } else if (isQuarter !== "All") {
      const [qs, qe] = QUARTER_RANGES[isQuarter]
      start = isYear + qs
      end   = isYear + qe
    } else {
      start = isYear + "-01-01"
      end   = isYear + "-12-31T99"
    }

    return ironSource.filter((d) => d.createDate >= start && d.createDate <= end)
  }, [ironSource, isYear, isQuarter])

  const [emailSplit,     setEmailSplit]     = useState<EmailSplit | null>(null)
  const [emailSplitError,setEmailSplitError]= useState(false)
  const [sources,        setSources]        = useState<SourceRow[] | null>(null)
  const [sourcesError,   setSourcesError]   = useState(false)
  const [lastUpdated,    setLastUpdated]    = useState<Date | null>(null)
  const [refreshing,     setRefreshing]     = useState(false)
  const [weeklyReport,      setWeeklyReport]      = useState<WeeklyReportData>(undefined as unknown as WeeklyReportData)
  const [weeklyReportError, setWeeklyReportError] = useState(false)
  const [reportRunning,     setReportRunning]     = useState(false)

  const fetchAll = useCallback(async () => {
    const results = await Promise.allSettled([
      fetch("/api/self-serve/kpis").then((r) => r.json()),
      fetch("/api/self-serve/pipeline-stages").then((r) => r.json()),
      fetch("/api/self-serve/weekly-dau").then((r) => r.json()),
      fetch("/api/self-serve/monthly-submissions").then((r) => r.json()),
      fetch("/api/self-serve/admob").then((r) => r.json()),
      fetch("/api/self-serve/email-split").then((r) => r.json()),
      fetch("/api/self-serve/weekly-report").then((r) => r.json()),
    ])
    const [r0, r1, r2, r3, r4, r5, r6] = results
    if (r0.status === "fulfilled" && !r0.value.error) setKpis(r0.value)
    else setKpisError(true)
    if (r1.status === "fulfilled" && !r1.value.error) setStages(r1.value)
    else setStagesError(true)
    if (r2.status === "fulfilled" && !r2.value.error) setWeekly(r2.value)
    else setWeeklyError(true)
    if (r3.status === "fulfilled" && !r3.value.error) setMonthly(r3.value)
    else setMonthlyError(true)
    if (r4.status === "fulfilled" && !r4.value.error) setAdmob(r4.value)
    else setAdmobError(true)
    if (r5.status === "fulfilled" && !r5.value.error) setEmailSplit(r5.value)
    else setEmailSplitError(true)
    if (r6.status === "fulfilled") setWeeklyReport(r6.value)
    else setWeeklyReportError(true)
    setLastUpdated(new Date())
    setRefreshing(false)

    // Fetch contact-sources independently — it's slow (multiple sequential HubSpot calls)
    // so we don't block other panels on it
    fetch("/api/self-serve/contact-sources")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setSources(d); else setSourcesError(true) })
      .catch(() => setSourcesError(true))

    // Fetch 2025 AdMob/GAM deals independently — reset state before each attempt so errors don't stick
    setAdmob2025(null)
    setAdmob2025Error(false)
    fetch("/api/self-serve/admob-2025")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setAdmob2025(d); else setAdmob2025Error(true) })
      .catch(() => setAdmob2025Error(true))

    // Fetch IronSource deals independently — reset state before each attempt so errors don't stick
    setIronSource(null)
    setIronSourceError(false)
    fetch("/api/self-serve/ironsource")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setIronSource(d); else setIronSourceError(true) })
      .catch(() => setIronSourceError(true))
  }, [])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setKpis(null)
    setKpisError(false)
    setStages(null)
    setStagesError(false)
    setWeekly(null)
    setWeeklyError(false)
    setMonthly(null)
    setMonthlyError(false)
    setAdmob(null)
    setAdmobError(false)
    setEmailSplit(null)
    setEmailSplitError(false)
    setSources(null)
    setSourcesError(false)
    setAdmob2025(null)
    setAdmob2025Error(false)
    setIronSource(null)
    setIronSourceError(false)
    await fetchAll()
  }, [fetchAll])

  async function runWeeklyReport() {
    setReportRunning(true)
    try {
      await fetch("/api/agents/weekly-report/run", { method: "POST" })
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const res = await fetch("/api/self-serve/weekly-report")
        const data = await res.json()
        if (data?.generatedAt) {
          setWeeklyReport(data)
          break
        }
      }
    } finally {
      setReportRunning(false)
    }
  }

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, 60_000)
    return () => clearInterval(id)
  }, [fetchAll])

  const qtdTarget  = 1_000_000
  const apacTarget = 300_000
  const q2FreeRate = emailSplit
    ? emailSplit.q2.free / Math.max(emailSplit.q2.business + emailSplit.q2.free, 1)
    : 0

  return (
    <>
      {/* Keyframes */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap');

        @keyframes bm-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes bm-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px ${C.accent}; }
          50%       { opacity: 0.35; box-shadow: none; }
        }
      `}</style>

      <div style={{
        display:       "flex",
        flexDirection: "column",
        gap:           "14px",
        color:         C.sage,
        fontFamily:    "'Outfit', system-ui, sans-serif",
      }}>

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          paddingBottom:  "6px",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{
                width:     "8px",
                height:    "8px",
                borderRadius: "50%",
                background:   C.accent,
                flexShrink:   0,
                animation:    "bm-pulse 2.4s ease infinite",
                display:      "inline-block",
              }} />
              <h2 style={{
                fontSize:      "20px",
                fontWeight:    700,
                color:         C.sageLight,
                letterSpacing: "-0.015em",
                margin:        0,
              }}>
                Self-Serve Pipeline
              </h2>
            </div>
            <p style={{
              fontSize:   "11.5px",
              color:      C.muted,
              marginTop:  "3px",
              paddingLeft:"18px",
              letterSpacing: "0.01em",
            }}>
              Pipeline 52357803 · Q2 2026 · Target 1M Norm DAU
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {lastUpdated && (
              <span style={{
                display:    "flex",
                alignItems: "center",
                gap:        "6px",
                fontSize:   "11px",
                color:      C.muted,
              }}>
                <span style={{
                  width:     "5px",
                  height:    "5px",
                  borderRadius: "50%",
                  background:   C.accent,
                  display:      "inline-block",
                  animation:    "bm-pulse 2.4s ease infinite",
                }} />
                Last sync {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              style={{
                display:      "flex",
                alignItems:   "center",
                gap:          "6px",
                background:   "transparent",
                border:       `1px solid ${C.border}`,
                borderRadius: "8px",
                padding:      "6px 14px",
                fontSize:     "11.5px",
                fontWeight:   500,
                color:        C.slate,
                cursor:       refreshing ? "not-allowed" : "pointer",
                opacity:      refreshing ? 0.5 : 1,
                transition:   "border-color 0.2s, color 0.2s",
                fontFamily:   "'Outfit', system-ui, sans-serif",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget
                el.style.borderColor = C.borderAccent
                el.style.color = C.sage
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget
                el.style.borderColor = C.border
                el.style.color = C.slate
              }}
            >
              <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Row 1: KPI Cards ─────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px" }}>
          {kpisError ? (
            Array.from({ length: 4 }).map((_, i) => <DataError key={i} label="KPI" />)
          ) : !kpis ? (
            Array.from({ length: 4 }).map((_, i) => <LoadingSkeleton key={i} h={140} />)
          ) : (
            <>
              <KpiCard
                label="Norm DAU QTD"
                value={fmtDau(kpis.qtdNormDau)}
                Icon={Target}
                progress={kpis.qtdNormDau / qtdTarget}
                sub={
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
                    <DeltaChip current={kpis.qtdNormDau} prev={kpis.q1NormDau} label="QoQ" />
                    <span style={{ fontSize: "11px", color: C.muted }}>
                      vs Q1 {fmtDau(kpis.q1NormDau)}
                    </span>
                  </div>
                }
              />
              <KpiCard
                label="This Week Norm DAU"
                value={fmtDau(kpis.thisWeekNormDau)}
                Icon={Zap}
                sub={<DeltaChip current={kpis.thisWeekNormDau} prev={kpis.prevWeekNormDau} />}
              />
              <KpiCard
                label="Q2 Form Submissions"
                value={kpis.q2Submissions.toString()}
                Icon={Users}
                sub={
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
                    <DeltaChip current={kpis.q2Submissions} prev={kpis.q1Submissions} label="QoQ" />
                    <span style={{ fontSize: "11px", color: C.muted }}>
                      vs Q1 {kpis.q1Submissions}
                    </span>
                  </div>
                }
              />
              <KpiCard
                label="APAC Norm DAU"
                value={fmtDau(kpis.apacNormDau)}
                Icon={Globe}
                accent={C.amber}
                progress={kpis.apacNormDau / apacTarget}
                progressTarget="300k"
                sub={
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
                    <DeltaChip current={kpis.apacNormDau} prev={kpis.q1ApacNormDau} label="QoQ" />
                    <span style={{ fontSize: "11px", color: C.muted }}>
                      vs Q1 {fmtDau(kpis.q1ApacNormDau)}
                    </span>
                  </div>
                }
              />
            </>
          )}
        </div>

        {/* ── Row 2: Stage breakdown | Weekly DAU ──────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>

          {/* Stage breakdown */}
          <Panel style={{ overflowY: "auto", maxHeight: "560px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.muted, margin: 0 }}>Pipeline Stage Breakdown (Norm DAU)</p>
              <div style={{ display: "flex", gap: "4px" }}>
                {(["Q1", "Q2"] as const).map((q) => (
                  <button
                    key={q}
                    onClick={() => setStageQuarter(q)}
                    style={{
                      padding:      "2px 10px",
                      borderRadius: "999px",
                      border:       `1px solid ${stageQuarter === q ? C.accent : C.border}`,
                      background:   stageQuarter === q ? C.accentDim : "transparent",
                      color:        stageQuarter === q ? C.accent : C.muted,
                      fontSize:     "10px",
                      fontWeight:   600,
                      cursor:       "pointer",
                      letterSpacing: "0.03em",
                    }}
                  >
                    {q} 2026
                  </button>
                ))}
              </div>
            </div>
            {stagesError ? (
              <DataError label="stage data" />
            ) : !stages ? (
              <LoadingSkeleton h={480} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {stages.map((s) => (
                  <StageGroup key={s.stageId} stage={s} quarter={stageQuarter} />
                ))}
              </div>
            )}
          </Panel>

          {/* Weekly DAU bar chart */}
          <Panel>
            <SectionLabel>Week-on-Week Norm DAU (last 8 weeks)</SectionLabel>
            {weeklyError ? (
              <DataError label="weekly DAU" />
            ) : !weekly ? (
              <LoadingSkeleton h={300} />
            ) : (
              <ResponsiveContainer width="100%" height={318}>
                <BarChart
                  data={weekly}
                  barSize={24}
                  margin={{ top: 28, right: 4, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient id="wkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={C.accent}    stopOpacity={0.9} />
                      <stop offset="100%" stopColor={C.accent}    stopOpacity={0.25} />
                    </linearGradient>
                    <linearGradient id="wkGradCur" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={C.accentBright} stopOpacity={1} />
                      <stop offset="100%" stopColor={C.accent}        stopOpacity={0.5} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="2 5"
                    stroke={C.grid}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="week"
                    tick={{ fill: C.muted, fontSize: 10, fontFamily: MONO }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: C.muted, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={fmtNum}
                    width={44}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ fill: C.accentGlow }}
                  />
                  <Bar dataKey="normDau" name="Norm DAU" radius={[5, 5, 0, 0]}>
                    {weekly.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.isCurrent ? "url(#wkGradCur)" : "url(#wkGrad)"}
                        opacity={entry.isCurrent ? 1 : 0.65}
                      />
                    ))}
                    <LabelList
                      dataKey="normDau"
                      position="top"
                      content={({ x, y, width, value, index }) => {
                        if (value == null || !weekly) return null
                        const isCurrent = weekly[index as number]?.isCurrent
                        return (
                          <text
                            x={Number(x) + Number(width) / 2}
                            y={Number(y) - 5}
                            textAnchor="middle"
                            fontSize={9.5}
                            fontFamily={MONO}
                            fontWeight={isCurrent ? 700 : 500}
                            fill={isCurrent ? C.accentBright : C.muted}
                          >
                            {fmtNum(value as number)}
                          </text>
                        )
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </div>

        {/* ── Row 3: Monthly Submissions ───────────────────────────────────── */}
        <Panel>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <SectionLabel>Monthly Submissions — Jan to May 2026</SectionLabel>
            <div style={{ display: "flex", gap: 16 }}>
              {[{ color: C.blue, label: "Submissions" }, { color: C.accent, label: "Approved" }].map(({ color, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width={20} height={10} style={{ flexShrink: 0 }}>
                    <line x1={0} y1={5} x2={20} y2={5} stroke={color} strokeWidth={2} />
                    <circle cx={10} cy={5} r={3.5} fill={color} />
                  </svg>
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
          {monthlyError ? (
            <DataError label="monthly submissions" />
          ) : !monthly ? (
            <LoadingSkeleton h={240} />
          ) : (
            <ResponsiveContainer width="100%" height={248}>
              <ComposedChart
                data={monthly}
                margin={{ top: 28, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="2 5" stroke={C.grid} vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fill: C.muted, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: C.muted, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={38}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: C.border, strokeWidth: 1 }} />
                <Line
                  type="monotone"
                  dataKey="submissions"
                  name="Submissions"
                  stroke={C.blue}
                  strokeWidth={2}
                  dot={({ cx, cy, index }) => {
                    const isPartial = monthly[index]?.isPartial
                    return <circle key={index} cx={cx} cy={cy} r={4} fill={C.blue} opacity={isPartial ? 0.4 : 1} strokeWidth={0} />
                  }}
                  activeDot={{ r: 6, fill: C.blue, strokeWidth: 0 }}
                  strokeOpacity={1}
                >
                  <LabelList
                    dataKey="submissions"
                    position="top"
                    content={({ x, y, value, index }) => {
                      if (value == null || !monthly) return null
                      const isPartial = monthly[index as number]?.isPartial
                      return (
                        <text
                          x={Number(x)}
                          y={Number(y) - 10}
                          textAnchor="middle"
                          fontSize={9.5}
                          fontFamily={MONO}
                          fontWeight={500}
                          fill={isPartial ? C.muted : C.blue}
                        >
                          {value as number}
                        </text>
                      )
                    }}
                  />
                </Line>
                <Line
                  type="monotone"
                  dataKey="approved"
                  name="Approved"
                  stroke={C.accent}
                  strokeWidth={2}
                  dot={({ cx, cy, index }) => {
                    const isPartial = monthly[index]?.isPartial
                    return <circle key={index} cx={cx} cy={cy} r={4} fill={C.accent} opacity={isPartial ? 0.4 : 1} strokeWidth={0} />
                  }}
                  activeDot={{ r: 6, fill: C.accent, strokeWidth: 0 }}
                >
                  <LabelList
                    dataKey="approved"
                    position="top"
                    content={({ x, y, value, index }) => {
                      if (value == null || !monthly) return null
                      const entry = monthly[index as number]
                      const isPartial = entry?.isPartial
                      const rate = entry?.approvalRate
                      const color = isPartial ? C.muted : C.accent
                      return (
                        <g>
                          <text
                            x={Number(x)}
                            y={Number(y) - 18}
                            textAnchor="middle"
                            fontSize={9.5}
                            fontFamily={MONO}
                            fontWeight={500}
                            fill={color}
                          >
                            {value as number}
                          </text>
                          <text
                            x={Number(x)}
                            y={Number(y) - 7}
                            textAnchor="middle"
                            fontSize={8.5}
                            fontFamily={MONO}
                            fontWeight={400}
                            fill={isPartial ? C.muted : C.muted}
                          >
                            {rate}%
                          </text>
                        </g>
                      )
                    }}
                  />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Panel>

        {/* ── Row 4: AdMob | Email Split ───────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>

          {/* AdMob */}
          <Panel>
            <SectionLabel>AdMob Submissions — Q1 vs Q2</SectionLabel>
            {admobError ? (
              <DataError label="AdMob data" />
            ) : !admob ? (
              <LoadingSkeleton h={220} />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={admob}
                    barSize={18}
                    margin={{ top: 24, right: 4, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="2 5" stroke={C.grid} vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: C.muted, fontSize: 10, fontFamily: MONO }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: C.muted, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={24}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: C.accentGlow }} />
                    <Bar dataKey="count" name="AdMob deals" radius={[4, 4, 0, 0]}>
                      {admob.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.quarter === "Q2" ? C.amber : C.purple}
                          opacity={entry.quarter === "Q1" ? 0.6 : 0.95}
                        />
                      ))}
                      <LabelList
                        dataKey="count"
                        position="top"
                        content={({ x, y, width, value, index }) => {
                          if (value == null || !admob) return null
                          const isQ2 = admob[index as number]?.quarter === "Q2"
                          return (
                            <text
                              x={Number(x) + Number(width) / 2}
                              y={Number(y) - 5}
                              textAnchor="middle"
                              fontSize={9.5}
                              fontFamily={MONO}
                              fontWeight={500}
                              fill={isQ2 ? C.amber : C.purple}
                            >
                              {value as number}
                            </text>
                          )
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                {/* Legend */}
                <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
                  {[{ label: "Q1", color: C.purple, opacity: 0.6 }, { label: "Q2", color: C.amber, opacity: 1 }].map(({ label, color, opacity }) => (
                    <span key={label} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.muted }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: color, opacity, display: "inline-block" }} />
                      {label}
                    </span>
                  ))}
                </div>

              </>
            )}
          </Panel>

          {/* Email Split */}
          <Panel>
            <SectionLabel>Email Type — Business vs Free</SectionLabel>
            {emailSplitError ? (
              <DataError label="email split" />
            ) : !emailSplit ? (
              <LoadingSkeleton h={220} />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={[
                      { quarter: "Q1", Business: emailSplit.q1.business, Free: emailSplit.q1.free },
                      { quarter: "Q2", Business: emailSplit.q2.business, Free: emailSplit.q2.free },
                    ]}
                    barGap={4}
                    margin={{ top: 24, right: 4, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="2 5" stroke={C.grid} vertical={false} />
                    <XAxis
                      dataKey="quarter"
                      tick={{ fill: C.muted, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: C.muted, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={32}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: C.accentGlow }} />
                    <Bar dataKey="Business" fill={C.blue} radius={[3, 3, 0, 0]} barSize={32} opacity={0.9}>
                      <LabelList
                        dataKey="Business"
                        position="top"
                        content={({ x, y, width, value }) => {
                          if (value == null) return null
                          return (
                            <text
                              x={Number(x) + Number(width) / 2}
                              y={Number(y) - 5}
                              textAnchor="middle"
                              fontSize={9.5}
                              fontFamily={MONO}
                              fontWeight={500}
                              fill={C.blue}
                            >
                              {value as number}
                            </text>
                          )
                        }}
                      />
                    </Bar>
                    <Bar dataKey="Free" fill={C.red} radius={[3, 3, 0, 0]} barSize={32} opacity={0.85}>
                      <LabelList
                        dataKey="Free"
                        position="top"
                        content={({ x, y, width, value }) => {
                          if (value == null) return null
                          return (
                            <text
                              x={Number(x) + Number(width) / 2}
                              y={Number(y) - 5}
                              textAnchor="middle"
                              fontSize={9.5}
                              fontFamily={MONO}
                              fontWeight={500}
                              fill={C.red}
                            >
                              {value as number}
                            </text>
                          )
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>


                <p style={{ marginTop: "10px", fontSize: "11px", color: C.muted }}>
                  Q2: {emailSplit.q2.business} business · {emailSplit.q2.free} free
                  {emailSplit.q2.unknown > 0 && ` · ${emailSplit.q2.unknown} no email`}
                </p>
              </>
            )}
          </Panel>
        </div>

        {/* ── Row 5: Contact Sources ───────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Panel>
            <SectionLabel>Last Touch Source — Q2 QTD</SectionLabel>
            {sourcesError ? (
              <DataError label="contact sources" />
            ) : !sources ? (
              <LoadingSkeleton h={180} />
            ) : sources.length === 0 ? (
              <p style={{ fontSize: 12, color: C.muted, padding: "24px 0", textAlign: "center" }}>No data</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>
                {/* Column headers */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Source</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 48, textAlign: "right" }}>Norm DAU</span>
                    <span style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 36, textAlign: "right" }}>QoQ</span>
                    <span style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 44, textAlign: "right" }}>Deals</span>
                  </div>
                </div>
                {sources.map((row, i) => {
                  const barColors = [C.accent, C.blue, C.amber, C.purple, C.red, C.muted]
                  const color = barColors[i % barColors.length]
                  const qoqPositive = row.qoqPct !== null && row.qoqPct >= 0
                  return (
                    <div key={row.source}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: C.sage }}>{row.source}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: C.sageLight, fontFamily: MONO, fontWeight: 600, minWidth: 48, textAlign: "right" }}>
                            {fmtNum(row.normDau ?? 0)}
                          </span>
                          <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 500, minWidth: 36, textAlign: "right",
                            color: row.qoqPct === null ? C.muted : qoqPositive ? C.accent : C.red,
                          }}>
                            {row.qoqPct === null ? "—" : `${qoqPositive ? "+" : ""}${row.qoqPct}%`}
                          </span>
                          <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO, minWidth: 44, textAlign: "right" }}>
                            {row.count}
                          </span>
                        </div>
                      </div>
                      <div style={{ height: 4, borderRadius: 2, background: C.border }}>
                        <div style={{ height: "100%", borderRadius: 2, background: color, width: `${row.pct}%`, transition: "width 0.4s ease" }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </div>

        {/* ── Row 6: AdMob / GAM — 2025 Cohort ────────────────────────────── */}
        <Panel style={{ overflowY: "auto", maxHeight: "400px" }}>
          <SectionLabel>AdMob / GAM — 2025 Signups (current stage)</SectionLabel>
          {admob2025Error ? (
            <DataError label="AdMob 2025 data" />
          ) : !admob2025 ? (
            <LoadingSkeleton h={200} />
          ) : admob2025.length === 0 ? (
            <p style={{ fontSize: 12, color: C.muted, padding: "24px 0", textAlign: "center" }}>No deals found</p>
          ) : (
            <>
              {/* Summary */}
              <div style={{ display: "flex", gap: "16px", marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", color: C.muted }}>
                  <span style={{ fontFamily: MONO, fontWeight: 600, color: C.sageLight }}>{admob2025.length}</span> deals
                </span>
                <span style={{ fontSize: "11px", color: C.muted }}>
                  <span style={{ fontFamily: MONO, fontWeight: 600, color: C.purple }}>
                    {fmtDau(admob2025.reduce((s, d) => s + d.normDau, 0))}
                  </span> total Norm DAU
                </span>
              </div>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 80px 28px", gap: "8px", padding: "5px 8px", borderBottom: `1px solid ${C.border}` }}>
                {["Deal", "Norm DAU", "Signup", ""].map((h) => (
                  <span key={h} style={{ fontSize: "10px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: h === "Norm DAU" ? "right" : "left" }}>{h}</span>
                ))}
              </div>
              {/* Rows */}
              {admob2025.map((deal, i) => (
                <div
                  key={deal.id}
                  style={{
                    display:         "grid",
                    gridTemplateColumns: "1fr 90px 80px 28px",
                    gap:             "8px",
                    alignItems:      "center",
                    padding:         "6px 8px",
                    borderBottom:    i < admob2025.length - 1 ? `1px solid ${C.border}` : "none",
                    background:      i % 2 === 0 ? "transparent" : C.cardAlt,
                    borderRadius:    "4px",
                  }}
                >
                  <span style={{ fontSize: "12px", color: C.sage, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {deal.name}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: "11px", fontWeight: 600, color: deal.normDau > 0 ? C.purple : C.muted, textAlign: "right" }}>
                    {deal.normDau > 0 ? fmtDau(deal.normDau) : "—"}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: "10px", color: C.muted }}>
                    {deal.signupDate || "—"}
                  </span>
                  <a
                    href={deal.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: "20px", height: "20px", borderRadius: "5px",
                      background: C.accentGlow, border: `1px solid ${C.border}`,
                      color: C.muted, fontSize: "10px", textDecoration: "none",
                    }}
                  >
                    ↗
                  </a>
                </div>
              ))}
            </>
          )}
        </Panel>

        {/* ── Row 7: IronSource Deals ──────────────────────────────────────── */}
        <Panel style={{ overflowY: "auto", maxHeight: "400px" }}>
          {/* Header + filters */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
            <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.muted, margin: 0 }}>
              IronSource — Pipeline Deals
            </p>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {/* Year filter */}
              <div style={{ display: "flex", gap: "3px" }}>
                {(["All", "YTD", "2024", "2025", "2026"] as const).map((y) => (
                  <button key={y} onClick={() => { setIsYear(y); setIsQuarter("All") }} style={{
                    padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, cursor: "pointer",
                    border:      `1px solid ${isYear === y ? C.amber : C.border}`,
                    background:  isYear === y ? `${C.amber}22` : "transparent",
                    color:       isYear === y ? C.amber : C.muted,
                    letterSpacing: "0.02em",
                  }}>{y}</button>
                ))}
              </div>
              {/* Quarter filter — hidden for YTD */}
              {isYear !== "YTD" && isYear !== "All" && (
                <div style={{ display: "flex", gap: "3px" }}>
                  {(["All", "Q1", "Q2", "Q3", "Q4"] as const).map((q) => (
                    <button key={q} onClick={() => setIsQuarter(q)} style={{
                      padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, cursor: "pointer",
                      border:     `1px solid ${isQuarter === q ? C.accent : C.border}`,
                      background: isQuarter === q ? C.accentDim : "transparent",
                      color:      isQuarter === q ? C.accent : C.muted,
                      letterSpacing: "0.02em",
                    }}>{q}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {ironSourceError ? (
            <DataError label="IronSource data" />
          ) : !filteredIronSource ? (
            <LoadingSkeleton h={200} />
          ) : filteredIronSource.length === 0 ? (
            <p style={{ fontSize: 12, color: C.muted, padding: "24px 0", textAlign: "center" }}>No deals found</p>
          ) : (
            <>
              {/* Summary */}
              <div style={{ display: "flex", gap: "16px", marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", color: C.muted }}>
                  <span style={{ fontFamily: MONO, fontWeight: 600, color: C.sageLight }}>{filteredIronSource.length}</span> deals
                </span>
                <span style={{ fontSize: "11px", color: C.muted }}>
                  <span style={{ fontFamily: MONO, fontWeight: 600, color: C.amber }}>
                    {fmtDau(filteredIronSource.reduce((s, d) => s + d.normDau, 0))}
                  </span> total Norm DAU
                </span>
              </div>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 90px 80px 28px", gap: "8px", padding: "5px 8px", borderBottom: `1px solid ${C.border}` }}>
                {[["Deal", "left"], ["Norm DAU", "right"], ["Stage", "left"], ["Created", "left"], ["", "left"]].map(([h, align]) => (
                  <span key={h} style={{ fontSize: "10px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: align as "left" | "right" }}>{h}</span>
                ))}
              </div>
              {/* Rows */}
              {filteredIronSource.map((deal, i) => {
                const stageColor = STAGE_COLOR[deal.stageId] ?? C.muted
                return (
                  <div
                    key={deal.id}
                    style={{
                      display:             "grid",
                      gridTemplateColumns: "1fr 120px 90px 80px 28px",
                      gap:                 "8px",
                      alignItems:          "center",
                      padding:             "6px 8px",
                      borderBottom:        i < filteredIronSource.length - 1 ? `1px solid ${C.border}` : "none",
                      background:          i % 2 === 0 ? "transparent" : C.cardAlt,
                      borderRadius:        "4px",
                    }}
                  >
                    <span style={{ fontSize: "12px", color: C.sage, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {deal.name}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: "11px", fontWeight: 600, color: deal.normDau > 0 ? C.amber : C.muted, textAlign: "right" }}>
                      {deal.normDau > 0 ? fmtDau(deal.normDau) : "—"}
                    </span>
                    <span style={{ fontSize: "10px", color: stageColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {deal.stage}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: "10px", color: C.muted }}>
                      {deal.createDate || "—"}
                    </span>
                    <a
                      href={deal.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: "20px", height: "20px", borderRadius: "5px",
                        background: C.accentGlow, border: `1px solid ${C.border}`,
                        color: C.muted, fontSize: "10px", textDecoration: "none",
                      }}
                    >
                      ↗
                    </a>
                  </div>
                )
              })}
            </>
          )}
        </Panel>

        {/* ── Row 8: Weekly Report ─────────────────────────────────────────── */}
        <Panel>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <SectionLabel>Weekly Report</SectionLabel>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {weeklyReport?.weekLabel && (
                <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{weeklyReport.weekLabel}</span>
              )}
              <button
                onClick={runWeeklyReport}
                disabled={reportRunning}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.borderAccent}`,
                  background: C.accentDim, color: C.accent, fontFamily: MONO, fontSize: 11,
                  cursor: reportRunning ? "not-allowed" : "pointer", opacity: reportRunning ? 0.6 : 1,
                }}
              >
                {reportRunning ? "Generating…" : "Run Now"}
              </button>
            </div>
          </div>

          {weeklyReportError ? (
            <DataError label="weekly report" />
          ) : weeklyReport === (undefined as unknown as WeeklyReportData) ? (
            <LoadingSkeleton h={200} />
          ) : !weeklyReport ? (
            <div style={{ padding: "32px 0", textAlign: "center", color: C.muted, fontSize: 13, fontFamily: MONO }}>
              No report generated yet. Click Run Now to generate the first report.
            </div>
          ) : (
            <div>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16,
                padding: "10px 12px", background: C.cardAlt, borderRadius: 8, border: `1px solid ${C.border}`,
              }}>
                {[
                  { label: "DAU QTD", value: fmtNum(weeklyReport.kpis.qtdNormDau) },
                  { label: "This Week", value: fmtNum(weeklyReport.kpis.thisWeekNormDau) },
                  { label: "Submissions", value: weeklyReport.kpis.q2Submissions },
                  { label: "APAC DAU", value: fmtNum(weeklyReport.kpis.apacNormDau) },
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: C.sageLight, fontFamily: MONO }}>{value}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
              <div style={{
                fontSize: 12.5, lineHeight: 1.7, color: C.sage, whiteSpace: "pre-wrap",
                padding: "12px 14px", background: C.cardAlt, borderRadius: 8,
                border: `1px solid ${C.border}`, fontFamily: "Outfit, sans-serif",
              }}>
                {weeklyReport.insights}
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: C.muted, fontFamily: MONO, textAlign: "right" }}>
                Generated {new Date(weeklyReport.generatedAt).toLocaleString()}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
