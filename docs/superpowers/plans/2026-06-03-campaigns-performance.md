# Campaigns Performance Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a live Campaigns Performance dashboard showing Lemlist campaign funnel stats, MQL/SQL attribution against the HubSpot Tricky pipeline, and Inbound email form-submission matching — all pulled live with no hardcoded values.

**Architecture:** Two Next.js API routes (`/api/campaigns/stats` for fast discovery+stats, `/api/campaigns/attribution` for slow paginated leads + HubSpot matching) feed a single client dashboard component that renders progressively. Matching logic lives in server-side lib files to keep the component thin. Design mirrors `components/g2-dashboard.tsx` exactly: same `C` color tokens, `Panel`, `KpiCard`, `LoadingSkeleton` inline-style system.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Recharts 3, Lemlist Data API, HubSpot CRM API v3, existing dark fintech design system.

---

## Files

**Create:**
- `lib/lemlist.ts` — Lemlist API client + TARGET_CAMPAIGNS constant + rate-limited paginated lead fetch
- `lib/hubspot-campaigns.ts` — HubSpot deal fetching, TRICKY_STAGES map, MQL/SQL fuzzy match, Inbound email match
- `app/api/campaigns/stats/route.ts` — GET: discover campaigns + fetch per-campaign stats in parallel
- `app/api/campaigns/attribution/route.ts` — POST: paginated leads + HubSpot deals + run matching
- `components/campaigns-dashboard.tsx` — full dashboard component
- `app/campaigns/page.tsx` — page entry point

**Modify:**
- `components/app-sidebar.tsx` — add "Campaigns" nav link

---

## Shared types reference (used across all tasks)

```typescript
// From lib/lemlist.ts
export interface CampaignStats {
  nbLeads: number
  nbContacted: number
  nbEmailsSent: number
  nbEmailsOpened: number
  openRate: number        // decimal 0-1
  nbEmailsClicked: number
  clickRate: number
  nbEmailsBounced: number
  bounceRate: number
  nbUnsubscribed: number
  nbReplied: number
}

export interface LemlistLead {
  email: string
  companyName: string | null
  firstName: string | null
  lastName: string | null
}

export interface DiscoveredCampaign {
  key: 'nc' | 'cu' | 'inbound'
  id: string | null   // null = not found in Lemlist
  label: string
  color: string
  stats: CampaignStats | null
  error: string | null
}

// From lib/hubspot-campaigns.ts
export interface MatchedDeal {
  dealId: string
  company: string
  stageLabel: string
  stageType: 'MQL' | 'SQL' | 'LOST'
}

export interface TrickyAttribution {
  mqls: MatchedDeal[]
  sqls: MatchedDeal[]
  lost: MatchedDeal[]
}

// app/api/campaigns/stats/route.ts response
export interface StatsResponse {
  campaigns: DiscoveredCampaign[]
}

// app/api/campaigns/attribution/route.ts — request body
interface AttributionRequest {
  nc: string
  cu: string
  inbound: string
}

// app/api/campaigns/attribution/route.ts — response
export interface AttributionResponse {
  sentCounts: { nc: number; cu: number; inbound: number }
  nc: TrickyAttribution
  cu: TrickyAttribution
  combined: {
    mqls: MatchedDeal[]
    sqls: MatchedDeal[]
    lost: MatchedDeal[]
    totalTrickyDeals: number
  }
  inbound: {
    matchedCount: number
    totalInboundDeals: number
    skippedDeals: number
  }
}
```

---

## Task 1: Lemlist API client

**Files:**
- Create: `lib/lemlist.ts`

- [ ] **Step 1: Write the file**

