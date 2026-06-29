# Campaigns Weekly Report — Design

## Goal

Generate a Claude-powered weekly report for the Campaigns page covering both engagement health (open/reply/click rates, who replied) and pipeline impact (MQLs, SQLs, Tricky Opps coverage, inbound matching). Delivered via Telegram on Monday mornings and surfaced as a panel at the bottom of the Campaigns dashboard.

## Architecture

Five files touched, one new lib created. Mirrors the G2 weekly report pattern exactly.

| File | Change |
|------|--------|
| `lib/campaigns-weekly-report.ts` | **Create** — fetch, KPIs, Claude, cache, Telegram |
| `app/api/campaigns/weekly-report/route.ts` | **Create** — GET (read cache) + POST (generate) |
| `app/api/cron/campaigns-weekly-report/route.ts` | **Create** — cron handler with CRON_SECRET auth |
| `vercel.json` | **Modify** — add third cron entry |
| `components/campaigns-dashboard.tsx` | **Modify** — add weekly report panel at bottom |

No new env vars. Uses existing `HUBSPOT_ACCESS_TOKEN`, `LEMLIST_API_KEY`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET`.

---

## Data Model

Cached to `.campaigns-weekly-report.json` in project root.

```typescript
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
```

---

## `lib/campaigns-weekly-report.ts`

### Generation flow

```
fetchAllCampaignStats()           → CampaignStats per campaign (~1s)
fetchAllLeads(ncId)               → LemlistLead[] for NC with hasResponded
fetchAllLeads(cuId)               → LemlistLead[] for CU
fetchAllLeads(inboundId)          → LemlistLead[] for Inbound
fetchTrickyDeals()                → EMEA Tricky pipeline deals
matchTrickyDeals(ncLeads, deals)  → TrickyAttribution for NC
matchTrickyDeals(cuLeads, deals)  → TrickyAttribution for CU
fetchInboundDeals()               → Inbound pipeline deals
email-match inboundLeads vs inbound deals → matched count
generateInsights(...)             → Claude Haiku insights string
writeFileSync(.campaigns-weekly-report.json)
postToTelegram(...)
```

Imports from `lib/lemlist.ts`: `fetchAllCampaignStats`, `fetchAllLeads`, `DiscoveredCampaign`, `CampaignStats`
Imports from `lib/hubspot-campaigns.ts`: `fetchTrickyDeals`, `fetchInboundDeals`, `fetchDealContactEmails`, `matchTrickyDeals`, `dedupeDeals`
Imports from `@anthropic-ai/sdk`: `Anthropic`

### Campaign ID discovery

`fetchAllCampaignStats()` returns `DiscoveredCampaign[]`. Find campaigns by key:
```typescript
const nc      = campaigns.find((c) => c.key === "nc")
const cu      = campaigns.find((c) => c.key === "cu")
const inbound = campaigns.find((c) => c.key === "inbound")
```
If any ID is missing, throw with a clear message.

### KPI computation

```typescript
kpis: {
  nc: {
    sent:      ncStats.nbEmailsSent,
    openRate:  ncStats.openRate,
    replyRate: ncStats.nbContacted > 0 ? ncStats.nbReplied / ncStats.nbContacted : 0,
    mqls:      ncAttrib.mqls.length,
    sqls:      ncAttrib.sqls.length,
  },
  cu: {
    sent:      cuStats.nbEmailsSent,
    openRate:  cuStats.openRate,
    replyRate: cuStats.nbContacted > 0 ? cuStats.nbReplied / cuStats.nbContacted : 0,
    mqls:      cuAttrib.mqls.length,
    sqls:      cuAttrib.sqls.length,
  },
  inbound: {
    sent:      inboundStats.nbEmailsSent,
    openRate:  inboundStats.openRate,
    clickRate: inboundStats.clickRate,
    matched:   inboundMatchedCount,
  },
  totalTrickyOpps: trickyDeals.total,
}
```

Replied companies: filter `hasResponded` from each lead list, map to `{ company: l.companyName ?? l.email.split("@")[1] ?? l.email, email: l.email }`.

Inbound matching: reuse same email-match logic as attribution route — for each inbound deal, call `fetchDealContactEmails`, check if any email matches an inbound lead's email.

### Claude prompt

Model: `claude-haiku-4-5-20251001`, max_tokens: 1024.

```
You are a sales performance analyst for BidMachine. Write a concise weekly campaigns report.

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

