# G2 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a G2 dashboard at `/g2` — styled identically to the Self Serve dashboard — showing G2 reviews, profile analytics, paid campaign performance, and HubSpot Buyer Intent signals.

**Architecture:** `lib/g2.ts` wraps all G2 API calls. Four API routes under `app/api/g2/` serve each panel independently. `components/g2-dashboard.tsx` fetches all routes in `Promise.allSettled` and renders the dark fintech design system shared with `components/self-serve-dashboard.tsx` (primitives duplicated, not imported).

**Tech Stack:** Next.js 15 App Router, TypeScript strict mode, G2 Data API (`https://data.g2.com/api/v1/`), HubSpot CRM API, Recharts (ComposedChart + Line), dark fintech design system (`C` tokens, inline styles)

---

## Files

**Create:**
- `lib/g2.ts` — G2 API client: base fetch, typed helpers, all exported types
- `app/api/g2/reviews/route.ts` — product aggregate + 10 recent reviews
- `app/api/g2/profile/route.ts` — category rank + 8 weeks of profile views
- `app/api/g2/campaigns/route.ts` — paid campaigns table
- `app/api/g2/intent/route.ts` — HubSpot G2 buyer intent companies
- `components/g2-dashboard.tsx` — full client dashboard component
- `app/g2/page.tsx` — page entry point

**Modify:**
- `components/app-sidebar.tsx` — add G2 nav item with `Star` icon

---

## Task 1: G2 API Client (`lib/g2.ts`)

**Files:**
- Create: `lib/g2.ts`

> **Note on G2 API JSON:API format:** All responses use `{ data: [...] }` or `{ data: {...} }` with attributes under `.attributes`. Exact field names (e.g., `star_rating` vs `rating`) must be confirmed from live API responses during implementation — log `res.json()` and adjust if fields differ.

- [ ] **Step 1: Create `lib/g2.ts` with types and base fetcher**

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
  rankChange: number      // positive = rank number decreased = improved; negative = dropped
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

const G2_BASE = "https://data.g2.com/api/v1"
const G2_TOKEN = process.env.G2_API_TOKEN!

async function g2Fetch(path: string): Promise<unknown> {
  const res = await fetch(`${G2_BASE}${path}`, {
    headers: { Authorization: `Token token=${G2_TOKEN}` },
    cache: "no-store",
  })
  if (!res.ok) {
    throw new Error(`G2 API ${path} → ${res.status} ${res.statusText}`)
  }
  return res.json()
}

// ─── Product discovery ────────────────────────────────────────────────────────

let _cachedProduct: G2Product | null = null

