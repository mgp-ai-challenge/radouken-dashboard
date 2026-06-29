# Weekly Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weekly self-serve performance report that runs every Wednesday at 9am, generates Claude-powered insights, displays in the dashboard, and delivers to Telegram and Slack.

**Architecture:** A new `weekly-report` agent uses the existing agent infrastructure — its runner fetches all self-serve KPI data, calls Claude API for narrative insights, saves to `.weekly-report.json`, and posts to Telegram/Slack. A cron route triggers it on schedule. The dashboard panel reads the saved report and shows a Run Now button.

**Tech Stack:** Next.js 15 App Router, TypeScript, `@anthropic-ai/sdk`, Telegram Bot HTTP API, Slack Incoming Webhooks

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/weekly-report.ts` | Create | Fetch data, call Claude, save report, post to Telegram + Slack |
| `lib/agents.ts` | Modify | Add `weekly-report` to AGENT_DEFAULTS |
| `app/api/agents/[id]/run/route.ts` | Modify | Wire `weekly-report` runner |
| `app/api/self-serve/weekly-report/route.ts` | Create | GET: read `.weekly-report.json` |
| `app/api/cron/weekly-report/route.ts` | Create | POST: cron trigger with CRON_SECRET auth |
| `vercel.json` | Create | Cron schedule definition |
| `.env.local` | Modify | Add `CRON_SECRET` |
| `components/self-serve-dashboard.tsx` | Modify | Add Weekly Report panel at bottom |

---

## Task 1: Install Anthropic SDK

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install the SDK**

```bash
npm install @anthropic-ai/sdk
```

Expected output: `added 1 package` (or similar), no errors.

- [ ] **Step 2: Verify types are available**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @anthropic-ai/sdk dependency"
```

---

## Task 2: Add CRON_SECRET to env

**Files:**
- Modify: `.env.local`

- [ ] **Step 1: Add CRON_SECRET**

Open `.env.local` and add a new line:

```
CRON_SECRET=replace-with-a-random-32-char-string
```

Generate a value with: `openssl rand -hex 16`

- [ ] **Step 2: No commit** — `.env.local` is gitignored.

---

## Task 3: Create `lib/weekly-report.ts`

This is the core module. It owns data fetching, Claude inference, file persistence, and delivery.

**Files:**
- Create: `lib/weekly-report.ts`

- [ ] **Step 1: Create the file**

```typescript
import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import path from "path"

const REPORT_FILE = path.join(process.cwd(), ".weekly-report.json")

export interface WeeklyReport {
  generatedAt: string
  weekLabel: string
  kpis: {
    qtdNormDau: number
    q1NormDau: number
    thisWeekNormDau: number
    prevWeekNormDau: number
    q2Submissions: number
    q1Submissions: number
    apacNormDau: number
    q1ApacNormDau: number
  }
  insights: string
}

function getWeekLabel(): string {
  const now = new Date()
  // ISO week number
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const weekNo = Math.ceil(
    ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7
  )
  // Monday of this week
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `W${weekNo} · ${fmt(monday)}–${fmt(sunday)} ${now.getFullYear()}`
}

async function fetchAllData(baseUrl: string) {
  const [kpis, weeklyDau, monthlySubmissions, pipelineStages, emailSplit] =
    await Promise.all([
      fetch(`${baseUrl}/api/self-serve/kpis`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`${baseUrl}/api/self-serve/weekly-dau`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`${baseUrl}/api/self-serve/monthly-submissions`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`${baseUrl}/api/self-serve/pipeline-stages`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`${baseUrl}/api/self-serve/email-split`, { cache: "no-store" }).then((r) => r.json()),
    ])
  return { kpis, weeklyDau, monthlySubmissions, pipelineStages, emailSplit }
}

async function generateInsights(data: ReturnType<typeof fetchAllData> extends Promise<infer T> ? T : never): Promise<string> {
  const client = new Anthropic()

  const wowChange = data.kpis.prevWeekNormDau > 0
    ? Math.round(((data.kpis.thisWeekNormDau - data.kpis.prevWeekNormDau) / data.kpis.prevWeekNormDau) * 100)
    : 0
  const qoqDauChange = data.kpis.q1NormDau > 0
    ? Math.round(((data.kpis.qtdNormDau - data.kpis.q1NormDau) / data.kpis.q1NormDau) * 100)
    : 0
  const approvalRates = data.monthlySubmissions.map((m: { month: string; approvalRate: number }) =>
    `${m.month}: ${m.approvalRate}%`
  ).join(", ")
  const topStages = (data.pipelineStages as Array<{ name: string; normDau: number; count: number; normDauQ1: number }>)
    .slice(0, 4)
    .map((s) => `${s.name}: ${s.normDau.toLocaleString()} DAU (${s.count} deals)`)
    .join("; ")

  const prompt = `You are a growth analyst for BidMachine's self-serve publisher platform. Write a concise weekly performance report based on this data.

