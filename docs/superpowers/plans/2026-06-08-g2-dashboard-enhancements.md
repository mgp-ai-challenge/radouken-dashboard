# G2 Dashboard Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three intelligence layers to the G2 dashboard: competitor evaluation tally, richer review dimension scores with trend direction, and ICP fit score per intent company.

**Architecture:** Feature 1 (competitor tally) and Feature 3 (ICP fit) are pure client-side additions derived from data already in the app. Feature 2 (dimension trends) requires adding 6 fields to `G2Review`, fetching 100 reviews, and computing trends server-side in the reviews route. Three files touched, no new files, no new env vars.

**Tech Stack:** Next.js 15 App Router, TypeScript, React 19, inline styles (no Tailwind in this component)

---

### Task 1: Data model — `lib/g2.ts`

**Files:**
- Modify: `lib/g2.ts:3-11` (G2Review interface)
- Modify: `lib/g2.ts` (add DimensionTrend after G2Campaign)
- Modify: `lib/g2.ts:99-116` (getG2Reviews page size + field mapping)

- [ ] **Step 1: Add 6 dimension fields to the G2Review interface**

Replace lines 3–11 of `lib/g2.ts`:

```typescript
export interface G2Review {
  id: string
  title: string
  rating: number          // 1–5
  reviewerRole: string
  companySize: string
  body: string            // "What do you like best?" excerpt
  createdAt: string       // ISO date
  easeOfUse: number | null
  qualityOfSupport: number | null
  easeOfSetup: number | null
  meetsRequirements: number | null
  likelihoodToRecommend: number | null
  easeOfDoingBusiness: number | null
}
```

- [ ] **Step 2: Add DimensionTrend interface after the G2Campaign interface (after line 41)**

Insert this block between `G2Campaign` and the blank line before `const G2_BASE`:

```typescript
export interface DimensionTrend {
  dimension: string       // display label, e.g. "Ease of Use"
  key: string             // camelCase field name matching G2Review
  current: number         // avg score, last 3 months (0 if < 3 reviews)
  previous: number        // avg score, months 4–6 ago (0 if < 3 reviews)
  delta: number           // percentage change, rounded to 1 decimal
  direction: "up" | "down" | "flat"
}
```

- [ ] **Step 3: Update getG2Reviews — increase page size to 100 and map the 6 new fields**

Replace the entire `getG2Reviews` function (lines 98–116):

```typescript
export async function getG2Reviews(productId: string): Promise<G2Review[]> {
  const data = await g2Fetch(
    `/products/${encodeURIComponent(productId)}/survey-responses?page[size]=100&sort=-submitted_at`
  ) as { data: Array<{ id: string; attributes: Record<string, unknown> }> }
  return (data.data ?? []).map((item) => {
    const attrs = item.attributes
    const commentAnswers = attrs.comment_answers as Record<string, { value?: string }> | null
    const body = commentAnswers?.love?.value ?? String(attrs.body ?? "")
    const numOrNull = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null
      const n = Number(v)
      return isNaN(n) ? null : n
    }
    return {
      id: item.id,
      title: String(attrs.title ?? ""),
      rating: Number(attrs.star_rating ?? 0),
      reviewerRole: String(attrs.user_name ?? ""),
      companySize: String(attrs.country_name ?? ""),
      body,
      createdAt: String(attrs.submitted_at ?? ""),
      easeOfUse:            numOrNull(attrs.ease_of_use),
      qualityOfSupport:     numOrNull(attrs.quality_of_support),
      easeOfSetup:          numOrNull(attrs.ease_of_setup),
      meetsRequirements:    numOrNull(attrs.meets_requirements),
      likelihoodToRecommend: numOrNull(attrs.likelihood_to_recommend),
      easeOfDoingBusiness:  numOrNull(attrs.ease_of_doing_business_with),
    }
  })
}
```

- [ ] **Step 4: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/g2.ts
git commit -m "feat(g2): add 6 dimension fields to G2Review; fetch 100 reviews; add DimensionTrend type"
```

---

### Task 2: Server-side dimension trends — `app/api/g2/reviews/route.ts`

**Files:**
- Modify: `app/api/g2/reviews/route.ts` (full rewrite)

- [ ] **Step 1: Rewrite the route to compute dimensionTrends before returning**

Replace the entire contents of `app/api/g2/reviews/route.ts`:

```typescript
// app/api/g2/reviews/route.ts
import { NextResponse } from "next/server"
import { getG2Product, getG2Reviews } from "@/lib/g2"
import type { DimensionTrend, G2Review } from "@/lib/g2"

