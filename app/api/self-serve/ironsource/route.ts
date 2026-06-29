import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

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

async function getPortalId(): Promise<string> {
  const res = await fetch("https://api.hubapi.com/account-info/v3/details", {
    headers: { Authorization: `Bearer ${HS_TOKEN}` },
    cache: "no-store",
  })
  if (!res.ok) return "0"
  const data = await res.json()
  return String(data.portalId ?? "0")
}

export async function GET() {
  try {
    const [deals, portalId] = await Promise.all([
      searchDeals(
        [
          { propertyName: "pipeline",     operator: "EQ", value: PIPELINE },
          { propertyName: "bm__mediation", operator: "EQ", value: "ironsource" },
        ],
        ["dealname", "dealstage", "normalised_dau__us_dau__tier_1__065", "createdate"]
      ),
      getPortalId(),
    ])

    const result = deals
      .map((deal) => ({
        id:         deal.id,
        name:       deal.properties.dealname ?? `Deal ${deal.id}`,
        normDau:    Math.round(parseFloat(deal.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0),
        stage:      STAGE_MAP[deal.properties.dealstage ?? ""] ?? deal.properties.dealstage ?? "Unknown",
        stageId:    deal.properties.dealstage ?? "",
        createDate: (deal.properties.createdate ?? "").slice(0, 10),
        url:        `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}`,
      }))
      .sort((a, b) => b.normDau - a.normDau)

    return NextResponse.json(result)
  } catch (e) {
    console.error("[ironsource]", e)
    return NextResponse.json({ error: "Failed to load IronSource data" }, { status: 500 })
  }
}
