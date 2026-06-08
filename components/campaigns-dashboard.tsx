"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from "recharts"
import type { DiscoveredCampaign, CampaignStats } from "@/lib/lemlist"
import type { AttributionResponse, TrickyAttribution } from "@/lib/hubspot-campaigns"

// ─── Design system (matches g2-dashboard.tsx) ────────────────────────────────
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
  slateDim:     "rgba(124,140,148,0.10)",
  amber:        "#f5a623",
  amberDim:     "rgba(245,166,35,0.12)",
  red:          "#ef4444",
  redDim:       "rgba(239,68,68,0.12)",
  blue:         "#4c9ef5",
  blueDim:      "rgba(76,158,245,0.12)",
  green:        "#1D9E75",
  greenDim:     "rgba(29,158,117,0.12)",
  grid:         "rgba(5,199,155,0.045)",
}
const MONO = "'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, monospace"

function pct(n: number, d: number) {
  if (!d) return "0%"
  return (n / d * 100).toFixed(1) + "%"
}

function Panel({ children, style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: "16px", padding: "22px",
      position: "relative", overflow: "hidden", ...style,
    }} {...rest}>
      <div style={{
        position: "absolute", top: 0, left: "10%", right: "10%", height: "1px",
        background: `linear-gradient(90deg, transparent, ${C.borderAccent}, transparent)`,
        pointerEvents: "none",
      }} />
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.muted, marginBottom: "18px" }}>
      {children}
    </p>
  )
}

function LoadingSkeleton({ h = 120 }: { h?: number }) {
  return (
    <div style={{
      height: h, borderRadius: "10px", background: C.card,
      backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
      backgroundSize: "200% 100%", animation: "bm-shimmer 1.6s ease infinite",
    }} />
  )
}

function DataError({ message }: { message: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: C.muted, fontSize: "12px", padding: "16px 0" }}>
      <AlertCircle size={14} color={C.red} />
      {message}
    </div>
  )
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function CampaignKpiCard({ campaign, totalLeads, leadCountsErr }: { campaign: DiscoveredCampaign; totalLeads: number | null; leadCountsErr?: string | null }) {
  const s = campaign.stats
  const delivered = s?.nbContacted ?? 0
  return (
    <Panel style={{ borderLeft: `3px solid ${campaign.color}` }}>
      <p style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.slate, marginBottom: "14px" }}>
        {campaign.label}
      </p>
      {campaign.error ? (
        <DataError message={campaign.error} />
      ) : !s ? (
        <LoadingSkeleton h={80} />
      ) : (
        <>
          {totalLeads === null && leadCountsErr
            ? <DataError message="Lead count unavailable" />
            : totalLeads === null
              ? <LoadingSkeleton h={32} />
              : <p style={{ fontSize: "36px", fontWeight: 700, lineHeight: 1, color: C.sageLight, fontFamily: MONO, letterSpacing: "-0.025em", marginBottom: "2px" }}>{totalLeads.toLocaleString()}</p>
          }
          {totalLeads !== null && (
            <p style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>leads in campaign</p>
          )}
          {totalLeads !== null && (s.nbCompleted > 0 || s.nbActive > 0) && (
            <p style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>
              <span style={{ color: C.sage }}>{s.nbCompleted.toLocaleString()} finished</span>
              {s.nbActive > 0 && <span style={{ color: campaign.color }}> · {s.nbActive.toLocaleString()} active</span>}
              {totalLeads - s.nbCompleted - s.nbActive > 0 && <span> · {(totalLeads - s.nbCompleted - s.nbActive).toLocaleString()} not started</span>}
            </p>
          )}
          <p style={{ fontSize: "13px", color: campaign.color, fontWeight: 600, marginBottom: "2px" }}>
            {s.nbEmailsSent.toLocaleString()} sent · {delivered.toLocaleString()} delivered
          </p>
          <p style={{ fontSize: "13px", color: C.sage }}>
            {(s.openRate * 100).toFixed(1)}% open · {(s.clickRate * 100).toFixed(1)}% click
          </p>
        </>
      )}
    </Panel>
  )
}

