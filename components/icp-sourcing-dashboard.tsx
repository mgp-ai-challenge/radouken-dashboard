"use client"

import React, { useState } from "react"
import type { ICPCandidate, ICPSourcingResponse, Vertical, EngagementTier, RecommendedAction, MMPDetected } from "@/lib/icp-sourcing"

// ─── Design system (mirrors g2-dashboard.tsx) ─────────────────────────────────
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
  blueDim:      "rgba(76,158,245,0.12)",
  purple:       "#9b7ff5",
  purpleDim:    "rgba(155,127,245,0.12)",
  green:        "#05c79b",
  greenDim:     "rgba(5,199,155,0.13)",
}

const MONO = "'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, monospace"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeDateStr(iso: string | null): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  return `${days} days ago`
}

function fmtNumber(n: number | null): string {
  if (n === null) return "—"
  return n.toLocaleString("en-US")
}

// ─── Panel ────────────────────────────────────────────────────────────────────

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

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "8px 0" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            height:          "40px",
            borderRadius:    "8px",
            background:      C.card,
            backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
            backgroundSize:  "200% 100%",
            animation:       "icp-shimmer 1.6s ease infinite",
          }}
        />
      ))}
    </div>
  )
}

// ─── MMP badge ────────────────────────────────────────────────────────────────

function MMPBadge({ value }: { value: MMPDetected }) {
  const config: Record<MMPDetected, { bg: string; color: string; label: string }> = {
    appsflyer: { bg: C.greenDim,  color: C.green,  label: "AppsFlyer" },
    adjust:    { bg: C.blueDim,   color: C.blue,   label: "Adjust"    },
    both:      { bg: C.purpleDim, color: C.purple, label: "Both"      },
    none:      { bg: C.redDim,    color: C.red,    label: "None"      },
    unknown:   { bg: C.amberDim,  color: C.amber,  label: "Unknown"   },
  }
  const { bg, color, label } = config[value]
  return (
    <span style={{
      padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600,
      background: bg, color,
    }}>
      {label}
    </span>
  )
}

// ─── Engagement badge ─────────────────────────────────────────────────────────

function EngagementBadge({ value }: { value: EngagementTier }) {
  if (value === null) return <span style={{ color: C.muted }}>—</span>
  const config: Record<NonNullable<EngagementTier>, { bg: string; color: string }> = {
    replied:    { bg: C.greenDim,  color: C.green },
    interested: { bg: C.greenDim,  color: C.green },
    clicked:    { bg: C.blueDim,   color: C.blue  },
    opened:     { bg: C.blueDim,   color: C.blue  },
    contacted:  { bg: "rgba(124,140,148,0.12)", color: C.slate },
  }
  const { bg, color } = config[value]
  return (
    <span style={{
      padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600,
      background: bg, color, textTransform: "capitalize",
    }}>
      {value}
    </span>
  )
}

// ─── Action badge ─────────────────────────────────────────────────────────────

function ActionBadge({ value }: { value: RecommendedAction }) {
  const config: Record<RecommendedAction, { bg: string; color: string; label: string }> = {
    "warm-re-approach":  { bg: C.greenDim,  color: C.green, label: "Warm Re-approach"  },
    "cold-outreach":     { bg: C.blueDim,   color: C.blue,  label: "Cold Outreach"     },
    "manual-verify-mmp": { bg: C.amberDim,  color: C.amber, label: "Verify MMP"        },
  }
  const { bg, color, label } = config[value]
  return (
    <span style={{
      padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600,
      background: bg, color,
    }}>
      {label}
    </span>
  )
}

// ─── Results table ────────────────────────────────────────────────────────────