```typescript
// lib/lemlist.ts

const LL_BASE = "https://api.lemlist.com/api"

export const TARGET_CAMPAIGNS = [
  { key: "nc"      as const, match: "Non Customers", label: "Tricky — Non-Customers", color: "#378ADD" },
  { key: "cu"      as const, match: "Q2 Customers",  label: "Tricky — Customers",     color: "#534AB7" },
  { key: "inbound" as const, match: "Inbound",       label: "Inbound SDK",            color: "#1D9E75" },
]

export type CampaignKey = "nc" | "cu" | "inbound"

export interface CampaignStats {
  nbLeads: number
  nbContacted: number
  nbEmailsSent: number
  nbEmailsOpened: number
  openRate: number
  nbEmailsClicked: number
  clickRate: number
  nbEmailsBounced: number
  bounceRate: number
  nbUnsubscribed: number
  nbReplied: number
}

export interface LemlistLead {
  email: string
  companyName: string | null
  firstName: string | null
  lastName: string | null
}

export interface DiscoveredCampaign {
  key: CampaignKey
  id: string | null
  label: string
  color: string
  stats: CampaignStats | null
  error: string | null
}

async function llFetch(path: string): Promise<unknown> {
  const key = process.env.LEMLIST_API_KEY
  if (!key) throw new Error("LEMLIST_API_KEY is not set")
  const res = await fetch(`${LL_BASE}${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(key + ":").toString("base64")}` },
    cache: "no-store",
  })
  if (res.status === 401) throw new Error("Lemlist 401 — Check LEMLIST_API_KEY")
  if (res.status === 429) {
    const retry = res.headers.get("Retry-After") ?? "10"
    throw new Error(`Lemlist 429 — Rate limited — retry in ${retry}s`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Lemlist ${path} → ${res.status}${body ? ": " + body.slice(0, 200) : ""}`)
  }
  return res.json()
}

export async function fetchAllCampaigns(): Promise<Array<{ _id: string; name: string }>> {
  const data = await llFetch("/campaigns")
  return (data as Array<{ _id: string; name: string }>) ?? []
}

export async function fetchCampaignStats(campaignId: string): Promise<CampaignStats> {
  const data = await llFetch(`/campaigns/${campaignId}/stats`) as Record<string, unknown>
  return {
    nbLeads:          Number(data.nbLeads ?? 0),
    nbContacted:      Number(data.nbContacted ?? 0),
    nbEmailsSent:     Number(data.nbEmailsSent ?? 0),
    nbEmailsOpened:   Number(data.nbEmailsOpened ?? 0),
    openRate:         Number(data.openRate ?? 0),
    nbEmailsClicked:  Number(data.nbEmailsClicked ?? 0),
    clickRate:        Number(data.clickRate ?? 0),
    nbEmailsBounced:  Number(data.nbEmailsBounced ?? 0),
    bounceRate:       Number(data.bounceRate ?? 0),
    nbUnsubscribed:   Number(data.nbUnsubscribed ?? 0),
    nbReplied:        Number(data.nbReplied ?? 0),
  }
}

