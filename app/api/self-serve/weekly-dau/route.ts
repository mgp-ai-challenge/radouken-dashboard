import { NextResponse } from "next/server"
import { searchDeals, sumProp, isoWeek, mondayWeeksAgo, currentWeekMonday } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"
const ACTIVE_STAGES = ["107224655", "107224657"] // Approved + Live
const WEEKS = 8

const APPROVED_STAGE = "107224655"
const APPROVED_ENTERED = `hs_v2_date_entered_${APPROVED_STAGE}`

export async function GET() {
  try {
    const eightWeeksAgo = mondayWeeksAgo(WEEKS - 1).toISOString().split("T")[0]

    // Filter by when the deal entered Approved in the last 8 weeks — not createdate,
    // and no current-stage filter so deals that later moved to Live/Promoted/etc. are included.
    const deals = await searchDeals(
      [
        { propertyName: "pipeline",       operator: "EQ",  value: PIPELINE },
        { propertyName: APPROVED_ENTERED, operator: "GTE", value: eightWeeksAgo },
      ],
      [APPROVED_ENTERED, "normalised_dau__us_dau__tier_1__065"]
    )

    // Build week buckets: last 8 ISO weeks
    const currentWeek = isoWeek(new Date())
    const buckets: Map<string, number> = new Map()

    for (let i = WEEKS - 1; i >= 0; i--) {
      const d = mondayWeeksAgo(i)
      const wk = isoWeek(d)
      buckets.set(`W${wk}`, 0)
    }

    for (const deal of deals) {
      const d = new Date(deal.properties[APPROVED_ENTERED] ?? "")
      if (isNaN(d.getTime())) continue
      const wk = `W${isoWeek(d)}`
      if (buckets.has(wk)) {
        buckets.set(wk, (buckets.get(wk) ?? 0) + (parseFloat(deal.properties.normalised_dau__us_dau__tier_1__065 ?? "0") || 0))
      }
    }

    const result = Array.from(buckets.entries()).map(([week, normDau]) => ({
      week,
      normDau: Math.round(normDau),
      isCurrent: week === `W${currentWeek}`,
    }))

    return NextResponse.json(result)
  } catch (e) {
    console.error("[weekly-dau]", e)
    return NextResponse.json({ error: "Failed to load weekly DAU" }, { status: 500 })
  }
}
