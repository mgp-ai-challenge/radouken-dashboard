const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

export type HSDeal = {
  id: string
  properties: Record<string, string | null>
}

type Filter = {
  propertyName: string
  operator: string
  value?: string
  values?: string[]
}

// Simple server-side cache shared across route handlers
const _cache = new Map<string, { ts: number; data: HSDeal[] }>()
const CACHE_TTL = 55_000

function cacheKey(filters: Filter[], properties: string[]): string {
  return JSON.stringify({ filters, properties })
}

async function fetchPage(body: Record<string, unknown>): Promise<{ results: HSDeal[]; after?: string }> {
  // Retry up to 3 times on 429 with exponential backoff
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    if (res.status === 429) {
      const wait = (parseInt(res.headers.get("Retry-After") ?? "1") + attempt) * 1000
      await new Promise((r) => setTimeout(r, wait))
      continue
    }

    if (!res.ok) throw new Error(`HubSpot search failed: ${res.status}`)
    const data = await res.json()
    return { results: data.results ?? [], after: data.paging?.next?.after }
  }
  throw new Error("HubSpot search failed after retries")
}

export async function searchDeals(filters: Filter[], properties: string[]): Promise<HSDeal[]> {
  const key = cacheKey(filters, properties)
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  const results: HSDeal[] = []
  let after: string | undefined

  do {
    const body: Record<string, unknown> = { filterGroups: [{ filters }], properties, limit: 200 }
    if (after) body.after = after
    const page = await fetchPage(body)
    results.push(...page.results)
    after = page.after
  } while (after)

  _cache.set(key, { ts: Date.now(), data: results })
  return results
}

/** Like searchDeals but accepts multiple filter groups (OR logic between groups, AND within each group) */
export async function searchDealsOr(filterGroups: Filter[][], properties: string[]): Promise<HSDeal[]> {
  const key = JSON.stringify({ filterGroups, properties })
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  const results: HSDeal[] = []
  let after: string | undefined

  do {
    const body: Record<string, unknown> = {
      filterGroups: filterGroups.map((filters) => ({ filters })),
      properties,
      limit: 200,
    }
    if (after) body.after = after
    const page = await fetchPage(body)
    results.push(...page.results)
    after = page.after
  } while (after)

  _cache.set(key, { ts: Date.now(), data: results })
  return results
}

export function sumProp(deals: HSDeal[], prop: string): number {
  return deals.reduce((sum, d) => sum + (parseFloat(d.properties[prop] ?? "0") || 0), 0)
}

/** ISO week number (1-53) for a date */
export function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

/** Monday of current ISO week (UTC midnight) */
export function currentWeekMonday(): Date {
  const now = new Date()
  const day = now.getUTCDay() || 7
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)))
  return monday
}

/** Monday N weeks ago */
export function mondayWeeksAgo(n: number): Date {
  const monday = currentWeekMonday()
  monday.setUTCDate(monday.getUTCDate() - n * 7)
  return monday
}
