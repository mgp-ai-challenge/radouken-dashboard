import { NextResponse } from "next/server"
import { searchDeals, currentWeekMonday, mondayWeeksAgo } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"
// Approved + Live both count toward normalised DAU (confirmed with HubSpot)
const ACTIVE_STAGES = ["107224655", "107224657"]
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

// APAC countries matching HubSpot's ip_country filter exactly (as shown in HubSpot UI).
// HubSpot filter uses "vietnam" / "hongkong" (no spaces) which don't match older contacts
// stored as "viet nam" / "hong kong" — matching HubSpot's 7,984 figure intentionally.
const APAC_COUNTRIES = new Set([
  "china", "japan", "south korea", "korea", "taiwan", "hongkong", "singapore",
  "malaysia", "thailand", "indonesia", "philippines", "vietnam", "australia",
  "new zealand", "india", "pakistan", "bangladesh", "sri lanka", "nepal",
  "myanmar", "cambodia", "laos", "brunei",
])

async function getApacDau(
  deals: Array<{ id: string; properties: Record<string, string | null> }>
): Promise<number> {
  if (deals.length === 0) return 0

  // Batch fetch deal → contact associations
  const dealContactMap = new Map<string, string[]>()
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
      dealContactMap.set(item.from.id, (item.to ?? []).map((t: { id: string }) => t.id))
    }
  }

  const contactIds = Array.from(new Set(Array.from(dealContactMap.values()).flat()))
  if (contactIds.length === 0) return 0

  // Batch fetch contact ip_country
  const contactCountry = new Map<string, string>()
  for (let i = 0; i < contactIds.length; i += 100) {
    const chunk = contactIds.slice(i, i + 100)
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })), properties: ["ip_country"] }),
      cache: "no-store",
    })
    if (!res.ok) continue
    const data = await res.json()
    for (const c of data.results ?? []) {
      contactCountry.set(c.id, (c.properties?.ip_country ?? "").toLowerCase())
    }
  }

  // Sum DAU for deals where associated contact's ip_country is APAC
  let apacDau = 0
  for (const deal of deals) {
    const cids = dealContactMap.get(deal.id) ?? []
    const isApac = cids.some((cid) => APAC_COUNTRIES.has(contactCountry.get(cid) ?? ""))
    if (isApac) {
      apacDau += parseFloat(deal.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0
    }
  }
  return Math.round(apacDau)
}

export async function GET() {
  try {
    const q2Start = "2026-04-01"
    const thisMonday = currentWeekMonday()
    const lastMonday = mondayWeeksAgo(1)
    const thisMondayStr = thisMonday.toISOString().split("T")[0]
    const lastMondayStr = lastMonday.toISOString().split("T")[0]

    // Fetch Q2 Approved+Live deals — single search, derive all week/APAC values from it
    const qtdDeals = await searchDeals(
      [
        { propertyName: "pipeline", operator: "EQ", value: PIPELINE },
        { propertyName: "dealstage", operator: "IN", values: ACTIVE_STAGES },
        { propertyName: "createdate", operator: "GTE", value: q2Start },
      ],
      ["normalised_dau__us_dau__tier_1__065", "createdate", "hs_v2_date_entered_107224655"]
    )

    // All Q2 deals for submission count
    const q2All = await searchDeals(
      [
        { propertyName: "pipeline", operator: "EQ", value: PIPELINE },
        { propertyName: "createdate", operator: "GTE", value: q2Start },
      ],
      ["createdate"]
    )

    // Q1 Approved+Live deals for DAU comparison + all Q1 deals for submission count
    const [q1Deals, q1All] = await Promise.all([
      searchDeals(
        [
          { propertyName: "pipeline", operator: "EQ", value: PIPELINE },
          { propertyName: "dealstage", operator: "IN", values: ACTIVE_STAGES },
          { propertyName: "createdate", operator: "GTE", value: "2026-01-01" },
          { propertyName: "createdate", operator: "LT",  value: q2Start },
        ],
        ["normalised_dau__us_dau__tier_1__065"]
      ),
      searchDeals(
        [
          { propertyName: "pipeline", operator: "EQ", value: PIPELINE },
          { propertyName: "createdate", operator: "GTE", value: "2026-01-01" },
          { propertyName: "createdate", operator: "LT",  value: q2Start },
        ],
        ["createdate"]
      ),
    ])

    const q1NormDau = q1Deals.reduce(
      (sum, d) => sum + (parseFloat(d.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0),
      0
    )

    let qtdNormDau = 0, thisWeekNormDau = 0, prevWeekNormDau = 0
    for (const deal of qtdDeals) {
      const dau = parseFloat(deal.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0
      const approvedAt = deal.properties.hs_v2_date_entered_107224655 ?? ""
      qtdNormDau += dau
      if (approvedAt >= thisMondayStr) thisWeekNormDau += dau
      else if (approvedAt >= lastMondayStr) prevWeekNormDau += dau
    }

    // APAC: look up via contact ip_country matching APAC region (Q2 + Q1)
    const [apacNormDau, q1ApacNormDau] = await Promise.all([
      getApacDau(qtdDeals),
      getApacDau(q1Deals),
    ])

    return NextResponse.json({
      qtdNormDau: Math.round(qtdNormDau),
      q1NormDau: Math.round(q1NormDau),
      thisWeekNormDau: Math.round(thisWeekNormDau),
      prevWeekNormDau: Math.round(prevWeekNormDau),
      q2Submissions: q2All.length,
      q1Submissions: q1All.length,
      apacNormDau,
      q1ApacNormDau,
    })
  } catch (e) {
    console.error("[kpis]", e)
    return NextResponse.json({ error: "Failed to load KPIs" }, { status: 500 })
  }
}
