# SensorTower App Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the G2 Buyer Intent table with SensorTower mobile app data — a platform badge per company and an expandable row showing app name, downloads, and a store link.

**Architecture:** `lib/sensortower.ts` wraps the SensorTower API. `POST /api/g2/app-enrichment` accepts company names, runs parallel lookups (capped at 20 concurrent), and returns one `AppEnrichment` per company. `components/g2-dashboard.tsx` fires this second fetch after intent data loads, stores results in a `Map`, and renders badges + expandable rows.

**Tech Stack:** Next.js 15 App Router, TypeScript strict mode, SensorTower Data API (`https://api.sensortower.com`), existing dark fintech design system in `components/g2-dashboard.tsx`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/sensortower.ts` | Create | API client: `stFetch`, `enrichCompany`, `AppEnrichment` type |
| `app/api/g2/app-enrichment/route.ts` | Create | POST endpoint: batches companies, calls `enrichCompany` |
| `components/g2-dashboard.tsx` | Modify | Second fetch, `AppBadge`, "App" column, expandable rows |

---

## Task 1: SensorTower API client (`lib/sensortower.ts`)

**Files:**
- Create: `lib/sensortower.ts`

**Context:** The SensorTower API base URL is `https://api.sensortower.com`. Auth is via `?auth_token=` query param. Verified endpoints:
- `GET /v1/{store}/search_entities?term={name}&entity_type=publisher&auth_token={token}` → `Array<{ publisher_id: number; publisher_name: string; os: string }>`
- `GET /v1/{store}/publishers/{publisher_id}/apps?limit=1&sort_by=downloads&auth_token={token}` → `{ meta: { count: number }; data: Array<{ app_id: number; name: string; humanized_worldwide_last_30_days_downloads: string }> }`

`sort_by=downloads` is **required** — omitting it returns a 400 error.

- [ ] **Step 1: Create `lib/sensortower.ts` with the complete client**

```typescript
// lib/sensortower.ts

const ST_BASE = "https://api.sensortower.com"

export interface AppEnrichment {
  companyId: string
  hasApp: boolean
  platform: "ios" | "android" | "both" | null
  appName: string | null
  monthlyDownloads: string | null  // pre-formatted e.g. "50M", "1.2M iOS + 800k Android"
  storeUrl: string | null          // iOS preferred when both exist
}

interface STPublisher {
  publisher_id: number
  publisher_name: string
  os: string
}

interface STApp {
  app_id: number
  name: string
  humanized_worldwide_last_30_days_downloads: string
}

async function stFetch(path: string): Promise<unknown> {
  const token = process.env.SENSORTOWER_API_TOKEN
  if (!token) throw new Error("SENSORTOWER_API_TOKEN environment variable is not set")
  const sep = path.includes("?") ? "&" : "?"
  const res = await fetch(`${ST_BASE}${path}${sep}auth_token=${token}`, {
    cache: "no-store",
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`SensorTower ${path} → ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`)
  }
  return res.json()
}

async function searchPublisher(name: string, store: "ios" | "android"): Promise<STPublisher | null> {
  const data = await stFetch(
    `/v1/${store}/search_entities?term=${encodeURIComponent(name)}&entity_type=publisher`
  ) as STPublisher[]
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

async function getTopApp(publisherId: number, store: "ios" | "android"): Promise<STApp | null> {
  const data = await stFetch(
    `/v1/${store}/publishers/${publisherId}/apps?limit=1&sort_by=downloads`
  ) as { data: STApp[] }
  return data.data?.[0] ?? null
}

function buildStoreUrl(appId: number, store: "ios" | "android"): string {
  return store === "ios"
    ? `https://apps.apple.com/app/id${appId}`
    : `https://play.google.com/store/apps/details?id=${appId}`
}

