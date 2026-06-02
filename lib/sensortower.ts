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
  publisher_id: string | number
  publisher_name: string
  os: string
}

interface STApp {
  app_id: string | number
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
  } catch (err) {
    console.error(`[sensortower] enrichCompany failed for "${name}":`, err)
    return empty
  }
}
