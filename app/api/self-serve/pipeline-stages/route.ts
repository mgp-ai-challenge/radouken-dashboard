import { NextResponse } from "next/server"
import { searchDeals, HSDeal } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

// Stage that HubSpot's "Date entered New Registration = Q1" filter is applied to
const NEW_REG_STAGE = "107224653"

const STAGE_MAP: Record<string, string> = {
  "107224653":  "New Registration",
  "107224654":  "Under Review",
  "1347884654": "Pending Verification",
  "114401160":  "Denied",
  "1275149844": "AdMob / GAM",
  "107224655":  "Approved",
  "107224657":  "Live",
  "1319309459": "Paused",
  "107224658":  "Promoted",
  "1062161234": "For Remarketing",
  "1079394475": "Closed / Trash",
}

const STAGE_ORDER = [
  "107224655", "107224657", "1347884654", "1275149844",
  "107224654", "107224653", "1319309459", "107224658",
  "114401160", "1062161234", "1079394475",
]

const Q1_START = "2026-01-01"
const Q1_END   = "2026-04-01" // exclusive
const Q2_START = "2026-04-01"

const DEAL_PROPS = ["dealstage", "dealname", "normalised_dau__us_dau__tier_1__065"]

async function getPortalId(): Promise<string> {
  const res = await fetch("https://api.hubapi.com/account-info/v3/details", {
    headers: { Authorization: `Bearer ${HS_TOKEN}` },
    cache: "no-store",
  })
  if (!res.ok) return "0"
  const data = await res.json()
  return String(data.portalId ?? "0")
}

function groupByStage(deals: HSDeal[], portalId: string) {
  const grouped: Record<string, {
    normDau: number
    deals: Array<{ id: string; name: string; normDau: number; url: string }>
  }> = {}

  for (const deal of deals) {
    const stage = deal.properties.dealstage ?? "unknown"
    if (!grouped[stage]) grouped[stage] = { normDau: 0, deals: [] }
    const normDau = parseFloat(deal.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0
    grouped[stage].normDau += normDau
    grouped[stage].deals.push({
      id:      deal.id,
      name:    deal.properties.dealname ?? `Deal ${deal.id}`,
      normDau: Math.round(normDau),
      url:     `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}`,
    })
  }

  for (const stage of Object.values(grouped)) {
    stage.deals.sort((a, b) => b.normDau - a.normDau)
  }

  return grouped
}

export async function GET() {
  try {
    const [q2Deals, q1Deals, portalId] = await Promise.all([
      // Q2: deals created on or after Q2 start
      searchDeals(
        [
          { propertyName: "pipeline",   operator: "EQ",  value: PIPELINE },
          { propertyName: "createdate", operator: "GTE", value: Q2_START },
        ],
        DEAL_PROPS
      ),
      // Q1: deals that entered New Registration in Q1 — matches HubSpot's
      // "Date entered New Registration = last quarter" filter.
      // Grouped by current stage so the breakdown mirrors the HubSpot pipeline view.
      searchDeals(
        [
          { propertyName: "pipeline",                                operator: "EQ",  value: PIPELINE },
          { propertyName: `hs_v2_date_entered_${NEW_REG_STAGE}`,    operator: "GTE", value: Q1_START },
          { propertyName: `hs_v2_date_entered_${NEW_REG_STAGE}`,    operator: "LT",  value: Q1_END },
        ],
        DEAL_PROPS
      ),
      getPortalId(),
    ])

    const grouped   = groupByStage(q2Deals, portalId)
    const groupedQ1 = groupByStage(q1Deals, portalId)

    const result = STAGE_ORDER.map((stageId) => ({
      stageId,
      name:      STAGE_MAP[stageId] ?? stageId,
      normDau:   Math.round(grouped[stageId]?.normDau ?? 0),
      normDauQ1: Math.round(groupedQ1[stageId]?.normDau ?? 0),
      count:     grouped[stageId]?.deals.length ?? 0,
      countQ1:   groupedQ1[stageId]?.deals.length ?? 0,
      deals:     grouped[stageId]?.deals ?? [],
      dealsQ1:   groupedQ1[stageId]?.deals ?? [],
    }))

    return NextResponse.json(result)
  } catch (e) {
    console.error("[pipeline-stages]", e)
    return NextResponse.json({ error: "Failed to load pipeline stages" }, { status: 500 })
  }
}
