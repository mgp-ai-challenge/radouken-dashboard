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

function quarterBounds() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const q = Math.floor(now.getUTCMonth() / 3) + 1 // 1–4
  const pad = (n: number) => String(n).padStart(2, "0")

  const curMonthStart = (q - 1) * 3 + 1
  const curStart = `${year}-${pad(curMonthStart)}-01`

  const prevQ = q === 1 ? 4 : q - 1
  const prevYear = q === 1 ? year - 1 : year
  const prevMonthStart = (prevQ - 1) * 3 + 1
  const prevStart = `${prevYear}-${pad(prevMonthStart)}-01`
  const prevEnd = curStart // exclusive

  return {
    currentQuarter: `Q${q} ${year}`,
    prevQuarter:    `Q${prevQ} ${prevYear}`,
    curStart,
    prevStart,
    prevEnd,
  }
}

export async function GET() {
  try {
    const { currentQuarter, prevQuarter, curStart, prevStart, prevEnd } = quarterBounds()
    const thisMonday = currentWeekMonday()
    const lastMonday = mondayWeeksAgo(1)
    const thisMondayStr = thisMonday.toISOString().split("T")[0]
    const lastMondayStr = lastMonday.toISOString().split("T")[0]

    const NEW_REG_STAGE = "107224653"

    // Current quarter: deals that entered New Registration this quarter and are now Approved or Live
    // Uses hs_v2_date_entered on New Registration — matches the pipeline stage breakdown tab logic
    const [qtdDeals, curAll, prevDeals, prevAll] = await Promise.all([
      searchDeals(
        [
          { propertyName: "pipeline",                                operator: "EQ",  value: PIPELINE },
          { propertyName: "dealstage",                               operator: "IN",  values: ACTIVE_STAGES },
          { propertyName: `hs_v2_date_entered_${NEW_REG_STAGE}`,    operator: "GTE", value: curStart },
        ],
        ["normalised_dau__us_dau__tier_1__065", "hs_v2_date_entered_107224655"]
      ),
      searchDeals(
        [
          { propertyName: "pipeline",                                operator: "EQ",  value: PIPELINE },
          { propertyName: `hs_v2_date_entered_${NEW_REG_STAGE}`,    operator: "GTE", value: curStart },
        ],
        ["createdate"]
      ),
      // Previous quarter: same logic
      searchDeals(
        [
          { propertyName: "pipeline",                                operator: "EQ",  value: PIPELINE },
          { propertyName: "dealstage",                               operator: "IN",  values: ACTIVE_STAGES },
          { propertyName: `hs_v2_date_entered_${NEW_REG_STAGE}`,    operator: "GTE", value: prevStart },
          { propertyName: `hs_v2_date_entered_${NEW_REG_STAGE}`,    operator: "LT",  value: prevEnd },
        ],
        ["normalised_dau__us_dau__tier_1__065"]
      ),
      searchDeals(
        [
          { propertyName: "pipeline",                                operator: "EQ",  value: PIPELINE },
          { propertyName: `hs_v2_date_entered_${NEW_REG_STAGE}`,    operator: "GTE", value: prevStart },
          { propertyName: `hs_v2_date_entered_${NEW_REG_STAGE}`,    operator: "LT",  value: prevEnd },
        ],
        ["createdate"]
      ),
    ])

    const prevQNormDau = prevDeals.reduce(
      (sum, d) => sum + (parseFloat(d.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0),
      0
    )

    const qtdNormDau = qtdDeals.reduce(
      (sum, d) => sum + (parseFloat(d.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0),
      0
    )

    // Week-on-week: all currently active deals approved this/last week — not scoped to quarter cohort
    const weeklyDeals = await searchDeals(
      [
        { propertyName: "pipeline",                    operator: "EQ",  value: PIPELINE },
        { propertyName: "dealstage",                   operator: "IN",  values: ACTIVE_STAGES },
        { propertyName: "hs_v2_date_entered_107224655", operator: "GTE", value: lastMondayStr },
      ],
      ["normalised_dau__us_dau__tier_1__065", "hs_v2_date_entered_107224655"]
    )

    let thisWeekNormDau = 0, prevWeekNormDau = 0
    for (const deal of weeklyDeals) {
      const dau = parseFloat(deal.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0
      const approvedAt = deal.properties.hs_v2_date_entered_107224655 ?? ""
      if (approvedAt >= thisMondayStr) thisWeekNormDau += dau
      else prevWeekNormDau += dau
    }

    const [apacNormDau, prevQApacNormDau] = await Promise.all([
      getApacDau(qtdDeals),
      getApacDau(prevDeals),
    ])

    return NextResponse.json({
      currentQuarter,
      prevQuarter,
      qtdNormDau:       Math.round(qtdNormDau),
      prevQNormDau:     Math.round(prevQNormDau),
      thisWeekNormDau:  Math.round(thisWeekNormDau),
      prevWeekNormDau:  Math.round(prevWeekNormDau),
      currentQSubmissions: curAll.length,
      prevQSubmissions:    prevAll.length,
      apacNormDau,
      prevQApacNormDau,
    })
  } catch (e) {
    console.error("[kpis]", e)
    return NextResponse.json({ error: "Failed to load KPIs" }, { status: 500 })
  }
}
