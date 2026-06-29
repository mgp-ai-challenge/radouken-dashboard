import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"
const ACTIVE_STAGES = new Set(["107224655", "107224657"]) // Approved + Live

const MONTHS = [
  { key: "2026-01", label: "Jan" },
  { key: "2026-02", label: "Feb" },
  { key: "2026-03", label: "Mar" },
  { key: "2026-04", label: "Apr" },
  { key: "2026-05", label: "May" },
]

export async function GET() {
  try {
    const deals = await searchDeals(
      [
        { propertyName: "pipeline", operator: "EQ", value: PIPELINE },
        { propertyName: "createdate", operator: "GTE", value: "2026-01-01" },
        { propertyName: "createdate", operator: "LTE", value: "2026-05-31" },
      ],
      ["createdate", "dealstage"]
    )

    const counts: Record<string, { submissions: number; approved: number }> = {}
    for (const { key } of MONTHS) counts[key] = { submissions: 0, approved: 0 }

    for (const deal of deals) {
      const month = (deal.properties.createdate ?? "").slice(0, 7)
      if (counts[month]) {
        counts[month].submissions++
        if (ACTIVE_STAGES.has(deal.properties.dealstage ?? "")) counts[month].approved++
      }
    }

    const result = MONTHS.map(({ key, label }) => ({
      month: label,
      submissions: counts[key].submissions,
      approved: counts[key].approved,
      approvalRate: counts[key].submissions > 0
        ? Math.round((counts[key].approved / counts[key].submissions) * 100)
        : 0,
      isPartial: key === "2026-05",
    }))

    return NextResponse.json(result)
  } catch (e) {
    console.error("[monthly-submissions]", e)
    return NextResponse.json({ error: "Failed to load monthly submissions" }, { status: 500 })
  }
}
