# Campaigns Weekly Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude-powered weekly Campaigns report covering engagement health (open/reply/click rates, who replied) and pipeline impact (MQLs, SQLs, Tricky Opps coverage, inbound matching), delivered via Telegram on Monday mornings and surfaced as a panel at the bottom of the Campaigns dashboard.

**Architecture:** Mirrors the G2 weekly report pattern exactly — one new lib file handles all data fetching, Claude Haiku insights generation, file caching, and Telegram delivery; two new API routes (GET/POST + cron handler); vercel.json gets a third cron entry; the Campaigns dashboard gets a new `CampaignWeeklyReportPanel` at the bottom.

**Tech Stack:** TypeScript, Next.js 15 App Router, Anthropic SDK (`claude-haiku-4-5-20251001`), existing `lib/lemlist.ts` + `lib/hubspot-campaigns.ts`

---

### Task 1: Create `lib/campaigns-weekly-report.ts`

**Files:**
- Create: `lib/campaigns-weekly-report.ts`

**Context:** This is the core lib — it fetches all campaign data, computes KPIs, asks Claude Haiku for insights, writes the cache file, and posts to Telegram.

**How campaign IDs are discovered:** Call `fetchAllCampaigns()` → `Array<{ _id: string; name: string }>`, then use `TARGET_CAMPAIGNS` (exported from `lib/lemlist.ts`) to find each campaign by name substring, same pattern as `app/api/campaigns/stats/route.ts`. Then call `fetchAllCampaignStats(ids: string[]) → Map<string, CampaignStats>` to get stats per ID.

**Leads:** `fetchAllLeads(campaignId: string) → Promise<LemlistLead[]>` with `hasResponded: boolean` field.

**Attribution:** Same as `app/api/campaigns/attribution/route.ts` — `matchTrickyDeals(leads, trickyDeals)` for NC and CU; inbound uses email-set matching against `fetchInboundDeals()`.

**Replied companies:** filter `l.hasResponded === true`, map to `{ company: l.companyName ?? l.email.split("@")[1] ?? l.email, email: l.email }`.

**WoW:** read the existing cached report before overwriting it. If previous report exists, include a WoW comparison block in the prompt.

**Telegram failure:** log warning, do NOT throw.

- [ ] **Step 1: Create the file with interfaces and helpers**

Create `lib/campaigns-weekly-report.ts`:

```typescript
// lib/campaigns-weekly-report.ts
import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import path from "path"
import {
  TARGET_CAMPAIGNS,
  fetchAllCampaigns,
  fetchAllCampaignStats,
  fetchAllLeads,
} from "@/lib/lemlist"
import {
  fetchTrickyDeals,
  fetchInboundDeals,
  fetchDealContactEmails,
  matchTrickyDeals,
} from "@/lib/hubspot-campaigns"

const REPORT_FILE = path.join(process.cwd(), ".campaigns-weekly-report.json")

export interface CampaignWeeklyReport {
  generatedAt: string
  weekLabel: string
  kpis: {
    nc:      { sent: number; openRate: number; replyRate: number; mqls: number; sqls: number }
    cu:      { sent: number; openRate: number; replyRate: number; mqls: number; sqls: number }
    inbound: { sent: number; openRate: number; clickRate: number; matched: number }
    totalTrickyOpps: number
  }
  repliedCompanies: {
    nc:      { company: string; email: string }[]
    cu:      { company: string; email: string }[]
    inbound: { company: string; email: string }[]
  }
  insights: string
}

function getWeekLabel(): string {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const weekNo = Math.ceil(
    ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
  )
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `W${weekNo} · ${fmt(monday)}–${fmt(sunday)} ${now.getFullYear()}`
}
```

- [ ] **Step 2: Add `generateInsights`, `formatTelegramMessage`, and `postToTelegram`**

Append to `lib/campaigns-weekly-report.ts`:

