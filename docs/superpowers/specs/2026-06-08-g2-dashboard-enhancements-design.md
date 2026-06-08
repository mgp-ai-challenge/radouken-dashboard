# G2 Dashboard Enhancements — Design

## Goal

Add three intelligence layers to the G2 dashboard: a competitor evaluation tally derived from existing HubSpot intent data, richer review dimension scores with trend direction, and an ICP fit score on each intent company.

## Architecture

Three files touched, nothing new created. No new env vars.

| File | Change |
|------|--------|
| `lib/g2.ts` | Add 6 dimension score fields to `G2Review`; fetch 100 reviews; add `DimensionTrend` type |
| `app/api/g2/reviews/route.ts` | Compute `dimensionTrends[]` server-side and return alongside reviews |
| `components/g2-dashboard.tsx` | Competitor tally panel, ICP fit column + filter pill, expanded dimension rows |

---

## Feature 1: Competitor Tally Panel

### Data source

Derived entirely from `relatedProducts` and `productName` already present on each `G2IntentCompany` returned by the existing `/api/g2/intent` route. No new API calls.

### Computation

`useMemo` over `filteredCompanies` (respects all active filters):

```
for each company:
  build a Set of { productName, ...relatedProducts } (dedup per company)
  for each product name in the Set:
    increment tally[name].total
    increment tally[name].byStage[company.buyingStage]
sort by total desc, take top 8
```

### Display

Replaces the existing intelligence summary bar (the amber "Top researched" chips row and blue "Industries" chips row) with a richer compact panel. The industry breakdown is dropped from the summary — industry is still visible as a chip on each company row in the table below. Each competitor entry shows:

- Competitor name
- Total company count
- Three stage counts as small colored chips: awareness (slate), consideration (blue), decision (accent)

Clicking a competitor name filters the intent table to companies evaluating that product — sets `filterRelatedProduct` state and wires into `filteredCompanies` `useMemo`.

A new `filterRelatedProduct: string` state (`"all"` default) is added alongside the existing filter states. The filter bar gets a "Competitor" pill group populated dynamically from the top 5 competitors (+ "All"). The "Clear filters ×" button also clears `filterRelatedProduct`.

### Intent table filter change

`filteredCompanies` gains one additional filter condition:
```
if filterRelatedProduct !== "all":
  keep company only if productName === filterRelatedProduct
    OR relatedProducts.includes(filterRelatedProduct)
```

---

## Feature 2: Review Dimension Trends

### Data changes — `lib/g2.ts`

Add 6 fields to `G2Review`:

```typescript
easeOfUse: number | null
qualityOfSupport: number | null
easeOfSetup: number | null
meetsRequirements: number | null
likelihoodToRecommend: number | null
easeOfDoingBusiness: number | null
```

Map from survey-response attributes:
```
ease_of_use, quality_of_support, ease_of_setup,
meets_requirements, likelihood_to_recommend, ease_of_doing_business_with
```

All nullable — return `null` if the attribute is absent (older reviews may lack some dimensions).

Increase page size from 10 to 100: `?page[size]=100&sort=-submitted_at`

Add `DimensionTrend` type:

```typescript
export interface DimensionTrend {
  dimension: string       // display label, e.g. "Ease of Use"
  key: string             // snake_case key matching G2Review field
  current: number         // avg score, last 3 months (0 if no data)
  previous: number        // avg score, months 4–6 ago (0 if no data)
  delta: number           // percentage change, rounded to 1 decimal
  direction: "up" | "down" | "flat"
}
```

### Server-side computation — `app/api/g2/reviews/route.ts`

After fetching reviews, compute `dimensionTrends` before returning:

```
now = Date.now()
recentWindow  = reviews where submittedAt >= now - 90d
previousWindow = reviews where submittedAt >= now - 180d AND < now - 90d

for each of the 6 dimensions:
  currentAvg  = mean of non-null values in recentWindow  (0 if < 3 reviews)
  previousAvg = mean of non-null values in previousWindow (0 if < 3 reviews)
  delta = previousAvg > 0 ? ((currentAvg - previousAvg) / previousAvg) * 100 : 0
  direction = delta > 1 ? "up" : delta < -1 ? "down" : "flat"
```

Minimum 3 reviews per window required before assigning a direction (avoids noisy arrows on sparse data).

Return shape:

```typescript
{
  product: { starRating, reviewsCount },
  reviews: G2Review[],          // up to 100, newest first
  dimensionTrends: DimensionTrend[]  // always 6 entries
}
```

### Dashboard change

The Product Ratings card expands from 3 rows to 6. Each row:

- Dimension label (left)
- Current score + trend badge (right): `4.7 ↑ +2.3%` in accent/red, or `4.7` with no badge if direction is flat or no data
- Gradient bar (unchanged)
- Category average marker (unchanged)

The `ReviewsData` type in the dashboard gains `dimensionTrends: DimensionTrend[]`.

---

## Feature 3: ICP Fit Scoring

### Scoring formula

Computed client-side in a `computeFit(co, enrichment)` function. Maximum 100 points.

| Signal | Points |
|--------|--------|
| activityLevel === "high" | 40 |
| activityLevel === "medium" | 25 |
| activityLevel === "low" | 10 |
| buyingStage === "decision" | 25 |
| buyingStage === "consideration" | 15 |
| buyingStage === "awareness" | 5 |
| lifecycleStage === "opportunity" | 20 |
| lifecycleStage === "salesqualifiedlead" | 15 |
| lifecycleStage === "marketingqualifiedlead" | 10 |
| lifecycleStage ∈ { "lead", "subscriber" } | 5 |
| enrichment.hasApp === true | 10 |
| relatedProducts.length > 0 OR productName set | 5 |

Tiers:

| Score | Tier | Color |
|-------|------|-------|
| 76–100 | Hot | accent (`#05c79b`) |
| 56–75 | High | amber (`#f5a623`) |
| 31–55 | Medium | blue (`#4c9ef5`) |
| 0–30 | Low | slate (`#7c8c94`) |

### Dashboard changes

**Intent table**: New "Fit" column inserted between "Lifecycle" and "Products". Displays a chip with tier label and color. `colSpan` on expanded rows increases from 9 to 10.

**Filter state**: New `filterFit: string` state (`"all"` default). Filter bar gets a "Fit" pill group: All / Hot / High / Medium / Low.

**`filteredCompanies` useMemo**: Gains `filterFit` dependency. Additional condition:
```
if filterFit !== "all":
  keep company only if computeFit(co, appEnrichments.get(co.id)).tier === filterFit
```

**`computeFit` function**: Pure function defined outside the component. Takes `G2IntentCompany` and `AppEnrichment | undefined`, returns `{ score: number; tier: "Hot" | "High" | "Medium" | "Low" }`.

---

## Error Handling

- **Dimension trends**: if the reviews fetch fails, `dimensionTrends` is omitted from the response (or empty array). The dashboard falls back to showing only the 3 existing score bars — no new error state needed.
- **Competitor tally**: if `intent` is null (loading/error), the panel renders nothing. No separate error state.
- **ICP fit**: if `appEnrichments` map is still loading, `enrichment` is `undefined` → `hasApp` contribution is 0. Score updates automatically when enrichments arrive (useMemo re-runs).

## Dependencies

No new env vars. No new routes. Uses existing `G2_API_TOKEN`, `HUBSPOT_ACCESS_TOKEN`.
