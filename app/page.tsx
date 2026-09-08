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

export default function DashboardPage() {
  const [ssKpis, setSsKpis] = useState<SelfServeKpis | null>(null)
  const [ssKpisLoading, setSsKpisLoading] = useState(true)
  const [mqlDau, setMqlDau] = useState<MqlDau | null>(null)
  const [mqlDauLoading, setMqlDauLoading] = useState(true)

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
    </div>
  )
}
