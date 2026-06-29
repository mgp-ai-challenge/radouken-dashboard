import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"

const MONTHS = [
  { key: "2026-01", label: "Jan", quarter: "Q1" as const },
  { key: "2026-02", label: "Feb", quarter: "Q1" as const },
  { key: "2026-03", label: "Mar", quarter: "Q1" as const },
  { key: "2026-04", label: "Apr", quarter: "Q2" as const },
  { key: "2026-05", label: "May", quarter: "Q2" as const },
]

export async function GET() {
  try {
    const deals = await searchDeals(
      [
        { propertyName: "pipeline", operator: "EQ", value: PIPELINE },
        { propertyName: "bm__mediation", operator: "EQ", value: "admob" },
        { propertyName: "createdate", operator: "GTE", value: "2026-01-01" },
        { propertyName: "createdate", operator: "LTE", value: "2026-05-31" },
      ],
      ["createdate"]
    )

    const counts: Record<string, number> = {}
    for (const { key } of MONTHS) counts[key] = 0

    for (const deal of deals) {
      const month = (deal.properties.createdate ?? "").slice(0, 7)
      if (counts[month] !== undefined) counts[month]++
    }

    const result = MONTHS.map(({ key, label, quarter }) => ({
      month: label,
      count: counts[key],
      quarter,
    }))

    return NextResponse.json(result)
  } catch (e) {
    console.error("[admob]", e)
    return NextResponse.json({ error: "Failed to load AdMob data" }, { status: 500 })
  }
}
