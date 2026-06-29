# G2 Weekly Intent Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a weekly Claude-generated intelligence briefing on G2 buyer intent signals, comparing this week vs last week for HubSpot-qualified companies, with Telegram push and a dashboard panel.

**Architecture:** `lib/g2-weekly-report.ts` fetches two HubSpot date windows, diffs them, generates a 4-section Claude narrative, and caches to `.g2-weekly-report.json`. Two routes expose it: a GET+POST at `/api/g2/weekly-report` for the UI, and a secured POST at `/api/cron/g2-weekly-report` for Vercel cron. A panel in the G2 dashboard reads the cache and offers a Generate button.

**Tech Stack:** Next.js 15 App Router, TypeScript, Anthropic SDK (claude-haiku-4-5-20251001), HubSpot CRM API v3, Telegram Bot API, Vercel cron.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `lib/g2-weekly-report.ts` | Create | Fetch, diff, Claude, Telegram, cache |
| `app/api/g2/weekly-report/route.ts` | Create | GET cached + POST trigger |
| `app/api/cron/g2-weekly-report/route.ts` | Create | Scheduled cron endpoint |
| `vercel.json` | Modify | Add Monday 9am cron |
| `components/g2-dashboard.tsx` | Modify | Add weekly report panel |

---

### Task 1: Create `lib/g2-weekly-report.ts`

**Files:**
- Create: `lib/g2-weekly-report.ts`

This file is the core library. It exports `generateG2WeeklyReport()` and `readG2WeeklyReport()`.

- [ ] **Step 1: Create the file with types, helpers, and HubSpot fetch**

```typescript
// lib/g2-weekly-report.ts
import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import path from "path"

const REPORT_FILE = path.join(process.cwd(), ".g2-weekly-report.json")

export interface G2WeeklyReport {
  generatedAt: string
  weekLabel: string
  kpis: {
    qualifiedThisWeek: number
    qualifiedLastWeek: number
    newThisWeek: number
    escalatedCount: number
  }
  insights: string
}

interface IntentCompany {
  id: string
  name: string
  lifecycleStage: string | null
  buyingStage: string | null
  activityLevel: string | null
  productName: string | null
  relatedProducts: string[]
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean)
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

async function fetchIntentWindow(afterMs: number, beforeMs: number): Promise<IntentCompany[]> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not set")

  const all: IntentCompany[] = []
  let after: string | undefined

  while (true) {
    const body: Record<string, unknown> = {
      filterGroups: [{
        filters: [
          { propertyName: "g2_buyer_intent_activity_level", operator: "HAS_PROPERTY" },
          { propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(afterMs) },
          { propertyName: "hs_lastmodifieddate", operator: "LTE", value: String(beforeMs) },
        ],
      }],
      properties: [
        "name", "g2_buyer_intent_activity_level", "g2_buyer_intent_buying_stage",
        "hs_lastmodifieddate", "lifecyclestage", "g2_product_name", "g2_related_products",
      ],
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
      limit: 100,
      ...(after ? { after } : {}),
    }

    const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    if (!res.ok) {
      if (res.status === 400) break  // G2 integration not active
      throw new Error(`HubSpot intent search → ${res.status}`)
    }

    const data = await res.json() as {
      results: Array<{ id: string; properties: Record<string, string | null> }>
      paging?: { next?: { after: string } }
    }

    for (const c of data.results ?? []) {
      all.push({
        id: c.id,
        name: c.properties.name ?? "",
        lifecycleStage: c.properties.lifecyclestage ?? null,
        buyingStage: c.properties.g2_buyer_intent_buying_stage ?? null,
        activityLevel: c.properties.g2_buyer_intent_activity_level ?? null,
        productName: c.properties.g2_product_name ?? null,
        relatedProducts: parseList(c.properties.g2_related_products),
      })
    }

    after = data.paging?.next?.after
    if (!after) break
  }

  return all
}

function isQualified(co: IntentCompany): boolean {
  return !!co.lifecycleStage && co.lifecycleStage.trim() !== ""
}

const STAGE_RANK: Record<string, number> = { awareness: 1, consideration: 2, decision: 3 }
const ACTIVITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 }

function didEscalate(prev: IntentCompany, curr: IntentCompany): boolean {
  const stageUp =
    (STAGE_RANK[curr.buyingStage ?? ""] ?? 0) > (STAGE_RANK[prev.buyingStage ?? ""] ?? 0)
  const activityUp =
    (ACTIVITY_RANK[curr.activityLevel ?? ""] ?? 0) > (ACTIVITY_RANK[prev.activityLevel ?? ""] ?? 0)
  return stageUp || activityUp
}

function topProducts(companies: IntentCompany[], n = 5): string[] {
  const tally = new Map<string, number>()
  for (const co of companies) {
    if (co.productName) tally.set(co.productName, (tally.get(co.productName) ?? 0) + 1)
    for (const p of co.relatedProducts) tally.set(p, (tally.get(p) ?? 0) + 1)
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => `${name} × ${count}`)
}

async function generateInsights(
  thisWeek: IntentCompany[],
  lastWeek: IntentCompany[],
  newEntrants: IntentCompany[],
  escalated: Array<{ prev: IntentCompany; curr: IntentCompany }>,
): Promise<string> {
  const client = new Anthropic()

  const wowDelta = thisWeek.length - lastWeek.length
  const productsThis = topProducts(thisWeek)
  const productsLastNames = new Set(topProducts(lastWeek).map((s) => s.split(" × ")[0]))
  const productsAnnotated = productsThis.map((p) => {
    const name = p.split(" × ")[0]
    return productsLastNames.has(name) ? p : `★ ${p}`
  })

  const newList = newEntrants
    .slice(0, 8)
    .map(
      (co) =>
        `- ${co.name} (${co.lifecycleStage}, ${co.buyingStage ?? "unknown stage"}${co.productName ? `, researching ${co.productName}` : ""})`,
    )
    .join("\n")

  const escalatedList = escalated
    .slice(0, 6)
    .map(({ prev, curr }) => {
      const changes: string[] = []
      if (
        (STAGE_RANK[curr.buyingStage ?? ""] ?? 0) >
        (STAGE_RANK[prev.buyingStage ?? ""] ?? 0)
      ) {
        changes.push(`${prev.buyingStage ?? "?"} → ${curr.buyingStage}`)
      }
      if (
        (ACTIVITY_RANK[curr.activityLevel ?? ""] ?? 0) >
        (ACTIVITY_RANK[prev.activityLevel ?? ""] ?? 0)
      ) {
        changes.push(`activity ${prev.activityLevel ?? "?"} → ${curr.activityLevel}`)
      }
      return `- ${curr.name} (${curr.lifecycleStage}): ${changes.join(", ")}`
    })
    .join("\n")

  const prompt = `You are a sales intelligence analyst for BidMachine. Write a concise weekly G2 buyer intent report.

