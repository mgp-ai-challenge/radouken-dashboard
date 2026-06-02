# SensorTower App Enrichment Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich the G2 Buyer Intent table with SensorTower mobile app data — showing a platform badge per company and an expandable row with app name, category, estimated monthly downloads, store rating, and a store link.

**Architecture:** A `lib/sensortower.ts` client wraps SensorTower API calls. A new `POST /api/g2/app-enrichment` route accepts a list of companies, runs parallel SensorTower lookups (capped at 20 concurrent), and returns one enrichment record per company. The G2 dashboard fires this second fetch after intent data arrives and progressively fills in badges and expandable rows.

**Tech Stack:** Next.js 15 App Router, TypeScript strict mode, SensorTower Data API (`https://api.sensortower.com/v1/`), existing dark fintech design system in `components/g2-dashboard.tsx`

---

## Environment Variables

- `SENSORTOWER_API_TOKEN` — add to `.env.local`, never commit

---

## SensorTower API

**Base URL:** `https://api.sensortower.com/v1`

**Auth:** `?auth_token=${SENSORTOWER_API_TOKEN}` query parameter on every request

**All fetches:** `cache: "no-store"`

**Lookup flow per company (iOS and Android searched in parallel):**

1. `GET /v1/ios/search_entities?term={encodedName}&entity_type=publisher&auth_token={token}`
   - Returns array of `{ id, name, type }` — take first result as best match
2. `GET /v1/android/search_entities?term={encodedName}&entity_type=publisher&auth_token={token}`
   - Same shape
3. For each store where a publisher was found, fetch their top app:
   `GET /v1/{store}/publishers/{publisher_id}/apps?limit=1&sort_by=downloads&auth_token={token}`
   - `sort_by=downloads` is **required** — omitting it returns a 400 error
   - Response shape: `{ meta: { count }, data: [ ...apps ] }` — take `data[0]`
   - Confirmed field names from live API: `app_id` (number), `name` (string), `humanized_worldwide_last_30_days_downloads` (pre-formatted string e.g. `"50M"`), `os`
   - `rating` and `category` are **not** returned by this endpoint — set both to `null`

**Store URLs:**
- iOS: `https://apps.apple.com/app/id{app_id}`
- Android: `https://play.google.com/store/apps/details?id={app_id}`

**Search response confirmed fields:** `publisher_id` (number), `publisher_name` (string), `os` (string), `app_count` (number)

---

## Files

**Create:**
- `lib/sensortower.ts` — SensorTower API client
- `app/api/g2/app-enrichment/route.ts` — enrichment endpoint

**Modify:**
- `components/g2-dashboard.tsx` — second fetch, badge column, expandable rows

---

## Data Types

```typescript
// lib/sensortower.ts
export interface STAppResult {
  appName: string
  category: string
  monthlyDownloads: number | null
  storeRating: number | null
  storeUrl: string
  platform: "ios" | "android"
}

export interface STPublisherMatch {
  publisherId: string
  publisherName: string
  platform: "ios" | "android"
}

// app/api/g2/app-enrichment/route.ts (request body)
interface EnrichmentRequest {
  companies: Array<{ id: string; name: string }>
}

// app/api/g2/app-enrichment/route.ts (response)
export interface AppEnrichment {
  companyId: string
  hasApp: boolean
  platform: "ios" | "android" | "both" | null
  appName: string | null
  monthlyDownloads: string | null  // pre-formatted by SensorTower e.g. "50M", "1.2M"
  storeUrl: string | null          // iOS preferred if both exist
}
```

---

## API Route

### `POST /api/g2/app-enrichment`

**Request body:**
```json
{
  "companies": [
    { "id": "123", "name": "Acme Corp" },
    { "id": "456", "name": "BetaCo" }
  ]
}
```

**Response:**
```typescript
{
  enrichments: AppEnrichment[]  // one per company, in same order as input
}
```

**Implementation notes:**
- Process companies in batches of 20 using a concurrency-limited `Promise.allSettled`
- Per company: search iOS + Android in parallel → for stores with a match, fetch top app in parallel → merge
- If both iOS and Android found: `platform = "both"`, use iOS `appName` and `storeUrl`; concatenate downloads as `"{ios} iOS + {android} Android"` string
- If no match on either store: `{ hasApp: false, platform: null, appName: null, monthlyDownloads: null, storeUrl: null }`
- If SensorTower throws for a company: return `{ companyId, hasApp: false, platform: null, appName: null, monthlyDownloads: null, storeUrl: null }`
- Return `export const dynamic = "force-dynamic"`

**Concurrency helper** (implement inline in route, no separate utility):
```typescript
async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    const settled = await Promise.allSettled(batch.map(fn))
    for (const r of settled) {
      results.push(r.status === "fulfilled" ? r.value : (null as unknown as R))
    }
  }
  return results
}
```

---

## Dashboard Changes (`components/g2-dashboard.tsx`)

