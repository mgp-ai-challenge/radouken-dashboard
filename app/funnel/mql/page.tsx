"use client"

import { useEffect, useState, useCallback } from "react"
import { RefreshCw } from "lucide-react"

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
  blue:         "#4c9ef5",
  blueDim:      "rgba(76,158,245,0.15)",
  amber:        "#f5a623",
  purple:       "#9b7ff5",
  red:          "#ef4444",
}
const MONO = "'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, monospace"

const MQL_TARGET = 140

const PIPELINE_COLORS: Record<string, string> = {
  "1273603":   "#4c9ef5", // Bidmachine - Sales (blue)
  "145970019": "#9b7ff5", // UA: Sales & AM (purple)
  "961280":    "#05c79b", // Indirect (accent green)
  "922793129": "#f5a623", // Agentix (amber)
  "867371640": "#e83f39", // UA Tricky (red)
  "52357803":  "#00e8b0", // Sign Ups (bright green)
}

type PipelineRow = {
  pipelineId: string
  pipelineName: string
  count: number
  normDau: number
  pct: number
  deals: Array<{ id: string; name: string; normDau: number }>
}

type MqlData = {
  quarter: string
  mqlNormDau: number
  dealCount: number
  pipelineSplit: PipelineRow[]
}

function fmtDau(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k"
  return n.toString()
}

