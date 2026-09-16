"use client"

import { useEffect, useState, useCallback } from "react"

type SelfServeKpis = {
  currentQuarter: string
  prevQuarter: string
  qtdNormDau: number
  hsQtdNormDau: number
  prevQNormDau: number
  thisWeekNormDau: number
  prevWeekNormDau: number
  currentQSubmissions: number
  prevQSubmissions: number
  apacNormDau: number
  prevQApacNormDau: number
}

function fmtDau(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k"
  return n.toString()
}

// ─── SelfServe design tokens ──────────────────────────────────────────────────
const C = {
  bg:           "#020d07",
  card:         "#071510",
  cardAlt:      "#0a1d14",
  border:       "#0e2b1d",
  borderAccent: "rgba(5,199,155,0.18)",
  accent:       "#05c79b",
  accentBright: "#00e8b0",
  accentDim:    "rgba(5,199,155,0.13)",
  accentGlow:   "rgba(5,199,155,0.06)",
  sage:         "#c8ddd5",
  sageLight:    "#e8f3ef",
  muted:        "#3d6b56",
  slate:        "#7c8c94",
  red:          "#ef4444",
  redDim:       "rgba(239,68,68,0.12)",
}
const MONO = "'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, monospace"

type MqlDau = {
  mqlNormDau: number
  dealCount: number
}

type OkrMetric = { name: string; current: number; target: number; start: number }
type OkrKR = { id: string; title: string; progress: number; status: number; metric: OkrMetric | null }
type OkrData = {
  objective: { title: string; progress: number; status: number }
  keyResults: OkrKR[]
  statusLabels: Record<number, string>
}

type CultureScore = {
  cultureScore: number
  scoreBreakdown: Array<{ label: string; value: string; tone: string; detail: string }>
  github: { commits: number; prsOpened: number; prsMerged: number; activeDays: number }
  atlassian: { ticketsCreated: number; ticketsResolved: number; pagesCreated: number; pagesEdited: number; jiraComments: number }
  fellow: { meetingsInvited: number; meetingsWithAgenda: number; actionItemsAssigned: number; actionItemsCompleted: number }
  meetingDiscipline: { score: number }
  okrHealth: { healthy: number; warning: number; critical: number; total: number; healthRate: number }
}

const STATUS_COLOR: Record<number, string> = {
  1: "#05c79b",  // On Track
  2: "#f5a623",  // At Risk
  3: "#ef4444",  // Behind
  4: "#7c8c94",  // Not Started
  5: "#7c8c94",
}

type Recommendation = {
  id: string
  priority: "high" | "medium" | "low"
  title: string
  description: string
  impact: string
  actionLabel: string
  actionEndpoint: string | null
  status: "pending" | "approved" | "declined" | "running" | "done"
}

function getRecommendations(culture: CultureScore | null, okrs: OkrData | null): Recommendation[] {
  if (!culture) return []
  const recs: Recommendation[] = []

  // OKR health is the #1 issue (-54 penalty)
  if (culture.okrHealth.warning > 0 || culture.okrHealth.critical > 0) {
    recs.push({
      id: "okr-market-data",
      priority: "high",
      title: "Fix OKR warning: add market data to MQL KR",
      description: "Your MQL Key Result is flagged for missing market/TAM benchmarks. I can update the KR description in GetOKRs to reference AdTech MQL benchmarks (Forrester B2B benchmark: 5-8% MQL-to-SQL rate) and cite your Q2 baseline as the internal benchmark.",
      impact: "Removes the OKR warning flag, improving OKR health rate from 75% to 100% and stopping the repeat penalty cycle (-54 pts).",
      actionLabel: "Update KR description in GetOKRs",
      actionEndpoint: "/api/dashboard/actions/fix-okr-warning",
      status: "pending",
    })
  }

  // OKR check-in freshness
  if (okrs) {
    const behindKRs = okrs.keyResults.filter((kr) => kr.status === 3)
    if (behindKRs.length > 0) {
      recs.push({
        id: "okr-checkin",
        priority: "high",
        title: "Update OKR check-in for MQL KR",
        description: `Your MQL KR shows 94/135 but is marked "Behind". I can push a check-in to GetOKRs with the latest MQL count from HubSpot (via /api/dashboard/mql-dau) to keep the progress current.`,
        impact: "Keeps OKR data fresh, prevents stale check-in penalties.",
        actionLabel: "Push check-in to GetOKRs",
        actionEndpoint: "/api/dashboard/actions/push-checkin",
        status: "pending",
      })
    }
  }

  // GitHub activity
  if (culture.github.prsMerged < 2) {
    recs.push({
      id: "github-pr",
      priority: "medium",
      title: "Create and merge a PR under your handle",
      description: "You have 1 merged PR in the last 14 days. Merging Dependabot PRs doesn't count — you need to author the PR. I can create a feature branch with today's dashboard changes, open a PR, and merge it.",
      impact: "Increases merged PR count, prevents github_inactive repeat flag.",
      actionLabel: "Create & merge a PR",
      actionEndpoint: "/api/dashboard/actions/create-pr",
      status: "pending",
    })
  }

  // Fellow action items completion rate
  if (culture.fellow.actionItemsAssigned > 0) {
    const completionRate = Math.round((culture.fellow.actionItemsCompleted / culture.fellow.actionItemsAssigned) * 100)
    if (completionRate < 50) {
      recs.push({
        id: "fellow-actions",
        priority: "medium",
        title: `Action item completion rate is ${completionRate}%`,
        description: `You have ${culture.fellow.actionItemsAssigned} action items assigned and only ${culture.fellow.actionItemsCompleted} completed (${completionRate}%). Review overdue items in Fellow and mark completed ones. This is a manual action — I can't access Fellow directly.`,
        impact: "Improves meeting discipline signals and shows follow-through.",
        actionLabel: "Open Fellow",
        actionEndpoint: null,
        status: "pending",
      })
    }
  }

  // Meeting agenda coverage
  if (culture.fellow.meetingsInvited > 0 && culture.fellow.meetingsWithAgenda < culture.fellow.meetingsInvited) {
    const missing = culture.fellow.meetingsInvited - culture.fellow.meetingsWithAgenda
    if (missing > 3) {
      recs.push({
        id: "meeting-agenda",
        priority: "low",
        title: `${missing} meetings without agenda`,
        description: "Ensure all meetings you organize have an agenda set in Fellow before the meeting starts. This improves your meeting discipline score.",
        impact: "Meeting discipline is at 87% — closing agenda gaps could push it higher.",
        actionLabel: "Open Fellow",
        actionEndpoint: null,
        status: "pending",
      })
    }
  }

  return recs
}