## This Week's Data

**Qualified signals:** ${thisWeek.length} this week vs ${lastWeek.length} last week (${wowDelta >= 0 ? "+" : ""}${wowDelta} WoW)
**New companies:** ${newEntrants.length}
**Escalations:** ${escalated.length}

**New this week (qualified companies with new intent signals):**
${newList || "None"}

**Escalations (stage or activity moved up):**
${escalatedList || "None"}

**Top researched competitor products (★ = new vs last week):**
${productsAnnotated.join(", ") || "No data"}

## Instructions

Write exactly 4 sections in this markdown format:

### Summary
2-3 sentences on overall signal health and the WoW change.

### New This Week
- Named companies with lifecycle stage, buying stage, and what they are researching. If none, say so.

### Escalations to Watch
- Named companies with what changed. If none, say so.

### Competitive Signals
- Top researched products. Flag ★ new ones. Note any patterns.

Be direct and analytical. Under 350 words total. No filler.`

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  })

  const block = message.content[0]
  return block.type === "text" ? block.text : ""
}

async function postToTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) console.warn("[g2-weekly-report/telegram] failed", res.status, await res.text())
}

function formatTelegramMessage(report: G2WeeklyReport): string {
  const wowDelta = report.kpis.qualifiedThisWeek - report.kpis.qualifiedLastWeek
  return [
    `📊 *G2 Intent Report — ${report.weekLabel}*`,
    ``,
    `Qualified signals: ${report.kpis.qualifiedThisWeek} this week (was ${report.kpis.qualifiedLastWeek}, ${wowDelta >= 0 ? "+" : ""}${wowDelta} WoW)`,
    `New companies: ${report.kpis.newThisWeek} | Escalations: ${report.kpis.escalatedCount}`,
    ``,
    report.insights,
  ].join("\n")
}

export async function generateG2WeeklyReport(): Promise<G2WeeklyReport> {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  const [thisWeekRaw, lastWeekRaw] = await Promise.all([
    fetchIntentWindow(now - 7 * day, now),
    fetchIntentWindow(now - 14 * day, now - 7 * day),
  ])

  const thisWeek = thisWeekRaw.filter(isQualified)
  const lastWeek = lastWeekRaw.filter(isQualified)

  const lastWeekMap = new Map(lastWeek.map((co) => [co.id, co]))
  const newEntrants = thisWeek.filter((co) => !lastWeekMap.has(co.id))
  const escalated = thisWeek
    .filter((co) => lastWeekMap.has(co.id))
    .map((curr) => ({ prev: lastWeekMap.get(curr.id)!, curr }))
    .filter(({ prev, curr }) => didEscalate(prev, curr))

  const insights = await generateInsights(thisWeek, lastWeek, newEntrants, escalated)

  const report: G2WeeklyReport = {
    generatedAt: new Date().toISOString(),
    weekLabel: getWeekLabel(),
    kpis: {
      qualifiedThisWeek: thisWeek.length,
      qualifiedLastWeek: lastWeek.length,
      newThisWeek: newEntrants.length,
      escalatedCount: escalated.length,
    },
    insights,
  }

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2))
  await postToTelegram(formatTelegramMessage(report))
  return report
}

export function readG2WeeklyReport(): G2WeeklyReport | null {
  if (!fs.existsSync(REPORT_FILE)) return null
  try {
    return JSON.parse(fs.readFileSync(REPORT_FILE, "utf-8")) as G2WeeklyReport
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit
```