### New state

```typescript
const [appEnrichments, setAppEnrichments] = useState<Map<string, AppEnrichment>>(new Map())
const [appEnrichmentsLoading, setAppEnrichmentsLoading] = useState(false)
const [expandedRow, setExpandedRow] = useState<string | null>(null)
```

### Second fetch (fires after intent data arrives)

In the `Promise.allSettled` `.then()` handler, after setting intent state:
```typescript
if (i.status === "fulfilled") {
  const intentData = i.value as IntentData
  setIntent(intentData)
  // Fire enrichment fetch with the companies we just received
  if (intentData.companies.length > 0) {
    setAppEnrichmentsLoading(true)
    fetch("/api/g2/app-enrichment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companies: intentData.companies.map((c) => ({ id: c.id, name: c.name })),
      }),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: { enrichments: AppEnrichment[] }) => {
        const map = new Map<string, AppEnrichment>()
        for (const e of data.enrichments) map.set(e.companyId, e)
        setAppEnrichments(map)
      })
      .catch(() => {/* silent — badges just stay absent */})
      .finally(() => setAppEnrichmentsLoading(false))
  }
} else {
  setIntentErr(true)
}
```

### "App" column header

Add `"App"` as the last column header in the intent table (after "Last Signal"), centered.

### Badge component (inline, no separate export)

```typescript
function AppBadge({ enrichment, loading }: { enrichment: AppEnrichment | undefined; loading: boolean }) {
  if (loading && !enrichment) {
    return <span style={{ display: "inline-block", width: 48, height: 16, borderRadius: 4, background: C.card, animation: "bm-shimmer 1.6s ease infinite", backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`, backgroundSize: "200% 100%" }} />
  }
  if (!enrichment) return null
  if (!enrichment.hasApp) return <span style={{ padding: "2px 7px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: "rgba(124,140,148,0.10)", color: C.slate }}>No app</span>
  const label = enrichment.platform === "both" ? "iOS + Android" : enrichment.platform === "ios" ? "iOS" : "Android"
  const bg    = enrichment.platform === "both" ? C.accentDim : enrichment.platform === "ios" ? "rgba(76,158,245,0.12)" : "rgba(76,245,130,0.12)"
  const color = enrichment.platform === "both" ? C.accent    : enrichment.platform === "ios" ? C.blue               : "#4cf582"
  return <span style={{ padding: "2px 7px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: bg, color }}>{label}</span>
}
```

### Row click + expanded detail strip

Each `<tr>` gets `onClick={() => setExpandedRow(expandedRow === co.id ? null : co.id)}` and `style={{ cursor: "pointer" }}`.

After each `<tr>`, conditionally render an expansion `<tr>` when `expandedRow === co.id`:

```tsx
{expandedRow === co.id && (
  <tr>
    <td colSpan={6} style={{ padding: "0 10px 14px 10px", background: C.cardAlt }}>
      {(() => {
        const e = appEnrichments.get(co.id)
        if (!e || !e.hasApp) return <p style={{ fontSize: "12px", color: C.muted, padding: "10px 0" }}>No mobile app found for this publisher.</p>
        return (
          <div style={{ display: "flex", gap: "24px", alignItems: "center", padding: "10px 0", flexWrap: "wrap" }}>
            <div>
              <p style={{ fontSize: "11px", color: C.muted, marginBottom: "2px" }}>App</p>
              <p style={{ fontSize: "13px", fontWeight: 600, color: C.sageLight }}>{e.appName}</p>
            </div>
            {e.monthlyDownloads && (
              <div>
                <p style={{ fontSize: "11px", color: C.muted, marginBottom: "2px" }}>Downloads/mo</p>
                <p style={{ fontSize: "13px", fontFamily: MONO, color: C.sageLight }}>{e.monthlyDownloads}</p>
              </div>
            )}
            {e.storeUrl && (
              <a href={e.storeUrl} target="_blank" rel="noreferrer" style={{ fontSize: "12px", color: C.accent, textDecoration: "none", border: `1px solid ${C.borderAccent}`, padding: "4px 12px", borderRadius: "6px" }}>
                View in Store ↗
              </a>
            )}
          </div>
        )
      })()}
    </td>
  </tr>
)}
```

### Import `AppEnrichment`

Add `import type { AppEnrichment } from "@/lib/sensortower"` at the top of `components/g2-dashboard.tsx`. `AppEnrichment` is exported from `lib/sensortower.ts` and also imported in the route file.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `SENSORTOWER_API_TOKEN` not set | Route returns 500; badges stay absent (silent) |
| SensorTower search returns empty array | `hasApp: false` |
| SensorTower API error for one company | That company gets `hasApp: false`; others unaffected |
| Entire enrichment fetch fails | `appEnrichmentsLoading` → false, badges simply never appear |
| Intent panel fails to load | Enrichment fetch never fires (no companies to enrich) |
