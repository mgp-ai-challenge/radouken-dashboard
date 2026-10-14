import { NextResponse } from "next/server"
import { searchDealsOr, sumProp } from "@/lib/hubspot-deals"

// Indirect pipeline: Bidmachine SDK DAU (Indirect)
const INDIRECT_PIPELINE = "961280"
// MQL stage in Supply Sales & AM pipeline
const MQL_STAGE_ID = "1157536"
const DAU_PROP = "normalised_dau__us_dau__tier_1__065"

function quarterInfo() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const q = Math.floor(now.getUTCMonth() / 3) + 1
  const monthStart = (q - 1) * 3 + 1
  return {
    start: `${year}-${String(monthStart).padStart(2, "0")}-01`,
    label: `Q${q} ${year} MQL`,
  }
}

export async function GET() {
  try {
    const { start: qStart, label: qLabel } = quarterInfo()

    // OR logic: matches the HubSpot report filters
    // Group 1: Date entered MQL this quarter
    // Group 2: Lead source = current quarter MQL label
    const deals = await searchDealsOr(
      [
        [
          { propertyName: "hs_v2_date_entered_1157536", operator: "GTE", value: qStart },
        ],
        [
          { propertyName: "lead_source", operator: "EQ", value: qLabel },
        ],
      ],
      [DAU_PROP]
    )

    const totalNormDau = Math.round(sumProp(deals, DAU_PROP))

    return NextResponse.json({
      mqlNormDau: totalNormDau,
      dealCount: deals.length,
    })
  } catch (e) {
    console.error("[mql-dau]", e)
    return NextResponse.json({ error: "Failed to load MQL DAU" }, { status: 500 })
  }
}
