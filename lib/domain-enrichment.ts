// lib/domain-enrichment.ts
// Server-side SensorTower domain enrichment for publisher CSV lists.
// Used by app/api/domain-enrichment/route.ts

const ST_BASE = "https://api.sensortower.com"
const REQUEST_DELAY_MS = 250
const MAX_RETRIES = 4
const INITIAL_BACKOFF_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function stFetch(path: string): Promise<unknown> {
  const token = process.env.SENSORTOWER_API_TOKEN
  if (!token) throw new Error("SENSORTOWER_API_TOKEN not set")
  const sep = path.includes("?") ? "&" : "?"
  const url = `${ST_BASE}${path}${sep}auth_token=${token}`

  let backoff = INITIAL_BACKOFF_MS
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, { cache: "no-store" })
    if (res.ok) return res.json()
    if (res.status === 429) {
      await sleep(backoff)
      backoff = Math.min(backoff * 2, 60_000)
      continue
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`SensorTower auth error ${res.status} — check SENSORTOWER_API_TOKEN`)
    }
    const body = await res.text().catch(() => "")
    throw new Error(`SensorTower ${path} → ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`)
  }
  throw new Error(`SensorTower rate limit: failed after ${MAX_RETRIES} retries on ${path}`)
}

// ── Name helpers ──────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

const LEGAL_PAT = /\b(inc|corp|ltd|llc|co|gmbh|ag|sa|plc|group|holdings?|international|technologies?|software|solutions|services|systems|digital|global|worldwide|studios?|games|entertainment|mobile|interactive)\.?\b/gi

function cleanName(name: string): string {
  return name.replace(LEGAL_PAT, "").replace(/\s+/g, " ").trim()
}

function namesMatch(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b)
  return na.length > 2 && nb.length > 2 && (na.includes(nb) || nb.includes(na))
}

// ── Domain extraction ─────────────────────────────────────────────────────────

// For code-hosting sites the username/org is the meaningful identifier,
// not just the root domain — return "github.com/outfit7" not "github.com"
const PATH_PRESERVING_HOSTS = new Set([
  "github.com", "gitlab.com", "bitbucket.org", "sourceforge.net",
])

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const withScheme = url.includes("://") ? url : `https://${url}`
    const { hostname, pathname } = new URL(withScheme)
    const host = hostname.toLowerCase().replace(/^www\./, "")

    if (PATH_PRESERVING_HOSTS.has(host)) {
      const firstSegment = pathname.split("/").filter(Boolean)[0]
      return firstSegment ? `${host}/${firstSegment}` : host
    }

    const parts = host.split(".")
    // Country SLDs: co.uk, com.au, net.au …
    const COUNTRY_SLDS = new Set(["co", "com", "net", "org", "gov", "edu", "ac"])
    if (parts.length >= 3 && COUNTRY_SLDS.has(parts[parts.length - 2])) {
      return parts.slice(-3).join(".")
    }
    return parts.length >= 2 ? parts.slice(-2).join(".") : host || null
  } catch {
    return null
  }
}

// ── SensorTower calls ─────────────────────────────────────────────────────────

interface STPublisher {
  publisher_id: string | number
  publisher_name: string
  publisher_country: string | null
}

async function searchPublishers(name: string, store: "ios" | "android"): Promise<STPublisher[]> {
  const cleaned = cleanName(name)
  const firstWord = cleaned.split(/\s+/)[0] ?? name
  const seenIds = new Set<string>()
  const matches: STPublisher[] = []

  for (const term of [...new Set([name, cleaned, firstWord])]) {
    if (!term) continue
    try {
      await sleep(REQUEST_DELAY_MS)
      const results = (await stFetch(
        `/v1/${store}/search_entities?term=${encodeURIComponent(term)}&entity_type=publisher`
      )) as STPublisher[]
      if (!Array.isArray(results)) continue
      for (const pub of results) {
        const pid = String(pub.publisher_id)
        if (pid && !seenIds.has(pid) && namesMatch(name, pub.publisher_name)) {
          seenIds.add(pid)
          matches.push(pub)
        }
      }
    } catch (e) {
      console.warn(`[domain-enrichment] search_entities('${term}', ${store}):`, e)
    }
  }
  return matches
}

