# G2 Dashboard Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a G2 dashboard page at `/g2` — styled identically to the Self Serve dashboard — showing G2 reviews, profile analytics, paid campaign performance, and HubSpot Buyer Intent signals in a single scrolling view.

**Architecture:** A `lib/g2.ts` client wraps all G2 API calls. Four API routes under `app/api/g2/` serve each panel independently. A `components/g2-dashboard.tsx` client component fetches all routes in `Promise.allSettled` and renders the dark fintech design system shared with `components/self-serve-dashboard.tsx`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict mode, G2 Data API (`https://data.g2.com/api/v1/`), HubSpot CRM API, Recharts (line charts), dark fintech design system (existing `C` tokens + `Panel`/`KpiCard` components)

---

## Environment Variables

- `G2_API_TOKEN` — G2 Data API bearer token (add to `.env.local`, never commit)
- `HUBSPOT_ACCESS_TOKEN` — already present in `.env.local`

---

## G2 API

**Base URL:** `https://data.g2.com/api/v1/`

**Auth header:** `Authorization: Token token=${G2_API_TOKEN}`

**All fetches:** `cache: "no-store"`

**Product discovery:** All G2 API calls require a `product_id`. `lib/g2.ts` will include a `getProduct()` helper that calls `GET /products` and finds the matching product. Add `G2_PRODUCT_SLUG` to `.env.local` with your product's slug (e.g. `adjust` or `appsflyer`) — if omitted, the first product returned is used.

Key endpoints used:
- `GET /products` — list products; find the matching product by name to get `product_id`, `star_rating`, `reviews_count`
- `GET /reviews?filter[product_id]=<id>&page[size]=10&sort=-created_at` — 10 most recent reviews
- `GET /products/<id>/ranking` — category rank and rank movement
- `GET /profile_views?filter[product_id]=<id>&filter[period]=weekly` — weekly profile view counts (last 8 weeks)
- `GET /campaigns?filter[product_id]=<id>` — paid campaigns with impressions, clicks, spend

> **Note:** Exact endpoint paths and filter parameter names should be verified against the G2 API docs during implementation. The G2 Data API uses JSON:API conventions.

---

## HubSpot Buyer Intent

G2's native HubSpot integration creates custom properties on **Company** records. The exact property names are created by the integration and must be discovered at implementation time by querying:

```
GET https://api.hubapi.com/crm/v3/properties/companies
```

Look for properties with names starting with `g2_`. Common defaults include:
- `g2_buying_intent_score` — numeric intent score
- `g2_product_researched` — product page viewed
- `g2_researched_date` or `hs_lastmodifieddate` as a proxy for recency

The intent API route will:
1. Query HubSpot company search for companies where any `g2_*` property was updated in the last 30 days
2. Return: company name, domain, intent score (if available), last updated date
3. Cap results at 50 companies, sorted by most recent

---

## Files

**Create:**
- `lib/g2.ts` — G2 API client (base fetch wrapper + typed helpers)
- `app/g2/page.tsx` — page entry point (imports and renders `G2Dashboard`)
- `app/api/g2/reviews/route.ts` — recent reviews + aggregate rating
- `app/api/g2/profile/route.ts` — category rank + weekly profile views (8 weeks)
- `app/api/g2/campaigns/route.ts` — paid campaign table data
- `app/api/g2/intent/route.ts` — HubSpot company intent signals
- `components/g2-dashboard.tsx` — full dashboard client component

**Modify:**
- `components/app-sidebar.tsx` — add G2 nav item with `Star` icon

---

## Data Types

```typescript
// lib/g2.ts
export interface G2Review {
  id: string
  title: string
  rating: number          // 1–5
  reviewerRole: string
  companySize: string
  body: string            // "What do you like best?" excerpt
  createdAt: string       // ISO date
}

export interface G2Product {
  id: string
  name: string
  starRating: number      // e.g. 4.7
  reviewsCount: number
}

export interface G2ProfileView {
  week: string            // ISO date of week start
  views: number
}

export interface G2Rank {
  category: string
  rank: number
  rankChange: number      // positive = rank number decreased = improved position; negative = rank number increased = dropped
}

export interface G2Campaign {
  id: string
  name: string
  impressions: number
  clicks: number
  ctr: number             // percentage
  spend: number           // USD
  status: "active" | "paused" | "ended"
}

export interface G2IntentCompany {
  id: string
  name: string
  domain: string
  intentScore: number | null
  lastSignalAt: string    // ISO date
}
```

