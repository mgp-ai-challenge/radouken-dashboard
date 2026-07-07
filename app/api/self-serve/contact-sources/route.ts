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

// For deals transferred to sales, the sign-up deal has null normDau.
// We look up their contacts' deals in the sales pipelines and read DAU from there.
async function enrichTransferredDau(
  transferredDeals: Deal[],
  contactMap: Map<string, string[]>
): Promise<Map<string, number>> {
  const enriched = new Map<string, number>() // signupDealId -> DAU
  if (transferredDeals.length === 0) return enriched

  // Collect all contact IDs from transferred deals
  const contactIds = Array.from(
    new Set(transferredDeals.flatMap((d) => contactMap.get(d.id) ?? []))
  )
  if (contactIds.length === 0) return enriched

  // Find all deals those contacts have in the sales pipelines
  const contactDealMap = new Map<string, string[]>() // contactId -> salesDealIds
  for (let i = 0; i < contactIds.length; i += 100) {
    const chunk = contactIds.slice(i, i + 100)
    const res = await fetch("https://api.hubapi.com/crm/v3/associations/contacts/deals/batch/read", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
      cache: "no-store",
    })
    if (!res.ok) continue
    const data = await res.json()
    for (const item of data.results ?? []) {
      contactDealMap.set(item.from.id, (item.to ?? []).map((t: { id: string }) => t.id))
    }
  }

  const allSalesDealIds = Array.from(new Set(Array.from(contactDealMap.values()).flat()))
  if (allSalesDealIds.length === 0) return enriched

  // Fetch those deals and filter to sales pipelines
  const salesDauMap = new Map<string, number>() // salesDealId -> DAU
  for (let i = 0; i < allSalesDealIds.length; i += 100) {
    const chunk = allSalesDealIds.slice(i, i + 100)
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/batch/read", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: chunk.map((id) => ({ id })),
        properties: ["pipeline", "normalised_dau__us_dau__tier_1__065", "bm_dau_usa_publishers"],
      }),
      cache: "no-store",
    })
    if (!res.ok) continue
    const data = await res.json()
    for (const deal of data.results ?? []) {
      if (!SALES_PIPELINES.includes(deal.properties?.pipeline ?? "")) continue
      const dau =
        parseFloat(deal.properties.normalised_dau__us_dau__tier_1__065 ?? "0") ||
        parseFloat(deal.properties.bm_dau_usa_publishers ?? "0") ||
        0
      salesDauMap.set(deal.id, dau)
    }
  }

  // Map back: for each transferred sign-up deal, sum DAU of its contacts' sales deals
  for (const deal of transferredDeals) {
    const cids = contactMap.get(deal.id) ?? []
    let totalDau = 0
    for (const cid of cids) {
      const salesDealIds = contactDealMap.get(cid) ?? []
      for (const sdId of salesDealIds) {
        totalDau += salesDauMap.get(sdId) ?? 0
      }
    }
    if (totalDau > 0) enriched.set(deal.id, totalDau)
  }

  return enriched
}

function aggregateBySource(
  deals: Deal[],
  dealContactMap: Map<string, string[]>,
  contactSource: Map<string, string>,
  transferredDau?: Map<string, number>
): Record<string, { count: number; normDau: number }> {
  const agg: Record<string, { count: number; normDau: number }> = {}
  for (const deal of deals) {
    const cids = dealContactMap.get(deal.id) ?? []
    const src = cids.length > 0 ? (contactSource.get(cids[0]) ?? "UNKNOWN") : "UNKNOWN"
    // Use enriched sales DAU for transferred deals; fall back to sign-up deal's normDau
    const dau = transferredDau?.get(deal.id)
      ?? (parseFloat(deal.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0)
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
  prevAgg?: Record<string, { count: number; normDau: number }>,
  transferredDau?: Map<string, number>
): SourceRow[] {
  const agg = aggregateBySource(deals, contactMap, contactSource, transferredDau)
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

    // Fetch all sign-up deals per quarter — no stage filter so Promoted, Paused, transferred deals all included
    const allQuarterDeals = await Promise.all(
      quarters.map(({ start, end }) =>
        searchDeals(
          [
            { propertyName: "pipeline",   operator: "EQ",  value: PIPELINE },
            { propertyName: "createdate", operator: "GTE", value: start },
            { propertyName: "createdate", operator: "LT",  value: end },
          ],
          ["normalised_dau__us_dau__tier_1__065", "bm__account_approval"]
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

    // Enrich transferred deals: their normDau is null in the sign-up pipeline,
    // so we look up DAU from their corresponding deals in the sales pipelines.
    const transferredApprovals = new Set(["Transfer to Sales", "Transfer to AM"])
    const allTransferred = ytdDeals.filter(
      (d) => transferredApprovals.has(d.properties.bm__account_approval ?? "")
    )
    const ytdTransferredDau = await enrichTransferredDau(allTransferred, ytdContactMap)

    // Build per-quarter transferred DAU maps (subset of ytd map)
    const quarterTransferredDauMaps = allQuarterDeals.map((deals) => {
      const map = new Map<string, number>()
      for (const d of deals) {
        const v = ytdTransferredDau.get(d.id)
        if (v !== undefined) map.set(d.id, v)
      }
      return map
    })

    // Per-quarter raw aggregations for QoQ reference
    const perQuarterAgg = allQuarterDeals.map((deals, i) =>
      aggregateBySource(deals, allContactMaps[i], contactSource, quarterTransferredDauMaps[i])
    )

    const result: Record<string, SourceRow[]> = {}
    for (let i = 0; i < quarters.length; i++) {
      result[quarters[i].label] = buildRows(
        allQuarterDeals[i],
        allContactMaps[i],
        contactSource,
        i > 0 ? perQuarterAgg[i - 1] : undefined,
        quarterTransferredDauMaps[i]
      )
    }
    result.ytd = buildRows(ytdDeals, ytdContactMap, contactSource, undefined, ytdTransferredDau)

    return NextResponse.json(result)
  } catch (e) {
    console.error("[contact-sources]", e)
    return NextResponse.json({ error: "Failed to load contact sources" }, { status: 500 })
  }
}