function PipelineGroup({ row, total }: { row: PipelineRow; total: number }) {
  const [open, setOpen] = useState(false)
  const color = PIPELINE_COLORS[row.pipelineId] ?? C.slate
  const barWidth = total > 0 ? (row.count / total) * 100 : 0

  return (
    <div style={{
      border:       `1px solid ${open ? color + "40" : C.border}`,
      borderRadius: "10px",
      overflow:     "hidden",
      transition:   "border-color 0.2s",
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width:      "100%",
          display:    "flex",
          alignItems: "center",
          gap:        "10px",
          padding:    "10px 14px",
          background: open ? `${color}0d` : "transparent",
          border:     "none",
          cursor:     "pointer",
          textAlign:  "left",
          transition: "background 0.2s",
        }}
      >
        <span style={{
          width:        "8px",
          height:       "8px",
          borderRadius: "50%",
          background:   color,
          flexShrink:   0,
        }} />
        <span style={{
          flex:       1,
          fontSize:   "12px",
          fontWeight: 600,
          color:      C.sage,
        }}>
          {row.pipelineName}
        </span>
        <span style={{
          fontSize:   "18px",
          fontWeight: 700,
          fontFamily: MONO,
          color:      C.sageLight,
          minWidth:   "36px",
          textAlign:  "right",
        }}>
          {row.count}
        </span>
        <span style={{
          fontSize:     "10px",
          fontWeight:   600,
          fontFamily:   MONO,
          color,
          background:   `${color}18`,
          padding:      "2px 8px",
          borderRadius: "999px",
          minWidth:     "42px",
          textAlign:    "center",
        }}>
          {row.pct}%
        </span>
        <span style={{
          fontSize: "10px",
          color:    C.muted,
        }}>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {/* Bar */}
      <div style={{ padding: "0 14px 8px", display: open ? "none" : "block" }}>
        <div style={{ height: "3px", background: C.border, borderRadius: "99px", overflow: "hidden" }}>
          <div style={{
            height:       "100%",
            width:        `${barWidth}%`,
            background:   color,
            borderRadius: "99px",
            transition:   "width 0.8s ease",
          }} />
        </div>
      </div>

      {/* Expanded deal list */}
      {open && (
        <div style={{ padding: "0 14px 12px" }}>
          <div style={{
            display:    "flex",
            gap:        "8px",
            marginBottom: "8px",
            fontSize:   "10px",
            color:      C.muted,
          }}>
            <span>Norm DAU: <span style={{ fontFamily: MONO, color: C.sage }}>{fmtDau(row.normDau)}</span></span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px", maxHeight: "200px", overflowY: "auto" }}>
            {row.deals.map((d) => (
              <a
                key={d.id}
                href={`https://app.hubspot.com/contacts/5606823/deal/${d.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "space-between",
                  padding:        "4px 8px",
                  borderRadius:   "6px",
                  background:     C.cardAlt,
                  fontSize:       "11px",
                  textDecoration: "none",
                  transition:     "background 0.15s",
                  cursor:         "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.border }}
                onMouseLeave={(e) => { e.currentTarget.style.background = C.cardAlt }}
              >
                <span style={{ color: C.sage, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.name}
                </span>
                <span style={{ fontFamily: MONO, fontSize: "10px", color: C.muted, flexShrink: 0, marginLeft: "8px" }}>
                  {fmtDau(d.normDau)} DAU
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function MqlPage() {
  const [data, setData] = useState<MqlData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await fetch("/api/dashboard/mql-dau", { cache: "no-store" })
      if (!res.ok) throw new Error()
      const json = await res.json()
      if (!json.error) setData(json)
      else setError(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div style={{
      display:       "flex",
      flexDirection: "column",
      gap:           "16px",
      maxWidth:      "900px",
      width:         "100%",
      margin:        "0 auto",
      padding:       "32px 24px",
      fontFamily:    "'Outfit', system-ui, sans-serif",
      color:         C.sage,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{
            fontSize:      "22px",
            fontWeight:    700,
            letterSpacing: "-0.02em",
            color:         C.sageLight,
            margin:        0,
          }}>
            MQLs to Sales
          </h1>
          {data && (
            <p style={{ fontSize: "11px", color: C.muted, marginTop: "4px" }}>
              {data.quarter} — Target: {MQL_TARGET} MQLs (at least 20 UA)
            </p>
          )}
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          style={{
            display:      "flex",
            alignItems:   "center",
            gap:          "5px",
            background:   "transparent",
            border:       `1px solid ${C.border}`,
            borderRadius: "8px",
            padding:      "6px 14px",
            fontSize:     "11.5px",
            fontWeight:   500,
            color:        C.slate,
            cursor:       refreshing ? "not-allowed" : "pointer",
            opacity:      refreshing ? 0.5 : 1,
          }}
        >
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Top KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
        {/* MQL Count */}
        <div style={{
          background:   C.card,
          border:       `1px solid ${C.border}`,
          borderRadius: "14px",
          padding:      "20px 22px",
          position:     "relative",
          overflow:     "hidden",
        }}>
          <div style={{
            position:     "absolute",
            left:         0, top: "18%", bottom: "18%",
            width:        "3px",
            borderRadius: "0 3px 3px 0",
            background:   C.blue,
            opacity:      0.9,
          }} />
          <p style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: "8px" }}>
            Total MQLs
          </p>
          {loading ? (
            <div style={{ height: 40, width: 80, borderRadius: "8px", background: C.cardAlt }} />
          ) : error ? (
            <p style={{ fontSize: "12px", color: C.red }}>Error</p>
          ) : data && (
            <>
              <p style={{ fontSize: "36px", fontWeight: 700, lineHeight: 1, color: C.sageLight, fontFamily: MONO, letterSpacing: "-0.025em" }}>
                {data.dealCount}
              </p>
              <div style={{ marginTop: "12px" }}>
                <div style={{ height: "3px", background: C.border, borderRadius: "99px", overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min((data.dealCount / MQL_TARGET) * 100, 100)}%`,
                    background: `linear-gradient(90deg, ${C.blue}, #7bb8ff)`,
                    borderRadius: "99px",
                    transition: "width 1.2s ease",
                  }} />
                </div>
                <p style={{ fontSize: "10px", color: C.muted, marginTop: "4px" }}>
                  {Math.round((data.dealCount / MQL_TARGET) * 100)}% of {MQL_TARGET} target
                </p>
              </div>
            </>
          )}
        </div>

        {/* Norm DAU */}
        <div style={{
          background:   C.card,
          border:       `1px solid ${C.border}`,
          borderRadius: "14px",
          padding:      "20px 22px",
          position:     "relative",
          overflow:     "hidden",
        }}>
          <div style={{
            position:     "absolute",
            left:         0, top: "18%", bottom: "18%",
            width:        "3px",
            borderRadius: "0 3px 3px 0",
            background:   C.accent,
            opacity:      0.9,
          }} />
          <p style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: "8px" }}>
            MQL Norm DAU
          </p>
          {loading ? (
            <div style={{ height: 40, width: 100, borderRadius: "8px", background: C.cardAlt }} />
          ) : error ? (
            <p style={{ fontSize: "12px", color: C.red }}>Error</p>
          ) : data && (
            <p style={{ fontSize: "36px", fontWeight: 700, lineHeight: 1, color: C.sageLight, fontFamily: MONO, letterSpacing: "-0.025em" }}>
              {fmtDau(data.mqlNormDau)}
            </p>
          )}
        </div>

        {/* Pipelines count */}
        <div style={{
          background:   C.card,
          border:       `1px solid ${C.border}`,
          borderRadius: "14px",
          padding:      "20px 22px",
          position:     "relative",
          overflow:     "hidden",
        }}>
          <div style={{
            position:     "absolute",
            left:         0, top: "18%", bottom: "18%",
            width:        "3px",
            borderRadius: "0 3px 3px 0",
            background:   C.purple,
            opacity:      0.9,
          }} />
          <p style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: "8px" }}>
            Pipelines
          </p>
          {loading ? (
            <div style={{ height: 40, width: 40, borderRadius: "8px", background: C.cardAlt }} />
          ) : error ? (
            <p style={{ fontSize: "12px", color: C.red }}>Error</p>
          ) : data && (
            <p style={{ fontSize: "36px", fontWeight: 700, lineHeight: 1, color: C.sageLight, fontFamily: MONO, letterSpacing: "-0.025em" }}>
              {data.pipelineSplit.length}
            </p>
          )}
        </div>
      </div>

      {/* Pipeline Split */}
      <div style={{
        background:   C.card,
        border:       `1px solid ${C.border}`,
        borderRadius: "16px",
        padding:      "22px 24px",
      }}>
        <p style={{
          fontSize:      "10px",
          fontWeight:    700,
          letterSpacing: "0.13em",
          textTransform: "uppercase",
          color:         C.muted,
          marginBottom:  "14px",
        }}>
          MQL Split by Pipeline {data ? `— ${data.quarter}` : ""}
        </p>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ height: 48, borderRadius: "10px", background: C.cardAlt }} />
            ))}
          </div>
        ) : error ? (
          <p style={{ fontSize: "12px", color: C.red }}>Could not load pipeline data</p>
        ) : data && data.pipelineSplit.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {data.pipelineSplit.map((row) => (
              <PipelineGroup key={row.pipelineId} row={row} total={data.dealCount} />
            ))}
          </div>
        ) : (
          <p style={{ fontSize: "12px", color: C.muted, textAlign: "center", padding: "20px 0" }}>No MQL data</p>
        )}
      </div>
    </div>
  )
}
