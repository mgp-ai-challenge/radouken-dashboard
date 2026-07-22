# ICP Sourcing Page — Design Spec
**Date:** 2026-07-22
**Project:** radouken-dashboard (outbound-attribution)
**Status:** Approved — ready for implementation planning

---

## Overview

A new dashboard page that sources and scores candidate advertisers against the Q3 UA ICP criteria. Results are fetched on-demand from Sensor Tower, cross-referenced against Lemlist (existing outreach history) and HubSpot (existing BM publisher / customer status), and presented in a tabbed table with per-candidate recommended actions.

Source brief: UA Q3 Commercialisation Document §4.

---

## Decisions Made

- **Data freshness:** On-demand — user clicks "Run Search", all fetches fire live. No caching or scheduled jobs.
- **BM publisher exclusion:** HubSpot `lifecyclestage = "customer"` is the hard-exclude signal.
- **MMP gate:** Best-effort SDK detection via Sensor Tower. If the plan doesn't have access (403/404), candidates receive `mmpDetected = "unknown"` and surface with `recommendedAction = "manual-verify-mmp"` rather than being dropped.
- **Verticals:** 4 Sensor Tower-sourced (IAP gaming, iGaming, e-commerce, prediction markets) + 1 manual placeholder (CTV). All built in v1.
- **API architecture:** Per-vertical routes, parallel client fetch (Option B). Isolated failure domains, matches existing codebase pattern.

---

## ICP Criteria Encoded

### Hard gates (all verticals, applied server-side before returning results)

| Gate | Behaviour on failure |
|---|---|
| Country = US | ST query filtered to US; not a post-filter |
| MMP = AppsFlyer or Adjust (SDK detected) | Excluded from results. `mmpDetected = "unknown"` → not excluded, flagged for manual verify |
| Not an existing BM publisher (HubSpot `lifecyclestage != "customer"`) | Excluded entirely — never appears in results |

### Vertical-specific gates

| Vertical | ST Categories | DAU / Downloads gate |
|---|---|---|
| IAP gaming | Casual, Puzzle, Simulation, Casino-adjacent idle/tycoon | `stEstimatedUSDAU >= 100,000` (hard gate, excluded if below) |
| iGaming | Casino | No DAU gate — all MMP-passing candidates returned |
| E-commerce / retargeting | Shopping, Retail | `stMonthlyDownloads >= 500,000` (hard gate). Retargeting list size flagged as manual check — not a ST field |
| Prediction markets / DFS | Sports, Finance | No hard DAU gate — source from spend/download momentum |
| CTV | N/A | Manual tab — static note pointing to Paul's partner lists |

### Soft signals (directional only, not gates)

- `stMonthlyDownloads` and `stEstimatedUSDAU` used as proxy for competitor DSP spend (≥$50K/mo). Labeled as estimates in UI. Never confused with advertiser-verified MMP numbers.

---

## Architecture

### New files

```
app/icp-sourcing/page.tsx
app/api/icp-sourcing/iap-gaming/route.ts
app/api/icp-sourcing/igaming/route.ts
app/api/icp-sourcing/ecommerce/route.ts
app/api/icp-sourcing/prediction-markets/route.ts
components/icp-sourcing-dashboard.tsx
lib/icp-sourcing.ts
docs/superpowers/specs/2026-07-22-icp-sourcing-design.md  ← this file
```

### Modified files

```
lib/sensortower.ts         ← add new query functions (see below)
components/app-sidebar.tsx ← add "UA Sourcing" nav item
```

### Per-vertical pipeline (each route runs this independently)

```
1. ST category search → app list (country=US, categories per vertical)
2. For each app (batched for rate limits):
   a. checkSDKDetection()  → mmpDetected (best-effort)
   b. getAppDAU()          → stEstimatedUSDAU  (IAP gaming only)
   c. getAppRevenue()      → stMonthlyDownloads (e-commerce only)
3. Apply hard gates → filter out excluded candidates
4. Resolve publisher domain from ST app record
5. Lemlist: scan `TARGET_CAMPAIGNS` (from `lib/lemlist.ts`) leads for publisher domain match → engagement tier + last contacted date
6. HubSpot: company search by domain, lifecyclestage check → exclude customers
7. Score and sort → return ICPCandidate[]
```

---

## Data Types (`lib/icp-sourcing.ts`)

```typescript
export type Vertical = "iap-gaming" | "igaming" | "ecommerce" | "prediction-markets" | "ctv"
export type MMPDetected = "appsflyer" | "adjust" | "both" | "none" | "unknown"
export type EngagementTier = "replied" | "interested" | "clicked" | "opened" | "contacted" | null
export type RecommendedAction = "warm-re-approach" | "cold-outreach" | "manual-verify-mmp"

export interface ICPCandidate {
  appId: string
  appName: string
  publisherName: string
  publisherDomain: string | null
  vertical: Vertical
  stEstimatedUSDAU: number | null       // ST panel estimate — not advertiser-verified
  stMonthlyDownloads: number | null
  mmpDetected: MMPDetected
  isExistingBMPublisher: boolean        // always false in returned results (customers are excluded)
  lemlistEngagement: EngagementTier
  lastContactedAt: string | null        // ISO string
  recommendedAction: RecommendedAction
  storeUrl: string | null
}

// API route response shape
export interface ICPSourcingResponse {
  candidates: ICPCandidate[]
  fetchedAt: string    // ISO string
  error?: string
}
```

