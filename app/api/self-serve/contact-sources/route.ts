import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

function buildQuarters() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const currentQ = Math.floor(now.getUTCMonth() / 3) + 1
  const pad = (n: number) => String(n).padStart(2, "0")
  const quarters = []
  for (let q = 1; q <= currentQ; q++) {
    const startMonth = (q - 1) * 3 + 1
    const endMonthRaw = q * 3 + 1
    const endYear  = endMonthRaw > 12 ? year + 1 : year
    const endMonth = endMonthRaw > 12 ? 1 : endMonthRaw
    quarters.push({ label: `Q${q}`, start: `${year}-${pad(startMonth)}-01`, end: `${endYear}-${pad(endMonth)}-01` })
  }
  return quarters
}

const SOURCE_LABELS: Record<string, string> = {
  ORGANIC_SEARCH:  "Organic Search",
  PAID_SEARCH:     "Paid Search",
  EMAIL_MARKETING: "Email",
  SOCIAL_MEDIA:    "Social Media",
  REFERRALS:       "Referral",
  OTHER_CAMPAIGNS: "Other Campaigns",
  DIRECT_TRAFFIC:  "Direct",
  OFFLINE:         "Manually Added",
  PAID_SOCIAL:     "Paid Social",
  ORGANIC_SOCIAL:  "Organic Social",
  UNKNOWN:         "Unknown",
}

type Deal = { id: string; properties: Record<string, string | null> }

async function getDealContactMap(deals: Deal[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  for (let i = 0; i < deals.length; i += 100) {
    const chunk = deals.slice(i, i + 100)
    const res = await fetch("https://api.hubapi.com/crm/v3/associations/deals/contacts/batch/read", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: chunk.map((d) => ({ id: d.id })) }),
      cache: "no-store",
    })
    if (!res.ok) continue
    const data = await res.json()
    for (const item of data.results ?? []) {
      map.set(item.from.id, (item.to ?? []).map((t: { id: string }) => t.id))
    }
  }
  return map
}

async function getContactSources(contactIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < contactIds.length; i += 100) {
    const chunk = contactIds.slice(i, i + 100)
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })), properties: ["hs_analytics_last_source", "hs_analytics_source"] }),
      cache: "no-store",
    })
    if (!res.ok) continue
    const data = await res.json()
    for (const c of data.results ?? []) {
      const src = c.properties?.hs_analytics_last_source
        || c.properties?.hs_analytics_source
        || "UNKNOWN"
      map.set(c.id, src)
    }
  }
  return map
}

function aggregateBySource(
  deals: Deal[],
  dealContactMap: Map<string, string[]>,
  contactSource: Map<string, string>
): Record<string, { count: number; normDau: number }> {
  const agg: Record<string, { count: number; normDau: number }> = {}
  for (const deal of deals) {
    const cids = dealContactMap.get(deal.id) ?? []
    const src = cids.length > 0 ? (contactSource.get(cids[0]) ?? "UNKNOWN") : "UNKNOWN"
    const dau = parseFloat(deal.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0
    if (!agg[src]) agg[src] = { count: 0, normDau: 0 }
    agg[src].count++
    agg[src].normDau += dau
  }
  return agg
}

type SourceRow = { source: string; count: number; pct: number; normDau: number; qoqPct: number | null }

function buildRows(
  deals: Deal[],
  contactMap: Map<string, string[]>,
  contactSource: Map<string, string>,
  prevAgg?: Record<string, { count: number; normDau: number }>
): SourceRow[] {
  const agg = aggregateBySource(deals, contactMap, contactSource)
  const total = deals.length || 1
  return Object.entries(agg)
    .map(([key, { count, normDau }]) => {
      const label = SOURCE_LABELS[key] ?? (key === "UNKNOWN" ? "Unknown" : key)
      const prevNormDau = prevAgg?.[key]?.normDau ?? 0
      const qoqPct = prevNormDau > 0
        ? Math.round(((normDau - prevNormDau) / prevNormDau) * 100)
        : null
      return { source: label, count, pct: Math.round((count / total) * 100), normDau: Math.round(normDau), qoqPct }
    })
    .sort((a, b) => b.normDau - a.normDau)
}

export async function GET() {
  try {
    const quarters = buildQuarters()

    // Fetch deals per quarter — no stage filter so all deals (Approved, Promoted, transferred to AMs, etc.) are included
    const allQuarterDeals = await Promise.all(
      quarters.map(({ start, end }) =>
        searchDeals(
          [
            { propertyName: "pipeline",   operator: "EQ",  value: PIPELINE },
            { propertyName: "createdate", operator: "GTE", value: start },
            { propertyName: "createdate", operator: "LT",  value: end },
          ],
          ["normalised_dau__us_dau__tier_1__065"]
        )
      )
    )

    const ytdDeals = allQuarterDeals.flat()
    if (ytdDeals.length === 0) return NextResponse.json({})

    // Fetch associations per quarter + ytd in parallel
    const [allContactMaps, ytdContactMap] = await Promise.all([
      Promise.all(allQuarterDeals.map(getDealContactMap)),
      getDealContactMap(ytdDeals),
    ])

    // One batch fetch of all contact sources
    const allContactIds = Array.from(new Set(Array.from(ytdContactMap.values()).flat()))
    const contactSource = await getContactSources(allContactIds)

    // Per-quarter raw aggregations (for QoQ reference between quarters)
    const perQuarterAgg = allQuarterDeals.map((deals, i) =>
      aggregateBySource(deals, allContactMaps[i], contactSource)
    )

    const result: Record<string, SourceRow[]> = {}
    for (let i = 0; i < quarters.length; i++) {
      result[quarters[i].label] = buildRows(
        allQuarterDeals[i],
        allContactMaps[i],
        contactSource,
        i > 0 ? perQuarterAgg[i - 1] : undefined
      )
    }
    result.ytd = buildRows(ytdDeals, ytdContactMap, contactSource)

    return NextResponse.json(result)
  } catch (e) {
    console.error("[contact-sources]", e)
    return NextResponse.json({ error: "Failed to load contact sources" }, { status: 500 })
  }
}
