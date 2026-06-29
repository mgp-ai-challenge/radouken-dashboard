# Self-Serve Dashboard — Design Spec
Date: 2026-06-02

## Overview

Add a "Self-Serve" tab to the main Dashboard page (`/`). The existing Outbound Attribution view becomes the first tab; the Self-Serve pipeline view becomes the second tab. No new route or nav item is needed.

The Self-Serve tab is a live analytics dashboard that pulls data from the HubSpot CRM via server-side Next.js API routes, rendered with Recharts. The client polls all data endpoints every 60 seconds and shows per-panel loading skeletons on first load and per-panel error states on failure.

---

## Layout (4 rows)

### Row 1 — KPI Cards (4 cards)
| Card | Value | Extra |
|---|---|---|
| Norm DAU QTD | Sum of `normalised_dau__us_dau__tier_1__065` for approved deals Q2 | Donut/gauge showing % of 1,000,000 target |
| This Week Norm DAU | Same field, deals created in current ISO week | WoW delta chip (green ▲ / red ▼) vs prior week |
| Q2 Unique Form Submissions | Count of all deals in pipeline 52357803 created Apr 1+ | — |
| APAC QTD Norm DAU | Same as Norm DAU QTD but filtered to owner 86978311 (Charlene Zheng) | — |

### Row 2 — Two panels side by side
- **Left**: Semi-circular SVG gauge showing QTD Norm DAU vs 1M target + table of pipeline stages with coloured dots and US DAU values
- **Right**: Bar chart — week-on-week Norm DAU, last 8 weeks, current week bar highlighted green

### Row 3 — Full width
Recharts `ComposedChart`: grouped bars (Submissions + Approved count) per month Jan–May 2026, with approval rate % as a line on a secondary Y-axis. May bars rendered at 45% opacity with an italic "(partial)" label.

### Row 4 — Two panels side by side
- **Left**: Grouped bar chart — AdMob deal count by month Jan–May, Q1 months in muted purple, Q2 months in amber. Static warning banner below: _"28 publishers waiting. Gaetan needs ~4 weeks. Start now → Q3 ready."_
- **Right**: Grouped bar chart — Business vs Free email deal counts, Q1 and Q2 side by side. Red warning banner below if free-email % for current quarter exceeds 30%.

---

## Data Sources (all HubSpot pipeline 52357803)

### Definitions
- **Q2** = createdate ≥ 2026-04-01 (computed dynamically each render)
- **Q1** = createdate 2026-01-01 – 2026-03-31
- **Approved stage** = dealstage `107224655`
- **APAC owner** = hubspot_owner_id `86978311`
- **Free email domains** = gmail.com, yahoo.com, hotmail.com, outlook.com, icloud.com, live.com, aol.com, mail.com, protonmail.com, yandex.com, qq.com, 163.com, 126.com

### Stage ID → Display Name Map (verified from HubSpot pipeline API)
| Stage ID | Display Name | Q2 Deal Count |
|---|---|---|
| 107224653 | New Registration | 3 |
| 107224654 | Under Review | — |
| 1347884654 | Pending Verification | 18 |
| 114401160 | Denied | 111 |
| 1275149844 | AdMob / GAM | 31 |
| 107224655 | Approved | 14 |
| 107224657 | Live | 9 |
| 1319309459 | Paused | — |
| 107224658 | Promoted | — |
| 1062161234 | For Remarketing | — |
| 1079394475 | Closed / Trash | 14 |

Note: The pipeline breakdown panel shows all stages with non-zero DAU values. Stage names "Transfer to Sales / Closed AM / Denied Default / Denied Low DAU" from the original brief do not match actual HubSpot stage names — real names above are used.

---

## API Routes (`/api/self-serve/`)

All routes use `process.env.HUBSPOT_ACCESS_TOKEN` and call `https://api.hubapi.com/crm/v3/objects/deals/search`. All aggregation is done server-side.

### `GET /api/self-serve/kpis`
Fetches four values:
1. QTD Norm DAU — paginate all approved deals (stage 107224655) with createdate ≥ Q2 start, sum `normalised_dau__us_dau__tier_1__065`
2. This-week Norm DAU — same filter but createdate ≥ current ISO week Monday; also fetch previous week for WoW delta
3. Q2 submissions — count of all pipeline deals with createdate ≥ Q2 start
4. APAC Norm DAU — same as (1) but add `hubspot_owner_id = 86978311` filter

