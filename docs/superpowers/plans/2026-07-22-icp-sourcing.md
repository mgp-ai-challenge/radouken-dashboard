# ICP Sourcing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/icp-sourcing` page to the radouken-dashboard that on-demand queries Sensor Tower by vertical, cross-references Lemlist engagement history and HubSpot customer status, and presents scored candidates in a tabbed table with recommended actions.

**Architecture:** Four per-vertical Next.js API routes each run the full pipeline (ST category search → SDK/DAU enrichment → hard gates → Lemlist domain match → HubSpot customer exclusion → score+sort) independently. The client fires all four in parallel on "Run Search"; each tab shows its own loading/error/result state. No persistent storage — results live in component state until next search.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS, shadcn/ui, Sensor Tower REST API (`api.sensortower.com`), Lemlist REST API (`api.lemlist.com`), HubSpot CRM API (`api.hubapi.com`).

**Spec:** `docs/superpowers/specs/2026-07-22-icp-sourcing-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/sensortower.ts` | Modify | Add: `MMPDetected` type, `STAppSummary` type, `searchAppsByCategory`, `getAppDAU`, `checkSDKDetection`, `getAppRevenue` |
| `lib/lemlist.ts` | Modify | Add: `LemlistLeadWithState` type, `fetchLeadsWithState` |
| `lib/icp-sourcing.ts` | Create | Types, `VERTICAL_CONFIGS`, `buildLemlistEngagementIndex`, `isCustomerDomain`, `scoreCandidate`, `runVerticalPipeline` |
| `app/api/icp-sourcing/iap-gaming/route.ts` | Create | Thin route: calls `runVerticalPipeline("iap-gaming")` |
| `app/api/icp-sourcing/igaming/route.ts` | Create | Thin route: calls `runVerticalPipeline("igaming")` |
| `app/api/icp-sourcing/ecommerce/route.ts` | Create | Thin route: calls `runVerticalPipeline("ecommerce")` |
| `app/api/icp-sourcing/prediction-markets/route.ts` | Create | Thin route: calls `runVerticalPipeline("prediction-markets")` |
| `components/icp-sourcing-dashboard.tsx` | Create | Full UI: tabs, table, loading/error states, Run Search button |
| `app/icp-sourcing/page.tsx` | Create | Page shell (renders `<ICPSourcingDashboard />`) |
| `components/app-sidebar.tsx` | Modify | Add "UA Sourcing" nav item |

---

## Task 1: Probe Sensor Tower API endpoints

This task has no code output — it discovers the exact endpoint shapes needed for Task 4. **Do not skip it.** Implementing ST functions against wrong endpoints wastes all subsequent work.

**Files:** None created/modified. Document findings as comments in this plan or in a scratch file.

- [ ] **Step 1: Export your ST token to the shell**

```bash
export ST_TOKEN=$(grep SENSORTOWER_API_TOKEN /Users/radustoia/outbound-attribution/.env.local | cut -d= -f2)
echo "Token: $ST_TOKEN"
```

Expected: prints your token (starts with `ST0_`).

- [ ] **Step 2: Probe the top apps by category endpoint (iOS, Casino)**

```bash
TODAY=$(date +%Y-%m-%d)
curl -s "https://api.sensortower.com/v1/ios/top_apps?category=6016&country=US&date=$TODAY&device_type=total&limit=5&auth_token=$ST_TOKEN" | python3 -m json.tool | head -80
```

Record: does this return data? What are the top-level keys? What are the per-app fields — specifically look for `app_id`, `name`, `publisher_id`, `publisher_name`, and any `website`/`seller_url`/`developer_url` field.

If the response is `{"error": "..."}` or 403, try without `device_type`:
```bash
curl -s "https://api.sensortower.com/v1/ios/top_apps?category=6016&country=US&date=$TODAY&limit=5&auth_token=$ST_TOKEN" | python3 -m json.tool | head -80
```

- [ ] **Step 3: Probe Android top apps (same category)**

```bash
curl -s "https://api.sensortower.com/v1/android/top_apps?category=GAME_CASINO&country=US&date=$TODAY&limit=5&auth_token=$ST_TOKEN" | python3 -m json.tool | head -80
```

Record: confirm Android uses string category IDs (e.g. `GAME_CASINO`) not numeric. If this 404s, try `category=6016` (same numeric as iOS).

- [ ] **Step 4: Probe SDK detection (use Candy Crush app_id=553834731 as a known test case)**

```bash
# Try SDK intelligence endpoint
curl -s "https://api.sensortower.com/v1/ios/sdk_intelligence?apps=553834731&auth_token=$ST_TOKEN" | python3 -m json.tool | head -60

# If 403/404, try the app detail endpoint for SDK fields
curl -s "https://api.sensortower.com/v1/ios/apps/553834731?auth_token=$ST_TOKEN" | python3 -m json.tool | head -60
```

Record:
- Is SDK detection accessible on this plan (200 vs 403)?
- If 200: what is the response shape? Does it include SDK names with "AppsFlyer" or "Adjust"?
- Note the exact field name for SDK display name.

- [ ] **Step 5: Probe Usage Intelligence / DAU**

```bash
# Try active users endpoint
curl -s "https://api.sensortower.com/v1/ios/apps/553834731/active_users?auth_token=$ST_TOKEN" | python3 -m json.tool | head -60

# If 403/404, try unified endpoint
curl -s "https://api.sensortower.com/v1/unified/apps/553834731/active_users?auth_token=$ST_TOKEN" | python3 -m json.tool | head -60
```

Record:
- Is DAU accessible (200 vs 403)?
- If 200: what is the response shape? What is the field name for US DAU?
- Does it need a date range param?

- [ ] **Step 6: Probe publisher detail for domain**

Take a `publisher_id` from the Step 2 response, then:
```bash
PUB_ID=<publisher_id_from_step_2>
curl -s "https://api.sensortower.com/v1/ios/publisher/${PUB_ID}?auth_token=$ST_TOKEN" | python3 -m json.tool | head -60
```

Record: Is there a `website`, `developer_url`, `seller_url`, or `publisher_url` field?

- [ ] **Step 7: Update Task 4 endpoint paths**

Based on findings:
1. Note the exact `top_apps` response shape (especially `app_id` field name — might be `app_id`, `id`, or `appId`)
2. Note Android category ID format (string vs numeric)
3. Note whether SDK detection is available and which endpoint works
4. Note whether DAU is available and which endpoint + date param format works
5. Note whether publisher detail has a domain field

These findings are used verbatim in Task 4. If SDK detection returns 403, `checkSDKDetection` will immediately return `"unknown"` for all apps. If DAU returns 403, `getAppDAU` returns `null` for all apps.

---

## Task 2: Core types and vertical configs