```typescript
async function generateInsights(
  nc:              { sent: number; openRate: number; replyRate: number; mqls: number; sqls: number },
  cu:              { sent: number; openRate: number; replyRate: number; mqls: number; sqls: number },
  inbound:         { sent: number; openRate: number; clickRate: number; matched: number },
  totalTrickyOpps: number,
  ncReplied:       { company: string; email: string }[],
  cuReplied:       { company: string; email: string }[],
  inboundReplied:  { company: string; email: string }[],
  prev:            CampaignWeeklyReport | null,
): Promise<string> {
  const client = new Anthropic()

  const totalMqls   = nc.mqls + cu.mqls
  const mqlCoverage = totalTrickyOpps > 0 ? (totalMqls / totalTrickyOpps * 100).toFixed(0) : "0"
  const ncRepliedList      = ncReplied.slice(0, 8).map((r) => r.company).join(", ")
  const cuRepliedList      = cuReplied.slice(0, 8).map((r) => r.company).join(", ")
  const inboundRepliedList = inboundReplied.slice(0, 8).map((r) => r.company).join(", ")

  let wowSection = ""
  if (prev) {
    const ncMqlDelta     = nc.mqls - prev.kpis.nc.mqls
    const cuMqlDelta     = cu.mqls - prev.kpis.cu.mqls
    const prevNcReplied  = prev.repliedCompanies.nc.length
    const ncRepliedCount = ncReplied.length
    const prevMatched    = prev.kpis.inbound.matched
    const sign = (n: number) => n >= 0 ? "+" : ""
    wowSection = `**WoW vs last week:**
NC: ${sign(ncMqlDelta)}${ncMqlDelta} MQLs, replies ${prevNcReplied}→${ncRepliedCount}
CU: ${sign(cuMqlDelta)}${cuMqlDelta} MQLs
Inbound: matched ${prevMatched}→${inbound.matched}`
  }

  const prompt = `You are a sales performance analyst for BidMachine. Write a concise weekly campaigns report.

## This Week's Data

**NC Campaign (Non-Customers):**
${nc.sent} sent · ${(nc.openRate*100).toFixed(1)}% open · ${(nc.replyRate*100).toFixed(1)}% reply · ${nc.mqls} MQLs · ${nc.sqls} SQLs

**CU Campaign (Customers):**
${cu.sent} sent · ${(cu.openRate*100).toFixed(1)}% open · ${(cu.replyRate*100).toFixed(1)}% reply · ${cu.mqls} MQLs · ${cu.sqls} SQLs

**Inbound Campaign:**
${inbound.sent} sent · ${(inbound.openRate*100).toFixed(1)}% open · ${(inbound.clickRate*100).toFixed(1)}% click · ${inbound.matched} matched to inbound deals

**Tricky Pipeline:**
${totalTrickyOpps} EMEA Tricky Opps total · ${totalMqls} MQLs matched (${mqlCoverage}% coverage)

**Companies that replied to NC:** ${ncRepliedList || "None"}
**Companies that replied to CU:** ${cuRepliedList || "None"}
**Companies that replied to Inbound:** ${inboundRepliedList || "None"}

${wowSection}

## Instructions

Write exactly 4 sections in this markdown format:

### Summary
2-3 sentences on overall campaign health and the strongest performer.

### Reply Signals
- Named companies that replied. Flag any that match an MQL or SQL.

### Pipeline Impact
- MQL/SQL counts, Tricky Opps coverage %, inbound match rate.

### Recommendations
- 2-3 concrete next actions based on the data.

Be direct and analytical. Under 350 words total. No filler.`

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  })

  const block = message.content[0]
  return block.type === "text" ? block.text : ""
}

function formatTelegramMessage(report: CampaignWeeklyReport): string {
  const { kpis: k, repliedCompanies: r } = report
  const totalMqls   = k.nc.mqls + k.cu.mqls
  const mqlCoverage = k.totalTrickyOpps > 0
    ? (totalMqls / k.totalTrickyOpps * 100).toFixed(0)
    : "0"
  return [
    `📊 *Campaigns Report — ${report.weekLabel}*`,
    ``,
    `NC: ${k.nc.sent} sent · ${(k.nc.openRate*100).toFixed(1)}% open · ${r.nc.length} replied · ${k.nc.mqls} MQLs · ${k.nc.sqls} SQLs`,
    `CU: ${k.cu.sent} sent · ${(k.cu.openRate*100).toFixed(1)}% open · ${r.cu.length} replied · ${k.cu.mqls} MQLs · ${k.cu.sqls} SQLs`,
    `Inbound: ${k.inbound.sent} sent · ${(k.inbound.clickRate*100).toFixed(1)}% click · ${k.inbound.matched} matched`,
    `Tricky Opps: ${k.totalTrickyOpps} total · ${mqlCoverage}% MQL coverage`,
    ``,
    report.insights,
  ].join("\n")
}

async function postToTelegram(text: string): Promise<void> {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    })
    if (!res.ok) console.warn("[campaigns-weekly-report/telegram] failed", res.status, await res.text())
  } catch (err) {
    console.warn("[campaigns-weekly-report/telegram] network error", err)
  }
}
```

