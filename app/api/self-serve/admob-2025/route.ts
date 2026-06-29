import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"

const PIPELINE         = "52357803"
const NEW_REG_STAGE    = "107224653"
const ADMOB_GAM_STAGE  = "1275149844"
const HS_TOKEN         = process.env.HUBSPOT_ACCESS_TOKEN!

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
      // Deals that registered (entered New Registration) in 2025 and are currently in AdMob/GAM
      searchDeals(
        [
          { propertyName: "pipeline",                                  operator: "EQ",  value: PIPELINE },
          { propertyName: `hs_v2_date_entered_${NEW_REG_STAGE}`,       operator: "GTE", value: "2025-01-01" },
          { propertyName: `hs_v2_date_entered_${NEW_REG_STAGE}`,       operator: "LT",  value: "2026-01-01" },
          { propertyName: "dealstage",                                 operator: "EQ",  value: ADMOB_GAM_STAGE },
        ],
        ["dealname", "normalised_dau__us_dau__tier_1__065", `hs_v2_date_entered_${NEW_REG_STAGE}`]
      ),
      getPortalId(),
    ])

    const result = deals
      .map((deal) => ({
        id:          deal.id,
        name:        deal.properties.dealname ?? `Deal ${deal.id}`,
        normDau:     Math.round(parseFloat(deal.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0),
        signupDate:  (deal.properties[`hs_v2_date_entered_${NEW_REG_STAGE}`] ?? "").slice(0, 10),
        url:         `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}`,
      }))
      .sort((a, b) => b.normDau - a.normDau)

    return NextResponse.json(result)
  } catch (e) {
    console.error("[admob-2025]", e)
    return NextResponse.json({ error: "Failed to load AdMob 2025 data" }, { status: 500 })
  }
}
