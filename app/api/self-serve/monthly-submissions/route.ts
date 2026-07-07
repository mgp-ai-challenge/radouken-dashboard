import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"
const ACTIVE_STAGES = new Set(["107224655", "107224657"]) // Approved + Live

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function buildMonths() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() // 0-indexed
  const pad = (n: number) => String(n).padStart(2, "0")
  const months = []
  for (let m = 0; m <= currentMonth; m++) {
    months.push({ key: `${year}-${pad(m + 1)}`, label: MONTH_LABELS[m], isCurrent: m === currentMonth })
  }
  // First day of the month after the current one (exclusive upper bound)
  const nextMonth = currentMonth + 2 > 12 ? 1 : currentMonth + 2
  const nextYear = currentMonth + 2 > 12 ? year + 1 : year
  const endDate = `${nextYear}-${pad(nextMonth)}-01`
  return { months, year, endDate }
}

export async function GET() {
  try {
    const { months, year, endDate } = buildMonths()

    const deals = await searchDeals(
      [
        { propertyName: "pipeline", operator: "EQ", value: PIPELINE },
        { propertyName: "createdate", operator: "GTE", value: `${year}-01-01` },
        { propertyName: "createdate", operator: "LT",  value: endDate },
      ],
      ["createdate", "dealstage"]
    )

    const counts: Record<string, { submissions: number; approved: number }> = {}
    for (const { key } of months) counts[key] = { submissions: 0, approved: 0 }

    for (const deal of deals) {
      const month = (deal.properties.createdate ?? "").slice(0, 7)
      if (counts[month]) {
        counts[month].submissions++
        if (ACTIVE_STAGES.has(deal.properties.dealstage ?? "")) counts[month].approved++
      }
    }

    const result = months.map(({ key, label, isCurrent }) => ({
      month: label,
      submissions: counts[key].submissions,
      approved: counts[key].approved,
      approvalRate: counts[key].submissions > 0
        ? Math.round((counts[key].approved / counts[key].submissions) * 100)
        : 0,
      isPartial: isCurrent,
    }))

    return NextResponse.json(result)
  } catch (e) {
    console.error("[monthly-submissions]", e)
    return NextResponse.json({ error: "Failed to load monthly submissions" }, { status: 500 })
  }
}