async function getDomainForPublisher(
  publisherId: string | number,
  store: "ios" | "android",
): Promise<string | null> {
  try {
    await sleep(REQUEST_DELAY_MS)
    const resp = (await stFetch(
      `/v1/${store}/publishers/${publisherId}/apps?limit=1&sort_by=downloads`
    )) as { data?: Array<{ app_id: string | number }> }
    const appId = resp.data?.[0]?.app_id
    if (!appId) return null

    await sleep(REQUEST_DELAY_MS)
    const detail = (await stFetch(
      `/v1/${store}/apps?app_ids=${encodeURIComponent(String(appId))}`
    )) as { apps?: Array<{ website_url?: string | null }> }
    return extractDomain(detail.apps?.[0]?.website_url)
  } catch (e) {
    console.warn(`[domain-enrichment] getDomain(${publisherId}, ${store}):`, e)
    return null
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface EnrichmentResult {
  domain: string | null
  domain2: string | null   // second candidate domain for Ambiguous rows
  confidence: "High" | "Ambiguous" | "No match"
  candidates: string
}

export async function resolvePublisherDomain(
  name: string,
  location: string,
): Promise<EnrichmentResult> {
  const [iosMatches, androidMatches] = await Promise.all([
    searchPublishers(name, "ios"),
    searchPublishers(name, "android"),
  ])

  // Merge stores, deduplicate by normalised publisher name, prefer iOS for domain lookup
  const merged = new Map<string, { pub: STPublisher; store: "ios" | "android" }>()
  for (const pub of iosMatches) merged.set(norm(pub.publisher_name), { pub, store: "ios" })
  for (const pub of androidMatches) {
    const k = norm(pub.publisher_name)
    if (!merged.has(k)) merged.set(k, { pub, store: "android" })
  }
  const unique = [...merged.values()]

  if (unique.length === 0) {
    return { domain: null, domain2: null, confidence: "No match", candidates: "" }
  }

  if (unique.length === 1) {
    const { pub, store } = unique[0]
    const pubCountry = (pub.publisher_country ?? "").trim()
    // Soft location check: mismatch → Ambiguous so user can verify
    if (location && pubCountry && !namesMatch(location, pubCountry)) {
      const domain = await getDomainForPublisher(pub.publisher_id, store)
      return {
        domain,
        domain2: null,
        confidence: "Ambiguous",
        candidates: `${pub.publisher_name} (${pubCountry}) → ${domain ?? "no domain"} [location mismatch: expected ${location}]`,
      }
    }
    const domain = await getDomainForPublisher(pub.publisher_id, store)
    if (domain) return { domain, domain2: null, confidence: "High", candidates: "" }
    return {
      domain: null,
      domain2: null,
      confidence: "Ambiguous",
      candidates: `${pub.publisher_name} (${pubCountry || "?"}) → no domain found`,
    }
  }

  // Multiple distinct publishers — try to narrow by location
  if (location) {
    const byLocation = unique.filter(({ pub }) =>
      namesMatch(location, pub.publisher_country ?? "")
    )
    if (byLocation.length === 1) {
      const { pub, store } = byLocation[0]
      const domain = await getDomainForPublisher(pub.publisher_id, store)
      if (domain) return { domain, domain2: null, confidence: "High", candidates: "" }
    }
  }

  // Still ambiguous — collect all candidates with their domains
  const resolved = await Promise.all(
    unique.map(async ({ pub, store }) => {
      const domain = await getDomainForPublisher(pub.publisher_id, store)
      return { name: pub.publisher_name, country: pub.publisher_country ?? "?", domain }
    })
  )
  const candidateStr = resolved
    .map((r) => `${r.name} (${r.country}) → ${r.domain ?? "no domain"}`)
    .join(" | ")
  return {
    domain:  resolved[0]?.domain ?? null,
    domain2: resolved[1]?.domain ?? null,
    confidence: "Ambiguous",
    candidates: candidateStr,
  }
}

// ── CSV parser (used by the API route) ───────────────────────────────────────

export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  // Normalise line endings, strip BOM
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\uFEFF/, "")
  const lines = raw.split("\n").filter((l) => l.trim() !== "")

  function parseLine(line: string): string[] {
    const fields: string[] = []
    let i = 0
    while (i <= line.length) {
      if (i === line.length) { fields.push(""); break }
      if (line[i] === '"') {
        let val = ""
        i++ // skip opening quote
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2 }
          else if (line[i] === '"') { i++; break }
          else { val += line[i++] }
        }
        fields.push(val)
        if (line[i] === ",") i++
        else break
      } else {
        const end = line.indexOf(",", i)
        if (end === -1) { fields.push(line.slice(i)); break }
        fields.push(line.slice(i, end))
        i = end + 1
      }
    }
    return fields
  }

  const headers = parseLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const values = parseLine(line)
    return Object.fromEntries(headers.map((h, idx) => [h, values[idx] ?? ""]))
  })
  return { headers, rows }
}