// Paginate all leads for a campaign, 100ms delay between pages (10 req/sec limit)
// Returns only leads where sentAt is set (isSent = true)
export async function fetchAllLeads(campaignId: string): Promise<LemlistLead[]> {
  const results: LemlistLead[] = []
  const limit = 100
  let offset = 0

  while (true) {
    const data = await llFetch(`/campaigns/${campaignId}/leads?limit=${limit}&offset=${offset}`)
    const page = data as Array<Record<string, unknown>>
    if (!Array.isArray(page) || page.length === 0) break

    for (const l of page) {
      if (l.sentAt) {
        results.push({
          email:       String(l.email ?? ""),
          companyName: l.companyName ? String(l.companyName) : null,
          firstName:   l.firstName  ? String(l.firstName)  : null,
          lastName:    l.lastName   ? String(l.lastName)   : null,
        })
      }
    }

    if (page.length < limit) break
    offset += limit
    await new Promise((r) => setTimeout(r, 100))
  }

  return results
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/radustoia/outbound-attribution && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors for `lib/lemlist.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/lemlist.ts
git commit -m "feat(campaigns): add Lemlist API client with paginated lead fetch"
```

---

## Task 2: HubSpot campaigns attribution logic

**Files:**
- Create: `lib/hubspot-campaigns.ts`

- [ ] **Step 1: Write the file**

```typescript
// lib/hubspot-campaigns.ts

export interface MatchedDeal {
  dealId: string
  company: string
  stageLabel: string
  stageType: "MQL" | "SQL" | "LOST"
}

export interface TrickyAttribution {
  mqls: MatchedDeal[]
  sqls: MatchedDeal[]
  lost: MatchedDeal[]
}

export const TRICKY_STAGES: Record<string, { label: string; type: "MQL" | "SQL" | "LOST" }> = {
  "1298083688": { label: "Qualified for UA", type: "MQL" },
  "1321645224": { label: "New MQL",          type: "MQL" },
  "1333172311": { label: "First Meeting",    type: "SQL" },
  "1333172312": { label: "Legal",            type: "SQL" },
  "1298083693": { label: "Qualified Out",    type: "LOST" },
}

const HS_BASE = "https://api.hubapi.com"

async function hsFetch(path: string, body?: unknown): Promise<unknown> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not set")
  const res = await fetch(`${HS_BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  })
  if (res.status === 401) throw new Error("HubSpot 401 — Check HUBSPOT_ACCESS_TOKEN")
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HubSpot ${path} → ${res.status}${text ? ": " + text.slice(0, 200) : ""}`)
  }
  return res.json()
}

interface HsDeal { id: string; properties: Record<string, string | null> }

// Paginate all deals from a HubSpot search using `after` cursor
async function fetchAllDeals(body: Record<string, unknown>): Promise<HsDeal[]> {
  const all: HsDeal[] = []
  let after: string | undefined

  while (true) {
    const payload = after ? { ...body, after } : body
    const data = await hsFetch("/crm/v3/objects/deals/search", payload) as {
      results: HsDeal[]
      paging?: { next?: { after: string } }
    }
    all.push(...(data.results ?? []))
    after = data.paging?.next?.after
    if (!after) break
  }

  return all
}

// Fetch all Tricky pipeline deals where lead_source = 'Q2 2026 MQL'
export async function fetchTrickyDeals(): Promise<{ deals: HsDeal[]; total: number }> {
  const body = {
    filterGroups: [{
      filters: [
        { propertyName: "pipeline",    operator: "EQ", value: "867371640" },
        { propertyName: "lead_source", operator: "EQ", value: "Q2 2026 MQL" },
      ],
    }],
    properties: ["dealname", "dealstage", "createdate"],
    limit: 100,
  }
  const deals = await fetchAllDeals(body)
  return { deals, total: deals.length }
}

// Fetch all Inbound pipeline deals created since 2026-04-01
export async function fetchInboundDeals(): Promise<HsDeal[]> {
  const body = {
    filterGroups: [{
      filters: [
        { propertyName: "pipeline",   operator: "EQ",  value: "52357803" },
        { propertyName: "createdate", operator: "GTE", value: "1743465600000" },
      ],
    }],
    properties: ["dealname", "dealstage"],
    limit: 100,
  }
  return fetchAllDeals(body)
}

// Fetch contact IDs associated with a deal, then resolve their emails
// emailCache: Map<contactId, email> — mutated in place to avoid re-fetching
export async function fetchDealContactEmails(
  dealId: string,
  emailCache: Map<string, string>,
): Promise<string[]> {
  const assocData = await hsFetch(
    `/crm/v3/objects/deals/${dealId}/associations/contacts`
  ) as { results: Array<{ id: string }> }

  const contactIds = (assocData.results ?? []).map((r) => r.id)
  const emails: string[] = []

  for (const cid of contactIds) {
    if (emailCache.has(cid)) {
      const cached = emailCache.get(cid)!
      if (cached) emails.push(cached)
      continue
    }
    try {
      const contact = await hsFetch(
        `/crm/v3/objects/contacts/${cid}?properties=email`
      ) as { properties: { email?: string } }
      const email = contact.properties.email ?? ""
      emailCache.set(cid, email)
      if (email) emails.push(email)
    } catch {
      emailCache.set(cid, "")  // mark as failed so we don't retry
    }
  }

  return emails
}

// Company name fuzzy match: both strings must be >= 4 chars and one contains the other
function companyMatch(a: string, b: string): boolean {
  const na = a.toLowerCase().trim()
  const nb = b.toLowerCase().trim()
  return na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))
}

// Run MQL/SQL/LOST attribution for a set of sent leads against Tricky deals
export function matchTrickyDeals(
  leads: Array<{ companyName: string | null }>,
  deals: HsDeal[],
): TrickyAttribution {
  const mqls: MatchedDeal[] = []
  const sqls: MatchedDeal[] = []
  const lost: MatchedDeal[] = []

  for (const deal of deals) {
    const stage = TRICKY_STAGES[deal.properties.dealstage ?? ""]
    if (!stage) continue

    // dealname format: "CompanyName from PersonName requests Bidmachine"
    const hsCompany = (deal.properties.dealname ?? "").split(" from ")[0]

    const matched = leads.some((l) => l.companyName && companyMatch(hsCompany, l.companyName))
    if (!matched) continue

    const entry: MatchedDeal = {
      dealId:     deal.id,
      company:    hsCompany,
      stageLabel: stage.label,
      stageType:  stage.type,
    }
    if (stage.type === "MQL")  mqls.push(entry)
    if (stage.type === "SQL")  sqls.push(entry)
    if (stage.type === "LOST") lost.push(entry)
  }

  return { mqls, sqls, lost }
}

// Deduplicate MatchedDeals from two attributions by dealId
export function dedupeDeals(a: MatchedDeal[], b: MatchedDeal[]): MatchedDeal[] {
  const seen = new Set<string>()
  return [...a, ...b].filter((d) => {
    if (seen.has(d.dealId)) return false
    seen.add(d.dealId)
    return true
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors for `lib/hubspot-campaigns.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/hubspot-campaigns.ts
git commit -m "feat(campaigns): add HubSpot attribution logic with fuzzy company matching"
```

---

## Task 3: Stats API route

**Files:**
- Create: `app/api/campaigns/stats/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// app/api/campaigns/stats/route.ts
import { NextResponse } from "next/server"
import {
  TARGET_CAMPAIGNS,
  fetchAllCampaigns,
  fetchCampaignStats,
  type DiscoveredCampaign,
} from "@/lib/lemlist"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const allCampaigns = await fetchAllCampaigns()

    // Match each target by substring
    const discovered = TARGET_CAMPAIGNS.map((target) => {
      const found = allCampaigns.find((c) => c.name.includes(target.match))
      return {
        key:   target.key,
        id:    found?._id ?? null,
        label: target.label,
        color: target.color,
      }
    })

    // Fetch stats for all found campaigns in parallel
    const withStats: DiscoveredCampaign[] = await Promise.all(
      discovered.map(async (c) => {
        if (!c.id) {
          return { ...c, stats: null, error: `Campaign not found by name — check Lemlist (match: "${TARGET_CAMPAIGNS.find(t => t.key === c.key)?.match}")` }
        }
        try {
          const stats = await fetchCampaignStats(c.id)
          return { ...c, stats, error: null }
        } catch (err) {
          return { ...c, stats: null, error: String(err) }
        }
      })
    )

    return NextResponse.json({ campaigns: withStats })
  } catch (err) {
    console.error("[campaigns/stats]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify route resolves**

```bash
curl -s http://localhost:3000/api/campaigns/stats | python3 -m json.tool | head -40
```

Expected: JSON with `campaigns` array, each entry having `key`, `id`, `label`, `color`, `stats` or `error`.

- [ ] **Step 3: Commit**

```bash
git add app/api/campaigns/stats/route.ts
git commit -m "feat(campaigns): add GET /api/campaigns/stats — discovery + parallel stats fetch"
```

---

## Task 4: Attribution API route

**Files:**
- Create: `app/api/campaigns/attribution/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// app/api/campaigns/attribution/route.ts
import { NextResponse } from "next/server"
import { fetchAllLeads }    from "@/lib/lemlist"
import {
  fetchTrickyDeals,
  fetchInboundDeals,
  fetchDealContactEmails,
  matchTrickyDeals,
  dedupeDeals,
  type TrickyAttribution,
} from "@/lib/hubspot-campaigns"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json() as { nc: string; cu: string; inbound: string }
    const { nc: ncId, cu: cuId, inbound: inboundId } = body

    // ── Step 1: Fetch all leads (paginated, rate-limited) ──────────────────
    const [ncLeads, cuLeads, inboundLeads] = await Promise.all([
      fetchAllLeads(ncId),
      fetchAllLeads(cuId),
      fetchAllLeads(inboundId),
    ])

    // ── Step 2: Fetch HubSpot deals (parallel) ────────────────────────────
    const [{ deals: trickyDeals, total: totalTrickyDeals }, inboundDeals] = await Promise.all([
      fetchTrickyDeals(),
      fetchInboundDeals(),
    ])

    // ── Step 3: MQL attribution (Tricky campaigns) ────────────────────────
    const ncAttrib  = matchTrickyDeals(ncLeads,  trickyDeals)
    const cuAttrib  = matchTrickyDeals(cuLeads,  trickyDeals)

    const combined = {
      mqls: dedupeDeals(ncAttrib.mqls, cuAttrib.mqls),
      sqls: dedupeDeals(ncAttrib.sqls, cuAttrib.sqls),
      lost: dedupeDeals(ncAttrib.lost, cuAttrib.lost),
      totalTrickyDeals,
    }

    // ── Step 4: Inbound email match ───────────────────────────────────────
    const inboundEmailSet = new Set(inboundLeads.map((l) => l.email.toLowerCase()))
    const emailCache = new Map<string, string>()
    let matchedCount = 0
    let skippedDeals = 0

    for (const deal of inboundDeals) {
      try {
        const emails = await fetchDealContactEmails(deal.id, emailCache)
        if (emails.some((e) => inboundEmailSet.has(e.toLowerCase()))) {
          matchedCount++
        }
      } catch {
        skippedDeals++
      }
    }

    return NextResponse.json({
      sentCounts: { nc: ncLeads.length, cu: cuLeads.length, inbound: inboundLeads.length },
      nc:  ncAttrib,
      cu:  cuAttrib,
      combined,
      inbound: {
        matchedCount,
        totalInboundDeals: inboundDeals.length,
        skippedDeals,
      },
    })
  } catch (err) {
    console.error("[campaigns/attribution]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify route compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Quick smoke test (requires campaign IDs from stats route)**

```bash
# First get campaign IDs
STATS=$(curl -s http://localhost:3000/api/campaigns/stats)
echo $STATS | python3 -c "import json,sys; d=json.load(sys.stdin); [print(c['key'], c['id']) for c in d['campaigns']]"
```

- [ ] **Step 4: Commit**

```bash
git add app/api/campaigns/attribution/route.ts
git commit -m "feat(campaigns): add POST /api/campaigns/attribution — leads + HubSpot MQL/Inbound matching"
```

---

## Task 5: Dashboard component — shell, banner, KPI cards, funnels

**Files:**
- Create: `components/campaigns-dashboard.tsx`

This task creates the component file with: design tokens, shared primitives, state/fetch logic, info banner, KPI card row, and funnel panels.

- [ ] **Step 1: Write the component (part 1 — up through funnel panels)**

```typescript
"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from "recharts"
import type { DiscoveredCampaign } from "@/lib/lemlist"
import type { AttributionResponse } from "@/app/api/campaigns/attribution/route"

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
function CampaignKpiCard({ campaign }: { campaign: DiscoveredCampaign }) {
  const s = campaign.stats
  const leadsReached = s?.nbContacted ?? 0
  const nbLeads      = s?.nbLeads ?? 0
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
          <p style={{ fontSize: "36px", fontWeight: 700, lineHeight: 1, color: C.sageLight, fontFamily: MONO, letterSpacing: "-0.025em", marginBottom: "8px" }}>
            {s.nbLeads.toLocaleString()}
          </p>
          <p style={{ fontSize: "11px", color: C.muted, marginBottom: "4px" }}>leads in campaign</p>
          <p style={{ fontSize: "13px", color: campaign.color, fontWeight: 600, marginBottom: "2px" }}>
            {leadsReached.toLocaleString()} reached ({pct(leadsReached, nbLeads)})
          </p>
          <p style={{ fontSize: "13px", color: C.sage }}>
            {(s.openRate * 100).toFixed(1)}% open rate
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

  const max = s.nbLeads
  const reached = s.nbContacted
  const opened  = s.nbEmailsOpened
  const clicked = s.nbEmailsClicked

  return (
    <Panel>
      <SectionLabel>{campaign.label}</SectionLabel>
      <FunnelStep label="Leads"   count={max}     pctLabel="100%"                    color={campaign.color} maxCount={max} />
      <FunnelStep label="Reached" count={reached} pctLabel={pct(reached, max)}       color={campaign.color} maxCount={max} />
      <FunnelStep label="Opened"  count={opened}  pctLabel={pct(opened, reached)}    color={campaign.color} maxCount={max} />
      <FunnelStep label="Clicked" count={clicked} pctLabel={pct(clicked, reached)}   color={campaign.color} maxCount={max} />
    </Panel>
  )
}
```

Note: The file continues in Task 6. Do NOT close the module yet — keep it open.

- [ ] **Step 2: Commit (partial — will expand in next tasks)**

This task only creates the design primitives and first panels. Continue to Task 6 before testing the component as a whole.

---

## Task 6: Dashboard component — stats tables, comparison chart, main component

**Files:**
- Modify: `components/campaigns-dashboard.tsx` (append to what Task 5 started)

- [ ] **Step 1: Append stats tables, comparison chart, and main component body**

Append to `components/campaigns-dashboard.tsx`:

```typescript
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
  campaign, attribution, sentCount,
}: {
  campaign: DiscoveredCampaign
  attribution?: { mqls: { company: string }[]; sqls: { company: string; stageLabel: string }[] } | null
  sentCount?: number
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
            <StatRow label="Leads in campaign"  count={s.nbLeads}         />
            <StatRow label="Leads reached"       count={reached}           rate={pct(reached, s.nbLeads)}          />
            <StatRow label="Messages sent"       count={s.nbEmailsSent}    note="Multi-step sequence"              />
            <StatRow label="Opened"              count={s.nbEmailsOpened}  rate={pct(s.nbEmailsOpened, reached)}   />
            <StatRow label="Clicked"             count={s.nbEmailsClicked} rate={pct(s.nbEmailsClicked, reached)}  />
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
    color:     c.color,
  }))

  return (
    <Panel style={{ marginBottom: "24px" }}>
      <SectionLabel>Open &amp; Click Rate Comparison</SectionLabel>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
          <YAxis dataKey="name" type="category" width={170} tick={{ fill: C.sage, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "11px" }}
            labelStyle={{ color: C.sage }}
            formatter={(v: number) => [`${v}%`]}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: "11px", color: C.muted, paddingTop: "12px" }} />
          <Bar dataKey="openRate"  name="Open Rate"  radius={[0, 4, 4, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} opacity={0.85} />)}
          </Bar>
          <Bar dataKey="clickRate" name="Click Rate" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} opacity={0.45} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ─── MQL Attribution panel ────────────────────────────────────────────────────