export const dynamic = "force-dynamic"

const DIMENSIONS: Array<{ dimension: string; key: keyof G2Review }> = [
  { dimension: "Ease of Use",             key: "easeOfUse" },
  { dimension: "Quality of Support",      key: "qualityOfSupport" },
  { dimension: "Ease of Setup",           key: "easeOfSetup" },
  { dimension: "Meets Requirements",      key: "meetsRequirements" },
  { dimension: "Likelihood to Recommend", key: "likelihoodToRecommend" },
  { dimension: "Ease of Doing Business",  key: "easeOfDoingBusiness" },
]

function windowAvg(reviews: G2Review[], key: keyof G2Review): number {
  const values = reviews
    .map((r) => r[key] as number | null)
    .filter((v): v is number => v !== null)
  if (values.length < 3) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export async function GET() {
  try {
    const product = await getG2Product()
    const reviews = await getG2Reviews(product.id)

    const now = Date.now()
    const MS_90  = 90  * 24 * 60 * 60 * 1000
    const MS_180 = 180 * 24 * 60 * 60 * 1000

    const recentWindow   = reviews.filter((r) => now - new Date(r.createdAt).getTime() < MS_90)
    const previousWindow = reviews.filter((r) => {
      const age = now - new Date(r.createdAt).getTime()
      return age >= MS_90 && age < MS_180
    })

    const dimensionTrends: DimensionTrend[] = DIMENSIONS.map(({ dimension, key }) => {
      const current  = windowAvg(recentWindow,   key)
      const previous = windowAvg(previousWindow, key)
      const delta    = previous > 0
        ? Math.round(((current - previous) / previous) * 1000) / 10
        : 0
      const direction: DimensionTrend["direction"] =
        delta > 1 ? "up" : delta < -1 ? "down" : "flat"
      return { dimension, key: key as string, current, previous, delta, direction }
    })

    return NextResponse.json({
      product: { starRating: product.starRating, reviewsCount: product.reviewsCount },
      reviews,
      dimensionTrends,
    })
  } catch (e) {
    console.error("[g2/reviews]", e)
    return NextResponse.json({ error: "Failed to load G2 reviews" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/g2/reviews/route.ts
git commit -m "feat(g2): compute dimensionTrends server-side in reviews route"
```

---

### Task 3: Dashboard — Competitor Tally Panel + ICP Fit Scoring

**Files:**
- Modify: `components/g2-dashboard.tsx` (multiple sections)

This task touches the dashboard in 5 places: imports/types, state declarations, useMemos, filter bar, and the intent table.

- [ ] **Step 1: Update the G2 import to include DimensionTrend**

At line 24, change:
```typescript
import type { G2Review, G2Product, G2ProfileView, G2Rank, G2Campaign, G2IntentCompany } from "@/lib/g2"
```
to:
```typescript
import type { G2Review, G2Product, G2ProfileView, G2Rank, G2Campaign, G2IntentCompany, DimensionTrend } from "@/lib/g2"
```

- [ ] **Step 2: Update the ReviewsData type**

At line 187, change:
```typescript
type ReviewsData  = { product: Pick<G2Product, "starRating" | "reviewsCount">; reviews: G2Review[] }
```
to:
```typescript
type ReviewsData  = { product: Pick<G2Product, "starRating" | "reviewsCount">; reviews: G2Review[]; dimensionTrends: DimensionTrend[] }
```

- [ ] **Step 3: Add the computeFit pure function before the G2Dashboard export**

Insert this block immediately before the `// ─── Main Dashboard ──` comment at line 263:

```typescript
// ─── ICP fit scoring ──────────────────────────────────────────────────────────
function computeFit(co: G2IntentCompany, enrichment: AppEnrichment | undefined): { score: number; tier: "Hot" | "High" | "Medium" | "Low" } {
  let score = 0
  if (co.activityLevel === "high")        score += 40
  else if (co.activityLevel === "medium") score += 25
  else if (co.activityLevel === "low")    score += 10
  if (co.buyingStage === "decision")           score += 25
  else if (co.buyingStage === "consideration") score += 15
  else if (co.buyingStage === "awareness")     score += 5
  const ls = co.lifecycleStage?.toLowerCase() ?? ""
  if      (ls === "opportunity")              score += 20
  else if (ls === "salesqualifiedlead")       score += 15
  else if (ls === "marketingqualifiedlead")   score += 10
  else if (ls === "lead" || ls === "subscriber") score += 5
  if (enrichment?.hasApp === true)            score += 10
  if (co.relatedProducts.length > 0 || co.productName) score += 5
  const tier: "Hot" | "High" | "Medium" | "Low" =
    score >= 76 ? "Hot" : score >= 56 ? "High" : score >= 31 ? "Medium" : "Low"
  return { score, tier }
}
```

- [ ] **Step 4: Add filterRelatedProduct and filterFit state**

After the `filterApp` state at line 281:
```typescript
const [filterApp,       setFilterApp]       = useState<string>("all")
```
add:
```typescript
const [filterRelatedProduct, setFilterRelatedProduct] = useState<string>("all")
const [filterFit,            setFilterFit]            = useState<string>("all")
```

- [ ] **Step 5: Update filteredCompanies useMemo to add 2 new filter conditions and add competitorTally useMemo**

Replace the `filteredCompanies` useMemo (lines 288–298) with:

```typescript
const filteredCompanies = useMemo(() => {
  if (!intent) return []
  return intent.companies.filter((co) => {
    if (filterStage !== "all" && co.buyingStage !== filterStage) return false
    if (filterScore > 0 && (co.intentScore === null || co.intentScore < filterScore)) return false
    if (filterLifecycle !== "all" && (co.lifecycleStage?.toLowerCase() ?? "") !== filterLifecycle) return false
    if (filterApp === "yes" && !appEnrichments.get(co.id)?.hasApp) return false
    if (filterApp === "no"  && appEnrichments.get(co.id)?.hasApp)  return false
    if (filterRelatedProduct !== "all") {
      if (co.productName !== filterRelatedProduct && !co.relatedProducts.includes(filterRelatedProduct)) return false
    }
    if (filterFit !== "all") {
      if (computeFit(co, appEnrichments.get(co.id)).tier !== filterFit) return false
    }
    return true
  })
}, [intent, filterStage, filterScore, filterLifecycle, filterApp, appEnrichments, filterRelatedProduct, filterFit])

// Competitor tally — derived from ALL intent companies (not filtered), top 8
const competitorTally = useMemo(() => {
  if (!intent) return []
  const tally = new Map<string, { total: number; byStage: Record<string, number> }>()
  for (const co of intent.companies) {
    const products = new Set([
      ...(co.productName ? [co.productName] : []),
      ...co.relatedProducts,
    ])
    for (const name of products) {
      const entry = tally.get(name) ?? { total: 0, byStage: {} }
      entry.total++
      const stage = co.buyingStage ?? "unknown"
      entry.byStage[stage] = (entry.byStage[stage] ?? 0) + 1
      tally.set(name, entry)
    }
  }
  return [...tally.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 8)
    .map(([name, data]) => ({ name, ...data }))
}, [intent])
```

- [ ] **Step 6: Update hasActiveFilter and the clear button**

In the filter bar IIFE (around line 567), change:
```typescript
const hasActiveFilter = filterStage !== "all" || filterScore > 0 || filterLifecycle !== "all" || filterApp !== "all"
```
to:
```typescript
const hasActiveFilter = filterStage !== "all" || filterScore > 0 || filterLifecycle !== "all" || filterApp !== "all" || filterRelatedProduct !== "all" || filterFit !== "all"
```

And change the clear button `onClick` (around line 618):
```typescript
onClick={() => { setFilterStage("all"); setFilterScore(0); setFilterLifecycle("all"); setFilterApp("all") }}
```
to:
```typescript
onClick={() => { setFilterStage("all"); setFilterScore(0); setFilterLifecycle("all"); setFilterApp("all"); setFilterRelatedProduct("all"); setFilterFit("all") }}
```

- [ ] **Step 7: Add Fit and Competitor FilterPills to the filter bar**

Inside the filter bar IIFE's returned `<div>` (after the `filterApp` FilterPills group and its separator at line 605–614), add:

```tsx
<div style={{ width: "1px", height: "18px", background: C.border }} />
<FilterPills
  label="Fit"
  options={[
    { value: "all",    display: "All"    },
    { value: "Hot",    display: "Hot"    },
    { value: "High",   display: "High"   },
    { value: "Medium", display: "Medium" },
    { value: "Low",    display: "Low"    },
  ]}
  active={filterFit}
  onSelect={setFilterFit}
/>
{competitorTally.length > 0 && (
  <>
    <div style={{ width: "1px", height: "18px", background: C.border }} />
    <FilterPills
      label="Competitor"
      options={[
        { value: "all", display: "All" },
        ...competitorTally.slice(0, 5).map(({ name }) => ({ value: name, display: name })),
      ]}
      active={filterRelatedProduct}
      onSelect={setFilterRelatedProduct}
    />
  </>
)}
```

- [ ] **Step 8: Replace the intelligence summary bar with the competitor tally panel**

Replace lines 640–688 (the entire `{/* ── Intelligence summary bar ─────────────────────────────── */}` IIFE) with:

```tsx
{/* ── Competitor Tally Panel ──────────────────────────────── */}
{competitorTally.length > 0 && (
  <div style={{
    background: C.cardAlt, border: `1px solid ${C.border}`,
    borderRadius: "10px", padding: "14px 16px", marginBottom: "16px",
  }}>
    <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted, marginBottom: "12px" }}>
      Competitors Being Evaluated
    </p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      {competitorTally.map(({ name, total, byStage }) => (
        <button
          key={name}
          onClick={() => setFilterRelatedProduct(filterRelatedProduct === name ? "all" : name)}
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "5px 10px", borderRadius: "8px",
            border: `1px solid ${filterRelatedProduct === name ? C.borderAccent : C.border}`,
            background: filterRelatedProduct === name ? C.accentDim : "transparent",
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: "11px", fontWeight: 600, color: C.sageLight }}>{name}</span>
          <span style={{ fontSize: "10px", fontWeight: 700, color: C.accent }}>{total}</span>
          {(byStage.awareness    ?? 0) > 0 && <span style={{ padding: "1px 5px", borderRadius: "4px", fontSize: "9px", fontWeight: 600, background: "rgba(124,140,148,0.15)", color: C.slate }}>{byStage.awareness}</span>}
          {(byStage.consideration ?? 0) > 0 && <span style={{ padding: "1px 5px", borderRadius: "4px", fontSize: "9px", fontWeight: 600, background: "rgba(76,158,245,0.12)", color: C.blue }}>{byStage.consideration}</span>}
          {(byStage.decision      ?? 0) > 0 && <span style={{ padding: "1px 5px", borderRadius: "4px", fontSize: "9px", fontWeight: 600, background: C.accentDim, color: C.accent }}>{byStage.decision}</span>}
        </button>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 9: Add "Fit" to the table column headers and update colSpan values**

In the column headers array (line 693), change:
```tsx
{["Company", "Activity", "Stage", "Intent Score", "Last Signal", "In HubSpot", "Lifecycle", "Products", "App"].map((col) => (
```
to:
```tsx
{["Company", "Activity", "Stage", "Intent Score", "Last Signal", "In HubSpot", "Lifecycle", "Fit", "Products", "App"].map((col) => (
```

Change both `colSpan={9}` occurrences to `colSpan={10}`:
- Line 702: `<tr><td colSpan={9} ...` → `<tr><td colSpan={10} ...`
- Line 818: `<td colSpan={9} style=...` → `<td colSpan={10} style=...`

- [ ] **Step 10: Add the Fit cell to each table row**

After the Lifecycle `<td>` (ends around line 785 with `</td>`), insert a new Fit cell before the Products cell:

```tsx
<td style={{ padding: "10px 10px", textAlign: "center" }}>
  {(() => {
    const { tier } = computeFit(co, appEnrichments.get(co.id))
    const color = tier === "Hot" ? C.accent : tier === "High" ? C.amber : tier === "Medium" ? C.blue : C.slate
    const bg    = tier === "Hot" ? C.accentDim : tier === "High" ? C.amberDim : tier === "Medium" ? "rgba(76,158,245,0.12)" : "rgba(124,140,148,0.10)"
    return (
      <span style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: bg, color }}>
        {tier}
      </span>
    )
  })()}
</td>
```

- [ ] **Step 11: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 12: Commit**

```bash
git add components/g2-dashboard.tsx
git commit -m "feat(g2): competitor tally panel + ICP fit score column + filter pills"
```

---

### Task 4: Dashboard — Dimension Trends in Product Ratings Card

**Files:**
- Modify: `components/g2-dashboard.tsx:956-987` (Product Ratings card rows)

- [ ] **Step 1: Replace the 3-row static product ratings with 6 dynamic dimension trend rows**

Replace lines 956–987 (the `.map()` block that renders the 3 product-rating rows) with:

```tsx
{reviews?.dimensionTrends && reviews.dimensionTrends.length > 0 ? (
  reviews.dimensionTrends.map(({ dimension, key, current, direction, delta }) => (
    <div key={key}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
        <span style={{ fontSize: "11px", color: C.slate }}>{dimension}</span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", fontFamily: MONO, color: C.sageLight, fontWeight: 600 }}>
          {current > 0 ? current.toFixed(1) : "—"}
          {current > 0 && direction !== "flat" && (
            <span style={{
              fontSize: "9px", fontWeight: 700, padding: "1px 4px", borderRadius: "4px",
              background: direction === "up" ? C.accentDim : C.redDim,
              color:      direction === "up" ? C.accent    : C.red,
            }}>
              {direction === "up" ? "↑" : "↓"} {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </span>
      </div>
      {current > 0 && (
        <div style={{ height: "6px", borderRadius: "999px", background: C.border, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: "999px",
            width: `${(current / 10) * 100}%`,
            background: `linear-gradient(90deg, ${C.accent}, ${C.accentBright})`,
          }} />
        </div>
      )}
    </div>
  ))
) : ([
  { label: "Ease of Use",   prod: profile.rank.productScores?.easeOfUse       ?? 0, cat: profile.rank.categoryScores?.easeOfUse       ?? 0 },
  { label: "Support",       prod: profile.rank.productScores?.qualityOfSupport ?? 0, cat: profile.rank.categoryScores?.qualityOfSupport ?? 0 },
  { label: "Ease of Setup", prod: profile.rank.productScores?.easeOfSetup      ?? 0, cat: profile.rank.categoryScores?.easeOfSetup      ?? 0 },
] as const).map(({ label, prod, cat }) => (
  <div key={label}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
      <span style={{ fontSize: "11px", color: C.slate }}>{label}</span>
      <span style={{ fontSize: "11px", fontFamily: MONO, color: C.sageLight, fontWeight: 600 }}>
        {prod > 0 ? prod.toFixed(1) : "—"}
        {cat > 0 && <span style={{ color: C.muted, fontWeight: 400 }}> / {cat.toFixed(1)} avg</span>}
      </span>
    </div>
    {prod > 0 && (
      <div style={{ position: "relative", height: "6px", borderRadius: "999px", background: C.border, overflow: "visible" }}>
        {cat > 0 && (
          <div style={{
            position: "absolute", top: "-3px", bottom: "-3px", width: "2px",
            left: `${(cat / 10) * 100}%`, background: C.muted, borderRadius: "1px",
          }} />
        )}
        <div style={{
          height: "100%", borderRadius: "999px",
          width: `${(prod / 10) * 100}%`,
          background: `linear-gradient(90deg, ${C.accent}, ${C.accentBright})`,
        }} />
      </div>
    )}
  </div>
))}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: Build completes without TypeScript errors.

- [ ] **Step 4: Manual smoke test**

Start dev server and verify:
1. **Competitor tally panel** appears above the intent table — shows competitor names with total count and colored stage chips (slate=awareness, blue=consideration, accent=decision). Clicking a competitor name filters the table. Clicking again clears the filter.
2. **Competitor filter pill** appears in the filter bar with top-5 competitors. Selecting one filters the table to matching companies.
3. **Fit filter pill** appears in the filter bar. Selecting "Hot" shows only companies with score 76+.
4. **Fit column** appears between "Lifecycle" and "Products" in every table row, showing a colored tier chip (Hot/High/Medium/Low).
5. **"Clear filters ×"** button clears both new filters alongside existing ones.
6. **Product Ratings card** shows 6 rows (all dimensions). Each row with a trend badge shows "↑ X.X%" in accent or "↓ X.X%" in red. Rows with no trend data show only the score.

- [ ] **Step 5: Commit**

```bash
git add components/g2-dashboard.tsx
git commit -m "feat(g2): 6-row dimension trend display in Product Ratings card"
```
