// lib/sensortower.ts

const ST_BASE = "https://api.sensortower.com"

const _cache = new Map<string, { ts: number; data: AppEnrichment }>()
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

export interface AppEnrichment {
  companyId: string
  hasApp: boolean
  platform: "ios" | "android" | "both" | null
  appName: string | null
  monthlyDownloads: string | null  // pre-formatted e.g. "50M", "1.2M iOS + 800k Android"
  storeUrl: string | null          // iOS preferred when both exist
}

interface STPublisher {
  publisher_id: string | number
  publisher_name: string
  os: string
}

interface STDownloads {
  string: string
  downloads?: number
  prefix?: string
  units?: string
}

interface STApp {
  app_id: string | number
  name: string
  humanized_worldwide_last_30_days_downloads: STDownloads | string | null
}

function extractDownloads(d: STApp["humanized_worldwide_last_30_days_downloads"]): string | null {
  if (!d) return null
  if (typeof d === "string") return d || null
  return (d as STDownloads).string || null
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
    const err = new Error(`SensorTower ${path} → ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return res.json()
}

// Normalise to bare alphanumeric so "T-Mobile USA Inc." ≈ "tmobileusa"
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

// True if either name is a substring of the other after normalising
function namesMatch(company: string, publisher: string): boolean {
  const a = norm(company), b = norm(publisher)
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))
}

// Strip common legal/generic suffixes so "Webzen Inc" → "Webzen"
function cleanName(name: string): string {
  return name
    .replace(/\b(inc|corp|ltd|llc|co|gmbh|ag|sa|plc|group|holdings?|international|technologies?|software|solutions|services|systems|digital|global|worldwide)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim()
}

async function searchPublisher(name: string, store: "ios" | "android"): Promise<STPublisher | null> {
  // Build a list of distinct search terms to try in order
  const cleaned = cleanName(name)
  const firstWord = cleaned.split(/\s+/)[0]
  const variants = [...new Set([name, cleaned, firstWord].filter(Boolean))]

  for (const term of variants) {
    const data = await stFetch(
      `/v1/${store}/search_entities?term=${encodeURIComponent(term)}&entity_type=publisher`
    ) as STPublisher[]
    if (!Array.isArray(data)) continue
    // Prefer a publisher whose name actually resembles the company
    const match = data.find((p) => namesMatch(name, p.publisher_name))
    if (match) return match
  }
  return null
}

async function getTopApp(publisherId: string | number, store: "ios" | "android"): Promise<STApp | null> {
  const data = await stFetch(
    `/v1/${store}/publishers/${publisherId}/apps?limit=1&sort_by=downloads`
  ) as { data: STApp[] }
  return data.data?.[0] ?? null
}

function buildStoreUrl(appId: string | number, store: "ios" | "android"): string {
  return store === "ios"
    ? `https://apps.apple.com/app/id${appId}`
    : `https://play.google.com/store/apps/details?id=${appId}`
}

export async function enrichCompany(companyId: string, name: string): Promise<AppEnrichment> {
  const cacheKey = name.toLowerCase().trim()
  const cached = _cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return { ...cached.data, companyId }

  const empty: AppEnrichment = {
    companyId, hasApp: false, platform: null,
    appName: null, monthlyDownloads: null, storeUrl: null,
  }

  let result: AppEnrichment
  try {
    const [iosPubResult, androidPubResult] = await Promise.allSettled([
      searchPublisher(name, "ios"),
      searchPublisher(name, "android"),
    ])
    const iosPub     = iosPubResult.status    === "fulfilled" ? iosPubResult.value    : null
    const androidPub = androidPubResult.status === "fulfilled" ? androidPubResult.value : null

    if (!iosPub && !androidPub) {
      result = empty
    } else {
      const [iosAppResult, androidAppResult] = await Promise.allSettled([
        iosPub     ? getTopApp(iosPub.publisher_id,     "ios")     : Promise.resolve(null),
        androidPub ? getTopApp(androidPub.publisher_id, "android") : Promise.resolve(null),
      ])
      const ios     = iosAppResult.status    === "fulfilled" ? iosAppResult.value    : null
      const android = androidAppResult.status === "fulfilled" ? androidAppResult.value : null

      if (!ios && !android) {
        result = empty
      } else if (ios && android) {
        const iosDl = extractDownloads(ios.humanized_worldwide_last_30_days_downloads)
        const andDl = extractDownloads(android.humanized_worldwide_last_30_days_downloads)
        const parts = [iosDl ? `${iosDl} iOS` : null, andDl ? `${andDl} Android` : null].filter(Boolean)
        result = {
          companyId, hasApp: true, platform: "both",
          appName: ios.name,
          monthlyDownloads: parts.length > 0 ? parts.join(" + ") : null,
          storeUrl: buildStoreUrl(ios.app_id, "ios"),
        }
      } else if (ios) {
        result = {
          companyId, hasApp: true, platform: "ios",
          appName: ios.name,
          monthlyDownloads: extractDownloads(ios.humanized_worldwide_last_30_days_downloads),
          storeUrl: buildStoreUrl(ios.app_id, "ios"),
        }
      } else {
        result = {
          companyId, hasApp: true, platform: "android",
          appName: android!.name,
          monthlyDownloads: extractDownloads(android!.humanized_worldwide_last_30_days_downloads),
          storeUrl: buildStoreUrl(android!.app_id, "android"),
        }
      }
    }
  } catch (err) {
    console.error(`[sensortower] enrichCompany failed for "${name}":`, err)
    result = empty
  }

  _cache.set(cacheKey, { ts: Date.now(), data: result })
  return result
}

// ─── ICP Sourcing helpers ─────────────────────────────────────────────────────

// Re-declared here to avoid a circular import (icp-sourcing.ts imports from this file).
type MMPDetected = "appsflyer" | "adjust" | "both" | "none" | "unknown"

export interface STAppSummary {
  appId: string
  appName: string
  publisherName: string
  publisherDomain: string | null  // from website_url field (may be null)
  store: "ios" | "android"
  storeUrl: string
}

interface STRankingApp {
  app_id: string | number
  name: string
  publisher_name: string
}

export async function searchAppsByCategory(
  category: string,
  store: "ios" | "android",
): Promise<STAppSummary[]> {
  const today = new Date().toISOString().slice(0, 10)
  const deviceParam = store === "ios" ? "&device=iphone" : "&device="
  const path = `/v1/${store}/category_rankings?category=${encodeURIComponent(category)}&country=US&date=${today}${deviceParam}&limit=250`

  const data = await stFetch(path) as { data: { free: STRankingApp[]; paid: STRankingApp[] } }

  const free: STRankingApp[] = data.data?.free ?? []
  const paid: STRankingApp[] = data.data?.paid ?? []

  // Combine and deduplicate by app_id
  const seen = new Set<string>()
  const results: STAppSummary[] = []
  for (const app of [...free, ...paid]) {
    const id = String(app.app_id)
    if (seen.has(id)) continue
    seen.add(id)
    results.push({
      appId: id,
      appName: app.name,
      publisherName: app.publisher_name,
      publisherDomain: null,
      store,
      storeUrl: buildStoreUrl(app.app_id, store),
    })
  }
  return results
}

export async function checkSDKDetection(
  _appId: string,
  _store: "ios" | "android",
): Promise<MMPDetected> {
  // SDK detection returns 404 on this account plan — always return "unknown".
  return "unknown"
}

export async function getAppDAU(
  appId: string,
  store: "ios" | "android",
): Promise<number | null> {
  if (store === "android") return null
  try {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const thirtyDaysAgo = new Date(today)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const startStr = thirtyDaysAgo.toISOString().slice(0, 10)

    const data = await stFetch(
      `/v1/ios/usage/active_users?app_ids=${encodeURIComponent(appId)}&start_date=${startStr}&end_date=${todayStr}&country=US`
    ) as Array<{ date: string; iphone_users: number; ipad_users: number }>

    if (!Array.isArray(data) || data.length === 0) return null
    const total = data.reduce((sum, row) => sum + (row.iphone_users ?? 0) + (row.ipad_users ?? 0), 0)
    return total / data.length
  } catch {
    return null
  }
}

export async function getAppRevenue(
  appId: string,
  store: "ios" | "android",
): Promise<{ monthlyDownloads: number | null }> {
  try {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const thirtyDaysAgo = new Date(today)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const startStr = thirtyDaysAgo.toISOString().slice(0, 10)

    const data = await stFetch(
      `/v1/${store}/sales_report_estimates?app_ids=${encodeURIComponent(appId)}&start_date=${startStr}&end_date=${todayStr}&countries=US`
    ) as Array<{ cc: string; iu?: number; au?: number }>

    if (!Array.isArray(data) || data.length === 0) return { monthlyDownloads: null }
    const usEntries = data.filter((row) => row.cc === "US")
    if (usEntries.length === 0) return { monthlyDownloads: null }
    const total = usEntries.reduce((sum, row) => sum + (row.iu ?? 0) + (row.au ?? 0), 0)
    return { monthlyDownloads: total }
  } catch {
    return { monthlyDownloads: null }
  }
}