Response:
```json
{
  "qtdNormDau": 283949,
  "thisWeekNormDau": 48000,
  "prevWeekNormDau": 43000,
  "q2Submissions": 224,
  "apacNormDau": 91000
}
```

### `GET /api/self-serve/pipeline-stages`
Fetches all Q2 deals with `bm_dau_usa_publishers`, groups by dealstage server-side.

Response:
```json
[
  { "stageId": "107224655", "name": "Approved", "usDau": 210000 },
  ...
]
```

### `GET /api/self-serve/weekly-dau`
Fetches approved deals (stage 107224655) created in the last 8 ISO weeks. Groups by ISO week number of `createdate`, sums `normalised_dau__us_dau__tier_1__065`.

Response:
```json
[{ "week": "W19", "normDau": 35000, "isCurrent": false }, ...]
```

### `GET /api/self-serve/monthly-submissions`
Fetches all pipeline deals Jan–May 2026. Groups by month, counts total deals and approved deals.

Response:
```json
[{ "month": "Jan", "submissions": 95, "approved": 42 }, ...]
```

### `GET /api/self-serve/admob`
Fetches deals where `bm__mediation = "admob"`, Jan–May 2026. Groups by month with Q1/Q2 flag.

Response:
```json
[{ "month": "Jan", "count": 12, "quarter": "Q1" }, ...]
```

### `GET /api/self-serve/email-split`
Fetches all deals in pipeline for Q1 and Q2. For each deal, fetches associated contact email via the associations API (`/crm/v3/objects/deals/{id}/associations/contacts` → contact properties). Classifies domain as free or business. Returns counts per quarter.

Due to the volume of deals (490 Jan–May), this route fetches deals in batches and resolves contact emails concurrently with a concurrency limit of 10. Results are cached in-memory per process for 55 seconds to avoid hammering the API on every poll.

Response:
```json
{
  "q1": { "business": 78, "free": 22 },
  "q2": { "business": 145, "free": 65 }
}
```

---

## Frontend Components

All in `components/self-serve/`:

| Component | Description |
|---|---|
| `SelfServeDashboard` | Root component, owns all state and polling logic |
| `KpiCard` | Label + value + optional donut ring or delta chip |
| `SemiGauge` | Recharts `PieChart` in half-donut config, shows QTD % of 1M |
| `StageTable` | Coloured dot + name + formatted DAU value |
| `WowBarChart` | Recharts `BarChart`, 8 weeks, current week in `#1D9E75` |
| `MonthlySubmissionsChart` | Recharts `ComposedChart`, grouped bars + line |
| `AdMobChart` | Recharts `BarChart`, Q1 purple / Q2 amber by month |
| `EmailSplitChart` | Recharts `BarChart`, business/free grouped by quarter |
| `PanelError` | "Could not load data" state with retry hint |
| `PanelSkeleton` | Skeleton placeholder for first load |
| `LastUpdated` | Timestamp top-right of the dashboard |

---

## Tab Integration

`app/page.tsx` gains a tab bar (shadcn `Tabs` or simple button tabs) at the top:
- **Outbound** — existing content unchanged
- **Self-Serve** — renders `<SelfServeDashboard />`

Tab state is local (useState), no URL routing.

---

## Theming

Add to `globals.css` `:root`:
```css
--bm-navy: #1A3A5C;
--bm-blue: #2E75B6;
--bm-green: #1D9E75;
--bm-red: #E24B4A;
--bm-amber: #F59E0B;
--bm-purple: #7C6FAD;
```

Recharts receives explicit hex strings (CSS variables don't work in SVG fill attributes).

---

## Error Handling

Each API route returns `{ error: string }` on failure. The client tracks loading/error state per data source independently. A failed fetch shows `<PanelError />` in that panel only — the rest of the dashboard continues to function. No error crashes the page.

---

## Polling

```ts
useEffect(() => {
  fetchAll()
  const id = setInterval(fetchAll, 60_000)
  return () => clearInterval(id)
}, [])
```

`fetchAll` fires all 6 fetches in parallel via `Promise.allSettled`.

---

## Dependencies to Add

- `recharts` — charts
- `@types/recharts` is not needed (recharts ships its own types)

---

## Out of Scope

- Drill-down / deal detail views
- Date range picker (uses fixed Q1/Q2/current-quarter logic)
- Export / download
- Stage name resolution from HubSpot API (hardcoded map, verify manually)