## This Week's Data

**Norm DAU QTD:** ${data.kpis.qtdNormDau.toLocaleString()} (${qoqDauChange > 0 ? "+" : ""}${qoqDauChange}% vs Q1's ${data.kpis.q1NormDau.toLocaleString()})
**This week DAU:** ${data.kpis.thisWeekNormDau.toLocaleString()} (${wowChange > 0 ? "+" : ""}${wowChange}% WoW vs ${data.kpis.prevWeekNormDau.toLocaleString()} last week)
**Q2 Submissions:** ${data.kpis.q2Submissions} (vs Q1: ${data.kpis.q1Submissions})
**APAC DAU:** ${data.kpis.apacNormDau.toLocaleString()} (vs Q1: ${data.kpis.q1ApacNormDau.toLocaleString()}, target: 300,000)
**Monthly approval rates:** ${approvalRates}
**Pipeline stage snapshot:** ${topStages}
**Email split Q2:** Business: ${data.emailSplit?.q2?.business ?? "N/A"}, Free: ${data.emailSplit?.q2?.free ?? "N/A"}

## Instructions

Write exactly 4 sections using this markdown format:

### Summary
2-3 sentences covering the week's overall performance.

### What's Working
- 2-3 bullet points. Each must reference a specific number from the data.

### What's Not Working
- 2-3 bullet points. Each must reference a specific number from the data.

### Recommendations
- 2-3 actionable recommendations. Be specific — name stages, metrics, or regions.

Be direct and analytical. No filler phrases. Under 300 words total.`

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

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  })
}

async function postToSlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
}

function formatDeliveryMessage(report: WeeklyReport): string {
  const wowChange = report.kpis.prevWeekNormDau > 0
    ? Math.round(((report.kpis.thisWeekNormDau - report.kpis.prevWeekNormDau) / report.kpis.prevWeekNormDau) * 100)
    : 0
  const qoqChange = report.kpis.q1NormDau > 0
    ? Math.round(((report.kpis.qtdNormDau - report.kpis.q1NormDau) / report.kpis.q1NormDau) * 100)
    : 0

  return [
    `📊 *Weekly Self-Serve Report — ${report.weekLabel}*`,
    ``,
    `Norm DAU QTD: ${report.kpis.qtdNormDau.toLocaleString()} (${qoqChange >= 0 ? "+" : ""}${qoqChange}% vs Q1)`,
    `This week: ${report.kpis.thisWeekNormDau.toLocaleString()} | Last week: ${report.kpis.prevWeekNormDau.toLocaleString()} (${wowChange >= 0 ? "+" : ""}${wowChange}% WoW)`,
    `Submissions: ${report.kpis.q2Submissions} | APAC DAU: ${report.kpis.apacNormDau.toLocaleString()}`,
    ``,
    report.insights,
  ].join("\n")
}

export async function generateWeeklyReport(baseUrl: string): Promise<WeeklyReport> {
  const data = await fetchAllData(baseUrl)
  const insights = await generateInsights(data)

  const report: WeeklyReport = {
    generatedAt: new Date().toISOString(),
    weekLabel: getWeekLabel(),
    kpis: data.kpis,
    insights,
  }

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2))

  const message = formatDeliveryMessage(report)
  await Promise.all([postToTelegram(message), postToSlack(message)])

  return report
}

export function readWeeklyReport(): WeeklyReport | null {
  if (!fs.existsSync(REPORT_FILE)) return null
  try {
    return JSON.parse(fs.readFileSync(REPORT_FILE, "utf-8"))
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Check TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/weekly-report.ts
git commit -m "feat: add weekly report generation module"
```

---

## Task 4: Register agent in `lib/agents.ts`

**Files:**
- Modify: `lib/agents.ts`

- [ ] **Step 1: Add to AGENT_DEFAULTS**

In `lib/agents.ts`, add to the `AGENT_DEFAULTS` array after the last entry:

```typescript
  {
    id: "weekly-report",
    name: "Weekly Report",
    description: "Generates the weekly self-serve performance report and delivers it to Telegram and Slack.",
    schedule: "Every Wednesday 9am",
  },
```

- [ ] **Step 2: Check TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/agents.ts
git commit -m "feat: register weekly-report agent"
```

---

## Task 5: Wire runner in `app/api/agents/[id]/run/route.ts`

**Files:**
- Modify: `app/api/agents/[id]/run/route.ts`

- [ ] **Step 1: Add the import at the top of the file**

Add after the existing imports:

```typescript
import { generateWeeklyReport } from "@/lib/weekly-report"
```

- [ ] **Step 2: Add the runner function**

Add before the `runners` map:

```typescript
async function runWeeklyReport(): Promise<Record<string, number | string>> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
  const report = await generateWeeklyReport(baseUrl)
  return {
    weekLabel: report.weekLabel,
    qtdNormDau: report.kpis.qtdNormDau,
    submissions: report.kpis.q2Submissions,
  }
}
```

- [ ] **Step 3: Register in the runners map**

In the `runners` object, add:

```typescript
  "weekly-report": runWeeklyReport,