export async function getG2Product(): Promise<G2Product> {
  if (_cachedProduct) return _cachedProduct
  const slug = process.env.G2_PRODUCT_SLUG ?? ""
  const qs = slug ? `?filter[slug]=${encodeURIComponent(slug)}` : ""
  const data = await g2Fetch(`/products${qs}`) as { data: Array<{ id: string; attributes: Record<string, unknown> }> }
  const item = data.data[0]
  if (!item) throw new Error("G2: no product found")
  _cachedProduct = {
    id: item.id,
    name: String(item.attributes.name ?? ""),
    starRating: Number(item.attributes.star_rating ?? 0),
    reviewsCount: Number(item.attributes.reviews_count ?? 0),
  }
  return _cachedProduct
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

export async function getG2Reviews(productId: string): Promise<G2Review[]> {
  const data = await g2Fetch(
    `/reviews?filter[product_id]=${productId}&page[size]=10&sort=-created_at`
  ) as { data: Array<{ id: string; attributes: Record<string, unknown> }> }
  return (data.data ?? []).map((item) => ({
    id: item.id,
    title: String(item.attributes.title ?? ""),
    rating: Number(item.attributes.star_rating ?? 0),
    reviewerRole: String(item.attributes.reviewer_job_title ?? item.attributes.submitter_title ?? ""),
    companySize: String(item.attributes.company_size ?? ""),
    body: String(item.attributes.love ?? item.attributes.body ?? ""),
    createdAt: String(item.attributes.created_at ?? ""),
  }))
}

// ─── Profile views ────────────────────────────────────────────────────────────

export async function getG2ProfileViews(productId: string): Promise<G2ProfileView[]> {
  const data = await g2Fetch(
    `/profile_views?filter[product_id]=${productId}&filter[period]=weekly`
  ) as { data: Array<{ id: string; attributes: Record<string, unknown> }> }
  return (data.data ?? []).map((item) => ({
    week: String(item.attributes.period_start ?? item.attributes.date ?? ""),
    views: Number(item.attributes.views ?? item.attributes.count ?? 0),
  }))
}

// ─── Category ranking ─────────────────────────────────────────────────────────

export async function getG2Rank(productId: string): Promise<G2Rank | null> {
  try {
    const data = await g2Fetch(`/products/${productId}/ranking`) as {
      data: { id: string; attributes: Record<string, unknown> }
    }
    const attrs = data.data?.attributes ?? {}
    return {
      category: String(attrs.category_name ?? attrs.category ?? ""),
      rank: Number(attrs.rank ?? 0),
      rankChange: Number(attrs.rank_change ?? 0),
    }
  } catch {
    return null
  }
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export async function getG2Campaigns(productId: string): Promise<G2Campaign[]> {
  try {
    const data = await g2Fetch(`/campaigns?filter[product_id]=${productId}`) as {
      data: Array<{ id: string; attributes: Record<string, unknown> }>
    }
    return (data.data ?? []).map((item) => {
      const attrs = item.attributes
      return {
        id: item.id,
        name: String(attrs.name ?? ""),
        impressions: Number(attrs.impressions ?? 0),
        clicks: Number(attrs.clicks ?? 0),
        ctr: Number(attrs.ctr ?? attrs.click_through_rate ?? 0),
        spend: Number(attrs.spend ?? attrs.total_spend ?? 0),
        status: (["active", "paused", "ended"].includes(String(attrs.status))
          ? String(attrs.status)
          : "ended") as G2Campaign["status"],
      }
    })
  } catch {
    return []
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/radustoia/outbound-attribution && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors for `lib/g2.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/g2.ts
git commit -m "feat: add G2 API client lib/g2.ts"
```

---

## Task 2: Reviews API Route (`app/api/g2/reviews/route.ts`)

**Files:**
- Create: `app/api/g2/reviews/route.ts`

- [ ] **Step 1: Create route**

```typescript
// app/api/g2/reviews/route.ts
import { NextResponse } from "next/server"
import { getG2Product, getG2Reviews } from "@/lib/g2"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const product = await getG2Product()
    const reviews = await getG2Reviews(product.id)
    return NextResponse.json({
      product: { starRating: product.starRating, reviewsCount: product.reviewsCount },
      reviews,
    })
  } catch (e) {
    console.error("[g2/reviews]", e)
    return NextResponse.json({ error: "Failed to load G2 reviews" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Start dev server and test route**

```bash
# In a separate terminal, with dev server running:
curl -s http://localhost:3000/api/g2/reviews | head -c 500
```

Expected: JSON with `{ product: { starRating, reviewsCount }, reviews: [...] }`. If G2_API_TOKEN is not set, you'll get a 500 — that's correct. If the field names differ from what `lib/g2.ts` expects, check the raw response and update the field mappings in `lib/g2.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/api/g2/reviews/route.ts
git commit -m "feat: add GET /api/g2/reviews route"
```

---

## Task 3: Profile API Route (`app/api/g2/profile/route.ts`)

**Files:**
- Create: `app/api/g2/profile/route.ts`

- [ ] **Step 1: Create route**

```typescript
// app/api/g2/profile/route.ts
import { NextResponse } from "next/server"
import { getG2Product, getG2Rank, getG2ProfileViews } from "@/lib/g2"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const product = await getG2Product()
    const [rank, allViews] = await Promise.all([
      getG2Rank(product.id),
      getG2ProfileViews(product.id),
    ])

    // Sort oldest-first, take last 8 weeks
    const sorted = [...allViews].sort((a, b) => a.week.localeCompare(b.week))
    const weeklyViews = sorted.slice(-8)

    // Current month = this calendar month; last month = previous calendar month
    const now = new Date()
    const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`

    let totalViewsThisMonth = 0
    let totalViewsLastMonth = 0
    for (const v of allViews) {
      if (v.week.startsWith(thisMonthStr)) totalViewsThisMonth += v.views
      if (v.week.startsWith(lastMonthStr)) totalViewsLastMonth += v.views
    }

    return NextResponse.json({
      rank: rank ?? { category: "", rank: 0, rankChange: 0 },
      weeklyViews,
      totalViewsThisMonth,
      totalViewsLastMonth,
    })
  } catch (e) {
    console.error("[g2/profile]", e)
    return NextResponse.json({ error: "Failed to load G2 profile" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Test route**

```bash
curl -s http://localhost:3000/api/g2/profile | head -c 500
```

Expected: `{ rank: { category, rank, rankChange }, weeklyViews: [...], totalViewsThisMonth, totalViewsLastMonth }`

- [ ] **Step 3: Commit**

```bash
git add app/api/g2/profile/route.ts
git commit -m "feat: add GET /api/g2/profile route"
```

---

## Task 4: Campaigns API Route (`app/api/g2/campaigns/route.ts`)

**Files:**
- Create: `app/api/g2/campaigns/route.ts`

- [ ] **Step 1: Create route**

```typescript
// app/api/g2/campaigns/route.ts
import { NextResponse } from "next/server"
import { getG2Product, getG2Campaigns } from "@/lib/g2"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const product = await getG2Product()
    const campaigns = await getG2Campaigns(product.id)
    const sorted = [...campaigns].sort((a, b) => b.spend - a.spend)
    return NextResponse.json({ campaigns: sorted })
  } catch (e) {
    console.error("[g2/campaigns]", e)
    return NextResponse.json({ error: "Failed to load G2 campaigns" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Test route**

```bash
curl -s http://localhost:3000/api/g2/campaigns | head -c 300
```

Expected: `{ campaigns: [...] }` — empty array is valid if no campaigns exist.

- [ ] **Step 3: Commit**

```bash
git add app/api/g2/campaigns/route.ts
git commit -m "feat: add GET /api/g2/campaigns route"
```

---

## Task 5: Intent API Route (`app/api/g2/intent/route.ts`)

**Files:**
- Create: `app/api/g2/intent/route.ts`

> **HubSpot G2 property discovery:** The G2–HubSpot integration creates `g2_*` properties on Company records. First run `GET /crm/v3/properties/companies` and look for properties starting with `g2_`. Common defaults: `g2_buying_intent_score`, `g2_product_researched`, `g2_researched_date`. If these don't exist, the search will 400 — the route handles that gracefully by returning empty.

- [ ] **Step 1: Create route**

```typescript
// app/api/g2/intent/route.ts
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

interface HsCompany {
  id: string
  properties: Record<string, string | null>
}

async function searchIntentCompanies(): Promise<HsCompany[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const afterMs = thirtyDaysAgo.getTime()

  // Search companies where g2_researched_date was updated in last 30 days
  // If g2_researched_date doesn't exist, fall back to hs_lastmodifieddate as proxy
  const body = {
    filterGroups: [
      {
        filters: [
          { propertyName: "g2_researched_date", operator: "GTE", value: String(afterMs) },
        ],
      },
    ],
    properties: ["name", "domain", "g2_buying_intent_score", "g2_researched_date"],
    sorts: [{ propertyName: "g2_researched_date", direction: "DESCENDING" }],
    limit: 50,
  }

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })

  if (!res.ok) {
    // 400 = property doesn't exist yet (G2 integration not active)
    if (res.status === 400) return []
    throw new Error(`HubSpot company search → ${res.status}`)
  }

  const data = await res.json()
  return data.results ?? []
}

export async function GET() {
  try {
    const companies = await searchIntentCompanies()

    const now = new Date()
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const thisWeekStart = new Date(now)
    thisWeekStart.setDate(now.getDate() - now.getDay()) // Sunday
    thisWeekStart.setHours(0, 0, 0, 0)

    let totalThisMonth = 0
    let totalThisWeek = 0

    const result = companies.map((c) => {
      const lastSignalAt = c.properties.g2_researched_date ?? ""
      const signalDate = lastSignalAt ? new Date(lastSignalAt) : null
      if (signalDate) {
        if (signalDate >= thisMonthStart) totalThisMonth++
        if (signalDate >= thisWeekStart) totalThisWeek++
      }
      return {
        id: c.id,
        name: c.properties.name ?? "",
        domain: c.properties.domain ?? "",
        intentScore: c.properties.g2_buying_intent_score
          ? Number(c.properties.g2_buying_intent_score)
          : null,
        lastSignalAt,
      }
    })

    return NextResponse.json({ companies: result, totalThisMonth, totalThisWeek })
  } catch (e) {
    console.error("[g2/intent]", e)
    return NextResponse.json({ error: "Failed to load G2 intent" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Test route**

```bash
curl -s http://localhost:3000/api/g2/intent | head -c 400
```

Expected: `{ companies: [...], totalThisMonth: N, totalThisWeek: N }`. Empty arrays are valid if G2 integration not configured.

- [ ] **Step 3: Commit**

```bash
git add app/api/g2/intent/route.ts
git commit -m "feat: add GET /api/g2/intent route (HubSpot G2 buyer intent)"
```

---

## Task 6: G2 Dashboard Component (`components/g2-dashboard.tsx`)

**Files:**
- Create: `components/g2-dashboard.tsx`

This is the largest task. It duplicates the design primitives from `components/self-serve-dashboard.tsx` (do NOT modify or import from that file) and builds 4 panels + a KPI strip.

- [ ] **Step 1: Create `components/g2-dashboard.tsx`**

```typescript
"use client"

import { useEffect, useState } from "react"
import {
  Star,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Users,
  Eye,
  Zap,
} from "lucide-react"
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts"
import type { G2Review, G2Product, G2ProfileView, G2Rank, G2Campaign, G2IntentCompany } from "@/lib/g2"

// ─── Design system (duplicated from self-serve-dashboard.tsx) ─────────────────
const C = {
  bg:           "#020d07",
  card:         "#071510",
  cardAlt:      "#0a1d14",
  border:       "#0e2b1d",
  borderAccent: "rgba(5,199,155,0.18)",
  borderGlow:   "rgba(5,199,155,0.10)",
  accent:       "#05c79b",
  accentBright: "#00e8b0",
  accentDim:    "rgba(5,199,155,0.13)",
  accentGlow:   "rgba(5,199,155,0.06)",
  sage:         "#c8ddd5",
  sageLight:    "#e8f3ef",
  muted:        "#3d6b56",
  slate:        "#7c8c94",
  amber:        "#f5a623",
  amberDim:     "rgba(245,166,35,0.12)",
  red:          "#ef4444",
  redDim:       "rgba(239,68,68,0.12)",
  blue:         "#4c9ef5",
  blueDim:      "rgba(76,158,245,0.15)",
  purple:       "#9b7ff5",
  grid:         "rgba(5,199,155,0.045)",
}

const MONO = "'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, monospace"

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "k"
  return n.toString()
}

function Panel({ children, style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      style={{
        background:   C.card,
        border:       `1px solid ${C.border}`,
        borderRadius: "16px",
        padding:      "22px",
        position:     "relative",
        overflow:     "hidden",
        ...style,
      }}
      {...rest}
    >
      <div style={{
        position:   "absolute",
        top: 0, left: "10%", right: "10%",
        height:     "1px",
        background: `linear-gradient(90deg, transparent, ${C.borderAccent}, transparent)`,
        pointerEvents: "none",
      }} />
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize:      "10px",
      fontWeight:    700,
      letterSpacing: "0.13em",
      textTransform: "uppercase",
      color:         C.muted,
      marginBottom:  "18px",
    }}>
      {children}
    </p>
  )
}

function LoadingSkeleton({ h = 200 }: { h?: number }) {
  return (
    <div style={{
      height:          h,
      borderRadius:    "10px",
      background:      C.card,
      backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
      backgroundSize:  "200% 100%",
      animation:       "bm-shimmer 1.6s ease infinite",
    }} />
  )
}

function DataError({ label }: { label: string }) {
  return (
    <div style={{
      height:         120,
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      gap:            "8px",
      color:          C.muted,
      fontSize:       "12px",
      border:         `1px dashed ${C.border}`,
      borderRadius:   "10px",
    }}>
      <AlertCircle size={14} color={C.red} style={{ flexShrink: 0 }} />
      Could not load {label}
    </div>
  )
}

function TrendBadge({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null
  const positive = value >= 0
  return (
    <span style={{
      display:       "inline-flex",
      alignItems:    "center",
      gap:           "3px",
      background:    positive ? C.accentDim : C.redDim,
      color:         positive ? C.accent : C.red,
      padding:       "2px 8px",
      borderRadius:  "999px",
      fontSize:      "11px",
      fontWeight:    600,
    }}>
      {positive ? <TrendingUp size={10} strokeWidth={2.5} /> : <TrendingDown size={10} strokeWidth={2.5} />}
      {positive ? "+" : ""}{value}% {label}
    </span>
  )
}

function KpiCard({
  label, value, sub, Icon, accent = C.accent,
}: {
  label: string; value: string; sub?: React.ReactNode; Icon?: React.ElementType; accent?: string
}) {
  return (
    <Panel style={{ paddingLeft: "26px" }}>
      <div style={{
        position: "absolute", left: 0, top: "18%", bottom: "18%",
        width: "3px", borderRadius: "0 3px 3px 0", background: accent, opacity: 0.9,
      }} />
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
        {Icon && (
          <span style={{
            width: "28px", height: "28px", borderRadius: "8px",
            background: `${accent}18`, border: `1px solid ${accent}30`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon size={13} color={accent} strokeWidth={2} />
          </span>
        )}
        <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.slate }}>
          {label}
        </span>
      </div>
      <p style={{ fontSize: "38px", fontWeight: 700, lineHeight: 1, color: C.sageLight, letterSpacing: "-0.025em", fontFamily: MONO, marginBottom: "8px" }}>
        {value}
      </p>
      {sub && <div style={{ marginTop: "4px" }}>{sub}</div>}
    </Panel>
  )
}

// ─── Data types for this dashboard ────────────────────────────────────────────
type ReviewsData  = { product: Pick<G2Product, "starRating" | "reviewsCount">; reviews: G2Review[] }
type ProfileData  = { rank: G2Rank; weeklyViews: G2ProfileView[]; totalViewsThisMonth: number; totalViewsLastMonth: number }
type CampaignsData = { campaigns: G2Campaign[] }
type IntentData   = { companies: G2IntentCompany[]; totalThisMonth: number; totalThisWeek: number }

// ─── Star rating helper ───────────────────────────────────────────────────────
function StarRating({ rating }: { rating: number }) {
  const color = rating >= 4 ? C.accent : rating === 3 ? C.amber : C.red
  return (
    <span style={{ display: "inline-flex", gap: "1px" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={11}
          fill={i <= rating ? color : "transparent"}
          color={i <= rating ? color : C.muted}
          strokeWidth={1.5}
        />
      ))}
    </span>
  )
}

// ─── Relative time helper ─────────────────────────────────────────────────────
function relTime(iso: string): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return "today"
  if (days === 1) return "1d ago"
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

// ─── Week label helper ────────────────────────────────────────────────────────
function fmtWeek(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export function G2Dashboard() {
  const [reviews,   setReviews]   = useState<ReviewsData | null>(null)
  const [profile,   setProfile]   = useState<ProfileData | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignsData | null>(null)
  const [intent,    setIntent]    = useState<IntentData | null>(null)

  const [reviewsErr,   setReviewsErr]   = useState(false)
  const [profileErr,   setProfileErr]   = useState(false)
  const [campaignsErr, setCampaignsErr] = useState(false)
  const [intentErr,    setIntentErr]    = useState(false)

  useEffect(() => {
    Promise.allSettled([
      fetch("/api/g2/reviews").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
      fetch("/api/g2/profile").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
      fetch("/api/g2/campaigns").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
      fetch("/api/g2/intent").then((r) => r.ok ? r.json() : Promise.reject(r.status)),
    ]).then(([r, p, c, i]) => {
      if (r.status === "fulfilled") setReviews(r.value as ReviewsData); else setReviewsErr(true)
      if (p.status === "fulfilled") setProfile(p.value as ProfileData); else setProfileErr(true)
      if (c.status === "fulfilled") setCampaigns(c.value as CampaignsData); else setCampaignsErr(true)
      if (i.status === "fulfilled") setIntent(i.value as IntentData); else setIntentErr(true)
    })
  }, [])

  // ── MoM profile views change ─────────────────────────────────────────────
  const viewsMoMPct = profile && profile.totalViewsLastMonth > 0
    ? Math.round(((profile.totalViewsThisMonth - profile.totalViewsLastMonth) / profile.totalViewsLastMonth) * 100)
    : null

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "32px 36px", fontFamily: "system-ui, sans-serif" }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: C.sageLight, letterSpacing: "-0.02em", margin: 0 }}>
          G2
        </h1>
        <p style={{ fontSize: "12px", color: C.muted, marginTop: "4px" }}>
          Reviews, profile analytics, paid campaigns, and buyer intent signals
        </p>
      </div>

      {/* ── KPI Strip ──────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "24px" }}>
        <KpiCard
          label="Star Rating"
          value={reviews ? `${reviews.product.starRating.toFixed(1)} ★` : "—"}
          Icon={Star}
          accent={C.accent}
          sub={reviews && (
            <span style={{ fontSize: "11px", color: C.muted }}>
              {fmtNum(reviews.product.reviewsCount)} reviews
            </span>
          )}
        />
        <KpiCard
          label="Total Reviews"
          value={reviews ? fmtNum(reviews.product.reviewsCount) : "—"}
          Icon={Users}
          accent={C.blue}
          sub={<span style={{ fontSize: "11px", color: C.muted }}>all time</span>}
        />
        <KpiCard
          label="Profile Views"
          value={profile ? fmtNum(profile.totalViewsThisMonth) : "—"}
          Icon={Eye}
          accent={C.purple}
          sub={profile && (
            <TrendBadge value={viewsMoMPct} label="MoM" />
          )}
        />
        <KpiCard
          label="Intent Signals"
          value={intent ? String(intent.totalThisMonth) : "—"}
          Icon={Zap}
          accent={C.amber}
          sub={intent && (
            <span style={{ fontSize: "11px", color: C.muted }}>
              {intent.totalThisWeek} this week
            </span>
          )}
        />
      </div>

      {/* ── Panel 1: Recent Reviews ─────────────────────────────────────────── */}
      <Panel style={{ marginBottom: "24px" }}>
        <SectionLabel>Recent Reviews</SectionLabel>
        {reviewsErr ? (
          <DataError label="reviews" />
        ) : !reviews ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[200, 160, 180].map((h, i) => <LoadingSkeleton key={i} h={h} />)}
          </div>
        ) : reviews.reviews.length === 0 ? (
          <p style={{ fontSize: "13px", color: C.muted, textAlign: "center", padding: "32px 0" }}>No reviews found.</p>
        ) : (
          <div>
            {reviews.reviews.map((review, i) => (
              <div key={review.id} style={{
                padding:     "14px 0",
                borderBottom: i < reviews.reviews.length - 1 ? `1px solid ${C.border}` : "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                  <StarRating rating={review.rating} />
                  <span style={{ fontSize: "13px", fontWeight: 600, color: C.sageLight, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {review.title || "Untitled Review"}
                  </span>
                </div>
                <p style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>
                  {[review.reviewerRole, review.companySize, review.createdAt ? new Date(review.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""].filter(Boolean).join(" · ")}
                </p>
                {review.body && (
                  <p style={{
                    fontSize:   "12px",
                    color:      C.slate,
                    overflow:   "hidden",
                    display:    "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    lineHeight: "1.5",
                  }}>
                    {review.body}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ── Panel 2: Profile Analytics ──────────────────────────────────────── */}
      <Panel style={{ marginBottom: "24px" }}>
        <SectionLabel>Profile Analytics</SectionLabel>
        {profileErr ? (
          <DataError label="profile analytics" />
        ) : !profile ? (
          <LoadingSkeleton h={220} />
        ) : (
          <div style={{ display: "flex", gap: "24px", alignItems: "stretch" }}>
            {/* Category Rank card */}
            <div style={{
              width: "35%", flexShrink: 0,
              background: C.cardAlt, border: `1px solid ${C.border}`,
              borderRadius: "12px", padding: "20px",
              display: "flex", flexDirection: "column", justifyContent: "center",
            }}>
              <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: "12px" }}>
                Category Rank
              </p>
              <p style={{ fontSize: "52px", fontWeight: 700, lineHeight: 1, color: C.accent, fontFamily: MONO, letterSpacing: "-0.03em", marginBottom: "8px" }}>
                {profile.rank.rank > 0 ? `#${profile.rank.rank}` : "—"}
              </p>
              <p style={{ fontSize: "12px", color: C.sage, marginBottom: "12px" }}>
                {profile.rank.category || "—"}
              </p>
              {profile.rank.rankChange !== 0 ? (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: "4px",
                  background: profile.rank.rankChange > 0 ? C.accentDim : C.redDim,
                  color: profile.rank.rankChange > 0 ? C.accent : C.red,
                  padding: "3px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 600,
                  alignSelf: "flex-start",
                }}>
                  {profile.rank.rankChange > 0 ? "↑" : "↓"}
                  {Math.abs(profile.rank.rankChange)} this month
                </span>
              ) : (
                <span style={{ fontSize: "11px", color: C.muted }}>— no change</span>
              )}
            </div>

            {/* Weekly views chart */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.muted, marginBottom: "18px" }}>
                Weekly Profile Views
              </p>
              {profile.weeklyViews.length === 0 ? (
                <p style={{ fontSize: "12px", color: C.muted }}>No view data available.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={profile.weeklyViews.map((v) => ({ ...v, label: fmtWeek(v.week) }))} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={36} tickFormatter={fmtNum} />
                    <Tooltip
                      contentStyle={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "11px" }}
                      labelStyle={{ color: C.sage }}
                      itemStyle={{ color: C.accent }}
                    />
                    <Line
                      type="monotone"
                      dataKey="views"
                      stroke={C.accent}
                      strokeWidth={2}
                      dot={{ fill: C.accent, r: 3, strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: C.accentBright }}
                    >
                      <LabelList dataKey="views" position="top" style={{ fill: C.slate, fontSize: "10px" }} formatter={fmtNum} />
                    </Line>
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </Panel>

      {/* ── Panel 3: Paid Campaigns ─────────────────────────────────────────── */}
      <Panel style={{ marginBottom: "24px" }}>
        <SectionLabel>Paid Campaigns</SectionLabel>
        {campaignsErr ? (
          <DataError label="campaigns" />
        ) : !campaigns ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[40, 40, 40].map((h, i) => <LoadingSkeleton key={i} h={h} />)}
          </div>
        ) : campaigns.campaigns.length === 0 ? (
          <p style={{ fontSize: "13px", color: C.muted, textAlign: "center", padding: "32px 0" }}>
            No campaign data available.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr>
                  {["Campaign", "Status", "Impressions", "Clicks", "CTR", "Spend"].map((col) => (
                    <th key={col} style={{ textAlign: col === "Campaign" ? "left" : "right", padding: "6px 10px", color: C.muted, fontWeight: 600, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}` }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.campaigns.map((c, i) => (
                  <tr key={c.id} style={{ borderBottom: i < campaigns.campaigns.length - 1 ? `1px solid ${C.border}` : "none" }}>
                    <td style={{ padding: "10px 10px", color: C.sage, maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.name}
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right" }}>
                      <span style={{
                        padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600,
                        background: c.status === "active" ? C.accentDim : c.status === "paused" ? C.amberDim : "rgba(124,140,148,0.12)",
                        color: c.status === "active" ? C.accent : c.status === "paused" ? C.amber : C.slate,
                      }}>
                        {c.status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right", fontFamily: MONO, color: C.sage }}>{fmtNum(c.impressions)}</td>
                    <td style={{ padding: "10px 10px", textAlign: "right", fontFamily: MONO, color: C.sage }}>{fmtNum(c.clicks)}</td>
                    <td style={{ padding: "10px 10px", textAlign: "right", fontFamily: MONO, color: C.sage }}>{c.ctr.toFixed(2)}%</td>
                    <td style={{ padding: "10px 10px", textAlign: "right", fontFamily: MONO, color: C.sageLight, fontWeight: 600 }}>
                      ${fmtNum(c.spend)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ── Panel 4: Buyer Intent ───────────────────────────────────────────── */}
      <Panel>
        <SectionLabel>G2 Buyer Intent — Last 30 Days</SectionLabel>
        {intent && (
          <p style={{ fontSize: "12px", color: C.muted, marginTop: "-10px", marginBottom: "18px" }}>
            {intent.totalThisMonth} companies this month · {intent.totalThisWeek} this week
          </p>
        )}
        {intentErr ? (
          <DataError label="buyer intent" />
        ) : !intent ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[40, 40, 40, 40, 40].map((h, i) => <LoadingSkeleton key={i} h={h} />)}
          </div>
        ) : intent.companies.length === 0 ? (
          <p style={{ fontSize: "13px", color: C.muted, textAlign: "center", padding: "32px 0" }}>
            No intent signals found. Verify G2–HubSpot integration is active.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr>
                  {["Company", "Domain", "Intent Score", "Last Signal"].map((col) => (
                    <th key={col} style={{ textAlign: col === "Company" || col === "Domain" ? "left" : "right", padding: "6px 10px", color: C.muted, fontWeight: 600, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}` }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {intent.companies.slice(0, 50).map((co, i) => (
                  <tr key={co.id} style={{ borderBottom: i < Math.min(intent.companies.length, 50) - 1 ? `1px solid ${C.border}` : "none" }}>
                    <td style={{ padding: "10px 10px", color: C.sage, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {co.name || "—"}
                    </td>
                    <td style={{ padding: "10px 10px", fontFamily: MONO, fontSize: "11px", color: C.muted }}>
                      {co.domain || "—"}
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right", fontFamily: MONO, color: co.intentScore !== null ? C.sageLight : C.muted }}>
                      {co.intentScore !== null ? co.intentScore : "—"}
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right", color: C.muted, fontSize: "11px" }}>
                      {relTime(co.lastSignalAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/g2-dashboard.tsx
git commit -m "feat: add G2Dashboard component with all 4 panels"
```

---

## Task 7: Page Entry Point + Sidebar Nav

**Files:**
- Create: `app/g2/page.tsx`
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: Create `app/g2/page.tsx`**

```typescript
// app/g2/page.tsx
import { G2Dashboard } from "@/components/g2-dashboard"

export default function G2Page() {
  return <G2Dashboard />
}
```

- [ ] **Step 2: Add G2 to sidebar nav**

In `components/app-sidebar.tsx`, change the import line from:

```typescript
import { LayoutDashboard, LayoutList, Bug, Settings, Bot, TrendingUp, RotateCcw } from "lucide-react"
```

to:

```typescript
import { LayoutDashboard, LayoutList, Bug, Settings, Bot, TrendingUp, RotateCcw, Star } from "lucide-react"
```

And add the G2 nav item to the `navItems` array after Self-Serve and before Agents:

```typescript
const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/self-serve", label: "Self-Serve", icon: TrendingUp },
  { href: "/g2", label: "G2", icon: Star },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/workspace", label: "Project Workspace", icon: LayoutList },
  { href: "/analytics", label: "Bug Tracking", icon: Bug },
  { href: "/settings", label: "Settings", icon: Settings },
] as const
```

- [ ] **Step 3: Add G2_API_TOKEN and G2_PRODUCT_SLUG to `.env.local`**

Add these two lines to `.env.local` (the file already exists — append, don't overwrite):

```
G2_API_TOKEN=77ee2fa7e311fe43427ab732fffadf7660f655958e5b0f83a6eecd7ebf1fee27
G2_PRODUCT_SLUG=bidmachine
```

> **Security note:** `.env.local` is already in `.gitignore`. Never commit this file.

- [ ] **Step 4: Start dev server and verify the page loads**

Navigate to `http://localhost:3000/g2` in the browser.

Expected:
- G2 nav item appears in the sidebar with a Star icon
- Dashboard header "G2" is visible
- 4 KPI cards render (loading skeletons → data once APIs respond)
- 4 panels render below
- No console errors (or only API errors if G2 token / HubSpot integration not yet active)

- [ ] **Step 5: Verify TypeScript compiles clean**

```bash
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add app/g2/page.tsx components/app-sidebar.tsx
git commit -m "feat: add G2 page and sidebar nav item"
```

---

## Post-Implementation: API Field Verification

> **Important:** G2 uses JSON:API format but exact attribute names vary. After adding `G2_API_TOKEN` to `.env.local`, test each route and verify the field mappings in `lib/g2.ts` match the actual API responses.

```bash
# Test each route after server restart
curl -s http://localhost:3000/api/g2/reviews | python3 -m json.tool | head -60
curl -s http://localhost:3000/api/g2/profile | python3 -m json.tool | head -40
curl -s http://localhost:3000/api/g2/campaigns | python3 -m json.tool | head -40
curl -s http://localhost:3000/api/g2/intent | python3 -m json.tool | head -40
```

If data is missing or `0`/`""` where you expect real values, add a `console.log` in `lib/g2.ts` to inspect the raw G2 API response, then update the field name mappings (e.g., `star_rating` → `rating`, `love` → `liked_best`, etc.).