// ─── Funnel panel ─────────────────────────────────────────────────────────────
function FunnelStep({ label, count, pctLabel, color, maxCount }: {
  label: string; count: number; pctLabel: string; color: string; maxCount: number
}) {
  const width = maxCount > 0 ? Math.max((count / maxCount) * 100, 4) : 4
  return (
    <div style={{ marginBottom: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "10px", fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
        <span style={{ fontSize: "11px", color: C.sage, fontFamily: MONO }}>{count.toLocaleString()} <span style={{ color: C.muted }}>({pctLabel})</span></span>
      </div>
      <div style={{ height: "8px", background: C.cardAlt, borderRadius: "4px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${width}%`, background: color, borderRadius: "4px", transition: "width 0.4s ease" }} />
      </div>
    </div>
  )
}

function FunnelPanel({ campaign }: { campaign: DiscoveredCampaign }) {
  const s = campaign.stats
  if (campaign.error) return <Panel><SectionLabel>{campaign.label}</SectionLabel><DataError message={campaign.error} /></Panel>
  if (!s) return <Panel><SectionLabel>{campaign.label}</SectionLabel><LoadingSkeleton h={160} /></Panel>

  const sent    = s.nbEmailsSent
  const reached = s.nbContacted
  const opened  = s.nbEmailsOpened
  const clicked = s.nbEmailsClicked

  return (
    <Panel>
      <SectionLabel>{campaign.label}</SectionLabel>
      <FunnelStep label="Sent"      count={sent}    pctLabel="100%"                    color={campaign.color} maxCount={sent} />
      <FunnelStep label="Delivered" count={reached} pctLabel={pct(reached, sent)}      color={campaign.color} maxCount={sent} />
      <FunnelStep label="Opened"    count={opened}  pctLabel={pct(opened, reached)}    color={campaign.color} maxCount={sent} />
      <FunnelStep label="Clicked"   count={clicked}       pctLabel={pct(clicked, reached)}       color={campaign.color} maxCount={sent} />
      <FunnelStep label="Replied"   count={s.nbReplied}   pctLabel={pct(s.nbReplied, reached)}   color={campaign.color} maxCount={sent} />
    </Panel>
  )
}

// ─── Stats table ──────────────────────────────────────────────────────────────
function StatRow({ label, count, rate, note, highlight }: {
  label: string; count: string | number; rate?: string; note?: string
  highlight?: "mql" | "sql" | "note"
}) {
  const bg = highlight === "mql" ? C.greenDim : highlight === "sql" ? C.blueDim : highlight === "note" ? "transparent" : "transparent"
  return (
    <tr style={{ borderBottom: `1px solid ${C.border}`, background: bg }}>
      <td style={{ padding: "8px 10px", fontSize: "12px", color: highlight === "note" ? C.muted : C.sage, fontStyle: highlight === "note" ? "italic" : "normal" }}>
        {label}
      </td>
      <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: MONO, fontSize: "12px", color: C.sageLight, fontWeight: 600 }}>
        {typeof count === "number" ? count.toLocaleString() : count}
      </td>
      <td style={{ padding: "8px 10px", textAlign: "right", fontSize: "11px", color: C.muted }}>{rate ?? "—"}</td>
      <td style={{ padding: "8px 10px", fontSize: "11px", color: C.muted, fontStyle: "italic" }}>{note ?? ""}</td>
    </tr>
  )
}

function StatsTable({
  campaign, attribution, sentCount, totalLeads,
}: {
  campaign: DiscoveredCampaign
  attribution?: { mqls: { company: string }[]; sqls: { company: string; stageLabel: string }[] } | null
  sentCount?: number
  totalLeads?: number | null
}) {
  const s = campaign.stats
  if (campaign.error) return <Panel style={{ marginBottom: "24px" }}><SectionLabel>{campaign.label} — Detail</SectionLabel><DataError message={campaign.error} /></Panel>
  if (!s) return <Panel style={{ marginBottom: "24px" }}><SectionLabel>{campaign.label} — Detail</SectionLabel><LoadingSkeleton h={200} /></Panel>

  const reached = s.nbContacted
  const sent    = sentCount ?? s.nbContacted

  return (
    <Panel style={{ marginBottom: "24px" }}>
      <SectionLabel>{campaign.label} — Detail</SectionLabel>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Metric", "Count", "Rate", "Note"].map((h) => (
                <th key={h} style={{ padding: "6px 10px", textAlign: h === "Metric" ? "left" : h === "Note" ? "left" : "right", color: C.muted, fontWeight: 600, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <StatRow label="Leads in campaign"  count={totalLeads ?? sentCount ?? 0}         />
            <StatRow label="Leads reached"       count={reached}           rate={pct(reached, sentCount ?? 0)}          />
            <StatRow label="Messages sent"       count={s.nbEmailsSent}    note="Multi-step sequence"              />
            <StatRow label="Opened"              count={s.nbEmailsOpened}  rate={pct(s.nbEmailsOpened, reached)}   />
            <StatRow label="Clicked"             count={s.nbEmailsClicked} rate={pct(s.nbEmailsClicked, reached)}  />
            <StatRow label="Replied"             count={s.nbReplied}       rate={pct(s.nbReplied, reached)}        />
            <StatRow label="Unsubscribed"        count={s.nbUnsubscribed}  rate={pct(s.nbUnsubscribed, reached)}   />
            <StatRow label="Bounced"             count={s.nbEmailsBounced} rate={pct(s.nbEmailsBounced, reached)}  />
            {attribution && (
              <>
                <StatRow
                  label="MQLs matched"
                  count={attribution.mqls.length}
                  rate={pct(attribution.mqls.length, sent)}
                  note={attribution.mqls.map((d) => d.company).join(", ")}
                  highlight="mql"
                />
                <StatRow
                  label="SQLs matched"
                  count={attribution.sqls.length}
                  rate={pct(attribution.sqls.length, sent)}
                  note={attribution.sqls.map((d) => `${d.company} (${d.stageLabel})`).join(", ")}
                  highlight="sql"
                />
                <StatRow label="Attribution" count="—" note="Company name fuzzy match vs HubSpot Tricky pipeline" highlight="note" />
              </>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ─── Comparison chart ─────────────────────────────────────────────────────────
function ComparisonChart({ campaigns }: { campaigns: DiscoveredCampaign[] }) {
  const ready = campaigns.filter((c) => c.stats)
  if (ready.length === 0) return <Panel style={{ marginBottom: "24px" }}><SectionLabel>Open & Click Rate Comparison</SectionLabel><LoadingSkeleton h={160} /></Panel>

  const data = ready.map((c) => ({
    name:      c.label,
    openRate:  parseFloat((c.stats!.openRate * 100).toFixed(1)),
    clickRate: parseFloat((c.stats!.clickRate * 100).toFixed(1)),
    replyRate: parseFloat((c.stats!.nbReplied / Math.max(c.stats!.nbContacted, 1) * 100).toFixed(1)),
    color:     c.color,
  }))

  return (
    <Panel style={{ marginBottom: "24px" }}>
      <SectionLabel>Open &amp; Click Rate Comparison</SectionLabel>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
          <YAxis dataKey="name" type="category" width={170} tick={{ fill: C.sage, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "11px" }}
            labelStyle={{ color: C.sage }}
            formatter={(v: number | string | ReadonlyArray<number | string> | undefined) => [`${v ?? 0}%`]}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: "11px", color: C.muted, paddingTop: "12px" }} />
          <Bar dataKey="openRate"  name="Open Rate"  radius={[0, 4, 4, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} opacity={0.85} />)}
          </Bar>
          <Bar dataKey="clickRate" name="Click Rate" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} opacity={0.45} />)}
          </Bar>
          <Bar dataKey="replyRate" name="Reply Rate" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} opacity={0.25} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ─── Lead Status breakdown panel ──────────────────────────────────────────────
type Bucket = { key: keyof CampaignStats; label: string; color: string; dimColor: string }
const BUCKETS: Bucket[] = [
  { key: "nbActive",        label: "Active",     color: "campaignColor", dimColor: "campaignDim" },
  { key: "nbCompleted",     label: "Completed",  color: C.accent,        dimColor: C.accentDim   },
  { key: "nbReplied",       label: "Replied",    color: C.amber,         dimColor: C.amberDim    },
  { key: "nbEmailsBounced", label: "Bounced",    color: C.red,           dimColor: C.redDim      },
  { key: "nbUnsubscribed",  label: "Unsub",      color: C.slate,         dimColor: C.slateDim    },
]

function LeadStatusPanel({ campaigns }: { campaigns: DiscoveredCampaign[] }) {
  const ready = campaigns.filter((c): c is DiscoveredCampaign & { stats: CampaignStats } => c.stats !== null)
  if (campaigns.length > 0 && ready.length === 0) {
    return (
      <Panel style={{ marginBottom: "24px" }}>
        <SectionLabel>Lead Status Breakdown</SectionLabel>
        <LoadingSkeleton h={100} />
      </Panel>
    )
  }
  if (ready.length === 0) return null

  return (
    <Panel style={{ marginBottom: "24px" }}>
      <SectionLabel>Lead Status Breakdown</SectionLabel>
      <p style={{ fontSize: "10px", color: C.muted, marginBottom: "16px", fontStyle: "italic" }}>
        Signal counts — not mutually exclusive
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {ready.map((c) => (
          <div key={c.key}>
            <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: c.color, marginBottom: "8px" }}>
              {c.label}
            </p>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {BUCKETS.map((b) => {
                const count    = (c.stats[b.key] as number) ?? 0
                const color    = b.color    === "campaignColor" ? c.color : b.color
                const dimColor = b.dimColor === "campaignDim"   ? `${c.color}1f` : b.dimColor
                return (
                  <span key={b.key} style={{ padding: "4px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 600, background: dimColor, color }}>
                    {count.toLocaleString()} {b.label}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ─── MQL Attribution panel ────────────────────────────────────────────────────
function CompanyChip({ company, type }: { company: string; type: "MQL" | "SQL" | "LOST" }) {
  const color = type === "MQL" ? C.green : type === "SQL" ? C.blue : C.slate
  const bg    = type === "MQL" ? C.greenDim : type === "SQL" ? C.blueDim : C.slateDim
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: bg, color, margin: "2px" }}>
      {company}
    </span>
  )
}

function MqlColumn({
  label, color, attrib, sentCount,
}: {
  label: string; color: string; attrib: TrickyAttribution | null; sentCount: number | null
}) {
  if (!attrib || sentCount === null) return <LoadingSkeleton h={160} />
  const sent = sentCount
  return (
    <div>
      <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color, marginBottom: "12px" }}>{label}</p>
      <p style={{ fontSize: "28px", fontWeight: 700, fontFamily: MONO, color: C.sageLight, marginBottom: "2px" }}>{attrib.mqls.length}</p>
      <p style={{ fontSize: "11px", color: C.muted, marginBottom: "8px" }}>MQLs — {pct(attrib.mqls.length, sent)} of sent</p>
      <p style={{ fontSize: "22px", fontWeight: 700, fontFamily: MONO, color: C.blue, marginBottom: "2px" }}>{attrib.sqls.length}</p>
      <p style={{ fontSize: "11px", color: C.muted, marginBottom: "14px" }}>SQLs — {pct(attrib.sqls.length, sent)} of sent</p>
      <div style={{ marginBottom: "8px" }}>
        {attrib.mqls.map((d) => <CompanyChip key={d.dealId} company={d.company} type="MQL" />)}
        {attrib.sqls.map((d) => <CompanyChip key={d.dealId} company={d.company} type="SQL" />)}
        {attrib.lost.map((d) => <CompanyChip key={d.dealId} company={d.company} type="LOST" />)}
      </div>
    </div>
  )
}

// ─── Replied companies panel ───────────────────────────────────────────────────
function RepliedPanel({
  attrib,
  attribErr,
  campaigns,
}: {
  attrib: AttributionResponse | null
  attribErr: string | null
  campaigns: DiscoveredCampaign[]
}) {
  return (
    <Panel style={{ marginBottom: "24px" }}>
      <SectionLabel>Replied Companies</SectionLabel>
      {!attrib && !attribErr ? (
        <LoadingSkeleton h={100} />
      ) : attribErr ? (
        <DataError message={attribErr} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px" }}>
          {(
            [
              { key: "nc"      as const, replied: attrib!.ncReplied      },
              { key: "cu"      as const, replied: attrib!.cuReplied      },
              { key: "inbound" as const, replied: attrib!.inboundReplied },
            ]
          ).map(({ key, replied }) => {
            const campaign = campaigns.find((c) => c.key === key)
            return (
              <div key={key}>
                <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: campaign?.color ?? C.muted, marginBottom: "8px" }}>
                  {campaign?.label ?? key}
                </p>
                <p style={{ fontSize: "22px", fontWeight: 700, fontFamily: MONO, color: C.amber, lineHeight: 1, marginBottom: "4px" }}>
                  {replied.length}
                </p>
                <p style={{ fontSize: "11px", color: C.muted, marginBottom: "10px" }}>replied</p>
                {replied.length === 0 ? (
                  <p style={{ fontSize: "11px", color: C.muted, fontStyle: "italic" }}>No replies yet</p>
                ) : (
                  <div>
                    {replied.map((r) => (
                      <span key={r.email} style={{ display: "inline-block", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: C.amberDim, color: C.amber, margin: "2px" }}>
                        {r.company}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function CampaignsDashboard() {
  const [campaigns,  setCampaigns]  = useState<DiscoveredCampaign[]>([])
  const [statsErr,   setStatsErr]   = useState<string | null>(null)
  const [attrib,     setAttrib]     = useState<AttributionResponse | null>(null)
  const [attribErr,  setAttribErr]  = useState<string | null>(null)
  const [leadCounts,    setLeadCounts]    = useState<{ nc: number; cu: number; inbound: number } | null>(null)
  const [leadCountsErr, setLeadCountsErr] = useState<string | null>(null)
  const [syncing,       setSyncing]       = useState(false)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const attribAbortRef = useRef<AbortController | null>(null)
  const syncGenRef     = useRef(0)

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/campaigns/stats")
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json() as { campaigns: DiscoveredCampaign[] }
    setCampaigns(data.campaigns)
    return data.campaigns
  }, [])

  const loadLeadCounts = useCallback(async (camps: DiscoveredCampaign[]): Promise<{ nc: number; cu: number; inbound: number } | null> => {
    const nc      = camps.find((c) => c.key === "nc")?.id
    const cu      = camps.find((c) => c.key === "cu")?.id
    const inbound = camps.find((c) => c.key === "inbound")?.id
    if (!nc || !cu || !inbound) return null
    const res = await fetch(`/api/campaigns/lead-counts?nc=${nc}&cu=${cu}&inbound=${inbound}`)
    if (!res.ok) throw new Error(await res.text())
    return await res.json() as { nc: number; cu: number; inbound: number }
  }, [])

  const loadAttribution = useCallback(async (camps: DiscoveredCampaign[]) => {
    const nc      = camps.find((c) => c.key === "nc")?.id
    const cu      = camps.find((c) => c.key === "cu")?.id
    const inbound = camps.find((c) => c.key === "inbound")?.id
    if (!nc || !cu || !inbound) {
      setAttribErr("One or more campaign IDs missing — skipping attribution")
      return
    }
    const ctrl = new AbortController()
    attribAbortRef.current = ctrl
    const res = await fetch("/api/campaigns/attribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nc, cu, inbound }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json() as AttributionResponse
    setAttrib(data)
  }, [])

  const fetchAll = useCallback(() => {
    attribAbortRef.current?.abort()
    const gen = ++syncGenRef.current
    setSyncing(true)
    setCampaigns([])
    setStatsErr(null)
    setAttrib(null)
    setAttribErr(null)
    setLeadCounts(null)
    setLeadCountsErr(null)

    // Stats are fast — stop syncing indicator once they load
    loadStats()
      .then((camps) => {
        if (syncGenRef.current !== gen) return
        setSyncing(false)
        setLastSynced(new Date())
        // Lead counts (~10s) then attribution (~5min) — sequential to respect rate limits
        loadLeadCounts(camps)
          .then(
            (counts) => { if (syncGenRef.current !== gen) return; if (counts) setLeadCounts(counts) },
            (err)    => { if (syncGenRef.current !== gen) return; console.error("[campaigns/lead-counts]", err); setLeadCountsErr(String(err)) },
          )
          .then(() => { if (syncGenRef.current !== gen) return; return new Promise<void>((r) => setTimeout(r, 500)) })
          .then(() => { if (syncGenRef.current !== gen) return; return loadAttribution(camps) })
          .catch((err) => {
            if ((err as Error).name === "AbortError") return
            console.error("[campaigns/attribution]", err)
            setAttribErr(String(err))
          })
      })
      .catch((err) => {
        console.error("[campaigns/stats]", err)
        setStatsErr(String(err))
        setSyncing(false)
        setLastSynced(new Date())
      })
  }, [loadStats, loadLeadCounts, loadAttribution])

  // Initial load
  useEffect(() => { fetchAll() }, [fetchAll])


  const nc      = campaigns.find((c) => c.key === "nc")      ?? null
  const cu      = campaigns.find((c) => c.key === "cu")      ?? null
  const inbound = campaigns.find((c) => c.key === "inbound") ?? null

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "32px 36px", fontFamily: "system-ui, sans-serif" }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: C.sageLight, letterSpacing: "-0.02em", margin: 0 }}>Campaigns</h1>
          <p style={{ fontSize: "12px", color: C.muted, marginTop: "4px" }}>Lemlist funnel stats + HubSpot MQL/SQL attribution</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {lastSynced && <span style={{ fontSize: "11px", color: C.muted }}>Synced {lastSynced.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>}
          <button onClick={fetchAll} disabled={syncing} style={{ display: "flex", alignItems: "center", gap: "6px", background: "transparent", border: `1px solid ${C.borderAccent}`, borderRadius: "8px", padding: "7px 14px", color: syncing ? C.muted : C.accent, fontSize: "12px", fontWeight: 600, cursor: syncing ? "not-allowed" : "pointer" }}>
            <RefreshCw size={12} strokeWidth={2.5} style={{ animation: syncing ? "g2-spin 1s linear infinite" : "none" }} />
            {syncing ? "Syncing…" : "Sync"}
          </button>
        </div>
      </div>

      {/* ── Info banner ─────────────────────────────────────────────────────── */}
      <div style={{ background: "rgba(76,158,245,0.08)", border: `1px solid rgba(76,158,245,0.2)`, borderRadius: "10px", padding: "10px 16px", marginBottom: "24px", fontSize: "11px", color: C.blue, lineHeight: 1.5 }}>
        Live data from Lemlist + HubSpot. Stats load in ~1s · Lead counts in ~10s · MQL attribution in ~5 min. Use Sync to refresh.
      </div>

      {statsErr && <div style={{ marginBottom: "20px" }}><DataError message={statsErr} /></div>}

      {/* ── KPI row ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", marginBottom: "24px" }}>
        {campaigns.length === 0 ? (
          [0,1,2].map((i) => <LoadingSkeleton key={i} h={130} />)
        ) : (
          campaigns.map((c) => (
            <CampaignKpiCard
              key={c.key}
              campaign={c}
              totalLeads={leadCounts?.[c.key as "nc" | "cu" | "inbound"] ?? null}
              leadCountsErr={leadCountsErr}
            />
          ))
        )}
      </div>

      {/* ── Funnel row ──────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", marginBottom: "24px" }}>
        {campaigns.length === 0 ? (
          [0,1,2].map((i) => <Panel key={i}><LoadingSkeleton h={160} /></Panel>)
        ) : (
          campaigns.map((c) => <FunnelPanel key={c.key} campaign={c} />)
        )}
      </div>

      {/* ── Stats tables ────────────────────────────────────────────────────── */}
      {nc && (
        <StatsTable
          campaign={nc}
          attribution={attrib ? { mqls: attrib.nc.mqls, sqls: attrib.nc.sqls } : null}
          sentCount={attrib?.sentCounts.nc}
          totalLeads={leadCounts?.nc}
        />
      )}
      {cu && (
        <StatsTable
          campaign={cu}
          attribution={attrib ? { mqls: attrib.cu.mqls, sqls: attrib.cu.sqls } : null}
          sentCount={attrib?.sentCounts.cu}
          totalLeads={leadCounts?.cu}
        />
      )}
      {inbound && (
        <StatsTable
          campaign={inbound}
          totalLeads={leadCounts?.inbound}
          sentCount={attrib?.sentCounts.inbound}
        />
      )}

      {/* ── Comparison chart ────────────────────────────────────────────────── */}
      <ComparisonChart campaigns={campaigns} />

      {/* ── Lead Status breakdown ───────────────────────────────────────────── */}
      <LeadStatusPanel campaigns={campaigns} />

      {/* ── MQL Attribution panel ───────────────────────────────────────────── */}
      <Panel style={{ marginBottom: "24px" }}>
        <SectionLabel>MQL Attribution — Tricky Pipeline</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px" }}>
          <MqlColumn
            label="Non-Customers"
            color="#378ADD"
            attrib={attrib?.nc ?? null}
            sentCount={attrib?.sentCounts.nc ?? null}
          />
          <MqlColumn
            label="Customers"
            color="#534AB7"
            attrib={attrib?.cu ?? null}
            sentCount={attrib?.sentCounts.cu ?? null}
          />
        </div>
        {attrib && (
          <p style={{ fontSize: "11px", color: C.muted, fontStyle: "italic", marginTop: "16px", borderTop: `1px solid ${C.border}`, paddingTop: "12px" }}>
            {attrib.combined.mqls.length} unique MQLs across both campaigns
            {attrib.combined.totalTrickyDeals > 0 && ` = ${pct(attrib.combined.mqls.length, attrib.combined.totalTrickyDeals)} of all ${attrib.combined.totalTrickyDeals} Tricky pipeline deals`}
          </p>
        )}
        {attribErr && <DataError message={attribErr} />}
      </Panel>

      {/* ── Replied companies panel ─────────────────────────────────────────── */}
      <RepliedPanel attrib={attrib} attribErr={attribErr} campaigns={campaigns} />

      {/* ── Inbound attribution panel ───────────────────────────────────────── */}
      <Panel>
        <SectionLabel>Inbound Form Submission Attribution</SectionLabel>
        {!attrib && !attribErr ? (
          <LoadingSkeleton h={80} />
        ) : attribErr ? (
          <DataError message={attribErr} />
        ) : (
          <div style={{ display: "flex", gap: "32px", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div>
              <p style={{ fontSize: "38px", fontWeight: 700, fontFamily: MONO, color: C.sageLight, lineHeight: 1, marginBottom: "4px" }}>
                {attrib!.inbound.matchedCount}
              </p>
              <p style={{ fontSize: "11px", color: C.muted }}>
                form submissions matched — {pct(attrib!.inbound.matchedCount, attrib!.inbound.totalInboundDeals)} of {attrib!.inbound.totalInboundDeals} Q2 inbound deals
              </p>
            </div>
            <div>
              <p style={{ fontSize: "38px", fontWeight: 700, fontFamily: MONO, color: C.accent, lineHeight: 1, marginBottom: "4px" }}>
                {pct(attrib!.inbound.matchedCount, attrib!.sentCounts?.inbound ?? 1)}
              </p>
              <p style={{ fontSize: "11px", color: C.muted }}>
                of {attrib!.sentCounts.inbound.toLocaleString()} Inbound sent leads
              </p>
            </div>
            {attrib!.inbound.skippedDeals > 0 && (
              <p style={{ fontSize: "11px", color: C.muted, fontStyle: "italic", alignSelf: "flex-end" }}>
                ({attrib!.inbound.skippedDeals} deals skipped — contact email fetch failed)
              </p>
            )}
          </div>
        )}
      </Panel>
    </div>
  )
}