```

- [ ] **Step 4: Add `NEXT_PUBLIC_BASE_URL` to `.env.local`**

```
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

(Set to your production URL when deploying.)

- [ ] **Step 5: Check TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/agents/[id]/run/route.ts .env.local
git commit -m "feat: wire weekly-report runner into agent infrastructure"
```

---

## Task 6: Create `GET /api/self-serve/weekly-report`

**Files:**
- Create: `app/api/self-serve/weekly-report/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextResponse } from "next/server"
import { readWeeklyReport } from "@/lib/weekly-report"

export async function GET() {
  const report = readWeeklyReport()
  if (!report) {
    return NextResponse.json(null)
  }
  return NextResponse.json(report)
}
```

- [ ] **Step 2: Check TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/self-serve/weekly-report/route.ts
git commit -m "feat: add weekly-report GET route"
```

---

## Task 7: Create `POST /api/cron/weekly-report`

**Files:**
- Create: `app/api/cron/weekly-report/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { generateWeeklyReport } from "@/lib/weekly-report"

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get("authorization")

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"

  try {
    const report = await generateWeeklyReport(baseUrl)
    return NextResponse.json({ ok: true, weekLabel: report.weekLabel })
  } catch (e) {
    console.error("[cron/weekly-report]", e)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Check TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/weekly-report/route.ts
git commit -m "feat: add cron trigger route for weekly report"
```

---

## Task 8: Create `vercel.json`

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create the file**

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

`0 9 * * 3` = every Wednesday at 09:00 UTC.

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "chore: add Vercel cron schedule for weekly report (Wed 9am UTC)"
```

---

## Task 9: Add Weekly Report panel to dashboard

**Files:**
- Modify: `components/self-serve-dashboard.tsx`

- [ ] **Step 1: Add the `WeeklyReport` type and state**

At the top of the component, add these types alongside the existing ones:

```typescript
type WeeklyReport = {
  generatedAt: string
  weekLabel: string
  kpis: {
    qtdNormDau: number
    q1NormDau: number
    thisWeekNormDau: number
    prevWeekNormDau: number
    q2Submissions: number
    q1Submissions: number
    apacNormDau: number
    q1ApacNormDau: number
  }
  insights: string
} | null
```

Add state to the `SelfServeDashboard` component alongside the other `useState` hooks:

```typescript
const [weeklyReport, setWeeklyReport] = useState<WeeklyReport>(undefined as unknown as WeeklyReport)
const [weeklyReportError, setWeeklyReportError] = useState(false)
const [reportRunning, setReportRunning] = useState(false)
```

- [ ] **Step 2: Fetch the report in the `fetchAll` callback**

Inside the existing `fetchAll` function, add a fetch for the weekly report alongside the other fetches:

```typescript
fetch("/api/self-serve/weekly-report")
  .then((r) => r.json())
  .then((d) => setWeeklyReport(d))
  .catch(() => setWeeklyReportError(true)),
