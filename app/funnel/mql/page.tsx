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
const GP_TARGET = 1_500_000
const GP_STRETCH = 1_800_000

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

type MqlDeal = {
  id: string
  name: string
  normDau: number
  pipeline: string
  owner: string
  lastActivity: string | null
}

type GpDeal = {
  id: string
  name: string
  pipeline: string
  stage: string
  amount: number
  gpAmount: number
  weight: number
  weightLabel: string
  dealGp: number
}

type GpExcluded = {
  id: string
  name: string
  pipeline: string
  stage: string
  reason: string
  amount: number
}

type GpBreakdown = {
  included: GpDeal[]
  excluded: GpExcluded[]
  includedCount: number
  excludedCount: number
  dealsWithNoAmount: number
}

type MqlData = {
  quarter: string
  mqlNormDau: number
  weightedGp: number
  rawGp: number
  dealCount: number
  stillInMql: number
  mqlDealsList: MqlDeal[]
  pipelineSplit: PipelineRow[]
  gpBreakdown: GpBreakdown
}

function fmtDau(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k"
  return n.toString()
}

function fmtMoney(n: number) {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "k"
  return "$" + n.toLocaleString("en-US")
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
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
  const [showGpSummary, setShowGpSummary] = useState(false)
  const [mqlPipelineFilter, setMqlPipelineFilter] = useState<string>("All")

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
      width:         "100%",
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "12px" }}>
        {/* Gross Profit */}
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
            Gross Profit
          </p>
          {loading ? (
            <div style={{ height: 40, width: 100, borderRadius: "8px", background: C.cardAlt }} />
          ) : error ? (
            <p style={{ fontSize: "12px", color: C.red }}>Error</p>
          ) : data && (
            <>
              <p style={{ fontSize: "36px", fontWeight: 700, lineHeight: 1, color: C.sageLight, fontFamily: MONO, letterSpacing: "-0.025em" }}>
                {fmtMoney(data.weightedGp)}
              </p>
              <p style={{ fontSize: "10px", color: C.muted, marginTop: "6px" }}>
                Pipeline: {fmtMoney(data.rawGp)}
              </p>
              <div style={{ marginTop: "10px" }}>
                <div style={{ height: "3px", background: C.border, borderRadius: "99px", overflow: "hidden", position: "relative" }}>
                  <div style={{
                    height:       "100%",
                    width:        `${Math.min((data.weightedGp / GP_STRETCH) * 100, 100)}%`,
                    background:   `linear-gradient(90deg, ${C.accent}, ${C.accent})`,
                    borderRadius: "99px",
                    transition:   "width 1.2s ease",
                  }} />
                  {/* Target marker */}
                  <div style={{
                    position:     "absolute",
                    left:         `${(GP_TARGET / GP_STRETCH) * 100}%`,
                    top:          "-2px",
                    width:        "1px",
                    height:       "7px",
                    background:   C.sage,
                    opacity:      0.5,
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                  <p style={{ fontSize: "10px", color: C.muted }}>
                    {Math.round((data.weightedGp / GP_TARGET) * 100)}% of $1.5M
                  </p>
                  <p style={{ fontSize: "10px", color: C.muted }}>
                    Stretch $1.8M
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

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

        {/* Still in MQL */}
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
            background:   C.amber,
            opacity:      0.9,
          }} />
          <p style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: "8px" }}>
            Still in MQL
          </p>
          {loading ? (
            <div style={{ height: 40, width: 40, borderRadius: "8px", background: C.cardAlt }} />
          ) : error ? (
            <p style={{ fontSize: "12px", color: C.red }}>Error</p>
          ) : data && (
            <>
              <p style={{ fontSize: "36px", fontWeight: 700, lineHeight: 1, color: C.sageLight, fontFamily: MONO, letterSpacing: "-0.025em" }}>
                {data.stillInMql}
              </p>
              <p style={{ fontSize: "10px", color: C.muted, marginTop: "6px" }}>
                {data.dealCount > 0 ? Math.round((data.stillInMql / data.dealCount) * 100) : 0}% of total MQLs
              </p>
            </>
          )}
        </div>
      </div>

      {/* Pipeline Split + Deals still in MQL */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
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

        {/* Deals still in MQL */}
        <div style={{
          background:   C.card,
          border:       `1px solid ${C.border}`,
          borderRadius: "16px",
          padding:      "22px 24px",
          overflowY:    "auto",
          maxHeight:    "600px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <p style={{
              fontSize:      "10px",
              fontWeight:    700,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color:         C.muted,
              margin:        0,
            }}>
              Deals Still in MQL {data ? `— ${mqlPipelineFilter === "All" ? data.stillInMql : data.mqlDealsList.filter((d) => d.pipeline === mqlPipelineFilter).length}` : ""}
            </p>
            {data && data.mqlDealsList.length > 0 && (
              <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
                {["All", ...Array.from(new Set(data.mqlDealsList.map((d) => d.pipeline)))].map((p) => (
                  <button
                    key={p}
                    onClick={() => setMqlPipelineFilter(p)}
                    style={{
                      padding:      "2px 8px",
                      borderRadius: "999px",
                      fontSize:     "9px",
                      fontWeight:   600,
                      cursor:       "pointer",
                      border:       `1px solid ${mqlPipelineFilter === p ? C.accent : C.border}`,
                      background:   mqlPipelineFilter === p ? C.accentDim : "transparent",
                      color:        mqlPipelineFilter === p ? C.accent : C.muted,
                      letterSpacing: "0.02em",
                      whiteSpace:   "nowrap",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ height: 48, borderRadius: "10px", background: C.cardAlt }} />
              ))}
            </div>
          ) : error ? (
            <p style={{ fontSize: "12px", color: C.red }}>Could not load data</p>
          ) : data && data.mqlDealsList.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {data.mqlDealsList.filter((d) => mqlPipelineFilter === "All" || d.pipeline === mqlPipelineFilter).map((d) => (
                <a
                  key={d.id}
                  href={`https://app.hubspot.com/contacts/5606823/deal/${d.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display:        "flex",
                    alignItems:     "center",
                    gap:            "10px",
                    padding:        "8px 10px",
                    borderRadius:   "8px",
                    background:     C.cardAlt,
                    textDecoration: "none",
                    transition:     "background 0.15s",
                    cursor:         "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.border }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = C.cardAlt }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: "12px", fontWeight: 600, color: C.sage, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.name}
                    </p>
                    <div style={{ display: "flex", gap: "8px", marginTop: "3px", fontSize: "10px", color: C.muted }}>
                      <span>{d.owner}</span>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span>{d.pipeline}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{ fontSize: "11px", fontFamily: MONO, color: C.sage, margin: 0 }}>
                      {fmtDau(d.normDau)} DAU
                    </p>
                    <p style={{ fontSize: "9px", color: C.muted, margin: 0, marginTop: "2px" }}>
                      {d.lastActivity ? `Last activity ${fmtDate(d.lastActivity)}` : "No activity"}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: "12px", color: C.muted, textAlign: "center", padding: "20px 0" }}>No deals in MQL stage</p>
          )}
        </div>
      </div>

      {/* GP Summary — On Demand */}
      {data && !loading && !error && (
        <div>
          <button
            onClick={() => setShowGpSummary((v) => !v)}
            style={{
              display:      "flex",
              alignItems:   "center",
              gap:          "6px",
              background:   "transparent",
              border:       `1px solid ${C.border}`,
              borderRadius: "10px",
              padding:      "8px 16px",
              fontSize:     "12px",
              fontWeight:   600,
              color:        C.sage,
              cursor:       "pointer",
              transition:   "border-color 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border }}
          >
            {showGpSummary ? "▾" : "▸"} GP Calculation Summary
          </button>

          {showGpSummary && (
            <div style={{
              background:   C.card,
              border:       `1px solid ${C.border}`,
              borderRadius: "16px",
              padding:      "24px",
              marginTop:    "12px",
            }}>
              <p style={{ fontSize: "14px", fontWeight: 700, color: C.sageLight, marginBottom: "6px" }}>
                Gross Profit Calculation — {data.quarter}
              </p>
              <p style={{ fontSize: "11px", color: C.muted, marginBottom: "16px" }}>
                Weighted GP: <span style={{ fontFamily: MONO, color: C.sage }}>{fmtMoney(data.weightedGp)}</span> · Pipeline: <span style={{ fontFamily: MONO, color: C.sage }}>{fmtMoney(data.rawGp)}</span> · Target: $1.5M · Stretch: $1.8M
              </p>

              {/* Rules */}
              <div style={{ background: C.cardAlt, borderRadius: "10px", padding: "14px 16px", marginBottom: "16px", fontSize: "11px", color: C.muted, lineHeight: 1.6 }}>
                <p style={{ fontWeight: 700, color: C.sage, marginBottom: "4px" }}>How this is calculated:</p>
                <p>• <strong style={{ color: C.sage }}>Weight</strong> = 1.0 if deal stage is Signed or later, otherwise the HubSpot stage probability</p>
                <p>• <strong style={{ color: C.sage }}>GP Amount</strong> = deal amount (Indirect / Mediation), or deal amount or $125k default (UA / Tricky)</p>
                <p>• <strong style={{ color: C.sage }}>Deal GP</strong> = GP Amount × Weight</p>
                <p>• <strong style={{ color: C.sage }}>QTD GP</strong> = sum of all included Deal GPs</p>
                <p>• Deals in Qualified Out / Closed Lost stages are <strong style={{ color: C.red }}>excluded</strong> from the total</p>
              </div>

              {/* Included deals table */}
              <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: "10px" }}>
                Included Deals ({data.gpBreakdown.includedCount}) — {fmtMoney(data.weightedGp)} weighted GP
              </p>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {["Deal", "Pipeline", "Stage", "Amount", "GP Amount", "Weight", "Deal GP"].map((h) => (
                        <th key={h} style={{ textAlign: h === "Deal" ? "left" : "right", padding: "6px 8px", fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.gpBreakdown.included.map((d) => (
                      <tr key={d.id} style={{ borderBottom: `1px solid ${C.border}22` }}>
                        <td style={{ padding: "6px 8px", color: C.sage }}>
                          <a
                            href={`https://app.hubspot.com/contacts/5606823/deal/${d.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: C.sage, textDecoration: "none" }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = C.accent }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = C.sage }}
                          >
                            {d.name}
                          </a>
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: C.muted, fontSize: "10px" }}>{d.pipeline}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: C.muted, fontSize: "10px" }}>{d.stage}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO, color: C.muted }}>
                          {d.amount > 0 ? fmtMoney(d.amount) : "—"}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO, color: C.sage }}>
                          {fmtMoney(d.gpAmount)}
                          {d.amount === 0 && <span style={{ fontSize: "9px", color: C.amber, marginLeft: "4px" }}>default</span>}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO, color: d.weightLabel === "Signed" ? C.accent : C.muted }}>
                          {d.weightLabel}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO, fontWeight: 600, color: C.sageLight }}>
                          {fmtMoney(d.dealGp)}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: `2px solid ${C.border}` }}>
                      <td colSpan={6} style={{ padding: "8px 8px", fontWeight: 700, color: C.sage }}>Total Weighted GP</td>
                      <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: MONO, fontWeight: 700, fontSize: "13px", color: C.accent }}>
                        {fmtMoney(data.weightedGp)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Deals with no amount */}
              {data.gpBreakdown.dealsWithNoAmount > 0 && (
                <p style={{ fontSize: "10px", color: C.amber, marginTop: "12px" }}>
                  {data.gpBreakdown.dealsWithNoAmount} non-UA deal{data.gpBreakdown.dealsWithNoAmount > 1 ? "s" : ""} with no amount set — contributing $0 to GP until amount is filled in.
                </p>
              )}

              {/* Excluded deals */}
              {data.gpBreakdown.excluded.length > 0 && (
                <>
                  <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.red, marginTop: "20px", marginBottom: "10px" }}>
                    Excluded Deals ({data.gpBreakdown.excludedCount}) — Qualified Out / Closed Lost
                  </p>
                  <p style={{ fontSize: "10px", color: C.muted, marginBottom: "10px" }}>
                    These deals entered MQL in {data.quarter} but have since been lost or qualified out. Their GP is not counted in the total. If the total GP has decreased, check here first.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {data.gpBreakdown.excluded.map((d) => (
                      <a
                        key={d.id}
                        href={`https://app.hubspot.com/contacts/5606823/deal/${d.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "6px 10px", borderRadius: "6px", background: C.cardAlt,
                          textDecoration: "none", fontSize: "11px",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ color: C.sage, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{d.name}</span>
                          <span style={{ fontSize: "9px", color: C.muted }}>{d.pipeline} · {d.stage}</span>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          {d.amount > 0 && <span style={{ fontFamily: MONO, color: C.red, fontSize: "10px" }}>-{fmtMoney(d.amount)}</span>}
                          <span style={{
                            display: "inline-block", marginLeft: "8px", padding: "1px 6px",
                            borderRadius: "999px", background: `${C.red}18`, color: C.red,
                            fontSize: "9px", fontWeight: 600,
                          }}>{d.reason}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