Expected: no errors related to `lib/g2-weekly-report.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/g2-weekly-report.ts
git commit -m "feat: add G2 weekly intent report library"
```

---

### Task 2: Create API routes

**Files:**
- Create: `app/api/g2/weekly-report/route.ts`
- Create: `app/api/cron/g2-weekly-report/route.ts`

- [ ] **Step 1: Create `app/api/g2/weekly-report/route.ts`**

```typescript
// app/api/g2/weekly-report/route.ts
import { NextResponse } from "next/server"
import { readG2WeeklyReport, generateG2WeeklyReport } from "@/lib/g2-weekly-report"

export const dynamic = "force-dynamic"

export async function GET() {
  const report = readG2WeeklyReport()
  return NextResponse.json(report)
}

export async function POST() {
  try {
    const report = await generateG2WeeklyReport()
    return NextResponse.json(report)
  } catch (e) {
    console.error("[g2/weekly-report]", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create `app/api/cron/g2-weekly-report/route.ts`**

```typescript
// app/api/cron/g2-weekly-report/route.ts
import { NextRequest, NextResponse } from "next/server"
import { generateG2WeeklyReport } from "@/lib/g2-weekly-report"

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const report = await generateG2WeeklyReport()
    return NextResponse.json({ ok: true, weekLabel: report.weekLabel })
  } catch (e) {
    console.error("[cron/g2-weekly-report]", e)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify the dev server still starts with no type errors**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/api/g2/weekly-report/route.ts app/api/cron/g2-weekly-report/route.ts
git commit -m "feat: add G2 weekly report API routes"
```

---

### Task 3: Update `vercel.json`

**Files:**
- Modify: `vercel.json`

Current content:
```json
{
  "crons": [
    {
      "path": "/api/cron/weekly-report",
      "schedule": "0 9 * * 3"
    }
  ]
}
```

- [ ] **Step 1: Add the G2 cron entry**

```json
{
  "crons": [
    {
      "path": "/api/cron/weekly-report",
      "schedule": "0 9 * * 3"
    },
    {
      "path": "/api/cron/g2-weekly-report",
      "schedule": "0 9 * * 1"
    }
  ]
}
```

`0 9 * * 1` = Monday at 9am UTC — reviews the previous 7 days at the start of the week.

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "feat: add G2 weekly intent report cron schedule"
```

---

### Task 4: Add weekly report panel to `components/g2-dashboard.tsx`

**Files:**
- Modify: `components/g2-dashboard.tsx`

The panel goes at the very bottom of the G2 dashboard, after Panel 3 (Profile Analytics). It mirrors the self-serve weekly report panel in structure.

- [ ] **Step 1: Add import for `G2WeeklyReport` type and state**

In `components/g2-dashboard.tsx`, add the `G2WeeklyReport` import at the top:

```typescript
import type { G2WeeklyReport } from "@/lib/g2-weekly-report"
```

Then inside `export function G2Dashboard()`, add state after the existing state declarations (after `const [intentDays, setIntentDays] = useState(30)`):

```typescript
const [g2Report,          setG2Report]          = useState<G2WeeklyReport | null>(null)
const [g2ReportLoading,   setG2ReportLoading]   = useState(true)
const [g2ReportGenerating, setG2ReportGenerating] = useState(false)
const [g2ReportErr,       setG2ReportErr]       = useState<string | null>(null)
```

- [ ] **Step 2: Fetch the cached report on load**

Inside the `fetchAll` callback (which already fetches reviews, profile, campaigns, intent), add the G2 report fetch alongside the others. Find the `Promise.allSettled([...])` block and add:

```typescript
fetch("/api/g2/weekly-report").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
```

So the full `Promise.allSettled` becomes:

```typescript
Promise.allSettled([
  fetch("/api/g2/reviews").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
  fetch("/api/g2/profile").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
  fetch("/api/g2/campaigns").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
  fetch(`/api/g2/intent?days=${intentDaysRef.current}`).then((r) => r.ok ? r.json() : Promise.reject(r.status)),
  fetch("/api/g2/weekly-report").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
]).then(([r, p, c, i, wr]) => {
  if (r.status === "fulfilled") setReviews(r.value as ReviewsData); else setReviewsErr(true)
  if (p.status === "fulfilled") setProfile(p.value as ProfileData); else setProfileErr(true)
  if (c.status === "fulfilled") setCampaigns(c.value as CampaignsData); else setCampaignsErr(true)
  if (i.status === "fulfilled") {
    const intentData = i.value as IntentData
    setIntent(intentData)
    if (intentData.companies.length > 0) {
      setAppEnrichmentsLoading(true)
      fetch("/api/g2/app-enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companies: intentData.companies.map((co) => ({ id: co.id, name: co.name })),
        }),
      })
        .then((r) => r.ok ? r.json() : Promise.reject(r.status))
        .then((data: { enrichments: AppEnrichment[] }) => {
          const map = new Map<string, AppEnrichment>()
          for (const e of data.enrichments) map.set(e.companyId, e)
          setAppEnrichments(map)
        })
        .catch(() => { /* silent — badges stay absent */ })
        .finally(() => setAppEnrichmentsLoading(false))
    }
  } else {
    setIntentErr(true)
  }
  if (wr.status === "fulfilled") {
    setG2Report(wr.value as G2WeeklyReport | null)
  }
  setG2ReportLoading(false)
  setLastSynced(new Date())
  setSyncing(false)
})
```

Also set `setG2ReportLoading(true)` at the top of `fetchAll` where the other states are reset.

- [ ] **Step 3: Add the panel JSX**

At the bottom of the return, after Panel 3 (Profile Analytics `</Panel>`), add:

```tsx
{/* ── Panel 4: Weekly Intent Report ─────────────────────────────────────── */}
<Panel style={{ marginTop: "24px" }}>
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
    <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.muted, margin: 0 }}>
      Weekly Intent Report
    </p>
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      {g2Report && (
        <span style={{ fontSize: "11px", color: C.muted }}>
          {new Date(g2Report.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </span>
      )}
      <button
        onClick={async () => {
          setG2ReportGenerating(true)
          setG2ReportErr(null)
          try {
            const res = await fetch("/api/g2/weekly-report", { method: "POST" })
            if (!res.ok) throw new Error(`${res.status}`)
            const report = await res.json() as G2WeeklyReport
            setG2Report(report)
          } catch (e) {
            setG2ReportErr(String(e))
          } finally {
            setG2ReportGenerating(false)
          }
        }}
        disabled={g2ReportGenerating}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          background: "transparent",
          border: `1px solid ${C.borderAccent}`,
          borderRadius: "8px",
          padding: "7px 14px",
          color: g2ReportGenerating ? C.muted : C.accent,
          fontSize: "12px", fontWeight: 600,
          cursor: g2ReportGenerating ? "not-allowed" : "pointer",
        }}
      >
        <RefreshCw size={12} strokeWidth={2.5} style={{ animation: g2ReportGenerating ? "g2-spin 1s linear infinite" : "none" }} />
        {g2ReportGenerating ? "Generating…" : "Generate"}
      </button>
    </div>
  </div>

  {g2ReportErr && (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: C.red, fontSize: "12px", marginBottom: "16px" }}>
      <AlertCircle size={14} /> {g2ReportErr}
    </div>
  )}

  {g2ReportLoading ? (
    <LoadingSkeleton h={180} />
  ) : !g2Report ? (
    <p style={{ fontSize: "13px", color: C.muted, textAlign: "center", padding: "32px 0" }}>
      No report generated yet. Click Generate to create the first one.
    </p>
  ) : (
    <div>
      {/* KPI chips */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
        {([
          { label: "Qualified this week", value: String(g2Report.kpis.qualifiedThisWeek), accent: C.accent },
          {
            label: "vs last week",
            value: (() => {
              const d = g2Report.kpis.qualifiedThisWeek - g2Report.kpis.qualifiedLastWeek
              return `${d >= 0 ? "+" : ""}${d}`
            })(),
            accent: (g2Report.kpis.qualifiedThisWeek - g2Report.kpis.qualifiedLastWeek) >= 0 ? C.accent : C.red,
          },
          { label: "New this week", value: String(g2Report.kpis.newThisWeek), accent: C.blue },
          { label: "Escalations", value: String(g2Report.kpis.escalatedCount), accent: C.amber },
        ]).map(({ label, value, accent }) => (
          <div key={label} style={{
            background: C.cardAlt, border: `1px solid ${C.border}`,
            borderRadius: "10px", padding: "10px 16px",
          }}>
            <p style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, marginBottom: "4px" }}>{label}</p>
            <p style={{ fontSize: "24px", fontWeight: 700, fontFamily: MONO, color: accent, lineHeight: 1 }}>{value}</p>
          </div>
        ))}
      </div>
      {/* Claude insights */}
      <div style={{
        background: C.cardAlt, border: `1px solid ${C.border}`,
        borderRadius: "10px", padding: "16px 20px",
        fontSize: "12px", color: C.slate, lineHeight: "1.7",
        whiteSpace: "pre-wrap", fontFamily: "inherit",
      }}>
        {g2Report.insights}
      </div>
    </div>
  )}
</Panel>
```

- [ ] **Step 4: Verify the page loads without errors**

Open `http://localhost:3000/g2`. The panel should show "No report generated yet." Click Generate — it should spin, then show 4 KPI chips and the Claude report text.

- [ ] **Step 5: Commit**

```bash
git add components/g2-dashboard.tsx
git commit -m "feat: add G2 weekly intent report panel to dashboard"
```

---

### Task 5: Manual end-to-end test

- [ ] **Step 1: Trigger generation from the dashboard**

Open `http://localhost:3000/g2`, click "Generate" in the Weekly Intent Report panel. Observe:
- Button shows "Generating…" with spin animation
- After 10–30 seconds, 4 KPI chips appear
- Claude insights text appears in 4 sections: Summary, New This Week, Escalations to Watch, Competitive Signals

- [ ] **Step 2: Verify the cache file was written**

```bash
cat .g2-weekly-report.json
```

Expected: valid JSON with `generatedAt`, `weekLabel`, `kpis`, `insights` fields.

- [ ] **Step 3: Verify GET returns the cached report**

```bash
curl http://localhost:3000/api/g2/weekly-report
```

Expected: same JSON as the cache file.

- [ ] **Step 4: Reload the page and verify the panel pre-populates**

Hard-refresh `http://localhost:3000/g2`. The panel should show the cached report immediately without needing to click Generate.

- [ ] **Step 5: Verify the cron route rejects missing auth**

```bash
curl -X POST http://localhost:3000/api/cron/g2-weekly-report
```

Expected: `{"error":"Unauthorized"}` with status 401.

- [ ] **Step 6: Verify the cron route accepts correct auth**

```bash
curl -X POST http://localhost:3000/api/cron/g2-weekly-report \
  -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

Expected: `{"ok":true,"weekLabel":"..."}` after generation completes.
