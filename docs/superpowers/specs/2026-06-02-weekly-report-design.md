# Weekly Report — Design Spec

**Date:** 2026-06-02

## Overview

A weekly self-serve performance report, auto-generated every Wednesday at 9am, displayed in the dashboard, and delivered to Telegram and Slack. The report combines raw KPI data with Claude-generated narrative insights (what worked, what didn't, recommendations).

---

## Architecture

### Agent: `weekly-report`

Added to `AGENT_DEFAULTS` in `lib/agents.ts`:

```ts
{
  id: "weekly-report",
  name: "Weekly Report",
  description: "Generates the weekly self-serve performance report and delivers it to Telegram and Slack.",
  schedule: "Every Wednesday 9am",
}
```

The runner function in `app/api/agents/[id]/run/route.ts`:

1. Fetches all 5 self-serve endpoints in parallel:
   - `/api/self-serve/kpis`
   - `/api/self-serve/weekly-dau`
   - `/api/self-serve/monthly-submissions`
   - `/api/self-serve/pipeline-stages`
   - `/api/self-serve/email-split`
2. Sends combined data to Claude API (`claude-haiku-4-5-20251001`) with a structured prompt requesting:
   - Executive summary (3-4 sentences)
   - What's working (2-3 bullet points with data references)
   - What's not working (2-3 bullet points)
   - Recommendations (2-3 actionable items)
3. Saves report to `.weekly-report.json` in project root
4. Posts formatted message to Telegram (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`)
5. Posts formatted message to Slack (`SLACK_WEBHOOK_URL`) — skipped if env var empty

### Report JSON shape

```ts
{
  generatedAt: string   // ISO timestamp
  weekLabel: string     // e.g. "W23 · Jun 2–8 2026"
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
  insights: string      // Claude-generated markdown narrative
}
```

### New API routes

- `GET /api/self-serve/weekly-report` — reads `.weekly-report.json`, returns report or `null` if not yet generated
- `POST /api/cron/weekly-report` — cron trigger endpoint, validates `Authorization: Bearer $CRON_SECRET`, calls the agent runner directly

### Scheduling

**Vercel:** `vercel.json` cron entry:
```json
{ "crons": [{ "path": "/api/cron/weekly-report", "schedule": "0 9 * * 3" }] }
```

**Self-hosted fallback:** system crontab:
```
0 9 * * 3 curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/weekly-report
```

---

## Dashboard Panel

New panel added at the bottom of `components/self-serve-dashboard.tsx`:

- Header: "Weekly Report" + `weekLabel` + `generatedAt` relative timestamp
- "Run Now" button → `POST /api/agents/weekly-report/run` → polls until status `success`
- While running: skeleton loader, previous report still visible
- Content: Claude's `insights` rendered as formatted text (sections for Summary, What's Working, What's Not, Recommendations)
- If no report yet: empty state with "Run Now" prompt

---

## Environment Variables

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather ✅ |
| `TELEGRAM_CHAT_ID` | BidMachine channel ID ✅ |
| `SLACK_WEBHOOK_URL` | Incoming webhook URL (to be filled in) |
| `CRON_SECRET` | Random secret to authenticate cron trigger |

---

## Delivery Format

**Telegram/Slack message structure:**
```
📊 Weekly Self-Serve Report — W23 · Jun 2–8

Norm DAU QTD: 42,300 (+12% vs Q1)
This week: 3,200 | Last week: 2,900 (+10% WoW)
Submissions: 47 | Approval rate: 68%
APAC DAU: 8,100

[AI narrative sections follow]
```