- [ ] **Step 3: Add `generateCampaignWeeklyReport` and `readCampaignWeeklyReport`**

Append to `lib/campaigns-weekly-report.ts`:

```typescript
export async function generateCampaignWeeklyReport(): Promise<CampaignWeeklyReport> {
  // Read previous report for WoW comparison BEFORE overwriting
  const prev = readCampaignWeeklyReport()

  // ── Step 1: Discover campaign IDs (same pattern as stats route) ──────────
  const allCampaigns = await fetchAllCampaigns()
  const discovered = TARGET_CAMPAIGNS.map((target) => {
    const matches = allCampaigns.filter((c) => c.name.includes(target.match))
    const found   = matches.find((c) => !(c as Record<string, unknown>).archived) ?? matches[0]
    return { key: target.key, id: found?._id ?? null }
  })

  const ncId      = discovered.find((c) => c.key === "nc")?.id
  const cuId      = discovered.find((c) => c.key === "cu")?.id
  const inboundId = discovered.find((c) => c.key === "inbound")?.id

  if (!ncId || !cuId || !inboundId) {
    throw new Error(
      `[campaigns-weekly-report] Missing campaign IDs: nc=${ncId ?? "null"}, cu=${cuId ?? "null"}, inbound=${inboundId ?? "null"}`,
    )
  }

  // ── Step 2: Fetch campaign stats ─────────────────────────────────────────
  const statsMap     = await fetchAllCampaignStats([ncId, cuId, inboundId])
  const ncStats      = statsMap.get(ncId)
  const cuStats      = statsMap.get(cuId)
  const inboundStats = statsMap.get(inboundId)

  if (!ncStats || !cuStats || !inboundStats) {
    throw new Error("[campaigns-weekly-report] Campaign stats failed to load")
  }

  // ── Step 3: Fetch leads for all three campaigns sequentially ─────────────
  const ncLeads      = await fetchAllLeads(ncId)
  const cuLeads      = await fetchAllLeads(cuId)
  const inboundLeads = await fetchAllLeads(inboundId)

  // ── Step 4: Tricky deals + MQL attribution ───────────────────────────────
  const { deals: trickyDeals, total: totalTrickyOpps } = await fetchTrickyDeals()
  const ncAttrib = matchTrickyDeals(ncLeads, trickyDeals)
  const cuAttrib = matchTrickyDeals(cuLeads, trickyDeals)

  // ── Step 5: Inbound email match ──────────────────────────────────────────
  const inboundDeals    = await fetchInboundDeals()
  const inboundEmailSet = new Set(inboundLeads.map((l) => l.email.toLowerCase()))
  const emailCache      = new Map<string, string>()
  let inboundMatchedCount = 0

  for (const deal of inboundDeals) {
    try {
      const emails = await fetchDealContactEmails(deal.id, emailCache)
      if (emails.some((e) => inboundEmailSet.has(e.toLowerCase()))) {
        inboundMatchedCount++
      }
    } catch {
      // skip deals where contact email fetch fails
    }
  }

  // ── Step 6: Replied companies ────────────────────────────────────────────
  const mapReplied = (leads: Awaited<ReturnType<typeof fetchAllLeads>>) =>
    leads
      .filter((l) => l.hasResponded)
      .map((l) => ({
        company: l.companyName ?? l.email.split("@")[1] ?? l.email,
        email:   l.email,
      }))

  const ncReplied      = mapReplied(ncLeads)
  const cuReplied      = mapReplied(cuLeads)
  const inboundReplied = mapReplied(inboundLeads)

  // ── Step 7: KPIs ─────────────────────────────────────────────────────────
  const nc: CampaignWeeklyReport["kpis"]["nc"] = {
    sent:      ncStats.nbEmailsSent,
    openRate:  ncStats.openRate,
    replyRate: ncStats.nbContacted > 0 ? ncStats.nbReplied / ncStats.nbContacted : 0,
    mqls:      ncAttrib.mqls.length,
    sqls:      ncAttrib.sqls.length,
  }
  const cu: CampaignWeeklyReport["kpis"]["cu"] = {
    sent:      cuStats.nbEmailsSent,
    openRate:  cuStats.openRate,
    replyRate: cuStats.nbContacted > 0 ? cuStats.nbReplied / cuStats.nbContacted : 0,
    mqls:      cuAttrib.mqls.length,
    sqls:      cuAttrib.sqls.length,
  }
  const inbound: CampaignWeeklyReport["kpis"]["inbound"] = {
    sent:      inboundStats.nbEmailsSent,
    openRate:  inboundStats.openRate,
    clickRate: inboundStats.clickRate,
    matched:   inboundMatchedCount,
  }

  // ── Step 8: Generate Claude insights ─────────────────────────────────────
  const insights = await generateInsights(
    nc, cu, inbound, totalTrickyOpps,
    ncReplied, cuReplied, inboundReplied,
    prev,
  )

  const report: CampaignWeeklyReport = {
    generatedAt:      new Date().toISOString(),
    weekLabel:        getWeekLabel(),
    kpis:             { nc, cu, inbound, totalTrickyOpps },
    repliedCompanies: { nc: ncReplied, cu: cuReplied, inbound: inboundReplied },
    insights,
  }

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2))
  await postToTelegram(formatTelegramMessage(report))
  return report
}

export function readCampaignWeeklyReport(): CampaignWeeklyReport | null {
  if (!fs.existsSync(REPORT_FILE)) return null
  try {
    const r = JSON.parse(fs.readFileSync(REPORT_FILE, "utf-8"))
    if (
      !r ||
      typeof r.generatedAt !== "string" ||
      typeof r.insights    !== "string" ||
      typeof r.kpis?.nc?.sent !== "number"
    ) return null
    return r as CampaignWeeklyReport
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/radustoia/outbound-attribution
npm run typecheck
```

