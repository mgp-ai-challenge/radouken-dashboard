import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!
const Q1_START = "2026-01-01"
const Q2_START = "2026-04-01"

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

export async function GET() {
  try {
    const [q2Deals, q1Deals] = await Promise.all([
      searchDeals(
        [
          { propertyName: "pipeline",   operator: "EQ",  value: PIPELINE },
          { propertyName: "createdate", operator: "GTE", value: Q2_START },
        ],
        ["normalised_dau__us_dau__tier_1__065"]
      ),
      searchDeals(
        [
          { propertyName: "pipeline",   operator: "EQ",  value: PIPELINE },
          { propertyName: "createdate", operator: "GTE", value: Q1_START },
          { propertyName: "createdate", operator: "LT",  value: Q2_START },
        ],
        ["normalised_dau__us_dau__tier_1__065"]
      ),
    ])

    if (q2Deals.length === 0) return NextResponse.json([])

    // Fetch contact associations for both quarters in parallel
    const [q2ContactMap, q1ContactMap] = await Promise.all([
      getDealContactMap(q2Deals),
      getDealContactMap(q1Deals),
    ])

    // Collect all unique contact IDs across both quarters
    const allContactIds = Array.from(new Set([
      ...Array.from(q2ContactMap.values()).flat(),
      ...Array.from(q1ContactMap.values()).flat(),
    ]))

    const contactSource = await getContactSources(allContactIds)

    const q2Agg = aggregateBySource(q2Deals, q2ContactMap, contactSource)
    const q1Agg = aggregateBySource(q1Deals, q1ContactMap, contactSource)

    const totalQ2 = q2Deals.length

    // Build result using Q2 sources, add QoQ comparison
    const result = Object.entries(q2Agg)
      .map(([key, { count, normDau }]) => {
        const label = SOURCE_LABELS[key] ?? (key === "UNKNOWN" ? "Unknown" : key)
        const q1NormDau = q1Agg[key]?.normDau ?? 0
        const qoqPct = q1NormDau > 0
          ? Math.round(((normDau - q1NormDau) / q1NormDau) * 100)
          : null
        return {
          source:     label,
          count,
          pct:        Math.round((count / totalQ2) * 100),
          normDau:    Math.round(normDau),
          q1NormDau:  Math.round(q1NormDau),
          qoqPct,
        }
      })
      .sort((a, b) => b.normDau - a.normDau)

    return NextResponse.json(result)
  } catch (e) {
    console.error("[contact-sources]", e)
    return NextResponse.json({ error: "Failed to load contact sources" }, { status: 500 })
  }
}
