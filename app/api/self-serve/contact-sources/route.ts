import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"
const SALES_PIPELINES = ["961280", "145970019"] // Supply Sales & AM, UA Sales & AM
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

// Fetch all "requests Bidmachine" deals from the sales pipelines.
// These include both deals created directly in sales and transferred sign-up deals that kept their name.
async function fetchSalesBidmachineDeals(): Promise<Deal[]> {
  const deals: Deal[] = []
  let after: string | undefined
  do {
    const body: Record<string, unknown> = {
      filterGroups: [{
        filters: [
          { propertyName: "pipeline", operator: "IN", values: SALES_PIPELINES },
          { propertyName: "dealname", operator: "CONTAINS_TOKEN", value: "Bidmachine" },
        ],
      }],
      properties: ["dealname", "createdate", "normalised_dau__us_dau__tier_1__065", "bm_dau_usa_publishers"],
      limit: 100,
    }
    if (after) body.after = after
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
    if (!res.ok) break
    const data = await res.json()
    for (const d of data.results ?? []) {
      deals.push({
        id: d.id,
        properties: {
          dealname:                              d.properties.dealname ?? null,
          createdate:                            d.properties.createdate ?? null,
          normalised_dau__us_dau__tier_1__065:   d.properties.normalised_dau__us_dau__tier_1__065 ?? null,
          bm_dau_usa_publishers:                 d.properties.bm_dau_usa_publishers ?? null,
          bm__account_approval:                  null,
        },
      })
    }
    after = data.paging?.next?.after
  } while (after)
  return deals
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
    // Use sign-up normDau, or bm_dau_usa_publishers fallback (populated on sales pipeline deals)
    const dau =
      parseFloat(deal.properties.normalised_dau__us_dau__tier_1__065 ?? "0") ||
      parseFloat(deal.properties.bm_dau_usa_publishers ?? "0") ||
      0
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

    // Fetch sign-up pipeline deals per quarter AND all "requests Bidmachine" sales deals in parallel
    const [allQuarterDeals, salesDeals] = await Promise.all([
      Promise.all(
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
      ),
      fetchSalesBidmachineDeals(),
    ])

    // Bucket sales deals by quarter using their createdate (same ranges as sign-up pipeline)
    const salesByQuarter = quarters.map(({ start, end }) =>
      salesDeals.filter((d) => {
        const cd = d.properties.createdate ?? ""
        return cd >= start && cd < end
      })
    )

    // Merge sign-up + sales deals per quarter and for YTD
    const mergedByQuarter = allQuarterDeals.map((qDeals, i) => [...qDeals, ...salesByQuarter[i]])
    const ytdDeals = [...allQuarterDeals.flat(), ...salesDeals]

    if (ytdDeals.length === 0) return NextResponse.json({})

    // Fetch contact associations for all merged deals
    const [allContactMaps, ytdContactMap] = await Promise.all([
      Promise.all(mergedByQuarter.map(getDealContactMap)),
      getDealContactMap(ytdDeals),
    ])

    // One batch fetch of all contact sources
    const allContactIds = Array.from(new Set(Array.from(ytdContactMap.values()).flat()))
    const contactSource = await getContactSources(allContactIds)

    // Per-quarter raw aggregations for QoQ reference
    const perQuarterAgg = mergedByQuarter.map((deals, i) =>
      aggregateBySource(deals, allContactMaps[i], contactSource)
    )

    const result: Record<string, SourceRow[]> = {}
    for (let i = 0; i < quarters.length; i++) {
      result[quarters[i].label] = buildRows(
        mergedByQuarter[i],
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