Expected: 0 errors. `fetchAllCampaigns` returns `Array<{ _id: string; name: string }>`. `fetchAllCampaignStats` takes `string[]` and returns `Map<string, CampaignStats>`. `fetchAllLeads` accepts a string ID and returns `LemlistLead[]` with `hasResponded`. `matchTrickyDeals` accepts `Array<{ companyName: string | null }>` — `LemlistLead[]` satisfies this since it has `companyName: string | null`.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns-weekly-report.ts
git commit -m "feat(campaigns): add campaigns-weekly-report lib with Claude Haiku insights"
```

---

### Task 2: Create `app/api/campaigns/weekly-report/route.ts`

**Files:**
- Create: `app/api/campaigns/weekly-report/route.ts`

**Context:** GET returns the cached report from disk (404 if not found). POST triggers a full generation. Mirrors `app/api/g2/weekly-report/route.ts` exactly.

- [ ] **Step 1: Create the route file**

Create `app/api/campaigns/weekly-report/route.ts`:

```typescript
// app/api/campaigns/weekly-report/route.ts
import { NextResponse } from "next/server"
import { readCampaignWeeklyReport, generateCampaignWeeklyReport } from "@/lib/campaigns-weekly-report"

export const dynamic = "force-dynamic"

export async function GET() {
  const report = readCampaignWeeklyReport()
  if (!report) return NextResponse.json({ available: false }, { status: 404 })
  return NextResponse.json(report)
}

