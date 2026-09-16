"use client"

import { useEffect, useState, useCallback } from "react"

type BlogAttribution = {
  totalDeals: number
  blogFirstTouch: number
  blogLastTouch: number
  blogAnyTouch: number
  blogPct: number
  monthlyData: Array<{ month: string; count: number }>
  blogDeals: Array<{ id: string; name: string; createDate: string; touchType: string }>
}

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
}
const MONO = "'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, monospace"

export default function BlogAttributionPage() {
  const [data, setData] = useState<BlogAttribution | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/blog-attribution")
      if (!res.ok) return
      const d = await res.json()
      if (!d.error) setData(d)
      setLastRefreshed(new Date())
    } catch {}
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div style={{ fontFamily: "'Outfit', system-ui, sans-serif", display: "flex", flexDirection: "column", gap: "14px", color: C.sage }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap');
        @keyframes bm-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: C.sageLight, letterSpacing: "-0.015em", margin: 0 }}>
            Blog Content Attribution
          </h1>
          <p style={{ fontSize: "11.5px", color: C.muted, marginTop: "3px" }}>
            {new Date().getFullYear()} YTD · First-touch & Last-touch · HubSpot
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {lastRefreshed && (
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: C.muted }}>
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: C.accent, display: "inline-block" }} />
              Last sync {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => { setRefreshing(true); fetchData() }}
            disabled={refreshing}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              background: "transparent", border: `1px solid ${C.border}`, borderRadius: "8px",
              padding: "6px 14px", fontSize: "11.5px", fontWeight: 500, color: C.slate,
              cursor: refreshing ? "not-allowed" : "pointer", opacity: refreshing ? 0.5 : 1,
              fontFamily: "'Outfit', system-ui, sans-serif",
            }}
          >
            {refreshing ? "Refreshing..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{
          height: 300, borderRadius: "16px", background: C.card,
          backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
          backgroundSize: "200% 100%", animation: "bm-shimmer 1.6s ease infinite",
        }} />
      ) : data ? (
        <>
          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
            {[
              { label: "Total Deals YTD", value: data.totalDeals, color: C.sageLight },
              { label: "Blog First-Touch", value: data.blogFirstTouch, color: C.accent },
              { label: "Blog Last-Touch", value: data.blogLastTouch, color: "#4c9ef5" },
              { label: "Blog Attribution %", value: `${data.blogPct}%`, color: C.accent },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
                padding: "22px 26px", position: "relative", overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute", top: 0, left: "10%", right: "10%", height: "1px",
                  background: `linear-gradient(90deg, transparent, ${C.borderAccent}, transparent)`,
                  pointerEvents: "none",
                }} />
                <p style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: "10px" }}>
                  {label}
                </p>
                <p style={{ fontFamily: MONO, fontSize: "38px", fontWeight: 700, color, lineHeight: 1, letterSpacing: "-0.025em" }}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Monthly Trend */}
          {data.monthlyData.length > 0 && (
            <div style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
              padding: "22px 26px", position: "relative", overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", top: 0, left: "10%", right: "10%", height: "1px",
                background: `linear-gradient(90deg, transparent, ${C.borderAccent}, transparent)`,
                pointerEvents: "none",
              }} />
              <p style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: "16px" }}>
                Monthly Blog First-Touch Deals
              </p>
              <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "120px" }}>
                {(() => {
                  const max = Math.max(...data.monthlyData.map((d) => d.count), 1)
                  return data.monthlyData.map((d) => (
                    <div key={d.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "11px", fontFamily: MONO, fontWeight: 600, color: C.accent }}>
                        {d.count}
                      </span>
                      <div style={{
                        width: "100%", maxWidth: "48px",
                        height: `${Math.max((d.count / max) * 80, 3)}px`,
                        background: `linear-gradient(180deg, ${C.accent}, ${C.accent}60)`,
                        borderRadius: "4px 4px 0 0",
                      }} />
                      <span style={{ fontSize: "10px", color: C.muted }}>
                        {new Date(d.month + "-01").toLocaleDateString("en-US", { month: "short" })}
                      </span>
                    </div>
                  ))
                })()}
              </div>
            </div>
          )}

          {/* Deals Table */}
          {data.blogDeals.length > 0 && (
            <div style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
              padding: "22px 26px", position: "relative", overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", top: 0, left: "10%", right: "10%", height: "1px",
                background: `linear-gradient(90deg, transparent, ${C.borderAccent}, transparent)`,
                pointerEvents: "none",
              }} />
              <p style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: "12px" }}>
                Blog-Attributed Deals ({data.blogDeals.length} most recent)
              </p>

              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 80px", gap: "8px", padding: "5px 8px", borderBottom: `1px solid ${C.border}` }}>
                {["Deal", "Created", "Touch Type"].map((h) => (
                  <span key={h} style={{ fontSize: "9px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{h}</span>
                ))}
              </div>

              {data.blogDeals.map((deal, i) => (
                <div key={deal.id} style={{
                  display: "grid", gridTemplateColumns: "1fr 90px 80px",
                  gap: "8px", alignItems: "center", padding: "8px",
                  borderBottom: i < data.blogDeals.length - 1 ? `1px solid ${C.border}` : "none",
                  background: i % 2 === 0 ? "transparent" : C.cardAlt, borderRadius: "4px",
                }}>
                  <span style={{ fontSize: "12px", color: C.sage, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {deal.name}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: "10px", color: C.muted }}>
                    {deal.createDate}
                  </span>
                  <span style={{
                    fontSize: "9px", fontWeight: 700, padding: "2px 8px", borderRadius: "999px",
                    textAlign: "center",
                    background: deal.touchType.includes("first") ? C.accentDim : "rgba(76,158,245,0.15)",
                    color: deal.touchType.includes("first") ? C.accent : "#4c9ef5",
                  }}>
                    {deal.touchType === "first+last" ? "FIRST+LAST" : deal.touchType === "first" ? "FIRST" : "LAST"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Caveat */}
          <p style={{ fontSize: "10px", color: C.muted, lineHeight: 1.5, fontStyle: "italic", padding: "0 4px" }}>
            First-touch: contact&apos;s first page seen (hs_analytics_first_url) contains &quot;blog&quot;.
            Last-touch: contact&apos;s last page seen (hs_analytics_last_url). Multi-touch attribution
            (blog as any touchpoint in the journey) requires HubSpot Journey Builder or raw page-view event analysis.
          </p>
        </>
      ) : (
        <p style={{ fontSize: "12px", color: C.muted }}>Could not load blog attribution data</p>
      )}
    </div>
  )
}