**Files:**
- Create: `lib/icp-sourcing.ts`

- [ ] **Step 1: Create `lib/icp-sourcing.ts` with types and vertical configs**

```typescript
// lib/icp-sourcing.ts

export type Vertical = "iap-gaming" | "igaming" | "ecommerce" | "prediction-markets" | "ctv"
export type EngagementTier = "replied" | "interested" | "clicked" | "opened" | "contacted" | null
export type RecommendedAction = "warm-re-approach" | "cold-outreach" | "manual-verify-mmp"

// Defined here (not in sensortower.ts) to avoid a circular dependency:
// lib/icp-sourcing.ts imports from lib/sensortower.ts; sensortower.ts must not import back.
export type MMPDetected = "appsflyer" | "adjust" | "both" | "none" | "unknown"

export interface ICPCandidate {
  appId: string
  appName: string
  publisherName: string
  publisherDomain: string | null
  vertical: Vertical
  store: "ios" | "android"              // platform the app was sourced from
  stEstimatedUSDAU: number | null       // ST panel estimate, not MMP-verified
  stMonthlyDownloads: number | null
  mmpDetected: MMPDetected
  isExistingBMPublisher: boolean        // always false in returned results (customers are hard-excluded)
  lemlistEngagement: EngagementTier
  lastContactedAt: string | null        // ISO string
  recommendedAction: RecommendedAction
  storeUrl: string | null
}

export interface ICPSourcingResponse {
  candidates: ICPCandidate[]
  fetchedAt: string
  error?: string
}

export interface VerticalConfig {
  vertical: Vertical
  // ST category IDs — verify correct values from Task 1 probe
  iosCategories: string[]
  androidCategories: string[]
  fetchDAU: boolean       // IAP gaming only — requires Usage Intelligence module
  fetchRevenue: boolean   // e-commerce and prediction markets — directional signal
  dauGate: number | null  // null = no gate; excludes candidates below threshold
  downloadsGate: number | null
}

// Category IDs based on App Store / Google Play taxonomy.
// iOS uses numeric IDs; Android uses string category keys.
// Verify these against Task 1 probe output and adjust if ST returns empty results.
export const VERTICAL_CONFIGS: Record<Exclude<Vertical, "ctv">, VerticalConfig> = {
  "iap-gaming": {
    vertical: "iap-gaming",
    iosCategories: ["7001", "7012", "7017", "6016"],   // Casual, Puzzle, Simulation, Casino
    androidCategories: ["GAME_CASUAL", "GAME_PUZZLE", "GAME_SIMULATION", "GAME_CASINO"],
    fetchDAU: true,
    fetchRevenue: false,
    dauGate: 100_000,
    downloadsGate: null,
  },
  "igaming": {
    vertical: "igaming",
    iosCategories: ["6016"],                            // Casino
    androidCategories: ["GAME_CASINO"],
    fetchDAU: false,
    fetchRevenue: false,
    dauGate: null,
    downloadsGate: null,
  },
  "ecommerce": {
    vertical: "ecommerce",
    iosCategories: ["6024"],                            // Shopping
    androidCategories: ["SHOPPING"],
    fetchDAU: false,
    fetchRevenue: true,
    dauGate: null,
    downloadsGate: 500_000,
  },
  "prediction-markets": {
    vertical: "prediction-markets",
    iosCategories: ["6004", "6015"],                    // Sports, Finance
    androidCategories: ["SPORTS", "FINANCE"],
    fetchDAU: false,
    fetchRevenue: true,
    dauGate: null,
    downloadsGate: null,
  },
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

const ENGAGEMENT_WEIGHT: Record<NonNullable<EngagementTier>, number> = {
  replied:    6,
  interested: 5,
  clicked:    4,
  opened:     3,
  contacted:  2,
}

export function scoreCandidate(candidate: ICPCandidate): number {
  // mmpDetected = "unknown" → lowest priority group
  if (candidate.mmpDetected === "unknown") return 0

  const engagementScore = candidate.lemlistEngagement
    ? ENGAGEMENT_WEIGHT[candidate.lemlistEngagement]
    : 1 // cold outreach baseline

  // Scale engagement score + normalised DAU signal (capped contribution)
  const dau = candidate.stEstimatedUSDAU ?? 0
  const dauSignal = Math.min(dau / 1_000_000, 5) // max 5 points from DAU
  const downloads = candidate.stMonthlyDownloads ?? 0
  const dlSignal = Math.min(downloads / 5_000_000, 3) // max 3 points

  return engagementScore * 10 + dauSignal + dlSignal
}

export function deriveRecommendedAction(
  mmpDetected: MMPDetected,
  lemlistEngagement: EngagementTier,
): RecommendedAction {
  if (mmpDetected === "unknown") return "manual-verify-mmp"
  if (lemlistEngagement !== null) return "warm-re-approach"
  return "cold-outreach"
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/radustoia/outbound-attribution && npm run typecheck
```

