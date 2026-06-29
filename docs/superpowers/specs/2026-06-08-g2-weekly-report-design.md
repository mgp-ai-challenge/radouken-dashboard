# G2 Buyer Intent Weekly Report — Design

## Goal

Deliver a weekly intelligence briefing on G2 buyer intent signals, comparing this week's qualified signals against last week's. "Qualified" means the company has a `lifecyclestage` set in HubSpot — indicating BidMachine already has a relationship with or is tracking them. Pushed to Telegram; also readable in the G2 dashboard panel.

## Architecture

Mirrors the self-serve weekly report pattern exactly:

```
lib/g2-weekly-report.ts                  ← fetch, diff, Claude generation, Telegram push, file cache
app/api/g2/weekly-report/route.ts        ← GET: serve cached report | POST: UI-triggered generation (no auth)
app/api/cron/g2-weekly-report/route.ts   ← POST: scheduled generation (CRON_SECRET auth)
vercel.json                              ← add cron entry: Monday 9am (0 9 * * 1)
components/g2-dashboard.tsx              ← weekly report panel (below intent table)
```

## Data Layer

### Two HubSpot fetches

Both use the same CRM search as the intent route (`/crm/v3/objects/companies/search`) but with explicit date windows on `hs_lastmodifieddate`:

- **This week**: `now - 7d` to `now`
- **Last week**: `now - 14d` to `now - 7d`

Same 13 properties fetched in both: `name`, `domain`, `g2_intent_score`, `g2_buyer_intent_activity_level`, `g2_buyer_intent_buying_stage`, `g2_buyer_intent_details`, `hs_lastmodifieddate`, `lifecyclestage`, `g2_industry`, `g2_product_name`, `g2_signals_page`, `g2_related_products`, `g2_related_product_details`.

Both fetches paginate via `paging.next.after` to get all results (not capped at 50).

### Qualified filter

Applied after fetch: `company.lifecyclestage` is non-null and non-empty. Both week arrays are filtered before diffing.

### Diff computation

```
newThisWeek     = thisWeek companies not in lastWeek (by HubSpot ID)
escalated       = in both weeks, AND (buyingStage moved up OR activityLevel moved up)
                  Stage order: awareness < consideration < decision
                  Activity order: low < medium < high
competitorDelta = top 5 products this week vs top 5 last week, new ones flagged with ★
```

### Headline KPIs (stored in report, shown in panel)

- `qualifiedThisWeek`: count of qualified companies this week
- `qualifiedLastWeek`: count of qualified companies last week
- `newThisWeek`: count of new entrants
- `escalatedCount`: count of escalated companies

## Claude Prompt (Haiku)

Injected data (no hallucination risk — company names come directly from the diff):

- Headline numbers with WoW delta
- Named list: new companies (name, lifecyclestage, buyingStage, top researched product)
- Named list: escalated companies (name, what changed: e.g. "consideration → decision")
- Competitor product tallies: this week vs last week, new ones flagged

Output format — exactly 4 sections, under 350 words:

```
### Summary
2-3 sentences on overall signal health and qualified count change.

### New This Week
- Named companies with lifecycle stage + buying stage + researched product

### Escalations to Watch
- Named companies with what changed (stage or activity level)

### Competitive Signals
- Top 5 researched products this week, flagging new vs last week
```

## File Cache

`.g2-weekly-report.json` at project root. Shape:

```typescript
interface G2WeeklyReport {
  generatedAt: string         // ISO
  weekLabel: string           // e.g. "W24 · Jun 9–15 2026"
  kpis: {
    qualifiedThisWeek: number
    qualifiedLastWeek: number
    newThisWeek: number
    escalatedCount: number
  }
  insights: string            // Claude markdown
}
```

## Telegram Message Format

```
📊 *G2 Intent Report — W24 · Jun 9–15 2026*

Qualified signals: 14 this week (was 11 last week, +3)
New companies: 4 | Escalations: 2

[Claude insights markdown]
```

## Cron Schedule

Monday 9am UTC (`0 9 * * 1`) — reviews the previous 7 days of signals at the start of the week.
Secured with `CRON_SECRET` bearer token (same env var as the self-serve cron).

## Dashboard Panel

Added below the Buyer Intent table in `components/g2-dashboard.tsx`. Structure:

- Section label: "Weekly Intent Report"
- If no cached report: skeleton + "No report generated yet. Click Generate."
- If report exists: `generatedAt` timestamp + 3 headline KPI chips + Claude markdown rendered as `<pre>` or styled paragraphs
- "Generate" button → POSTs to `/api/g2/weekly-report` (no auth required — UI-only trigger endpoint). The cron route remains the scheduled entry point with `CRON_SECRET` auth. This avoids exposing `CRON_SECRET` to the browser.

## Error Handling

- HubSpot fetch failure: throw, cron route returns 500, no file written
- Claude failure: throw, same
- Telegram failure: log warning, do not throw (report still saved and returned)
- No qualified companies in either week: Claude still runs with zeros — generates a "no signals" summary rather than crashing

## Dependencies

No new env vars. Uses existing `HUBSPOT_ACCESS_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET`.