function CompanyChip({ company, type }: { company: string; type: "MQL" | "SQL" | "LOST" }) {
  const color = type === "MQL" ? C.green : type === "SQL" ? C.blue : C.slate
  const bg    = type === "MQL" ? C.greenDim : type === "SQL" ? C.blueDim : "rgba(124,140,148,0.10)"
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: bg, color, margin: "2px" }}>
      {company}
    </span>
  )
}

function MqlColumn({
  label, color, attrib, sentCount, totalTrickyDeals,
}: {
  label: string; color: string; attrib: { mqls: { dealId: string; company: string; stageType: string }[]; sqls: { dealId: string; company: string; stageLabel: string; stageType: string }[]; lost: { dealId: string; company: string; stageType: string }[] } | null; sentCount: number | null; totalTrickyDeals: number
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

// ─── Main component ───────────────────────────────────────────────────────────
export function CampaignsDashboard() {
  const [campaigns, setCampaigns] = useState<DiscoveredCampaign[]>([])
  const [statsErr,  setStatsErr]  = useState<string | null>(null)
  const [attrib,    setAttrib]    = useState<AttributionResponse | null>(null)
  const [attribErr, setAttribErr] = useState<string | null>(null)
  const [syncing,   setSyncing]   = useState(false)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const attribAbortRef = useRef<AbortController | null>(null)

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/campaigns/stats")
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json() as { campaigns: DiscoveredCampaign[] }
    setCampaigns(data.campaigns)
    return data.campaigns
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
    setSyncing(true)
    setCampaigns([])
    setStatsErr(null)
    setAttrib(null)
    setAttribErr(null)

    loadStats()
      .then((camps) => loadAttribution(camps))
      .catch((err) => {
        if ((err as Error).name === "AbortError") return
        console.error("[campaigns]", err)
        setAttribErr(String(err))
      })
      .finally(() => { setSyncing(false); setLastSynced(new Date()) })
  }, [loadStats, loadAttribution])

  // Initial load
  useEffect(() => { fetchAll() }, [fetchAll])

  // 5-minute auto-refresh
  useEffect(() => {
    const id = setInterval(() => { fetchAll() }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchAll])

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
        Live data from Lemlist + HubSpot. Refreshes every 5 min. Open/click rates = % of leads reached. MQL attribution = company name fuzzy match against HubSpot Tricky pipeline.
      </div>

      {statsErr && <div style={{ marginBottom: "20px" }}><DataError message={statsErr} /></div>}

      {/* ── KPI row ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", marginBottom: "24px" }}>
        {campaigns.length === 0 ? (
          [0,1,2].map((i) => <LoadingSkeleton key={i} h={130} />)
        ) : (
          campaigns.map((c) => <CampaignKpiCard key={c.key} campaign={c} />)
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
        />
      )}
      {cu && (
        <StatsTable
          campaign={cu}
          attribution={attrib ? { mqls: attrib.cu.mqls, sqls: attrib.cu.sqls } : null}
          sentCount={attrib?.sentCounts.cu}
        />
      )}
      {inbound && (
        <StatsTable campaign={inbound} />
      )}

      {/* ── Comparison chart ────────────────────────────────────────────────── */}
      <ComparisonChart campaigns={campaigns} />

      {/* ── MQL Attribution panel ───────────────────────────────────────────── */}
      <Panel style={{ marginBottom: "24px" }}>
        <SectionLabel>MQL Attribution — Tricky Pipeline</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px" }}>
          <MqlColumn
            label="Non-Customers"
            color="#378ADD"
            attrib={attrib?.nc ?? null}
            sentCount={attrib?.sentCounts.nc ?? null}
            totalTrickyDeals={attrib?.combined.totalTrickyDeals ?? 0}
          />
          <MqlColumn
            label="Customers"
            color="#534AB7"
            attrib={attrib?.cu ?? null}
            sentCount={attrib?.sentCounts.cu ?? null}
            totalTrickyDeals={attrib?.combined.totalTrickyDeals ?? 0}
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
```

- [ ] **Step 2: Fix the `AttributionResponse` import — the route file exports it**

In `app/api/campaigns/attribution/route.ts`, add this export at the top (before the POST handler):

```typescript
export type { AttributionResponse } from "@/app/api/campaigns/attribution/route"
```

Wait — this is a circular dependency risk. Instead, move the shared types to `lib/hubspot-campaigns.ts`. Add to `lib/hubspot-campaigns.ts`:

```typescript
// Add at the bottom of lib/hubspot-campaigns.ts
export interface AttributionResponse {
  sentCounts: { nc: number; cu: number; inbound: number }
  nc: TrickyAttribution
  cu: TrickyAttribution
  combined: {
    mqls: MatchedDeal[]
    sqls: MatchedDeal[]
    lost: MatchedDeal[]
    totalTrickyDeals: number
  }
  inbound: {
    matchedCount: number
    totalInboundDeals: number
    skippedDeals: number
  }
}
```

Update the import in `campaigns-dashboard.tsx`:

```typescript
import type { AttributionResponse } from "@/lib/hubspot-campaigns"
```

Remove the route import from `campaigns-dashboard.tsx`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/campaigns-dashboard.tsx lib/hubspot-campaigns.ts
git commit -m "feat(campaigns): add CampaignsDashboard component — KPI, funnel, tables, charts, attribution panels"
```

---

## Task 7: Page entry + sidebar nav + env vars

**Files:**
- Create: `app/campaigns/page.tsx`
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: Create page entry**

```typescript
// app/campaigns/page.tsx
import { CampaignsDashboard } from "@/components/campaigns-dashboard"

export default function CampaignsPage() {
  return <CampaignsDashboard />
}
```

- [ ] **Step 2: Add Campaigns to sidebar nav**

In `components/app-sidebar.tsx`, update the imports line to add `BarChart2`:

```typescript
import { LayoutDashboard, LayoutList, Bug, Settings, Bot, TrendingUp, RotateCcw, Star, BarChart2 } from "lucide-react"
```

Update `navItems` to add the Campaigns entry after G2:

```typescript
const navItems = [
  { href: "/",          label: "Dashboard",        icon: LayoutDashboard },
  { href: "/self-serve",label: "Self-Serve",        icon: TrendingUp },
  { href: "/g2",        label: "G2",                icon: Star },
  { href: "/campaigns", label: "Campaigns",         icon: BarChart2 },
  { href: "/agents",    label: "Agents",            icon: Bot },
  { href: "/workspace", label: "Project Workspace", icon: LayoutList },
  { href: "/analytics", label: "Bug Tracking",      icon: Bug },
  { href: "/settings",  label: "Settings",          icon: Settings },
] as const
```

- [ ] **Step 3: Verify the page renders**

Open `http://localhost:3000/campaigns` in the browser. Expected: dark dashboard loads, KPI skeletons appear, then resolve with live Lemlist data.

- [ ] **Step 4: Verify attribution loads**

Wait ~30-60 seconds for the attribution fetch (paginated leads + HubSpot). Expected: stats tables gain MQL/SQL rows, MQL panel populates, Inbound panel shows matched count.

- [ ] **Step 5: Commit**

```bash
git add app/campaigns/page.tsx components/app-sidebar.tsx
git commit -m "feat(campaigns): add page entry and sidebar nav link"
```

---

## Self-Review

### 1. Spec coverage

| Spec requirement | Covered by |
|---|---|
| Discover campaigns by name substring | Task 3 (`fetchAllCampaigns` + filter in route) |
| "Campaign not found" per-panel state | Task 3 (error field on DiscoveredCampaign) |
| Campaign stats (all fields) | Task 1 (`fetchCampaignStats`) |
| leadsReached = nbContacted | Task 5 (KpiCard + FunnelPanel) |
| Rate-limited paginated leads | Task 1 (`fetchAllLeads` with 100ms delay) |
| HubSpot Tricky pipeline deals (pipeline 867371640, lead_source Q2 2026 MQL) | Task 2 (`fetchTrickyDeals`) |
| TRICKY_STAGES map | Task 2 |
| Company name fuzzy match (min 4 chars, substring) | Task 2 (`companyMatch`) |
| Deduplicate by dealId across NC + CU | Task 2 (`dedupeDeals`) |
| Inbound pipeline deals (52357803, createdate >= 2026-04-01) | Task 2 (`fetchInboundDeals`) |
| Contact email fetch via associations + contacts API | Task 2 (`fetchDealContactEmails`) |
| Email cache (Map<contactId, email>) | Task 4 (in attribution route) |
| Info banner | Task 6 (CampaignsDashboard) |
| KPI row — 3 cards with leads, reached, open rate | Task 5 (CampaignKpiCard) |
| Funnel panels — 4 steps with count + % | Task 5 (FunnelPanel + FunnelStep) |
| Stats tables — all metric rows | Task 6 (StatsTable + StatRow) |
| MQL rows green bg, SQL rows blue bg | Task 6 (highlight prop) |
| Comparison chart (open + click rate, grouped bars) | Task 6 (ComparisonChart) |
| MQL attribution two-column panel | Task 6 (MqlColumn) |
| Company chips colour-coded by stage type | Task 6 (CompanyChip) |
| "N unique MQLs = X% of all Y deals" note | Task 6 (bottom of MQL panel) |
| Inbound form submission panel | Task 6 (Inbound panel) |
| skippedDeals note | Task 6 |
| 5-min auto-refresh | Task 6 (setInterval) |
| Sync button | Task 6 (header button) |
| Error handling: 401, 429, campaign not found, 0 matches | Tasks 1-2 (throws), Tasks 3-4 (catches per panel), Task 6 (DataError) |
| LEMLIST_API_KEY, HUBSPOT_ACCESS_TOKEN (already in .env.local) | — already present |
| Page entry + sidebar nav | Task 7 |

### 2. Placeholder scan

No TBDs, TODOs, or "similar to Task N" found. All code blocks are complete.

### 3. Type consistency

- `DiscoveredCampaign.key` typed as `"nc" | "cu" | "inbound"` consistently (Task 1, Task 5-6)
- `TrickyAttribution` defined in Task 2, consumed in Tasks 4 and 6
- `AttributionResponse` moved to `lib/hubspot-campaigns.ts` in Task 6 to avoid circular imports
- `MatchedDeal.stageType` is `"MQL" | "SQL" | "LOST"` consistently (Tasks 2 and 6)
- `pct(n, d)` helper defined once in Task 5, used throughout Task 6
- `fetchAllLeads` returns `LemlistLead[]` in Task 1, consumed in Task 4 — types match