---

## API Routes

### `GET /api/g2/reviews`

Returns:
```typescript
{
  product: { starRating: number; reviewsCount: number }
  reviews: G2Review[]   // 10 most recent
}
```

### `GET /api/g2/profile`

Returns:
```typescript
{
  rank: G2Rank
  weeklyViews: G2ProfileView[]  // 8 weeks, oldest first
  totalViewsThisMonth: number
  totalViewsLastMonth: number
}
```

### `GET /api/g2/campaigns`

Returns:
```typescript
{
  campaigns: G2Campaign[]  // sorted by spend desc
}
```

Returns `{ campaigns: [] }` if no campaigns found.

### `GET /api/g2/intent`

Returns:
```typescript
{
  companies: G2IntentCompany[]  // up to 50, sorted by lastSignalAt desc
  totalThisMonth: number
  totalThisWeek: number
}
```

---

## Page Layout (`app/g2/page.tsx` + `components/g2-dashboard.tsx`)

### Sidebar
Add to `components/app-sidebar.tsx` navItems (after Self-Serve, before Agents):
```typescript
{ href: "/g2", label: "G2", icon: Star }
```

### KPI Strip (4 cards)

| Card | Value | Trend |
|------|-------|-------|
| Star Rating | `4.7 ★` | review count below |
| Total Reviews | `312` | QoQ change badge |
| Profile Views | `8.4k` this month | vs last month badge |
| Intent Signals | `47` this month | this week count below |

### Panel 1 — Recent Reviews
- Section label: "RECENT REVIEWS"
- Feed of 10 rows; each row:
  - Star rating: filled/empty star icons (★★★★☆), colored: green ≥ 4, amber = 3, red ≤ 2
  - Review title (bold, truncated)
  - Reviewer role · company size · date (muted)
  - Body excerpt (2-line clamp, muted)
- Dividers between rows
- Loading skeleton: 3 rows of placeholder bars

### Panel 2 — Profile Analytics
Two side-by-side cards inside one panel:

**Category Rank card (left, ~35% width)**
- Large rank number (`#4`) in accent color
- Category name below
- Rank change badge: `↑2 this month` (green) or `↓1` (red) or `—` (no change)

**Profile Views chart (right, ~65% width)**
- Section label: "WEEKLY PROFILE VIEWS"
- Recharts `ComposedChart` with a single `Line` (same style as Monthly Submissions)
- X-axis: abbreviated week labels (e.g. "Apr 7", "Apr 14")
- Y-axis: view counts
- `LabelList` showing values on each data point

### Panel 3 — Paid Campaigns
- Section label: "PAID CAMPAIGNS"
- Table columns: Campaign · Status · Impressions · Clicks · CTR · Spend
- Status badge: green=active, amber=paused, gray=ended
- Sorted by spend desc by default
- Empty state: "No campaign data available" if `campaigns.length === 0`
- Loading skeleton: 3 rows

### Panel 4 — Buyer Intent
- Section label: "G2 BUYER INTENT — LAST 30 DAYS"
- Sub-header stat: `X companies this month · Y this week`
- Table columns: Company · Domain · Intent Score · Last Signal
- Intent Score: numeric if available, `—` if null
- Last Signal: relative time (e.g. "2d ago")
- Empty state: "No intent signals found. Verify G2–HubSpot integration is active."
- Loading skeleton: 5 rows
- Capped at 50 rows

### Error handling
Each panel renders a `DataError` component (same as self-serve) if its API route returns an error. Panels are independent — one error does not affect others.

---

## Design System

The design primitives (`Panel`, `SectionLabel`, `LoadingSkeleton`, `DataError`, `KpiCard`, `TrendBadge`, `C` tokens, `MONO`, `fmtNum`) are defined inside `components/self-serve-dashboard.tsx` and are not exported. **Duplicate** the minimal set needed into `components/g2-dashboard.tsx` — do not modify `self-serve-dashboard.tsx` to export them.

The G2 dashboard uses the same dark background (`C.bg = "#020d07"`), card styles, border glows, and typography as the self-serve dashboard.