export async function enrichCompany(companyId: string, name: string): Promise<AppEnrichment> {
  const empty: AppEnrichment = {
    companyId, hasApp: false, platform: null,
    appName: null, monthlyDownloads: null, storeUrl: null,
  }
  try {
    const [iosPubResult, androidPubResult] = await Promise.allSettled([
      searchPublisher(name, "ios"),
      searchPublisher(name, "android"),
    ])
    const iosPub    = iosPubResult.status    === "fulfilled" ? iosPubResult.value    : null
    const androidPub = androidPubResult.status === "fulfilled" ? androidPubResult.value : null

    if (!iosPub && !androidPub) return empty

    const [iosAppResult, androidAppResult] = await Promise.allSettled([
      iosPub     ? getTopApp(iosPub.publisher_id,     "ios")     : Promise.resolve(null),
      androidPub ? getTopApp(androidPub.publisher_id, "android") : Promise.resolve(null),
    ])
    const ios     = iosAppResult.status     === "fulfilled" ? iosAppResult.value     : null
    const android = androidAppResult.status === "fulfilled" ? androidAppResult.value : null

    if (!ios && !android) return empty

    if (ios && android) {
      const parts = [
        ios.humanized_worldwide_last_30_days_downloads
          ? `${ios.humanized_worldwide_last_30_days_downloads} iOS` : null,
        android.humanized_worldwide_last_30_days_downloads
          ? `${android.humanized_worldwide_last_30_days_downloads} Android` : null,
      ].filter(Boolean)
      return {
        companyId,
        hasApp: true,
        platform: "both",
        appName: ios.name,
        monthlyDownloads: parts.length > 0 ? parts.join(" + ") : null,
        storeUrl: buildStoreUrl(ios.app_id, "ios"),
      }
    }

    if (ios) {
      return {
        companyId, hasApp: true, platform: "ios",
        appName: ios.name,
        monthlyDownloads: ios.humanized_worldwide_last_30_days_downloads || null,
        storeUrl: buildStoreUrl(ios.app_id, "ios"),
      }
    }

    return {
      companyId, hasApp: true, platform: "android",
      appName: android!.name,
      monthlyDownloads: android!.humanized_worldwide_last_30_days_downloads || null,
      storeUrl: buildStoreUrl(android!.app_id, "android"),
    }
  } catch {
    return empty
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/radustoia/outbound-attribution && npm run typecheck
```

Expected: no errors in `lib/sensortower.ts`

- [ ] **Step 3: Smoke-test the client via curl (verify field shapes match)**

```bash
source .env.local
# Search
curl -s "https://api.sensortower.com/v1/ios/search_entities?term=Supercell&entity_type=publisher&auth_token=$SENSORTOWER_API_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['publisher_id'], d[0]['publisher_name'])"
# Expected: 488106216 Supercell

# Top app
curl -s "https://api.sensortower.com/v1/ios/publishers/488106216/apps?limit=1&sort_by=downloads&auth_token=$SENSORTOWER_API_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); a=d['data'][0]; print(a['name'], a['humanized_worldwide_last_30_days_downloads'])"
# Expected: Brawl Stars <some download count>
```

- [ ] **Step 4: Commit**

```bash
git add lib/sensortower.ts
git commit -m "feat(sensortower): add API client with enrichCompany helper"
```

---

## Task 2: App enrichment API route (`app/api/g2/app-enrichment/route.ts`)

**Files:**
- Create: `app/api/g2/app-enrichment/route.ts`

**Context:** This is a Next.js App Router API route. It accepts `POST { companies: [{ id, name }] }`, processes them in batches of 20 using a concurrency helper, and returns `{ enrichments: AppEnrichment[] }`.

- [ ] **Step 1: Create `app/api/g2/app-enrichment/route.ts`**

```typescript
// app/api/g2/app-enrichment/route.ts
import { NextResponse } from "next/server"
import { enrichCompany, type AppEnrichment } from "@/lib/sensortower"

export const dynamic = "force-dynamic"

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<(R | null)[]> {
  const results: (R | null)[] = []
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    const settled = await Promise.allSettled(batch.map(fn))
    for (const r of settled) {
      results.push(r.status === "fulfilled" ? r.value : null)
    }
  }
  return results
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { companies?: Array<{ id: string; name: string }> }
    const companies = body.companies ?? []
    if (companies.length === 0) {
      return NextResponse.json({ enrichments: [] })
    }
    const enrichments = await withConcurrency(
      companies,
      20,
      (c) => enrichCompany(c.id, c.name)
    )
    return NextResponse.json({ enrichments: enrichments.filter(Boolean) as AppEnrichment[] })
  } catch (e) {
    console.error("[g2/app-enrichment]", e)
    return NextResponse.json({ error: "Failed to enrich companies" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Start dev server and smoke-test the route**

```bash
npm run dev
```

In a second terminal:
```bash
curl -s -X POST http://localhost:3000/api/g2/app-enrichment \
  -H "Content-Type: application/json" \
  -d '{"companies":[{"id":"test-1","name":"Supercell"}]}' | python3 -m json.tool
```

Expected: `{ "enrichments": [{ "companyId": "test-1", "hasApp": true, "platform": "both" or "ios", "appName": "Brawl Stars", ... }] }`

Also test empty input:
```bash
curl -s -X POST http://localhost:3000/api/g2/app-enrichment \
  -H "Content-Type: application/json" \
  -d '{"companies":[]}' | python3 -m json.tool
```

Expected: `{ "enrichments": [] }`

- [ ] **Step 4: Commit**

```bash
git add app/api/g2/app-enrichment/route.ts
git commit -m "feat(g2): add POST /api/g2/app-enrichment SensorTower enrichment route"
```

---

## Task 3: Dashboard — state, second fetch, AppBadge, App column

**Files:**
- Modify: `components/g2-dashboard.tsx`

**Context:** The dashboard currently has a single `Promise.allSettled` in `useEffect` that fetches reviews, profile, campaigns, and intent. After intent resolves, we fire a second fetch to `/api/g2/app-enrichment`. The intent table currently has 5 columns: Company, Activity, Stage, Intent Score, Last Signal. We add a 6th "App" column with a platform badge.

- [ ] **Step 1: Add `AppEnrichment` import at the top of `components/g2-dashboard.tsx`**

Find the existing import line:
```typescript
import type { G2Review, G2Product, G2ProfileView, G2Rank, G2Campaign, G2IntentCompany } from "@/lib/g2"
```

Replace with:
```typescript
import type { G2Review, G2Product, G2ProfileView, G2Rank, G2Campaign, G2IntentCompany } from "@/lib/g2"
import type { AppEnrichment } from "@/lib/sensortower"
```

- [ ] **Step 2: Add three new state variables inside `G2Dashboard`**

Find this block (existing state declarations):
```typescript
  const [intentErr,    setIntentErr]    = useState(false)
```

Add immediately after it:
```typescript
  const [appEnrichments, setAppEnrichments] = useState<Map<string, AppEnrichment>>(new Map())
  const [appEnrichmentsLoading, setAppEnrichmentsLoading] = useState(false)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
```

- [ ] **Step 3: Replace the intent settlement handler to trigger the second fetch**

Find this line in the `Promise.allSettled` `.then()` handler:
```typescript
      if (i.status === "fulfilled") setIntent(i.value as IntentData); else setIntentErr(true)
```

Replace with:
```typescript
      if (i.status === "fulfilled") {
        const intentData = i.value as IntentData
        setIntent(intentData)
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
            .catch(() => { /* silent — badges stay absent */ })
            .finally(() => setAppEnrichmentsLoading(false))
        }
      } else {
        setIntentErr(true)
      }
```

- [ ] **Step 4: Add the `AppBadge` component**

Add this function after the `relTime` helper (before `fmtWeek`):

```typescript
function AppBadge({ enrichment, loading }: { enrichment: AppEnrichment | undefined; loading: boolean }) {
  if (loading && !enrichment) {
    return (
      <span style={{
        display: "inline-block", width: 52, height: 16, borderRadius: 4,
        background: C.card,
        backgroundImage: `linear-gradient(90deg, ${C.card} 0%, ${C.cardAlt} 50%, ${C.card} 100%)`,
        backgroundSize: "200% 100%",
        animation: "bm-shimmer 1.6s ease infinite",
      }} />
    )
  }
  if (!enrichment) return null
  if (!enrichment.hasApp) {
    return (
      <span style={{ padding: "2px 7px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: "rgba(124,140,148,0.10)", color: C.slate }}>
        No app
      </span>
    )
  }
  const label = enrichment.platform === "both" ? "iOS + Android"
    : enrichment.platform === "ios" ? "iOS" : "Android"
  const bg    = enrichment.platform === "both" ? C.accentDim
    : enrichment.platform === "ios" ? "rgba(76,158,245,0.12)" : "rgba(76,245,130,0.12)"
  const color = enrichment.platform === "both" ? C.accent
    : enrichment.platform === "ios" ? C.blue : "#4cf582"
  return (
    <span style={{ padding: "2px 7px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: bg, color }}>
      {label}
    </span>
  )
}
```

- [ ] **Step 5: Add "App" to the column headers and badge cell to each row**

Find the intent table column header array:
```typescript
                  {["Company", "Activity", "Stage", "Intent Score", "Last Signal"].map((col) => (
                    <th key={col} scope="col" style={{ textAlign: col === "Company" ? "left" : "center", padding: "6px 10px", color: C.muted, fontWeight: 600, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}` }}>
```

Replace with:
```typescript
                  {["Company", "Activity", "Stage", "Intent Score", "Last Signal", "App"].map((col) => (
                    <th key={col} scope="col" style={{ textAlign: col === "Company" ? "left" : "center", padding: "6px 10px", color: C.muted, fontWeight: 600, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}` }}>
```

Then find the last `<td>` in the intent table row (the "Last Signal" cell):
```typescript
                      <td style={{ padding: "10px 10px", textAlign: "center", color: C.muted, fontSize: "11px" }}>
                        {relTime(co.lastSignalAt)}
                      </td>
```

Add immediately after it (before the closing `</tr>`):
```typescript
                      <td style={{ padding: "10px 10px", textAlign: "center" }}>
                        <AppBadge enrichment={appEnrichments.get(co.id)} loading={appEnrichmentsLoading} />
                      </td>
```

- [ ] **Step 6: Type-check**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Visual check in browser**

Open `http://localhost:3000/g2`. The Buyer Intent table should have a 6th "App" column. While enrichment is loading, cells show a shimmer placeholder. After ~5–10s, badges fill in with `iOS`, `Android`, `iOS + Android`, or `No app`.

- [ ] **Step 8: Commit**

```bash
git add components/g2-dashboard.tsx
git commit -m "feat(g2): add SensorTower app badge column to buyer intent table"
```

---

## Task 4: Dashboard — expandable rows with app details

**Files:**
- Modify: `components/g2-dashboard.tsx`

**Context:** Clicking any row in the Buyer Intent table toggles an expansion strip beneath it showing app name, downloads/mo, and a "View in Store" link. Only one row can be expanded at a time. The `expandedRow` state (added in Task 3) holds the currently-expanded `co.id`, or `null`.

The intent table rows currently look like:

```tsx
                {intent.companies.slice(0, 50).map((co, i) => {
                  ...
                  return (
                    <tr key={co.id} style={{ borderBottom: ... }}>
                      ...cells...
                    </tr>
                  )
                })}
```

- [ ] **Step 1: Add `onClick` and `cursor: pointer` to each intent table row**

Find the row opening tag inside the intent table map:
```typescript
                    <tr key={co.id} style={{ borderBottom: i < Math.min(intent.companies.length, 50) - 1 ? `1px solid ${C.border}` : "none" }}>
```

Replace with:
```typescript
                    <tr
                      key={co.id}
                      onClick={() => setExpandedRow(expandedRow === co.id ? null : co.id)}
                      style={{ borderBottom: i < Math.min(intent.companies.length, 50) - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer" }}
                    >
```

- [ ] **Step 2: Add the expansion row after each `</tr>`**

The map currently returns just the `<tr>`. Wrap the return in a `<>` fragment and add the expansion row:

Find:
```tsx
                  return (
                    <tr
                      key={co.id}
                      onClick={() => setExpandedRow(expandedRow === co.id ? null : co.id)}
                      style={{ borderBottom: i < Math.min(intent.companies.length, 50) - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer" }}
                    >
                      ...all cells...
                    </tr>
                  )
```

Replace with:
```tsx
                  return (
                    <React.Fragment key={co.id}>
                      <tr
                        onClick={() => setExpandedRow(expandedRow === co.id ? null : co.id)}
                        style={{ borderBottom: expandedRow === co.id ? "none" : i < Math.min(intent.companies.length, 50) - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer" }}
                      >
                        ...all cells (unchanged)...
                      </tr>
                      {expandedRow === co.id && (
                        <tr style={{ borderBottom: i < Math.min(intent.companies.length, 50) - 1 ? `1px solid ${C.border}` : "none" }}>
                          <td colSpan={6} style={{ padding: "0 10px 14px 10px", background: C.cardAlt }}>
                            {(() => {
                              const e = appEnrichments.get(co.id)
                              if (!e || !e.hasApp) {
                                return (
                                  <p style={{ fontSize: "12px", color: C.muted, padding: "10px 0" }}>
                                    No mobile app found for this publisher.
                                  </p>
                                )
                              }
                              return (
                                <div style={{ display: "flex", gap: "24px", alignItems: "center", padding: "10px 0", flexWrap: "wrap" }}>
                                  <div>
                                    <p style={{ fontSize: "11px", color: C.muted, marginBottom: "2px" }}>App</p>
                                    <p style={{ fontSize: "13px", fontWeight: 600, color: C.sageLight }}>{e.appName}</p>
                                  </div>
                                  {e.monthlyDownloads && (
                                    <div>
                                      <p style={{ fontSize: "11px", color: C.muted, marginBottom: "2px" }}>Downloads / mo</p>
                                      <p style={{ fontSize: "13px", fontFamily: MONO, color: C.sageLight }}>{e.monthlyDownloads}</p>
                                    </div>
                                  )}
                                  {e.storeUrl && (
                                    <a
                                      href={e.storeUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(ev) => ev.stopPropagation()}
                                      style={{ fontSize: "12px", color: C.accent, textDecoration: "none", border: `1px solid ${C.borderAccent}`, padding: "4px 12px", borderRadius: "6px" }}
                                    >
                                      View in Store ↗
                                    </a>
                                  )}
                                </div>
                              )
                            })()}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
```

**Important:** `React` must be in scope for `React.Fragment`. The file already uses JSX so React is available — but if there's no explicit `import React` at the top, add it:

Check the top of `components/g2-dashboard.tsx`. If it has `"use client"` but no `import React`, add:
```typescript
import React, { useEffect, useState } from "react"
```
replacing the existing `import { useEffect, useState } from "react"`.

Also note: `onClick={(ev) => ev.stopPropagation()}` on the store link prevents the row toggle from firing when the user clicks the link.

- [ ] **Step 3: Type-check**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Visual check — expand and collapse rows**

Open `http://localhost:3000/g2`. In the Buyer Intent table:
- Click any row → it should expand showing a dark `C.cardAlt` strip with "App" name, "Downloads / mo" and "View in Store ↗" link
- Click the same row again → it should collapse
- Click a different row → the previous row should collapse and the new one opens
- Clicking "View in Store ↗" should open the store page without toggling the row

- [ ] **Step 5: Commit**

```bash
git add components/g2-dashboard.tsx
git commit -m "feat(g2): expandable rows in buyer intent table with SensorTower app details"
```

---

## Task 5: Push and open PR

- [ ] **Step 1: Push branch**

```bash
git push --force-with-lease origin ui-update
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "feat: G2 dashboard + SensorTower mobile app enrichment" --body "$(cat <<'EOF'
## Summary
- New G2 dashboard at `/g2` with reviews, profile analytics, paid campaigns, and buyer intent panels
- Buyer intent companies enriched with SensorTower data: iOS/Android/Both badge per company
- Clicking a row expands to show app name, estimated monthly downloads, and store link
- HubSpot company links, activity level + buying stage badges, intent details in buyer intent table

## Test plan
- [ ] Visit `/g2` — all panels load (reviews, profile, campaigns, intent)
- [ ] Buyer intent table shows platform badges after ~5–10s
- [ ] Click a row — expansion strip shows app details
- [ ] Click "View in Store" — opens correct store page without collapsing row
- [ ] Click expanded row again — collapses
EOF
)"
```