```

- [ ] **Step 3: Add the `runWeeklyReport` handler**

Add this function inside the component, after `fetchAll`:

```typescript
async function runWeeklyReport() {
  setReportRunning(true)
  try {
    await fetch("/api/agents/weekly-report/run", { method: "POST" })
    // Poll until done
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const res = await fetch("/api/self-serve/weekly-report")
      const data = await res.json()
      if (data?.generatedAt) {
        setWeeklyReport(data)
        break
      }
    }
  } finally {
    setReportRunning(false)
  }
}
```

- [ ] **Step 4: Add the panel at the bottom of the JSX**

Add this panel after the last `</div>` closing the Row 4 grid, before the closing `</div>` of the outer container:

```tsx
{/* ── Row 5: Weekly Report ─────────────────────────────────────────── */}
<Panel>
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
    <SectionLabel>Weekly Report</SectionLabel>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {weeklyReport?.weekLabel && (
        <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{weeklyReport.weekLabel}</span>
      )}
      <button
        onClick={runWeeklyReport}
        disabled={reportRunning}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.borderAccent}`,
          background: C.accentDim, color: C.accent, fontFamily: MONO, fontSize: 11,
          cursor: reportRunning ? "not-allowed" : "pointer", opacity: reportRunning ? 0.6 : 1,
        }}
      >
        {reportRunning ? "Generating…" : "Run Now"}
      </button>
    </div>
  </div>

  {weeklyReportError ? (
    <DataError label="weekly report" />
  ) : weeklyReport === (undefined as unknown as WeeklyReport) ? (
    <LoadingSkeleton h={200} />
  ) : !weeklyReport ? (
    <div style={{ padding: "32px 0", textAlign: "center", color: C.muted, fontSize: 13, fontFamily: MONO }}>
      No report generated yet. Click Run Now to generate the first report.
    </div>
  ) : (
    <div>
      {/* KPI strip */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16,
        padding: "10px 12px", background: C.cardAlt, borderRadius: 8, border: `1px solid ${C.border}`,
      }}>
        {[
          { label: "DAU QTD", value: fmtNum(weeklyReport.kpis.qtdNormDau) },
          { label: "This Week", value: fmtNum(weeklyReport.kpis.thisWeekNormDau) },
          { label: "Submissions", value: weeklyReport.kpis.q2Submissions },
          { label: "APAC DAU", value: fmtNum(weeklyReport.kpis.apacNormDau) },
        ].map(({ label, value }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.sageLight, fontFamily: MONO }}>{value}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* AI Insights */}
      <div style={{
        fontSize: 12.5, lineHeight: 1.7, color: C.sage, whiteSpace: "pre-wrap",
        padding: "12px 14px", background: C.cardAlt, borderRadius: 8,
        border: `1px solid ${C.border}`, fontFamily: "Outfit, sans-serif",
      }}>
        {weeklyReport.insights}
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: C.muted, fontFamily: MONO, textAlign: "right" }}>
        Generated {new Date(weeklyReport.generatedAt).toLocaleString()}
      </div>
    </div>
  )}
</Panel>
```

- [ ] **Step 5: Check TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Start dev server and verify the panel renders**

```bash
npm run dev
```

Open `http://localhost:3000/self-serve`. The Weekly Report panel should appear at the bottom with the "Run Now" button. Click it and verify it polls and shows a report after ~15-30 seconds.

- [ ] **Step 7: Commit**

```bash
git add components/self-serve-dashboard.tsx
git commit -m "feat: add Weekly Report panel to self-serve dashboard"
```

---

## Task 10: Manual end-to-end test

- [ ] **Step 1: Verify Telegram delivery**

With the dev server running, call the agent directly:

```bash
curl -X POST http://localhost:3000/api/agents/weekly-report/run
```

Expected response: `{"started":true}`

Wait ~20 seconds, then check the BidMachine Telegram channel for the report message.

- [ ] **Step 2: Verify cron route auth**

```bash
# Should return 401
curl -X POST http://localhost:3000/api/cron/weekly-report

# Should return 200 (replace YOUR_SECRET with value from .env.local)
curl -X POST http://localhost:3000/api/cron/weekly-report \
  -H "Authorization: Bearer YOUR_SECRET"
```

- [ ] **Step 3: Verify Slack (once webhook URL is added)**

Add `SLACK_WEBHOOK_URL` to `.env.local`, restart dev server, run the agent again, and check Slack channel.

- [ ] **Step 4: Final commit**

```bash
git add vercel.json
git commit -m "feat: complete weekly report — agent, cron, dashboard panel, Telegram/Slack delivery"
```