Expected: errors only about missing `MMPDetected` export from `lib/sensortower.ts` (which we haven't added yet). Any other errors → fix before continuing.

- [ ] **Step 3: Commit**

```bash
cd /Users/radustoia/outbound-attribution
git add lib/icp-sourcing.ts
git commit -m "feat: add ICP sourcing types, vertical configs, and scoring logic"
```

---

## Task 3: Lemlist engagement index + HubSpot customer check

**Files:**
- Modify: `lib/lemlist.ts` (add `LemlistLeadWithState`, `fetchLeadsWithState`)
- Modify: `lib/icp-sourcing.ts` (add `buildLemlistEngagementIndex`, `isCustomerDomain`)

- [ ] **Step 1: Add `fetchLeadsWithState` to `lib/lemlist.ts`**

Open `lib/lemlist.ts`. After the existing `fetchAllLeads` function, add:

```typescript
export interface LemlistLeadWithState {
  email: string
  companyName: string | null
  state: string   // raw Lemlist state, e.g. "emailReplied", "emailClicked", etc.
  sentAt: string | null
}

// Like fetchAllLeads but returns the raw state field for engagement scoring.
// Does NOT filter by sentAt — returns all leads including unsent.
export async function fetchLeadsWithState(campaignId: string): Promise<LemlistLeadWithState[]> {
  const results: LemlistLeadWithState[] = []
  const limit = 100
  let offset = 0

  while (true) {
    const data = await llFetch(`/campaigns/${campaignId}/leads?limit=${limit}&offset=${offset}`)
    const page = data as Array<Record<string, unknown>>
    if (!Array.isArray(page) || page.length === 0) break

    for (const l of page) {
      results.push({
        email:       String(l.email ?? ""),
        companyName: l.companyName ? String(l.companyName) : null,
        state:       String(l.state ?? ""),
        sentAt:      l.sentAt ? String(l.sentAt) : null,
      })
    }

    if (page.length < limit) break
    offset += limit
    await new Promise((r) => setTimeout(r, 100))
  }

  return results
}
```

- [ ] **Step 2: Add Lemlist engagement index and HubSpot customer check to `lib/icp-sourcing.ts`**

Open `lib/icp-sourcing.ts`. Add after the `deriveRecommendedAction` function:

```typescript
// ─── Lemlist engagement index ─────────────────────────────────────────────────

import { fetchAllCampaigns, fetchLeadsWithState, TARGET_CAMPAIGNS } from "./lemlist"

interface DomainEngagement {
  tier: EngagementTier
  lastContactedAt: string | null
}

function stateToEngagementTier(state: string): EngagementTier {
  const s = state.toLowerCase()
  if (s.includes("replied") || s.includes("reply")) return "replied"
  if (s.includes("interested"))                        return "interested"
  if (s.includes("click"))                             return "clicked"
  if (s.includes("open"))                              return "opened"
  if (s.includes("sent") || s.includes("contacted"))  return "contacted"
  return null
}

function extractDomain(email: string): string | null {
  const parts = email.split("@")
  return parts.length === 2 && parts[1] ? parts[1].toLowerCase() : null
}

// Builds a domain → engagement map by scanning all TARGET_CAMPAIGNS leads.
// Call once at the start of runVerticalPipeline and pass the result downstream.
export async function buildLemlistEngagementIndex(): Promise<Map<string, DomainEngagement>> {
  const index = new Map<string, DomainEngagement>()

  let allCampaigns: Array<{ _id: string; name: string }>
  try {
    allCampaigns = await fetchAllCampaigns()
  } catch {
    console.warn("[icp-sourcing] Lemlist campaign fetch failed — engagement will be null for all candidates")
    return index
  }

  const targetIds = TARGET_CAMPAIGNS
    .map(({ match }) => allCampaigns.find((c) => c.name.includes(match))?._id)
    .filter(Boolean) as string[]

  for (const campaignId of targetIds) {
    let leads: Awaited<ReturnType<typeof fetchLeadsWithState>>
    try {
      leads = await fetchLeadsWithState(campaignId)
    } catch {
      console.warn(`[icp-sourcing] Lemlist leads fetch failed for campaign ${campaignId}`)
      continue
    }

    for (const lead of leads) {
      const domain = extractDomain(lead.email)
      if (!domain) continue

      const tier = stateToEngagementTier(lead.state)
      const existing = index.get(domain)

      // Keep the highest-weight engagement for this domain
      const existingWeight = existing?.tier ? (ENGAGEMENT_WEIGHT[existing.tier] ?? 0) : 0
      const newWeight = tier ? (ENGAGEMENT_WEIGHT[tier] ?? 0) : 0

      if (!existing || newWeight > existingWeight) {
        index.set(domain, {
          tier,
          lastContactedAt: lead.sentAt ?? null,
        })
      }
    }
  }

  return index
}

// ─── HubSpot customer check ───────────────────────────────────────────────────

const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN

// Returns true if the domain belongs to an existing HubSpot customer.
// On API failure, returns false (conservative: don't exclude on error).
export async function isCustomerDomain(domain: string): Promise<boolean> {
  if (!HS_TOKEN) return false
  try {
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: "domain", operator: "EQ", value: domain },
          { propertyName: "lifecyclestage", operator: "EQ", value: "customer" },
        ],
      }],
      properties: ["domain", "lifecyclestage"],
      limit: 1,
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
      console.warn(`[icp-sourcing] HubSpot customer check failed for ${domain}: ${res.status}`)
      return false
    }
    const data = await res.json()
    return (data.total ?? 0) > 0
  } catch (e) {
    console.warn(`[icp-sourcing] HubSpot customer check threw for ${domain}:`, e)
    return false
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/radustoia/outbound-attribution && npm run typecheck
```

Expected: passes (or only errors from lib/sensortower.ts missing `MMPDetected`, which is next). Fix any real type errors before continuing.

- [ ] **Step 4: Commit**

```bash
cd /Users/radustoia/outbound-attribution
git add lib/lemlist.ts lib/icp-sourcing.ts
git commit -m "feat: add Lemlist engagement index and HubSpot customer check for ICP sourcing"
```

---

## Task 4: Sensor Tower extensions

**Files:**
- Modify: `lib/sensortower.ts`

> **Before writing code:** Review your Task 1 probe findings. The endpoint paths, field names, and response shapes below are based on the most likely ST API structure. Adjust any path or field name that differs from what you observed in the probe.

- [ ] **Step 1: Add `STAppSummary` interface to `lib/sensortower.ts`**

Open `lib/sensortower.ts`. After the existing interface definitions (after `STApp`), add:

> Note: `MMPDetected` is intentionally defined in `lib/icp-sourcing.ts`, not here, to avoid a circular import. The `checkSDKDetection` function below uses a compatible string union return type — TypeScript will infer assignability without an explicit import.

```typescript
export interface STAppSummary {
  appId: string
  appName: string
  publisherId: string
  publisherName: string
  publisherDomain: string | null
  store: "ios" | "android"
  storeUrl: string
}
```

- [ ] **Step 2: Add `searchAppsByCategory` to `lib/sensortower.ts`**

After the existing `enrichCompany` function, add:

```typescript
// Top apps by category (country=US).
// Queries both iOS and Android and merges results, deduplicating by publisherId.
// Adjust endpoint path and field names based on Task 1 probe findings.
export async function searchAppsByCategory(
  iosCategories: string[],
  androidCategories: string[],
): Promise<STAppSummary[]> {
  const today = new Date().toISOString().slice(0, 10)
  const seen = new Set<string>()
  const results: STAppSummary[] = []

  async function fetchCategory(categoryId: string, store: "ios" | "android"): Promise<void> {
    try {
      // Adjust path if probe found a different endpoint (e.g. /v1/unified/top_apps)
      const data = await stFetch(
        `/v1/${store}/top_apps?category=${categoryId}&country=US&date=${today}&device_type=total&limit=250`
      ) as { top_apps?: STTopAppRaw[] } | STTopAppRaw[]

      const apps: STTopAppRaw[] = Array.isArray(data)
        ? data
        : (data as { top_apps?: STTopAppRaw[] }).top_apps ?? []

      for (const app of apps) {
        const appId = String(app.app_id ?? app.id ?? "")
        const publisherId = String(app.publisher_id ?? app.publisher?.id ?? "")
        if (!appId || seen.has(appId)) continue
        seen.add(appId)

        results.push({
          appId,
          appName: String(app.name ?? app.app_name ?? ""),
          publisherId,
          publisherName: String(app.publisher_name ?? app.publisher?.name ?? ""),
          publisherDomain: app.website ?? app.seller_url ?? app.developer_url ?? null,
          store,
          storeUrl: buildStoreUrl(appId, store),
        })
      }
    } catch (e) {
      console.warn(`[sensortower] searchAppsByCategory failed for ${store} category ${categoryId}:`, e)
    }
  }

  await Promise.all([
    ...iosCategories.map((cat) => fetchCategory(cat, "ios")),
    ...androidCategories.map((cat) => fetchCategory(cat, "android")),
  ])

  return results
}

// Raw top-app shape from ST API — fields vary by account/plan tier.
// Adjust field names based on Task 1 probe findings.
interface STTopAppRaw {
  app_id?: string | number
  id?: string | number
  name?: string
  app_name?: string
  publisher_id?: string | number
  publisher?: { id?: string | number; name?: string }
  publisher_name?: string
  website?: string | null
  seller_url?: string | null
  developer_url?: string | null
}
```

- [ ] **Step 3: Add `checkSDKDetection` to `lib/sensortower.ts`**

```typescript
// Returns the MMP(s) detected for an app.
// Returns "unknown" if SDK Intelligence module is not available on this plan (403/404).
// Adjust endpoint and field names based on Task 1 probe findings.
export async function checkSDKDetection(
  appId: string,
  store: "ios" | "android",
): Promise<MMPDetected> {
  try {
    // Adjust path if probe found a different endpoint
    const data = await stFetch(`/v1/${store}/sdk_intelligence?apps=${appId}`) as Record<string, STSdkRaw[]>
    const sdks: STSdkRaw[] = data[appId] ?? Object.values(data)[0] ?? []

    const names = sdks.map((s) => (s.display_name ?? s.name ?? "").toLowerCase())
    const hasAF  = names.some((n) => n.includes("appsflyer"))
    const hasAdj = names.some((n) => n.includes("adjust"))

    if (hasAF && hasAdj) return "both"
    if (hasAF) return "appsflyer"
    if (hasAdj) return "adjust"
    return "none"
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status
    if (status === 403 || status === 404) {
      // Plan doesn't include SDK Intelligence — all candidates flagged for manual verify
      return "unknown"
    }
    // Transient error — treat as unknown
    console.warn(`[sensortower] checkSDKDetection failed for ${appId}:`, e)
    return "unknown"
  }
}

interface STSdkRaw {
  display_name?: string
  name?: string
}
```

Note: `stFetch` currently throws `new Error(...)` on non-200. We need it to expose the HTTP status for the 403/404 check. Update `stFetch` in `lib/sensortower.ts` to throw a typed error:

Find the existing `stFetch` function and replace the error throw with:
```typescript
// Replace this line:
throw new Error(`SensorTower ${path} → ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`)
// With:
const err = new Error(`SensorTower ${path} → ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`) as Error & { status: number }
err.status = res.status
throw err
```

- [ ] **Step 4: Add `getAppDAU` to `lib/sensortower.ts`**

```typescript
// Returns estimated US DAU from ST Usage Intelligence.
// Returns null if module unavailable (403/404) or data absent.
// Adjust endpoint path and field names based on Task 1 probe findings.
export async function getAppDAU(
  appId: string,
  store: "ios" | "android",
): Promise<number | null> {
  try {
    // Try the per-app active users endpoint — adjust path from Task 1 probe
    const data = await stFetch(`/v1/${store}/apps/${appId}/active_users`) as STActiveUsersRaw

    // Response may be an object with a "usage" or "active_users" array
    const entries: STActiveUsersEntry[] =
      (data as { active_users?: STActiveUsersEntry[] }).active_users ??
      (data as { usage?: STActiveUsersEntry[] }).usage ??
      (Array.isArray(data) ? data as STActiveUsersEntry[] : [])

    // Find a US entry; prefer 30-day DAU; fall back to MAU if DAU absent
    const usEntry = entries.find((e) => (e.country ?? e.country_code ?? "").toUpperCase() === "US")
    if (!usEntry) return null

    return usEntry.dau ?? usEntry.daily_active_users ?? usEntry.mau ?? usEntry.monthly_active_users ?? null
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status
    if (status === 403 || status === 404) return null
    console.warn(`[sensortower] getAppDAU failed for ${appId}:`, e)
    return null
  }
}

interface STActiveUsersRaw {
  active_users?: STActiveUsersEntry[]
  usage?: STActiveUsersEntry[]
}

interface STActiveUsersEntry {
  country?: string
  country_code?: string
  dau?: number
  daily_active_users?: number
  mau?: number
  monthly_active_users?: number
}
```

- [ ] **Step 5: Add `getAppRevenue` to `lib/sensortower.ts`**

```typescript
// Returns estimated monthly downloads (used for e-commerce gate and momentum signal).
// Uses the humanized_worldwide_last_30_days_downloads field from the publisher apps
// endpoint (already present in the existing STApp type). Falls back to null.
export async function getAppRevenue(
  appId: string,
  store: "ios" | "android",
): Promise<{ monthlyDownloads: number | null }> {
  try {
    const data = await stFetch(`/v1/${store}/apps/${appId}`) as STAppDetail
    const raw = data?.downloads_30d ?? data?.downloads?.value ?? data?.humanized_worldwide_last_30_days_downloads
    if (typeof raw === "number") return { monthlyDownloads: raw }
    return { monthlyDownloads: null }
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status
    if (status === 403 || status === 404) return { monthlyDownloads: null }
    console.warn(`[sensortower] getAppRevenue failed for ${appId}:`, e)
    return { monthlyDownloads: null }
  }
}

interface STAppDetail {
  downloads_30d?: number
  downloads?: { value?: number }
  humanized_worldwide_last_30_days_downloads?: number | { string?: string; downloads?: number } | null
}
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/radustoia/outbound-attribution && npm run typecheck
```

Expected: passes. Fix any type errors. Common issue: `import type { MMPDetected }` in `lib/icp-sourcing.ts` now resolves since we added the export.

- [ ] **Step 7: Quick smoke test of category search against the running server**

```bash
cd /Users/radustoia/outbound-attribution && npm run dev &
sleep 5
# Quick node script to test searchAppsByCategory
node -e "
const { searchAppsByCategory } = require('./lib/sensortower.ts')
" 2>&1 | head -5
```

Actually, since this is an ES module project, test via the API route (added in Task 6). Skip this and verify end-to-end in Task 6 instead.

- [ ] **Step 8: Commit**

```bash
cd /Users/radustoia/outbound-attribution
git add lib/sensortower.ts
git commit -m "feat: add ST category search, DAU, SDK detection, and revenue functions"
```

---

## Task 5: Pipeline orchestrator

**Files:**
- Modify: `lib/icp-sourcing.ts` (add `runVerticalPipeline`)

- [ ] **Step 1: Add `runVerticalPipeline` to `lib/icp-sourcing.ts`**

Open `lib/icp-sourcing.ts`. Add these imports at the top of the file:

```typescript
import {
  searchAppsByCategory,
  checkSDKDetection,
  getAppDAU,
  getAppRevenue,
  type STAppSummary,
} from "./sensortower"
```

Then add `runVerticalPipeline` after `isCustomerDomain`:

```typescript
// ─── Pipeline ─────────────────────────────────────────────────────────────────

// Concurrency helper — processes items in batches to respect ST rate limits
async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    const settled = await Promise.allSettled(batch.map(fn))
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(r.value)
    }
  }
  return results
}

export async function runVerticalPipeline(
  vertical: Exclude<Vertical, "ctv">,
): Promise<ICPSourcingResponse> {
  const config = VERTICAL_CONFIGS[vertical]
  const fetchedAt = new Date().toISOString()

  // Step 1: Build Lemlist engagement index (fetch once, look up per candidate)
  const engagementIndex = await buildLemlistEngagementIndex()

  // Step 2: Search ST for apps by category
  let apps: STAppSummary[]
  try {
    apps = await searchAppsByCategory(config.iosCategories, config.androidCategories)
  } catch (e) {
    console.error(`[icp-sourcing] ST category search failed for ${vertical}:`, e)
    return { candidates: [], fetchedAt, error: `Sensor Tower search failed: ${String(e)}` }
  }

  if (apps.length === 0) {
    return { candidates: [], fetchedAt }
  }

  // Step 3: Enrich each app (SDK, DAU, revenue) — max 10 concurrent ST calls
  const enriched = await withConcurrency(apps, 10, async (app): Promise<ICPCandidate | null> => {
    const [mmpDetected, dauResult, revenueResult] = await Promise.all([
      checkSDKDetection(app.appId, app.store),
      config.fetchDAU ? getAppDAU(app.appId, app.store) : Promise.resolve(null),
      config.fetchRevenue ? getAppRevenue(app.appId, app.store) : Promise.resolve({ monthlyDownloads: null }),
    ])

    const stEstimatedUSDAU = dauResult
    const stMonthlyDownloads = revenueResult.monthlyDownloads

    // Hard gate: MMP must be detected (not "none") — "unknown" is allowed through
    if (mmpDetected === "none") return null

    // Hard gate: DAU threshold (IAP gaming)
    if (config.dauGate !== null && stEstimatedUSDAU !== null && stEstimatedUSDAU < config.dauGate) return null

    // Hard gate: downloads threshold (e-commerce)
    if (config.downloadsGate !== null && stMonthlyDownloads !== null && stMonthlyDownloads < config.downloadsGate) return null

    // Resolve publisher domain for Lemlist + HubSpot matching
    const domain = app.publisherDomain
      ? extractPublisherDomain(app.publisherDomain)
      : null

    // Lemlist engagement lookup
    const engagement = domain ? (engagementIndex.get(domain) ?? null) : null
    const lemlistEngagement = engagement?.tier ?? null
    const lastContactedAt = engagement?.lastContactedAt ?? null

    return {
      appId:                app.appId,
      appName:              app.appName,
      publisherName:        app.publisherName,
      publisherDomain:      domain,
      vertical,
      store:                app.store,
      stEstimatedUSDAU,
      stMonthlyDownloads,
      mmpDetected,
      isExistingBMPublisher: false,  // set below after HubSpot check
      lemlistEngagement,
      lastContactedAt,
      recommendedAction:    deriveRecommendedAction(mmpDetected, lemlistEngagement),
      storeUrl:             app.storeUrl,
    }
  })

  const passing = enriched.filter((c): c is ICPCandidate => c !== null)

  // Step 4: HubSpot customer exclusion (batch to avoid hammering the API)
  const withHubspot = await withConcurrency(passing, 5, async (candidate) => {
    if (!candidate.publisherDomain) return candidate
    const isCustomer = await isCustomerDomain(candidate.publisherDomain)
    if (isCustomer) return null  // hard exclude
    return candidate
  })

  const final = withHubspot.filter((c): c is ICPCandidate => c !== null)

  // Step 5: Sort
  final.sort((a, b) => scoreCandidate(b) - scoreCandidate(a))

  return { candidates: final, fetchedAt }
}

function extractPublisherDomain(rawUrl: string): string | null {
  try {
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`
    const hostname = new URL(url).hostname
    // Strip www. prefix
    return hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/radustoia/outbound-attribution && npm run typecheck
```

Expected: passes. Fix any errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/radustoia/outbound-attribution
git add lib/icp-sourcing.ts
git commit -m "feat: add ICP sourcing pipeline orchestrator"
```

---

## Task 6: API routes

**Files:**
- Create: `app/api/icp-sourcing/iap-gaming/route.ts`
- Create: `app/api/icp-sourcing/igaming/route.ts`
- Create: `app/api/icp-sourcing/ecommerce/route.ts`
- Create: `app/api/icp-sourcing/prediction-markets/route.ts`

- [ ] **Step 1: Create all four route files**

`app/api/icp-sourcing/iap-gaming/route.ts`:
```typescript
import { NextResponse } from "next/server"
import { runVerticalPipeline } from "@/lib/icp-sourcing"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await runVerticalPipeline("iap-gaming")
    return NextResponse.json(result)
  } catch (e) {
    console.error("[icp-sourcing/iap-gaming]", e)
    return NextResponse.json({ candidates: [], fetchedAt: new Date().toISOString(), error: String(e) }, { status: 500 })
  }
}
```

`app/api/icp-sourcing/igaming/route.ts`:
```typescript
import { NextResponse } from "next/server"
import { runVerticalPipeline } from "@/lib/icp-sourcing"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await runVerticalPipeline("igaming")
    return NextResponse.json(result)
  } catch (e) {
    console.error("[icp-sourcing/igaming]", e)
    return NextResponse.json({ candidates: [], fetchedAt: new Date().toISOString(), error: String(e) }, { status: 500 })
  }
}
```

`app/api/icp-sourcing/ecommerce/route.ts`:
```typescript
import { NextResponse } from "next/server"
import { runVerticalPipeline } from "@/lib/icp-sourcing"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await runVerticalPipeline("ecommerce")
    return NextResponse.json(result)
  } catch (e) {
    console.error("[icp-sourcing/ecommerce]", e)
    return NextResponse.json({ candidates: [], fetchedAt: new Date().toISOString(), error: String(e) }, { status: 500 })
  }
}
```

`app/api/icp-sourcing/prediction-markets/route.ts`:
```typescript
import { NextResponse } from "next/server"
import { runVerticalPipeline } from "@/lib/icp-sourcing"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const result = await runVerticalPipeline("prediction-markets")
    return NextResponse.json(result)
  } catch (e) {
    console.error("[icp-sourcing/prediction-markets]", e)
    return NextResponse.json({ candidates: [], fetchedAt: new Date().toISOString(), error: String(e) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/radustoia/outbound-attribution && npm run typecheck
```

Expected: passes.

- [ ] **Step 3: Smoke test — hit the iGaming route (fastest — no DAU/revenue fetch)**

Make sure `npm run dev` is running, then:
```bash
curl -s http://localhost:3000/api/icp-sourcing/igaming | python3 -m json.tool | head -60
```

Expected: JSON with `candidates` array (may be empty if ST returns no results, or populated). If `error` field appears, check server logs for the actual error — likely an ST endpoint path mismatch from Task 4. Adjust the endpoint path in `lib/sensortower.ts` `searchAppsByCategory`.

- [ ] **Step 4: Commit**

```bash
cd /Users/radustoia/outbound-attribution
git add app/api/icp-sourcing/
git commit -m "feat: add per-vertical ICP sourcing API routes"
```

---

## Task 7: UI dashboard component

**Files:**
- Create: `components/icp-sourcing-dashboard.tsx`

- [ ] **Step 1: Create `components/icp-sourcing-dashboard.tsx`**

```tsx
"use client"

import React, { useState } from "react"
import { Search, RefreshCw, AlertCircle, CheckCircle, Loader2, ExternalLink } from "lucide-react"
import type { ICPCandidate, ICPSourcingResponse, Vertical } from "@/lib/icp-sourcing"

// ─── Design system (matches g2-dashboard.tsx) ─────────────────────────────────
const C = {
  bg:           "#020d07",
  card:         "#071510",
  cardAlt:      "#0a1d14",
  border:       "#0e2b1d",
  borderAccent: "rgba(5,199,155,0.18)",
  accent:       "#05c79b",
  accentBright: "#00e8b0",
  accentDim:    "rgba(5,199,155,0.13)",
  sage:         "#c8ddd5",
  sageLight:    "#e8f3ef",
  muted:        "#3d6b56",
  slate:        "#7c8c94",
  amber:        "#f5a623",
  amberDim:     "rgba(245,166,35,0.12)",
  red:          "#ef4444",
  redDim:       "rgba(239,68,68,0.12)",
  blue:         "#4c9ef5",
  blueDim:      "rgba(76,158,245,0.12)",
  green:        "#22c55e",
  greenDim:     "rgba(34,197,94,0.12)",
}

const MONO = "'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, monospace"

function fmtNum(n: number | null): string {
  if (n === null) return "—"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "k"
  return n.toString()
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return "today"
  if (days === 1) return "1 day ago"
  if (days < 30)  return `${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? "1 mo ago" : `${months} mo ago`
}

// ─── Types ────────────────────────────────────────────────────────────────────

type FetchStatus = "idle" | "loading" | "done" | "error"

interface VerticalState {
  status: FetchStatus
  candidates: ICPCandidate[]
  fetchedAt: string | null
  error: string | null
}

type VerticalKey = Exclude<Vertical, "ctv">
const VERTICALS: Array<{ key: VerticalKey; label: string; apiPath: string }> = [
  { key: "iap-gaming",         label: "IAP Gaming",         apiPath: "/api/icp-sourcing/iap-gaming" },
  { key: "igaming",            label: "iGaming",            apiPath: "/api/icp-sourcing/igaming" },
  { key: "ecommerce",          label: "E-Commerce",         apiPath: "/api/icp-sourcing/ecommerce" },
  { key: "prediction-markets", label: "Prediction Markets", apiPath: "/api/icp-sourcing/prediction-markets" },
]

const INITIAL_STATE: Record<VerticalKey, VerticalState> = {
  "iap-gaming":         { status: "idle", candidates: [], fetchedAt: null, error: null },
  "igaming":            { status: "idle", candidates: [], fetchedAt: null, error: null },
  "ecommerce":          { status: "idle", candidates: [], fetchedAt: null, error: null },
  "prediction-markets": { status: "idle", candidates: [], fetchedAt: null, error: null },
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function MmpBadge({ value }: { value: ICPCandidate["mmpDetected"] }) {
  const map: Record<ICPCandidate["mmpDetected"], { label: string; color: string; bg: string }> = {
    appsflyer: { label: "AppsFlyer", color: C.accent,  bg: C.accentDim },
    adjust:    { label: "Adjust",    color: C.blue,    bg: C.blueDim },
    both:      { label: "Both",      color: C.green,   bg: C.greenDim },
    none:      { label: "None",      color: C.red,     bg: C.redDim },
    unknown:   { label: "Unknown",   color: C.amber,   bg: C.amberDim },
  }
  const s = map[value]
  return (
    <span style={{ background: s.bg, color: s.color, fontFamily: MONO, fontSize: 11, padding: "2px 8px", borderRadius: 4 }}>
      {s.label}
    </span>
  )
}

function EngagementBadge({ tier }: { tier: ICPCandidate["lemlistEngagement"] }) {
  if (!tier) return <span style={{ color: C.slate, fontSize: 12 }}>—</span>
  const map: Record<NonNullable<ICPCandidate["lemlistEngagement"]>, { label: string; color: string; bg: string }> = {
    replied:   { label: "Replied",   color: C.green, bg: C.greenDim },
    interested:{ label: "Interested",color: C.accent, bg: C.accentDim },
    clicked:   { label: "Clicked",   color: C.blue,  bg: C.blueDim },
    opened:    { label: "Opened",    color: C.sage,  bg: "rgba(200,221,213,0.1)" },
    contacted: { label: "Contacted", color: C.slate, bg: "rgba(124,140,148,0.1)" },
  }
  const s = map[tier]
  return (
    <span style={{ background: s.bg, color: s.color, fontFamily: MONO, fontSize: 11, padding: "2px 8px", borderRadius: 4 }}>
      {s.label}
    </span>
  )
}

function ActionBadge({ action }: { action: ICPCandidate["recommendedAction"] }) {
  const map: Record<ICPCandidate["recommendedAction"], { label: string; color: string; bg: string }> = {
    "warm-re-approach":  { label: "Warm Re-approach",  color: C.green, bg: C.greenDim },
    "cold-outreach":     { label: "Cold Outreach",     color: C.blue,  bg: C.blueDim },
    "manual-verify-mmp": { label: "Verify MMP",        color: C.amber, bg: C.amberDim },
  }
  const s = map[action]
  return (
    <span style={{ background: s.bg, color: s.color, fontFamily: MONO, fontSize: 11, padding: "2px 8px", borderRadius: 4 }}>
      {s.label}
    </span>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────

function CandidateTable({ candidates, vertical }: { candidates: ICPCandidate[]; vertical: VerticalKey }) {
  const showDAU = vertical === "iap-gaming"
  const showDownloads = vertical === "ecommerce" || vertical === "prediction-markets"

  const thStyle: React.CSSProperties = {
    padding: "8px 12px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    color: C.muted,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
  }
  const tdStyle: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 13,
    color: C.sage,
    borderBottom: `1px solid ${C.border}`,
    verticalAlign: "middle",
  }

  if (candidates.length === 0) {
    return (
      <div style={{ padding: "32px 0", textAlign: "center", color: C.slate, fontSize: 13 }}>
        No candidates pass the ICP gates for this vertical.
      </div>
    )
  }

  // E-commerce: retargeting list size (≥100K users) cannot be verified via ST — flag for manual check
  const ecommerceNote = vertical === "ecommerce" ? (
    <div style={{
      background: C.amberDim, border: `1px solid rgba(245,166,35,0.2)`,
      borderRadius: 8, padding: "10px 14px", marginBottom: 14,
      fontSize: 12, color: C.amber, display: "flex", gap: 8, alignItems: "center",
    }}>
      <AlertCircle size={14} style={{ flexShrink: 0 }} />
      Retargeting list size (≥100K users) cannot be verified via Sensor Tower.
      Manually confirm retargeting audience size before outreach.
    </div>
  ) : null

  return (
    <div style={{ overflowX: "auto" }}>
      {ecommerceNote}
      <p style={{ fontSize: 11, color: C.slate, marginBottom: 12 }}>
        {candidates.length} candidate{candidates.length !== 1 ? "s" : ""} — Sensor Tower est. DAU/downloads are panel-based estimates, not advertiser-verified figures.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>App</th>
            <th style={thStyle}>Publisher</th>
            {showDAU && <th style={{ ...thStyle, textAlign: "right" }}>ST est. US DAU</th>}
            {showDownloads && <th style={{ ...thStyle, textAlign: "right" }}>ST est. Downloads</th>}
            <th style={thStyle}>MMP Detected</th>
            <th style={thStyle}>Lemlist Engagement</th>
            <th style={thStyle}>Last Contacted</th>
            <th style={thStyle}>Recommended Action</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.appId} style={{ transition: "background 0.1s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.cardAlt)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <td style={tdStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: C.sageLight, fontWeight: 500 }}>{c.appName}</span>
                  {c.storeUrl && (
                    <a href={c.storeUrl} target="_blank" rel="noopener noreferrer"
                      style={{ color: C.muted, display: "flex" }}>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>
                  {c.store === "ios" ? "iOS" : "Android"}
                </div>
              </td>
              <td style={tdStyle}>
                <div style={{ color: C.sage }}>{c.publisherName}</div>
                {c.publisherDomain && (
                  <div style={{ fontSize: 11, color: C.slate }}>{c.publisherDomain}</div>
                )}
              </td>
              {showDAU && (
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: MONO }}>
                  {fmtNum(c.stEstimatedUSDAU)}
                </td>
              )}
              {showDownloads && (
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: MONO }}>
                  {fmtNum(c.stMonthlyDownloads)}
                </td>
              )}
              <td style={tdStyle}><MmpBadge value={c.mmpDetected} /></td>
              <td style={tdStyle}><EngagementBadge tier={c.lemlistEngagement} /></td>
              <td style={{ ...tdStyle, fontFamily: MONO, fontSize: 12, color: C.slate }}>
                {timeAgo(c.lastContactedAt)}
              </td>
              <td style={tdStyle}><ActionBadge action={c.recommendedAction} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ICPSourcingDashboard() {
  const [states, setStates] = useState<Record<VerticalKey, VerticalState>>(INITIAL_STATE)
  const [activeTab, setActiveTab] = useState<VerticalKey | "ctv">("iap-gaming")
  const [isSearching, setIsSearching] = useState(false)

  function setVerticalState(key: VerticalKey, patch: Partial<VerticalState>) {
    setStates((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  async function fetchVertical(v: { key: VerticalKey; apiPath: string }) {
    setVerticalState(v.key, { status: "loading", error: null })
    try {
      const res = await fetch(v.apiPath)
      const data: ICPSourcingResponse = await res.json()
      if (data.error) {
        setVerticalState(v.key, { status: "error", error: data.error, candidates: [] })
      } else {
        setVerticalState(v.key, { status: "done", candidates: data.candidates, fetchedAt: data.fetchedAt, error: null })
      }
    } catch (e) {
      setVerticalState(v.key, { status: "error", error: String(e), candidates: [] })
    }
  }

  async function runSearch() {
    setIsSearching(true)
    await Promise.all(VERTICALS.map(fetchVertical))
    setIsSearching(false)
  }

  function tabIcon(key: VerticalKey) {
    const s = states[key]
    if (s.status === "loading") return <Loader2 size={12} className="animate-spin" style={{ color: C.accent }} />
    if (s.status === "done")    return <CheckCircle size={12} style={{ color: C.accent }} />
    if (s.status === "error")   return <AlertCircle size={12} style={{ color: C.amber }} />
    return null
  }

  const panelStyle: React.CSSProperties = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 24,
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: 32, color: C.sage }}>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: C.sageLight, margin: 0 }}>
            UA ICP Sourcing — Q3 2026
          </h1>
          <p style={{ fontSize: 13, color: C.slate, marginTop: 6 }}>
            Live Sensor Tower candidates scored against Lemlist engagement and BM publisher status.
            Existing customers are excluded. DAU and download figures are Sensor Tower panel estimates.
          </p>
        </div>
        <button
          onClick={runSearch}
          disabled={isSearching}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            background: isSearching ? C.accentDim : C.accent,
            color: isSearching ? C.accent : C.bg,
            border: "none", borderRadius: 8, padding: "10px 20px",
            fontSize: 13, fontWeight: 600, cursor: isSearching ? "not-allowed" : "pointer",
            transition: "all 0.15s",
          }}
        >
          {isSearching
            ? <><RefreshCw size={14} className="animate-spin" /> Searching…</>
            : <><Search size={14} /> Run Search</>
          }
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
        {VERTICALS.map((v) => {
          const active = activeTab === v.key
          return (
            <button
              key={v.key}
              onClick={() => setActiveTab(v.key)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px",
                background: active ? C.accentDim : "transparent",
                color: active ? C.accentBright : C.slate,
                border: "none",
                borderBottom: active ? `2px solid ${C.accent}` : "2px solid transparent",
                borderRadius: "6px 6px 0 0",
                fontSize: 13, fontWeight: active ? 600 : 400,
                cursor: "pointer", transition: "all 0.15s",
              }}
            >
              {v.label}
              {tabIcon(v.key)}
              {states[v.key].status === "done" && (
                <span style={{
                  background: C.accentDim, color: C.accent,
                  fontSize: 10, fontFamily: MONO,
                  padding: "1px 6px", borderRadius: 10,
                }}>
                  {states[v.key].candidates.length}
                </span>
              )}
            </button>
          )
        })}
        <button
          onClick={() => setActiveTab("ctv")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px",
            background: activeTab === "ctv" ? C.accentDim : "transparent",
            color: activeTab === "ctv" ? C.accentBright : C.slate,
            border: "none",
            borderBottom: activeTab === "ctv" ? `2px solid ${C.accent}` : "2px solid transparent",
            borderRadius: "6px 6px 0 0",
            fontSize: 13, fontWeight: activeTab === "ctv" ? 600 : 400,
            cursor: "pointer", transition: "all 0.15s",
          }}
        >
          CTV
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "ctv" ? (
        <div style={panelStyle}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: C.sageLight, margin: "0 0 8px" }}>CTV Overlay</h3>
          <p style={{ fontSize: 13, color: C.slate, margin: 0 }}>
            CTV advertiser sourcing cannot be automated via Sensor Tower — this vertical requires Paul{"'"}s partner
            lists from Smadex/Adikteev. Reach out to Paul directly to get the candidate list for Q3.
          </p>
        </div>
      ) : (
        <div style={panelStyle}>
          {states[activeTab].status === "idle" && (
            <div style={{ padding: "40px 0", textAlign: "center", color: C.slate, fontSize: 13 }}>
              Click <strong style={{ color: C.sage }}>Run Search</strong> to fetch candidates from Sensor Tower.
            </div>
          )}
          {states[activeTab].status === "loading" && (
            <div style={{ padding: "40px 0", textAlign: "center", color: C.slate, fontSize: 13 }}>
              <Loader2 size={20} className="animate-spin" style={{ color: C.accent, margin: "0 auto 12px", display: "block" }} />
              Fetching from Sensor Tower, Lemlist, and HubSpot…
            </div>
          )}
          {states[activeTab].status === "error" && (
            <div style={{
              display: "flex", gap: 12, alignItems: "flex-start",
              background: C.redDim, border: `1px solid rgba(239,68,68,0.2)`,
              borderRadius: 8, padding: 16,
            }}>
              <AlertCircle size={16} style={{ color: C.red, flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, color: C.red, fontSize: 13, marginBottom: 4 }}>Search failed</div>
                <div style={{ fontSize: 12, color: C.slate, fontFamily: MONO }}>{states[activeTab].error}</div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 8 }}>Click Run Search to retry.</div>
              </div>
            </div>
          )}
          {states[activeTab].status === "done" && (
            <CandidateTable
              candidates={states[activeTab].candidates}
              vertical={activeTab as VerticalKey}
            />
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/radustoia/outbound-attribution && npm run typecheck
```

Expected: passes. The `ICPCandidate` type includes a `store` field — if TypeScript reports it missing, add `store: "ios" | "android"` to the `ICPCandidate` interface in `lib/icp-sourcing.ts` and populate it in `runVerticalPipeline` from `app.store`.

- [ ] **Step 3: Commit**

```bash
cd /Users/radustoia/outbound-attribution
git add components/icp-sourcing-dashboard.tsx
git commit -m "feat: add ICP sourcing dashboard UI"
```

---

## Task 8: Page shell and sidebar nav

**Files:**
- Create: `app/icp-sourcing/page.tsx`
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: Create `app/icp-sourcing/page.tsx`**

```tsx
import { ICPSourcingDashboard } from "@/components/icp-sourcing-dashboard"

export default function ICPSourcingPage() {
  return <ICPSourcingDashboard />
}
```

- [ ] **Step 2: Add nav item to `components/app-sidebar.tsx`**

Open `components/app-sidebar.tsx`. Find the `navItems` array:

```typescript
const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/self-serve", label: "Self-Serve", icon: TrendingUp },
  { href: "/g2", label: "G2", icon: Star },
  { href: "/campaigns", label: "Campaigns", icon: BarChart2 },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/workspace", label: "Project Workspace", icon: LayoutList },
  { href: "/analytics", label: "Bug Tracking", icon: Bug },
  { href: "/settings", label: "Settings", icon: Settings },
] as const
```

Replace with (adds `Target` icon for UA Sourcing after Campaigns):

```typescript
const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/self-serve", label: "Self-Serve", icon: TrendingUp },
  { href: "/g2", label: "G2", icon: Star },
  { href: "/campaigns", label: "Campaigns", icon: BarChart2 },
  { href: "/icp-sourcing", label: "UA Sourcing", icon: Target },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/workspace", label: "Project Workspace", icon: LayoutList },
  { href: "/analytics", label: "Bug Tracking", icon: Bug },
  { href: "/settings", label: "Settings", icon: Settings },
] as const
```

Also add `Target` to the lucide-react import at the top:
```typescript
import { LayoutDashboard, LayoutList, Bug, Settings, Bot, TrendingUp, RotateCcw, Star, BarChart2, Target } from "lucide-react"
```

- [ ] **Step 3: Typecheck and verify**

```bash
cd /Users/radustoia/outbound-attribution && npm run typecheck
```

Expected: passes.

- [ ] **Step 4: Visual verify in browser**

Make sure `npm run dev` is running, then open `http://localhost:3000/icp-sourcing`.