function ResultsTable({ candidates }: { candidates: ICPCandidate[] }) {
  const TH_STYLE: React.CSSProperties = {
    textAlign: "left",
    padding: "6px 10px",
    color: C.muted,
    fontWeight: 600,
    fontSize: "10px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
  }
  const TD_STYLE: React.CSSProperties = {
    padding: "10px 10px",
    verticalAlign: "middle",
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        aria-label="ICP Candidates"
        style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}
      >
        <thead>
          <tr>
            <th scope="col" style={TH_STYLE}>App</th>
            <th scope="col" style={TH_STYLE}>Publisher</th>
            <th scope="col" style={{ ...TH_STYLE, textAlign: "right" }}>Est. US DAU</th>
            <th scope="col" style={{ ...TH_STYLE, textAlign: "center" }}>MMP Detected</th>
            <th scope="col" style={{ ...TH_STYLE, textAlign: "center" }}>Lemlist</th>
            <th scope="col" style={{ ...TH_STYLE, textAlign: "center" }}>Last Contacted</th>
            <th scope="col" style={{ ...TH_STYLE, textAlign: "center" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, i) => (
            <tr
              key={`${c.store}:${c.appId}`}
              style={{
                borderBottom: i < candidates.length - 1 ? `1px solid ${C.border}` : "none",
              }}
            >
              {/* App */}
              <td style={{ ...TD_STYLE, maxWidth: "220px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "13px", lineHeight: 1 }}>
                    {c.store === "ios" ? "🍎" : "🤖"}
                  </span>
                  <span style={{ fontWeight: 500, color: C.sageLight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.appName}
                  </span>
                  {c.storeUrl && (
                    <a
                      href={c.storeUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="View in store"
                      style={{ color: C.muted, textDecoration: "none", fontSize: "10px", flexShrink: 0 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = C.accent)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
                    >
                      ↗
                    </a>
                  )}
                </div>
              </td>
              {/* Publisher */}
              <td style={{ ...TD_STYLE, color: C.slate, maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.publisherName || "—"}
              </td>
              {/* Est. US DAU */}
              <td style={{ ...TD_STYLE, textAlign: "right", fontFamily: MONO, color: c.stEstimatedUSDAU !== null ? C.sageLight : C.muted }}>
                <span title="Sensor Tower panel estimate">
                  {fmtNumber(c.stEstimatedUSDAU)}
                </span>
              </td>
              {/* MMP Detected */}
              <td style={{ ...TD_STYLE, textAlign: "center" }}>
                <MMPBadge value={c.mmpDetected} />
              </td>
              {/* Lemlist */}
              <td style={{ ...TD_STYLE, textAlign: "center" }}>
                <EngagementBadge value={c.lemlistEngagement} />
              </td>
              {/* Last Contacted */}
              <td style={{ ...TD_STYLE, textAlign: "center", color: C.muted, fontSize: "11px" }}>
                {relativeDateStr(c.lastContactedAt)}
              </td>
              {/* Action */}
              <td style={{ ...TD_STYLE, textAlign: "center" }}>
                <ActionBadge value={c.recommendedAction} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── State types ──────────────────────────────────────────────────────────────

type VerticalState = {
  status: "idle" | "loading" | "done" | "error"
  candidates: ICPCandidate[]
  fetchedAt: string | null
  error: string | null
}

type NonCTVVertical = Exclude<Vertical, "ctv">

const NON_CTV_VERTICALS: NonCTVVertical[] = [
  "iap-gaming",
  "igaming",
  "ecommerce",
  "prediction-markets",
]

const TAB_LABELS: Record<Vertical, string> = {
  "iap-gaming":         "IAP Gaming",
  "igaming":            "iGaming",
  "ecommerce":          "E-Commerce",
  "prediction-markets": "Prediction Markets",
  "ctv":                "CTV",
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      aria-label="Loading"
      style={{
        display:      "inline-block",
        width:        "10px",
        height:       "10px",
        border:       `2px solid ${C.muted}`,
        borderTop:    `2px solid ${C.accent}`,
        borderRadius: "50%",
        animation:    "icp-spin 0.8s linear infinite",
        flexShrink:   0,
      }}
    />
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ICPSourcingDashboard() {
  const [results, setResults] = useState<Record<NonCTVVertical, VerticalState>>({
    "iap-gaming":         { status: "idle", candidates: [], fetchedAt: null, error: null },
    "igaming":            { status: "idle", candidates: [], fetchedAt: null, error: null },
    "ecommerce":          { status: "idle", candidates: [], fetchedAt: null, error: null },
    "prediction-markets": { status: "idle", candidates: [], fetchedAt: null, error: null },
  })

  const [activeTab, setActiveTab] = useState<Vertical>("iap-gaming")

  const isLoading = NON_CTV_VERTICALS.some((v) => results[v].status === "loading")

  async function handleRunSearch() {
    // Set all to loading
    setResults({
      "iap-gaming":         { status: "loading", candidates: [], fetchedAt: null, error: null },
      "igaming":            { status: "loading", candidates: [], fetchedAt: null, error: null },
      "ecommerce":          { status: "loading", candidates: [], fetchedAt: null, error: null },
      "prediction-markets": { status: "loading", candidates: [], fetchedAt: null, error: null },
    })

    const settled = await Promise.allSettled(
      NON_CTV_VERTICALS.map((vertical) =>
        fetch(`/api/icp-sourcing/${vertical}`)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            return r.json() as Promise<ICPSourcingResponse>
          })
          .then((data) => ({ vertical, data }))
      )
    )

    setResults((prev) => {
      const next = { ...prev }
      for (let i = 0; i < NON_CTV_VERTICALS.length; i++) {
        const vertical = NON_CTV_VERTICALS[i]
        const result = settled[i]
        if (result.status === "fulfilled") {
          const { data } = result.value
          next[vertical] = {
            status: "done",
            candidates: data.candidates,
            fetchedAt: data.fetchedAt,
            error: null,
          }
        } else {
          const err = result.reason
          next[vertical] = {
            status: "error",
            candidates: [],
            fetchedAt: null,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }
      return next
    })
  }

  // ── Tab badge ──────────────────────────────────────────────────────────────

  function TabBadge({ vertical }: { vertical: Vertical }) {
    if (vertical === "ctv") return null
    const state = results[vertical as NonCTVVertical]
    if (state.status === "idle") return null
    if (state.status === "loading") {
      return (
        <span style={{ marginLeft: "5px", display: "inline-flex", alignItems: "center" }}>
          <Spinner />
        </span>
      )
    }
    if (state.status === "error") {
      return (
        <span style={{ marginLeft: "5px", fontSize: "11px" }}>⚠</span>
      )
    }
    // done
    return (
      <span style={{
        marginLeft:   "5px",
        display:      "inline-flex",
        alignItems:   "center",
        justifyContent: "center",
        minWidth:     "18px",
        height:       "16px",
        padding:      "0 5px",
        borderRadius: "999px",
        fontSize:     "10px",
        fontWeight:   700,
        background:   C.accentDim,
        color:        C.accent,
        fontFamily:   MONO,
      }}>
        {state.candidates.length}
      </span>
    )
  }

  // ── Tab content ────────────────────────────────────────────────────────────

  function TabContent() {
    if (activeTab === "ctv") {
      return (
        <Panel>
          <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.muted, marginBottom: "14px" }}>
            CTV Sourcing
          </p>
          <div style={{
            background: C.cardAlt, border: `1px solid ${C.border}`,
            borderRadius: "10px", padding: "18px 20px",
            fontSize: "13px", color: C.slate, lineHeight: "1.6",
          }}>
            Source CTV candidates from Paul&apos;s partner lists — not available in Sensor Tower.
          </div>
        </Panel>
      )
    }

    const state = results[activeTab as NonCTVVertical]

    if (state.status === "idle") {
      return (
        <Panel>
          <p style={{ fontSize: "13px", color: C.muted, textAlign: "center", padding: "40px 0" }}>
            Click &ldquo;Run Search&rdquo; to load results.
          </p>
        </Panel>
      )
    }

    if (state.status === "loading") {
      return (
        <Panel>
          <SkeletonRows />
        </Panel>
      )
    }

    if (state.status === "error") {
      return (
        <Panel>
          <div style={{
            display: "flex", alignItems: "center", gap: "10px",
            padding: "18px 20px",
            background: C.redDim, border: `1px solid rgba(239,68,68,0.25)`,
            borderRadius: "10px",
            color: C.red, fontSize: "13px",
          }}>
            <span style={{ fontSize: "16px", flexShrink: 0 }}>⚠</span>
            {state.error ?? "An unknown error occurred."}
          </div>
        </Panel>
      )
    }

    // done
    if (state.candidates.length === 0) {
      return (
        <Panel>
          <p style={{ fontSize: "13px", color: C.muted, textAlign: "center", padding: "40px 0" }}>
            No candidates matched the ICP criteria for this vertical.
          </p>
        </Panel>
      )
    }

    return (
      <Panel>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.muted, margin: 0 }}>
            {TAB_LABELS[activeTab]} — {state.candidates.length} candidates
          </p>
          {state.fetchedAt && (
            <span style={{ fontSize: "11px", color: C.muted }}>
              Fetched {relativeDateStr(state.fetchedAt)}
            </span>
          )}
        </div>
        <ResultsTable candidates={state.candidates} />
      </Panel>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "32px 36px", fontFamily: "system-ui, sans-serif" }}>
      {/* Keyframes injected inline */}
      <style>{`
        @keyframes icp-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes icp-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "32px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: C.sageLight, letterSpacing: "-0.02em", margin: 0 }}>
            UA ICP Sourcing — Q3 2026
          </h1>
          <p style={{ fontSize: "12px", color: C.muted, marginTop: "6px", maxWidth: "620px", lineHeight: "1.5" }}>
            Candidates sourced from Sensor Tower, cross-referenced against Lemlist and HubSpot.
            Download and DAU figures are Sensor Tower panel estimates — not advertiser-verified.
          </p>
        </div>
        <button
          onClick={handleRunSearch}
          disabled={isLoading}
          style={{
            display:      "flex",
            alignItems:   "center",
            gap:          "8px",
            background:   isLoading ? "transparent" : C.accentDim,
            border:       `1px solid ${C.borderAccent}`,
            borderRadius: "8px",
            padding:      "9px 18px",
            color:        isLoading ? C.muted : C.accent,
            fontSize:     "13px",
            fontWeight:   600,
            cursor:       isLoading ? "not-allowed" : "pointer",
            flexShrink:   0,
            marginTop:    "4px",
          }}
        >
          {isLoading && <Spinner />}
          {isLoading ? "Searching..." : "Run Search"}
        </button>
      </div>

      {/* ── Tab row ──────────────────────────────────────────────────────────── */}
      <div style={{
        display:      "flex",
        gap:          "2px",
        borderBottom: `1px solid ${C.border}`,
        marginBottom: "20px",
      }}>
        {(["iap-gaming", "igaming", "ecommerce", "prediction-markets", "ctv"] as Vertical[]).map((v) => {
          const active = activeTab === v
          return (
            <button
              key={v}
              onClick={() => setActiveTab(v)}
              style={{
                display:       "inline-flex",
                alignItems:    "center",
                padding:       "8px 14px",
                fontSize:      "12px",
                fontWeight:    600,
                background:    "transparent",
                border:        "none",
                borderBottom:  active ? `2px solid ${C.accent}` : "2px solid transparent",
                cursor:        "pointer",
                color:         active ? C.accent : C.muted,
                marginBottom:  "-1px",
                borderRadius:  "0",
                whiteSpace:    "nowrap",
                transition:    "color 0.15s",
              }}
            >
              {TAB_LABELS[v]}
              <TabBadge vertical={v} />
            </button>
          )
        })}
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────────── */}
      <TabContent />
    </div>
  )
}