export async function POST() {
  try {
    const report = await generateCampaignWeeklyReport()
    return NextResponse.json(report)
  } catch (e) {
    console.error("[campaigns/weekly-report]", e)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/radustoia/outbound-attribution
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/campaigns/weekly-report/route.ts
git commit -m "feat(campaigns): add weekly-report GET/POST API route"
```

---

### Task 3: Create `app/api/cron/campaigns-weekly-report/route.ts`

**Files:**
- Create: `app/api/cron/campaigns-weekly-report/route.ts`

**Context:** Cron handler called by Vercel on Monday mornings. Validates `Authorization: Bearer <CRON_SECRET>` header. Returns `{ ok: true, weekLabel }` on success. Mirrors `app/api/cron/g2-weekly-report/route.ts` exactly.

- [ ] **Step 1: Create the cron route file**

Create `app/api/cron/campaigns-weekly-report/route.ts`:

```typescript
// app/api/cron/campaigns-weekly-report/route.ts
import { NextRequest, NextResponse } from "next/server"
import { generateCampaignWeeklyReport } from "@/lib/campaigns-weekly-report"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth   = req.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const report = await generateCampaignWeeklyReport()
    return NextResponse.json({ ok: true, weekLabel: report.weekLabel })
  } catch (e) {
    console.error("[cron/campaigns-weekly-report]", e)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/radustoia/outbound-attribution
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/campaigns-weekly-report/route.ts
git commit -m "feat(campaigns): add cron handler for weekly report"
```

---

### Task 4: Update `vercel.json` with Monday 10AM cron

**Files:**
- Modify: `vercel.json`

**Context:** Current `vercel.json` has two cron entries. Add a third staggered 1 hour after the G2 one (Monday 10AM UTC = `0 10 * * 1`).

Current file:
```json
{
  "crons": [
    { "path": "/api/cron/weekly-report",    "schedule": "0 9 * * 3" },
    { "path": "/api/cron/g2-weekly-report", "schedule": "0 9 * * 1" }
  ]
}
```

- [ ] **Step 1: Add the third cron entry**

Replace `vercel.json` with:

```json
{
  "crons": [
    { "path": "/api/cron/weekly-report",           "schedule": "0 9 * * 3" },
    { "path": "/api/cron/g2-weekly-report",        "schedule": "0 9 * * 1" },
    { "path": "/api/cron/campaigns-weekly-report", "schedule": "0 10 * * 1" }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "feat(campaigns): register campaigns weekly report cron at Monday 10AM UTC"
```

---

### Task 5: Add `CampaignWeeklyReportPanel` to `components/campaigns-dashboard.tsx`

**Files:**
- Modify: `components/campaigns-dashboard.tsx`

**Context:** Four changes to this file:
1. Add `CampaignWeeklyReport` type import
2. Add `CampaignWeeklyReportPanel` component function (before `// ─── Main component`)
3. Add three state vars + `useEffect` fetch-on-mount + `handleGenerate` inside `CampaignsDashboard`
4. Add `<CampaignWeeklyReportPanel>` JSX at the bottom of the return (after Inbound Attribution panel, before closing `</div>`)

Current file ends at line 695. Inbound Attribution panel `</Panel>` is at line 692. Outer closing `</div>` is at line 693.

**Important:** The existing `SectionLabel` component accepts only `children: React.ReactNode` — it does not accept a `style` prop. Use a raw `<p>` for the panel header instead.

- [ ] **Step 1: Read lines 1–12 of campaigns-dashboard.tsx**

Read `components/campaigns-dashboard.tsx` lines 1–12 to confirm the current import block.

- [ ] **Step 2: Add the CampaignWeeklyReport type import**

After the `AttributionResponse` import (line 10–11), add:

```typescript
import type { CampaignWeeklyReport } from "@/lib/campaigns-weekly-report"
```

The import block should then read:
```typescript
import type { DiscoveredCampaign, CampaignStats } from "@/lib/lemlist"
import type { AttributionResponse, TrickyAttribution } from "@/lib/hubspot-campaigns"
import type { CampaignWeeklyReport } from "@/lib/campaigns-weekly-report"
```

- [ ] **Step 3: Add `CampaignWeeklyReportPanel` component before the main component comment**

Find the line `// ─── Main component ─────` (around line 444). Insert the full component immediately before it:

```typescript
// ─── Weekly Campaigns Report panel ────────────────────────────────────────────
function CampaignWeeklyReportPanel({
  report, generating, error, onGenerate,
}: {
  report: CampaignWeeklyReport | null
  generating: boolean
  error: string | null
  onGenerate: () => void
}) {
  const totalMqls = report ? report.kpis.nc.mqls + report.kpis.cu.mqls : 0
  const totalSqls = report ? report.kpis.nc.sqls + report.kpis.cu.sqls : 0

  return (
    <Panel style={{ marginTop: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.muted, margin: 0 }}>
          Weekly Campaigns Report
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {report && (
            <span style={{ fontSize: "11px", color: C.muted }}>
              {report.weekLabel}
            </span>
          )}
          <button
            onClick={onGenerate}
            disabled={generating}
            style={{ display: "flex", alignItems: "center", gap: "6px", background: "transparent", border: `1px solid ${C.borderAccent}`, borderRadius: "8px", padding: "6px 12px", color: generating ? C.muted : C.accent, fontSize: "11px", fontWeight: 600, cursor: generating ? "not-allowed" : "pointer" }}
          >
            {generating ? "Generating… ~5 min" : "Generate Report"}
          </button>
        </div>
      </div>

      {error && <DataError message={error} />}

      {!report && !generating && !error && (
        <p style={{ fontSize: "12px", color: C.muted, fontStyle: "italic" }}>No report generated yet.</p>
      )}

      {generating && !report && <LoadingSkeleton h={160} />}

      {report && (
        <>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "20px" }}>
            {[
              { label: `${report.repliedCompanies.nc.length} NC replied`,  bg: C.accentDim, color: C.accent },
              { label: `${report.repliedCompanies.cu.length} CU replied`,  bg: C.accentDim, color: C.accent },
              { label: `${totalMqls} MQLs`,                                bg: C.greenDim,  color: C.green  },
              { label: `${totalSqls} SQLs`,                                bg: C.blueDim,   color: C.blue   },
              { label: `${report.kpis.totalTrickyOpps} Tricky Opps`,       bg: C.accentDim, color: C.accent },
            ].map((chip) => (
              <span key={chip.label} style={{ padding: "3px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 700, background: chip.bg, color: chip.color }}>
                {chip.label}
              </span>
            ))}
          </div>
          <div style={{ fontSize: "12px", color: C.sage, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {report.insights}
          </div>
        </>
      )}
    </Panel>
  )
}
```

- [ ] **Step 4: Add state variables inside `CampaignsDashboard`**

Find the last existing state/ref line inside `CampaignsDashboard` (around line 455):
```typescript
const syncGenRef     = useRef(0)
```

Add three new state variables immediately after it:
```typescript
const [weeklyReport,    setWeeklyReport]    = useState<CampaignWeeklyReport | null>(null)
const [weeklyReportErr, setWeeklyReportErr] = useState<string | null>(null)
const [generating,      setGenerating]      = useState(false)
```

- [ ] **Step 5: Add the fetch-on-mount `useEffect`**

Find the existing `useEffect` that calls `fetchAll` (around line 536):
```typescript
useEffect(() => { fetchAll() }, [fetchAll])
```

Add a second `useEffect` immediately after it (on its own line):
```typescript
useEffect(() => {
  fetch("/api/campaigns/weekly-report")
    .then((r) => r.ok ? r.json() : null)
    .then((data: CampaignWeeklyReport | null) => { if (data && data.generatedAt) setWeeklyReport(data) })
    .catch(() => {})
}, [])
```

- [ ] **Step 6: Add `handleGenerate` function**

Find the computed variables block (after the useEffects, around line 539):
```typescript
const nc      = campaigns.find((c) => c.key === "nc")      ?? null
```

Add `handleGenerate` immediately before those lines:
```typescript
async function handleGenerate() {
  setGenerating(true)
  setWeeklyReportErr(null)
  try {
    const res = await fetch("/api/campaigns/weekly-report", { method: "POST" })
    if (!res.ok) throw new Error(await res.text())
    setWeeklyReport(await res.json())
  } catch (e) {
    setWeeklyReportErr(String(e))
  } finally {
    setGenerating(false)
  }
}
```

- [ ] **Step 7: Add the panel to the JSX return**

Find the Inbound Attribution panel closing tag (line 692: `</Panel>`) immediately followed by the outer `</div>` (line 693). Insert the weekly report panel between them:

```tsx
      {/* ── Weekly Campaigns Report ──────────────────────────────────────────── */}
      <CampaignWeeklyReportPanel
        report={weeklyReport}
        generating={generating}
        error={weeklyReportErr}
        onGenerate={handleGenerate}
      />
```

- [ ] **Step 8: Type-check**

```bash
cd /Users/radustoia/outbound-attribution
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 9: Build**

```bash
cd /Users/radustoia/outbound-attribution
npm run build
```

Expected: Build completes without errors.

- [ ] **Step 10: Commit**

```bash
git add components/campaigns-dashboard.tsx
git commit -m "feat(campaigns): add CampaignWeeklyReportPanel to dashboard"
```