Expected:
- "UA Sourcing" appears in sidebar, highlighted when on `/icp-sourcing`
- Page shows "UA ICP Sourcing — Q3 2026" header
- Tabs visible: IAP Gaming | iGaming | E-Commerce | Prediction Markets | CTV
- CTV tab shows the manual note about Paul's lists
- "Run Search" button visible; click it — all tabs should go into loading state simultaneously

- [ ] **Step 5: Final commit**

```bash
cd /Users/radustoia/outbound-attribution
git add app/icp-sourcing/page.tsx components/app-sidebar.tsx
git commit -m "feat: add UA ICP sourcing page and sidebar nav item"
```

---

## Post-implementation checks

After all tasks are complete, run search against each vertical and verify:
1. **IAP Gaming** — results have `stEstimatedUSDAU` populated (or null with "Unknown" DAU), `mmpDetected` badge shows, existing customers absent
2. **iGaming** — Casino-category apps visible, no DAU column shown
3. **E-Commerce** — Shopping-category apps, downloads column shown
4. **Prediction Markets** — Sports/Finance apps, warm-re-approach sorted first if any Lemlist history exists
5. **CTV** — Static note card, no ST data

If a vertical returns 0 candidates after a successful search, the most likely cause is category ID mismatch — revisit Task 1 probe findings and update `VERTICAL_CONFIGS` in `lib/icp-sourcing.ts`.