type FellowItem = {
  id: string
  text: string
  status: string
  createdAt: string
  dueDate: string | null
  overdue: boolean
  isDuplicate: boolean
  suggestComplete: boolean
  aiDetected: boolean
  assignees: string[]
}
type FellowData = {
  items: FellowItem[]
  stats: { total: number; overdue: number; duplicates: number; suggestComplete: number; recentlyDone: number }
}

type FellowFilter = "all" | "overdue" | "duplicates" | "suggest" | "ai"

const PRIORITY_COLOR: Record<string, string> = {
  high: "#ef4444",
  medium: "#f5a623",
  low: "#4c9ef5",
}

export default function DashboardPage() {
  const [ssKpis, setSsKpis] = useState<SelfServeKpis | null>(null)
  const [ssKpisLoading, setSsKpisLoading] = useState(true)
  const [mqlDau, setMqlDau] = useState<MqlDau | null>(null)
  const [mqlDauLoading, setMqlDauLoading] = useState(true)
  const [okrs, setOkrs] = useState<OkrData | null>(null)
  const [okrsLoading, setOkrsLoading] = useState(true)
  const [culture, setCulture] = useState<CultureScore | null>(null)
  const [cultureLoading, setCultureLoading] = useState(true)
  const [recStatuses, setRecStatuses] = useState<Record<string, Recommendation["status"]>>({})
  const [recMessages, setRecMessages] = useState<Record<string, string>>({})
  const [fellow, setFellow] = useState<FellowData | null>(null)
  const [fellowLoading, setFellowLoading] = useState(true)
  const [fellowFilter, setFellowFilter] = useState<FellowFilter>("all")
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set())

  const fetchAll = useCallback(() => {
    setSsKpisLoading(true)
    fetch("/api/self-serve/kpis")
      .then((r) => r.json())
      .then((data) => { if (!data.error) setSsKpis(data) })
      .catch(() => {})
      .finally(() => setSsKpisLoading(false))

    setMqlDauLoading(true)
    fetch("/api/dashboard/mql-dau")
      .then((r) => r.json())
      .then((data) => { if (!data.error) setMqlDau(data) })
      .catch(() => {})
      .finally(() => setMqlDauLoading(false))

    setOkrsLoading(true)
    fetch("/api/dashboard/okrs")
      .then((r) => r.json())
      .then((data) => { if (!data.error) setOkrs(data) })
      .catch(() => {})
      .finally(() => setOkrsLoading(false))

    setCultureLoading(true)
    fetch("/api/dashboard/culture-score")
      .then((r) => r.json())
      .then((data) => { if (!data.error) setCulture(data) })
      .catch(() => {})
      .finally(() => setCultureLoading(false))

    setFellowLoading(true)
    fetch("/api/dashboard/fellow")
      .then((r) => r.json())
      .then((data) => { if (!data.error) setFellow(data) })
      .catch(() => {})
      .finally(() => setFellowLoading(false))
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, 60_000)
    return () => clearInterval(id)
  }, [fetchAll])

  return (
    <div className="flex flex-col gap-6">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
      {/* Self-Serve KPIs */}
      <div style={{
        background:   C.card,
        border:       `1px solid ${C.border}`,
        borderRadius: "16px",
        padding:      "22px 26px",
        position:     "relative",
        overflow:     "hidden",
        fontFamily:   "'Outfit', system-ui, sans-serif",
      }}>
        {/* Top shimmer line */}
        <div style={{
          position:   "absolute",
          top: 0, left: "10%", right: "10%",
          height:     "1px",
          background: `linear-gradient(90deg, transparent, ${C.borderAccent}, transparent)`,
          pointerEvents: "none",
        }} />
        {/* Left accent stripe */}
        <div style={{
          position:     "absolute",
          left:         0, top: "18%", bottom: "18%",
          width:        "3px",
          borderRadius: "0 3px 3px 0",
          background:   C.accent,
          opacity:      0.9,
        }} />

        {/* Icon + label row */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <span style={{
            width:          "28px",
            height:         "28px",
            borderRadius:   "8px",
            background:     `${C.accent}18`,
            border:         `1px solid ${C.accent}30`,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            flexShrink:     0,
            fontSize:       "13px",
            color:          C.accent,
          }}>
            ◎
          </span>
          <span style={{
            fontSize:      "9.5px",
            fontWeight:    700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color:         C.slate,
          }}>
            Norm DAU QTD
          </span>
          {ssKpis && (
            <span style={{ fontSize: "10px", color: C.muted, marginLeft: "4px" }}>
              — {ssKpis.currentQuarter}
            </span>
          )}
        </div>

        {ssKpisLoading ? (
          <div style={{
            height:          48,
            width:           140,
            borderRadius:    "10px",
            background:      C.card,
            backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
            backgroundSize:  "200% 100%",
            animation:       "bm-shimmer 1.6s ease infinite",
          }} />
        ) : ssKpis ? (
          <>
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
              {fmtDau(ssKpis.qtdNormDau)}
            </p>

            {/* QoQ + prev quarter */}
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "2px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {ssKpis.prevQNormDau > 0 && (() => {
                  const pct = ((ssKpis.qtdNormDau - ssKpis.prevQNormDau) / ssKpis.prevQNormDau) * 100
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
                      {positive ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% QoQ
                    </span>
                  )
                })()}
                <span style={{ fontSize: "11px", color: C.muted }}>
                  vs {ssKpis.prevQuarter} {fmtDau(ssKpis.prevQNormDau)}
                </span>
              </div>
              {/* HS view */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "10px", color: C.muted }}>HS view:</span>
                <span style={{ fontSize: "11px", fontFamily: MONO, fontWeight: 600, color: C.slate }}>
                  {fmtDau(ssKpis.hsQtdNormDau)}
                </span>
                <span style={{
                  fontSize:   "10px",
                  color:      ssKpis.qtdNormDau >= ssKpis.hsQtdNormDau ? C.accent : C.red,
                  fontFamily: MONO,
                }}>
                  {ssKpis.qtdNormDau >= ssKpis.hsQtdNormDau ? "+" : ""}{fmtDau(ssKpis.qtdNormDau - ssKpis.hsQtdNormDau)} vs HS
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ marginTop: "14px" }}>
              <div style={{
                height:       "2px",
                background:   C.border,
                borderRadius: "99px",
                overflow:     "hidden",
              }}>
                <div style={{
                  height:       "100%",
                  width:        `${Math.min((ssKpis.qtdNormDau / 1_000_000) * 100, 100)}%`,
                  background:   `linear-gradient(90deg, ${C.accent}, ${C.accentBright})`,
                  borderRadius: "99px",
                  transition:   "width 1.2s cubic-bezier(0.4,0,0.2,1)",
                }} />
              </div>
              <p style={{ fontSize: "10px", color: C.muted, marginTop: "5px" }}>
                {Math.round((ssKpis.qtdNormDau / 1_000_000) * 100)}% of 1M target
              </p>
            </div>
          </>
        ) : (
          <p style={{ fontSize: "12px", color: C.muted }}>Could not load KPI data</p>
        )}

        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap');
          @keyframes bm-shimmer {
            0%   { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
      </div>

      {/* MQL Norm DAU */}
      <div style={{
        background:   C.card,
        border:       `1px solid ${C.border}`,
        borderRadius: "16px",
        padding:      "22px 26px",
        position:     "relative",
        overflow:     "hidden",
        fontFamily:   "'Outfit', system-ui, sans-serif",
      }}>
        {/* Top shimmer line */}
        <div style={{
          position:   "absolute",
          top: 0, left: "10%", right: "10%",
          height:     "1px",
          background: `linear-gradient(90deg, transparent, rgba(76,158,245,0.18), transparent)`,
          pointerEvents: "none",
        }} />
        {/* Left accent stripe */}
        <div style={{
          position:     "absolute",
          left:         0, top: "18%", bottom: "18%",
          width:        "3px",
          borderRadius: "0 3px 3px 0",
          background:   "#4c9ef5",
          opacity:      0.9,
        }} />

        {/* Icon + label row */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <span style={{
            width:          "28px",
            height:         "28px",
            borderRadius:   "8px",
            background:     "rgba(76,158,245,0.1)",
            border:         "1px solid rgba(76,158,245,0.19)",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            flexShrink:     0,
            fontSize:       "13px",
            color:          "#4c9ef5",
          }}>
            ⬡
          </span>
          <span style={{
            fontSize:      "9.5px",
            fontWeight:    700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color:         C.slate,
          }}>
            MQL Norm DAU QTD
          </span>
          {ssKpis && (
            <span style={{ fontSize: "10px", color: C.muted, marginLeft: "4px" }}>
              — {ssKpis.currentQuarter}
            </span>
          )}
        </div>

        {mqlDauLoading ? (
          <div style={{
            height:          48,
            width:           140,
            borderRadius:    "10px",
            background:      C.card,
            backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
            backgroundSize:  "200% 100%",
            animation:       "bm-shimmer 1.6s ease infinite",
          }} />
        ) : mqlDau ? (
          <>
            {/* Deal count — big KPI */}
            <p style={{
              fontSize:      "38px",
              fontWeight:    700,
              lineHeight:    1,
              color:         C.sageLight,
              letterSpacing: "-0.025em",
              fontFamily:    MONO,
              marginBottom:  "8px",
            }}>
              {mqlDau.dealCount}
            </p>

            {/* Norm DAU sub-value */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
              <span style={{
                display:       "inline-flex",
                alignItems:    "center",
                gap:           "3px",
                background:    "rgba(76,158,245,0.15)",
                color:         "#4c9ef5",
                padding:       "2px 8px",
                borderRadius:  "999px",
                fontSize:      "11px",
                fontWeight:    600,
                letterSpacing: "0.01em",
              }}>
                {fmtDau(mqlDau.mqlNormDau)} Norm DAU
              </span>
              <span style={{ fontSize: "11px", color: C.muted }}>
                entered MQL or sourced Q3 2026
              </span>
            </div>

            {/* Progress bar — 135 target */}
            <div style={{ marginTop: "14px" }}>
              <div style={{
                height:       "2px",
                background:   C.border,
                borderRadius: "99px",
                overflow:     "hidden",
              }}>
                <div style={{
                  height:       "100%",
                  width:        `${Math.min((mqlDau.dealCount / 135) * 100, 100)}%`,
                  background:   "linear-gradient(90deg, #4c9ef5, #7bb8ff)",
                  borderRadius: "99px",
                  transition:   "width 1.2s cubic-bezier(0.4,0,0.2,1)",
                }} />
              </div>
              <p style={{ fontSize: "10px", color: C.muted, marginTop: "5px" }}>
                {Math.round((mqlDau.dealCount / 135) * 100)}% of 135 target
              </p>
            </div>
          </>
        ) : (
          <p style={{ fontSize: "12px", color: C.muted }}>Could not load MQL DAU data</p>
        )}
      </div>
      </div>

      {/* Culture Score + Activity */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>

        {/* Culture Score */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
          padding: "22px 26px", position: "relative", overflow: "hidden",
          fontFamily: "'Outfit', system-ui, sans-serif",
        }}>
          <div style={{
            position: "absolute", top: 0, left: "10%", right: "10%", height: "1px",
            background: `linear-gradient(90deg, transparent, rgba(245,166,35,0.18), transparent)`,
            pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute", left: 0, top: "18%", bottom: "18%",
            width: "3px", borderRadius: "0 3px 3px 0",
            background: culture && culture.cultureScore >= 80 ? C.accent : culture && culture.cultureScore >= 50 ? "#f5a623" : "#ef4444",
            opacity: 0.9,
          }} />

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
            <span style={{
              width: "28px", height: "28px", borderRadius: "8px",
              background: "rgba(245,166,35,0.1)", border: "1px solid rgba(245,166,35,0.19)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, fontSize: "13px", color: "#f5a623",
            }}>♦</span>
            <span style={{
              fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em",
              textTransform: "uppercase", color: C.slate,
            }}>Culture Score</span>
          </div>

          {cultureLoading ? (
            <div style={{
              height: 48, width: 80, borderRadius: "10px", background: C.card,
              backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
              backgroundSize: "200% 100%", animation: "bm-shimmer 1.6s ease infinite",
            }} />
          ) : culture ? (
            <>
              <p style={{
                fontSize: "52px", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em",
                fontFamily: MONO, marginBottom: "6px",
                color: culture.cultureScore >= 80 ? C.accent : culture.cultureScore >= 50 ? "#f5a623" : "#ef4444",
              }}>
                {culture.cultureScore}
              </p>
              <p style={{ fontSize: "10px", color: C.muted, marginBottom: "14px" }}>out of 100</p>

              {/* Breakdown */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {culture.scoreBreakdown.map((item, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", color: C.sage }}>{item.label}</span>
                    <span style={{
                      fontFamily: MONO, fontSize: "11px", fontWeight: 600,
                      color: item.tone === "negative" ? "#ef4444" : item.tone === "final" ? C.sageLight : C.muted,
                    }}>{item.value}</span>
                  </div>
                ))}
              </div>

              {/* OKR Health */}
              <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: `1px solid ${C.border}` }}>
                <p style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, marginBottom: "8px" }}>
                  OKR Health
                </p>
                <div style={{ display: "flex", gap: "8px" }}>
                  {[
                    { label: "Healthy", count: culture.okrHealth.healthy, color: C.accent },
                    { label: "Warning", count: culture.okrHealth.warning, color: "#f5a623" },
                    { label: "Critical", count: culture.okrHealth.critical, color: "#ef4444" },
                  ].map(({ label, count, color }) => (
                    <div key={label} style={{
                      flex: 1, textAlign: "center", padding: "6px 4px",
                      background: `${color}12`, borderRadius: "8px", border: `1px solid ${color}25`,
                    }}>
                      <p style={{ fontFamily: MONO, fontSize: "16px", fontWeight: 700, color }}>{count}</p>
                      <p style={{ fontSize: "9px", color: C.muted }}>{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p style={{ fontSize: "12px", color: C.muted }}>Could not load culture score</p>
          )}
        </div>

        {/* Activity Grid */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
          padding: "22px 26px", position: "relative", overflow: "hidden",
          fontFamily: "'Outfit', system-ui, sans-serif",
        }}>
          <div style={{
            position: "absolute", top: 0, left: "10%", right: "10%", height: "1px",
            background: `linear-gradient(90deg, transparent, rgba(245,166,35,0.18), transparent)`,
            pointerEvents: "none",
          }} />

          <p style={{
            fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em",
            textTransform: "uppercase", color: C.muted, marginBottom: "16px",
          }}>Activity — Last 14 Days</p>

          {cultureLoading ? (
            <div style={{
              height: 120, borderRadius: "10px", background: C.card,
              backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
              backgroundSize: "200% 100%", animation: "bm-shimmer 1.6s ease infinite",
            }} />
          ) : culture ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
              {/* GitHub */}
              <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "14px" }}>
                <p style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, marginBottom: "10px" }}>GitHub</p>
                {[
                  { label: "Commits", value: culture.github.commits },
                  { label: "PRs Opened", value: culture.github.prsOpened },
                  { label: "PRs Merged", value: culture.github.prsMerged },
                  { label: "Active Days", value: culture.github.activeDays },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ fontSize: "11px", color: C.sage }}>{label}</span>
                    <span style={{ fontFamily: MONO, fontSize: "11px", fontWeight: 600, color: value > 0 ? C.sageLight : C.muted }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Atlassian */}
              <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "14px" }}>
                <p style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, marginBottom: "10px" }}>Atlassian</p>
                {[
                  { label: "Tickets Created", value: culture.atlassian.ticketsCreated },
                  { label: "Tickets Resolved", value: culture.atlassian.ticketsResolved },
                  { label: "Pages Created", value: culture.atlassian.pagesCreated },
                  { label: "Jira Comments", value: culture.atlassian.jiraComments },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ fontSize: "11px", color: C.sage }}>{label}</span>
                    <span style={{ fontFamily: MONO, fontSize: "11px", fontWeight: 600, color: value > 0 ? C.sageLight : C.muted }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Meetings */}
              <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "14px" }}>
                <p style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, marginBottom: "10px" }}>Meetings</p>
                {[
                  { label: "Invited", value: culture.fellow.meetingsInvited },
                  { label: "With Agenda", value: culture.fellow.meetingsWithAgenda },
                  { label: "Actions Assigned", value: culture.fellow.actionItemsAssigned },
                  { label: "Actions Done", value: culture.fellow.actionItemsCompleted },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ fontSize: "11px", color: C.sage }}>{label}</span>
                    <span style={{ fontFamily: MONO, fontSize: "11px", fontWeight: 600, color: value > 0 ? C.sageLight : C.muted }}>{value}</span>
                  </div>
                ))}
                <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "11px", color: C.sage }}>Discipline</span>
                  <span style={{
                    fontFamily: MONO, fontSize: "11px", fontWeight: 600,
                    color: culture.meetingDiscipline.score >= 80 ? C.accent : culture.meetingDiscipline.score >= 50 ? "#f5a623" : "#ef4444",
                  }}>{culture.meetingDiscipline.score}%</span>
                </div>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: "12px", color: C.muted }}>Could not load activity data</p>
          )}
        </div>
      </div>

      {/* Fellow Action Items */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
        padding: "22px 26px", position: "relative", overflow: "hidden",
        fontFamily: "'Outfit', system-ui, sans-serif",
      }}>
        <div style={{
          position: "absolute", top: 0, left: "10%", right: "10%", height: "1px",
          background: `linear-gradient(90deg, transparent, rgba(76,158,245,0.18), transparent)`,
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", left: 0, top: "6%", bottom: "6%",
          width: "3px", borderRadius: "0 3px 3px 0", background: "#4c9ef5", opacity: 0.9,
        }} />

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <span style={{
            width: "28px", height: "28px", borderRadius: "8px",
            background: "rgba(76,158,245,0.1)", border: "1px solid rgba(76,158,245,0.19)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, fontSize: "13px", color: "#4c9ef5",
          }}>☐</span>
          <span style={{
            fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em",
            textTransform: "uppercase", color: C.slate,
          }}>Fellow Action Items</span>

          {fellow && (
            <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
              {[
                { label: `All (${fellow.stats.total})`, value: "all" as FellowFilter },
                { label: `Overdue (${fellow.stats.overdue})`, value: "overdue" as FellowFilter, color: "#ef4444" },
                { label: `Duplicates (${fellow.stats.duplicates})`, value: "duplicates" as FellowFilter, color: "#f5a623" },
                { label: `Can Close (${fellow.stats.suggestComplete})`, value: "suggest" as FellowFilter, color: C.accent },
              ].map(({ label, value, color }) => (
                <button key={value} onClick={() => setFellowFilter(value)} style={{
                  padding: "2px 10px", borderRadius: "999px", fontSize: "10px", fontWeight: 600,
                  cursor: "pointer", letterSpacing: "0.02em",
                  border: `1px solid ${fellowFilter === value ? (color ?? "#4c9ef5") : C.border}`,
                  background: fellowFilter === value ? `${color ?? "#4c9ef5"}18` : "transparent",
                  color: fellowFilter === value ? (color ?? "#4c9ef5") : C.muted,
                  fontFamily: "'Outfit', system-ui, sans-serif",
                }}>{label}</button>
              ))}
            </div>
          )}
        </div>

        {/* Stats bar */}
        {fellow && (
          <div style={{
            display: "flex", gap: "16px", marginBottom: "14px", padding: "8px 12px",
            background: C.cardAlt, borderRadius: "8px", border: `1px solid ${C.border}`,
          }}>
            {[
              { label: "Open", value: fellow.stats.total, color: C.sageLight },
              { label: "Overdue", value: fellow.stats.overdue, color: "#ef4444" },
              { label: "Duplicates", value: fellow.stats.duplicates, color: "#f5a623" },
              { label: "Can Close", value: fellow.stats.suggestComplete, color: C.accent },
              { label: "Done (14d)", value: fellow.stats.recentlyDone, color: C.muted },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: "center", flex: 1 }}>
                <p style={{ fontFamily: MONO, fontSize: "16px", fontWeight: 700, color }}>{value}</p>
                <p style={{ fontSize: "9px", color: C.muted }}>{label}</p>
              </div>
            ))}
          </div>
        )}

        {fellowLoading ? (
          <div style={{
            height: 200, borderRadius: "10px", background: C.card,
            backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
            backgroundSize: "200% 100%", animation: "bm-shimmer 1.6s ease infinite",
          }} />
        ) : fellow ? (
          <div style={{ maxHeight: "400px", overflowY: "auto" }}>
            {/* Column headers */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 90px 80px 70px",
              gap: "8px", padding: "5px 8px", borderBottom: `1px solid ${C.border}`,
              position: "sticky", top: 0, background: C.card, zIndex: 1,
            }}>
              {["Action Item", "Due Date", "Flags", ""].map((h) => (
                <span key={h} style={{
                  fontSize: "9px", color: C.muted, textTransform: "uppercase",
                  letterSpacing: "0.06em", fontWeight: 700,
                }}>{h}</span>
              ))}
            </div>

            {(() => {
              const filtered = fellow.items.filter((item) => {
                if (fellowFilter === "overdue") return item.overdue
                if (fellowFilter === "duplicates") return item.isDuplicate
                if (fellowFilter === "suggest") return item.suggestComplete
                if (fellowFilter === "ai") return item.aiDetected
                return true
              })

              if (filtered.length === 0) return (
                <p style={{ padding: "24px 0", textAlign: "center", fontSize: "12px", color: C.muted }}>
                  No items in this filter
                </p>
              )

              return filtered.map((item, i) => {
                const isCompleting = completingIds.has(item.id)
                return (
                  <div key={item.id} style={{
                    display: "grid", gridTemplateColumns: "1fr 90px 80px 70px",
                    gap: "8px", alignItems: "center", padding: "8px",
                    borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : "none",
                    background: i % 2 === 0 ? "transparent" : C.cardAlt,
                    borderRadius: "4px",
                    opacity: isCompleting ? 0.4 : 1, transition: "opacity 0.3s",
                  }}>
                    {/* Text */}
                    <div style={{ minWidth: 0 }}>
                      <p style={{
                        fontSize: "12px", color: C.sage, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{item.text}</p>
                    </div>

                    {/* Due date */}
                    <span style={{
                      fontFamily: MONO, fontSize: "10px",
                      color: item.overdue ? "#ef4444" : item.dueDate ? C.slate : C.muted,
                      fontWeight: item.overdue ? 600 : 400,
                    }}>
                      {item.dueDate ?? "—"}
                    </span>

                    {/* Flags */}
                    <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
                      {item.overdue && (
                        <span style={{
                          fontSize: "8px", fontWeight: 700, padding: "1px 5px",
                          borderRadius: "999px", background: C.redDim, color: "#ef4444",
                        }}>OVERDUE</span>
                      )}
                      {item.isDuplicate && (
                        <span style={{
                          fontSize: "8px", fontWeight: 700, padding: "1px 5px",
                          borderRadius: "999px", background: "rgba(245,166,35,0.12)", color: "#f5a623",
                        }}>DUPE</span>
                      )}
                      {item.suggestComplete && (
                        <span style={{
                          fontSize: "8px", fontWeight: 700, padding: "1px 5px",
                          borderRadius: "999px", background: C.accentDim, color: C.accent,
                        }}>DONE?</span>
                      )}
                      {item.aiDetected && (
                        <span style={{
                          fontSize: "8px", fontWeight: 700, padding: "1px 5px",
                          borderRadius: "999px", background: "rgba(155,127,245,0.12)", color: "#9b7ff5",
                        }}>AI</span>
                      )}
                    </div>

                    {/* Mark done button */}
                    <button
                      disabled={isCompleting}
                      onClick={async () => {
                        setCompletingIds((prev) => new Set([...prev, item.id]))
                        try {
                          const res = await fetch("/api/dashboard/fellow/complete", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ itemId: item.id, completed: true }),
                          })
                          if (res.ok) {
                            setFellow((prev) => prev ? {
                              ...prev,
                              items: prev.items.filter((i) => i.id !== item.id),
                              stats: {
                                ...prev.stats,
                                total: prev.stats.total - 1,
                                overdue: prev.stats.overdue - (item.overdue ? 1 : 0),
                                duplicates: prev.stats.duplicates - (item.isDuplicate ? 1 : 0),
                                suggestComplete: prev.stats.suggestComplete - (item.suggestComplete ? 1 : 0),
                                recentlyDone: prev.stats.recentlyDone + 1,
                              },
                            } : null)
                          }
                        } finally {
                          setCompletingIds((prev) => { const n = new Set(prev); n.delete(item.id); return n })
                        }
                      }}
                      style={{
                        padding: "3px 10px", borderRadius: "6px", fontSize: "10px", fontWeight: 600,
                        border: `1px solid ${C.accent}40`, background: C.accentDim, color: C.accent,
                        cursor: isCompleting ? "not-allowed" : "pointer",
                        fontFamily: "'Outfit', system-ui, sans-serif",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => { if (!isCompleting) e.currentTarget.style.background = `${C.accent}30` }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = C.accentDim }}
                    >
                      {isCompleting ? "..." : "✓ Done"}
                    </button>
                  </div>
                )
              })
            })()}
          </div>
        ) : (
          <p style={{ fontSize: "12px", color: C.muted }}>Could not load Fellow data</p>
        )}
      </div>

      {/* OKR Panel */}
      <div style={{
        background:   C.card,
        border:       `1px solid ${C.border}`,
        borderRadius: "16px",
        padding:      "22px 26px",
        position:     "relative",
        overflow:     "hidden",
        fontFamily:   "'Outfit', system-ui, sans-serif",
      }}>
        {/* Top shimmer line */}
        <div style={{
          position: "absolute", top: 0, left: "10%", right: "10%", height: "1px",
          background: `linear-gradient(90deg, transparent, rgba(155,127,245,0.18), transparent)`,
          pointerEvents: "none",
        }} />
        {/* Left accent stripe */}
        <div style={{
          position: "absolute", left: 0, top: "12%", bottom: "12%",
          width: "3px", borderRadius: "0 3px 3px 0", background: "#9b7ff5", opacity: 0.9,
        }} />

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "18px" }}>
          <span style={{
            width: "28px", height: "28px", borderRadius: "8px",
            background: "rgba(155,127,245,0.1)", border: "1px solid rgba(155,127,245,0.19)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, fontSize: "13px", color: "#9b7ff5",
          }}>
            ◆
          </span>
          <span style={{
            fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em",
            textTransform: "uppercase", color: C.slate,
          }}>
            Q3 2026 OKRs
          </span>
          {okrs && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "3px",
              background: `${STATUS_COLOR[okrs.objective.status]}18`,
              color: STATUS_COLOR[okrs.objective.status],
              padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600,
              marginLeft: "auto",
            }}>
              {okrs.statusLabels[okrs.objective.status] ?? "Unknown"}
            </span>
          )}
        </div>

        {okrsLoading ? (
          <div style={{
            height: 120, borderRadius: "10px", background: C.card,
            backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
            backgroundSize: "200% 100%", animation: "bm-shimmer 1.6s ease infinite",
          }} />
        ) : okrs ? (
          <>
            {/* Objective title */}
            <p style={{
              fontSize: "14px", fontWeight: 600, color: C.sageLight,
              marginBottom: "6px", lineHeight: 1.4,
            }}>
              {okrs.objective.title}
            </p>

            {/* Objective progress */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontSize: "10px", color: C.muted }}>Overall Progress</span>
                <span style={{ fontSize: "11px", fontFamily: MONO, fontWeight: 600, color: "#9b7ff5" }}>
                  {Math.round(okrs.objective.progress)}%
                </span>
              </div>
              <div style={{ height: "3px", background: C.border, borderRadius: "99px", overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${Math.min(okrs.objective.progress, 100)}%`,
                  background: "linear-gradient(90deg, #9b7ff5, #c4b0ff)",
                  borderRadius: "99px", transition: "width 1.2s cubic-bezier(0.4,0,0.2,1)",
                }} />
              </div>
            </div>

            {/* Key Results */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {okrs.keyResults.map((kr) => {
                const color = STATUS_COLOR[kr.status] ?? C.muted
                const pct = kr.metric
                  ? Math.round(((kr.metric.current - kr.metric.start) / Math.max(kr.metric.target - kr.metric.start, 1)) * 100)
                  : Math.round(kr.progress)
                return (
                  <div key={kr.id} style={{
                    background: C.cardAlt, border: `1px solid ${C.border}`,
                    borderRadius: "10px", padding: "12px 14px",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", marginBottom: "8px" }}>
                      <p style={{ fontSize: "12px", fontWeight: 500, color: C.sage, lineHeight: 1.4, flex: 1 }}>
                        {kr.title}
                      </p>
                      <span style={{
                        display: "inline-flex", alignItems: "center",
                        background: `${color}18`, color,
                        padding: "1px 6px", borderRadius: "999px", fontSize: "9px", fontWeight: 600,
                        flexShrink: 0, whiteSpace: "nowrap",
                      }}>
                        {okrs.statusLabels[kr.status] ?? ""}
                      </span>
                    </div>

                    {kr.metric && (
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
                        <span style={{ fontFamily: MONO, fontSize: "20px", fontWeight: 700, color: C.sageLight }}>
                          {kr.metric.current}
                        </span>
                        <span style={{ fontSize: "11px", color: C.muted }}>
                          / {kr.metric.target} {kr.metric.name}
                        </span>
                      </div>
                    )}

                    <div style={{ height: "2px", background: C.border, borderRadius: "99px", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${Math.min(pct, 100)}%`,
                        background: `linear-gradient(90deg, ${color}, ${color}cc)`,
                        borderRadius: "99px", transition: "width 1s ease",
                      }} />
                    </div>
                    <p style={{ fontSize: "9px", color: C.muted, marginTop: "3px", textAlign: "right" }}>
                      {pct}%
                    </p>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <p style={{ fontSize: "12px", color: C.muted }}>Could not load OKR data</p>
        )}
      </div>

      {/* Recommendations */}
      {(() => {
        const recs = getRecommendations(culture, okrs)
        if (recs.length === 0) return null
        return (
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
            padding: "22px 26px", position: "relative", overflow: "hidden",
            fontFamily: "'Outfit', system-ui, sans-serif",
          }}>
            <div style={{
              position: "absolute", top: 0, left: "10%", right: "10%", height: "1px",
              background: `linear-gradient(90deg, transparent, rgba(5,199,155,0.18), transparent)`,
              pointerEvents: "none",
            }} />
            <div style={{
              position: "absolute", left: 0, top: "8%", bottom: "8%",
              width: "3px", borderRadius: "0 3px 3px 0", background: C.accent, opacity: 0.9,
            }} />

            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "18px" }}>
              <span style={{
                width: "28px", height: "28px", borderRadius: "8px",
                background: C.accentDim, border: `1px solid ${C.accent}30`,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, fontSize: "13px", color: C.accent,
              }}>⚡</span>
              <span style={{
                fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em",
                textTransform: "uppercase", color: C.slate,
              }}>
                Recommendations to Improve Score
              </span>
              <span style={{
                marginLeft: "auto", fontSize: "10px", color: C.muted,
              }}>
                {recs.filter((r) => (recStatuses[r.id] ?? r.status) === "pending").length} pending
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {recs.map((rec) => {
                const status = recStatuses[rec.id] ?? rec.status
                const priColor = PRIORITY_COLOR[rec.priority]
                const isDone = status === "approved" || status === "declined" || status === "done"

                return (
                  <div key={rec.id} style={{
                    background: isDone ? C.card : C.cardAlt,
                    border: `1px solid ${isDone ? C.border : priColor + "30"}`,
                    borderRadius: "10px", padding: "14px 16px",
                    opacity: status === "declined" ? 0.5 : 1,
                    transition: "opacity 0.3s, border-color 0.3s",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
                      {/* Priority chip */}
                      <span style={{
                        display: "inline-flex", alignItems: "center",
                        background: `${priColor}18`, color: priColor,
                        padding: "1px 6px", borderRadius: "999px", fontSize: "9px", fontWeight: 700,
                        textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0, marginTop: "2px",
                      }}>
                        {rec.priority}
                      </span>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: "13px", fontWeight: 600, color: C.sageLight, marginBottom: "4px", lineHeight: 1.3 }}>
                          {rec.title}
                        </p>
                        <p style={{ fontSize: "11.5px", color: C.sage, lineHeight: 1.5, marginBottom: "6px" }}>
                          {rec.description}
                        </p>
                        <p style={{ fontSize: "10px", color: C.accent, lineHeight: 1.4 }}>
                          Impact: {rec.impact}
                        </p>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${C.border}` }}>
                      {status === "pending" ? (
                        <>
                          <button
                            onClick={async () => {
                              setRecStatuses((prev) => ({ ...prev, [rec.id]: "approved" }))
                              if (rec.actionEndpoint) {
                                try {
                                  const res = await fetch(rec.actionEndpoint, { method: "POST" })
                                  const data = await res.json()
                                  setRecMessages((prev) => ({ ...prev, [rec.id]: data.message ?? "Done" }))
                                  setRecStatuses((prev) => ({ ...prev, [rec.id]: "done" }))
                                } catch {
                                  setRecMessages((prev) => ({ ...prev, [rec.id]: "Action failed — retry later" }))
                                  setRecStatuses((prev) => ({ ...prev, [rec.id]: "approved" }))
                                }
                              }
                            }}
                            style={{
                              display: "flex", alignItems: "center", gap: "5px",
                              padding: "6px 16px", borderRadius: "8px", border: `1px solid ${C.accent}40`,
                              background: C.accentDim, color: C.accent,
                              fontSize: "11px", fontWeight: 600, cursor: "pointer",
                              fontFamily: "'Outfit', system-ui, sans-serif",
                              transition: "background 0.15s, border-color 0.15s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = `${C.accent}30`; e.currentTarget.style.borderColor = C.accent }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = C.accentDim; e.currentTarget.style.borderColor = `${C.accent}40` }}
                          >
                            ✓ Approve
                          </button>
                          <button
                            onClick={() => setRecStatuses((prev) => ({ ...prev, [rec.id]: "declined" }))}
                            style={{
                              display: "flex", alignItems: "center", gap: "5px",
                              padding: "6px 16px", borderRadius: "8px", border: `1px solid ${C.border}`,
                              background: "transparent", color: C.muted,
                              fontSize: "11px", fontWeight: 600, cursor: "pointer",
                              fontFamily: "'Outfit', system-ui, sans-serif",
                              transition: "background 0.15s, color 0.15s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = C.redDim; e.currentTarget.style.color = C.red }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.muted }}
                          >
                            ✕ Decline
                          </button>
                          {!rec.actionEndpoint && (
                            <a
                              href="https://fellow.app"
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                marginLeft: "auto", fontSize: "10px", color: C.muted,
                                textDecoration: "none",
                              }}
                            >
                              Manual action ↗
                            </a>
                          )}
                          {rec.actionEndpoint && (
                            <span style={{ marginLeft: "auto", fontSize: "10px", color: C.muted }}>
                              Automated action
                            </span>
                          )}
                        </>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: "4px",
                            fontSize: "11px", fontWeight: 600,
                            color: status === "declined" ? C.red : status === "done" ? C.accent : "#f5a623",
                          }}>
                            {status === "declined" && "✕ Declined"}
                            {status === "approved" && "⏳ Running..."}
                            {status === "done" && "✓ Done"}
                          </span>
                          {recMessages[rec.id] && (
                            <span style={{ fontSize: "10px", color: C.muted, lineHeight: 1.3 }}>
                              {recMessages[rec.id]}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