---

## Scoring & Sort Logic

### Recommended action derivation

```
if mmpDetected = "unknown"
  → "manual-verify-mmp"
else if lemlistEngagement in ["replied", "interested", "clicked", "opened", "contacted"]
  → "warm-re-approach"
else
  → "cold-outreach"
```

### Sort order within a tab

1. `warm-re-approach` first (sorted by engagement tier weight: replied > interested > clicked > opened > contacted)
2. `cold-outreach` (sorted by stEstimatedUSDAU desc, or stMonthlyDownloads desc for e-commerce)
3. `manual-verify-mmp` last

---

## Sensor Tower Extensions (`lib/sensortower.ts`)

Four new functions added to the existing module (preserving existing `stFetch`, `enrichCompany`):

```typescript
// Search apps by category and country. Returns basic app list.
searchAppsByCategory(categories: string[], country: string, store: "ios" | "android"): Promise<STAppSummary[]>

// Usage Intelligence — US DAU estimate. Returns null if module unavailable.
getAppDAU(appId: string, store: "ios" | "android"): Promise<number | null>

// SDK detection — checks for AppsFlyer/Adjust. Returns "unknown" on 403/404.
checkSDKDetection(appId: string, store: "ios" | "android"): Promise<MMPDetected>

// Revenue + downloads. Returns null fields if unavailable.
getAppRevenue(appId: string, store: "ios" | "android"): Promise<{ monthlyDownloads: number | null }>
```

**Open items to resolve against live ST docs before implementation:**
- Exact endpoint path and filter param names for category + country search
- Whether SDK detection is a query param on the app detail endpoint or a separate filter-builder flow
- Rate limits on Usage Intelligence endpoint (to size batch concurrency)
- Whether the account token covers SDK Detection and Usage Intelligence modules

---

## UI (`components/icp-sourcing-dashboard.tsx`)

Follows the existing dark design system (`C` palette from `g2-dashboard.tsx`, same `Panel` component and monospace number formatting).

### Layout

```
Header
  "UA ICP Sourcing — Q3 2026"
  Subtitle with data source caveat
  [Run Search] button

Vertical tabs: IAP Gaming | iGaming | E-Commerce | Prediction Markets | CTV
  Tab badge: spinner (loading) | count (done) | ⚠ (error)

Tab content:
  Loading  → skeleton rows
  Error    → inline error panel
  Results  → count + table
  CTV      → static info card ("Source from Paul's partner lists — not available in Sensor Tower")
```

### Table columns

| Column | Detail |
|---|---|
| App | Name + platform icon + store link |
| Publisher / Company | Publisher name |
| Sensor Tower est. US DAU | Formatted number; tooltip clarifying it's a panel estimate |
| MMP Detected | Badge: AppsFlyer / Adjust / Both / None / Unknown |
| Lemlist Engagement | Badge: Replied / Interested / Clicked / Opened / Contacted / — |
| Last Contacted | Relative date ("14 days ago") |
| Recommended Action | Coloured badge: green (warm-re-approach) / blue (cold-outreach) / amber (manual-verify-mmp) |

### Run Search behaviour

- Triggers all 4 ST fetches simultaneously on click
- Each tab independently shows skeleton while its fetch is in-flight
- Results persist in component state until next "Run Search"
- No auto-fetch on page load

---

## Error Handling

### API route level

Each route returns `{ candidates: ICPCandidate[], fetchedAt: string }` on success or `{ error: string, candidates: [] }` on failure.

Partial failures inside a route do not drop the candidate — they null out the failed field:
- DAU fetch fails → `stEstimatedUSDAU: null`
- Lemlist fails → `lemlistEngagement: null, lastContactedAt: null`
- HubSpot fails → candidate passes through with `isExistingBMPublisher: false` (conservative — log warning, don't drop)

### ST SDK detection failure modes

| Status | Behaviour |
|---|---|
| 403 / 404 | Set `mmpDetected = "unknown"` for all in batch, log once, do not retry |
| 429 | Retry once after `Retry-After` delay (same as `llFetch` pattern) |
| Other error | Set `mmpDetected = "unknown"`, continue |

### Client level

- Each tab shows an isolated error panel on failure
- "Run Search" is the natural retry — re-triggers all fetches

---

## Out of Scope (v1)

- Persistent storage of results (no DB, no file cache)
- CTV vertical data (manual process — Paul's lists)
- Retargeting list size check (not a ST field — flagged as manual check in UI)
- Export to CSV
- Writing candidates back to Lemlist or HubSpot