Be direct and analytical. Under 350 words total. No filler.
```

WoW section: if a previous cached report exists, include:
```
**WoW vs last week:**
NC: ${deltaSign}${ncMqlDelta} MQLs, replies ${prevNcReplied}→${ncReplied}
CU: ${deltaSign}${cuMqlDelta} MQLs
Inbound: matched ${prevInboundMatched}→${inboundMatched}
```

Replied lists: up to 8 companies per campaign, joined by ", ".

### Telegram message

```typescript
function formatTelegramMessage(report: CampaignWeeklyReport): string {
  const { kpis: k, repliedCompanies: r } = report
  const totalMqls = k.nc.mqls + k.cu.mqls
  const totalSqls = k.nc.sqls + k.cu.sqls
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
```

### Public interface

```typescript
export async function generateCampaignWeeklyReport(): Promise<CampaignWeeklyReport>
export function readCampaignWeeklyReport(): CampaignWeeklyReport | null
```

`readCampaignWeeklyReport` validates shape same way as `readG2WeeklyReport`: checks `generatedAt`, `insights`, `kpis.nc.sent` exist and are correct types before returning.

---

## `app/api/campaigns/weekly-report/route.ts`

Exact mirror of `app/api/g2/weekly-report/route.ts`:

```typescript
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

---

## `app/api/cron/campaigns-weekly-report/route.ts`

Exact mirror of `app/api/cron/g2-weekly-report/route.ts`:

```typescript
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get("authorization")
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

---

## `vercel.json`

Add third cron entry (Monday 10 AM UTC — staggered 1 hour after G2 at 9 AM):

```json
{
  "crons": [
    { "path": "/api/cron/weekly-report",             "schedule": "0 9 * * 3" },
    { "path": "/api/cron/g2-weekly-report",          "schedule": "0 9 * * 1" },
    { "path": "/api/cron/campaigns-weekly-report",   "schedule": "0 10 * * 1" }
  ]
}
```

---

## `components/campaigns-dashboard.tsx` — Weekly Report Panel

New `CampaignWeeklyReportPanel` component. Added at the bottom of `CampaignsDashboard` JSX, after the Inbound Attribution panel.

### State in `CampaignsDashboard`

```typescript
const [weeklyReport,    setWeeklyReport]    = useState<CampaignWeeklyReport | null>(null)
const [weeklyReportErr, setWeeklyReportErr] = useState<string | null>(null)
const [generating,      setGenerating]      = useState(false)
```

On mount, fetch the cached report:
```typescript
useEffect(() => {
  fetch("/api/campaigns/weekly-report")
    .then((r) => r.ok ? r.json() : null)
    .then((data) => { if (data && data.generatedAt) setWeeklyReport(data) })
    .catch(() => {})
}, [])
```

Generate handler (called by button):
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

### `CampaignWeeklyReportPanel` component

```tsx
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
        <SectionLabel style={{ marginBottom: 0 }}>Weekly Campaigns Report</SectionLabel>
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
          {/* KPI chips */}
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
          {/* Insights */}
          <div style={{ fontSize: "12px", color: C.sage, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {report.insights}
          </div>
        </>
      )}
    </Panel>
  )
}
```

In `CampaignsDashboard` JSX, after the Inbound Attribution panel:

```tsx
{/* ── Weekly Campaigns Report ──────────────────────────────────────── */}
<CampaignWeeklyReportPanel
  report={weeklyReport}
  generating={generating}
  error={weeklyReportErr}
  onGenerate={handleGenerate}
/>
```

---

## Error Handling

- Missing campaign IDs: `generateCampaignWeeklyReport` throws with message — POST route returns 500
- `readCampaignWeeklyReport`: validates `generatedAt`, `insights`, `kpis.nc.sent` — returns null on malformed cache
- Telegram failure: logs warning, does not throw (same as G2 pattern)
- Dashboard generate errors: shown via `weeklyReportErr` state → `DataError` component

## Dependencies

No new env vars. Uses existing `HUBSPOT_ACCESS_TOKEN`, `LEMLIST_API_KEY`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET`.
