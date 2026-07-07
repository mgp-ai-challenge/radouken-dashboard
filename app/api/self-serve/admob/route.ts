import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function quarterOf(monthIndex: number) {
  return `Q${Math.floor(monthIndex / 3) + 1}`
}

function buildMonths() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth()
  const pad = (n: number) => String(n).padStart(2, "0")
  const months = []
  for (let m = 0; m <= currentMonth; m++) {
    months.push({ key: `${year}-${pad(m + 1)}`, label: MONTH_LABELS[m], quarter: quarterOf(m) })
  }
  const nextMonth = currentMonth + 2 > 12 ? 1 : currentMonth + 2
  const nextYear = currentMonth + 2 > 12 ? year + 1 : year
  return { months, year, endDate: `${nextYear}-${pad(nextMonth)}-01` }
}

export async function GET() {
  try {
    const { months, year, endDate } = buildMonths()

    const deals = await searchDeals(
      [
        { propertyName: "pipeline",      operator: "EQ",  value: PIPELINE },
        { propertyName: "bm__mediation", operator: "EQ",  value: "admob" },
        { propertyName: "createdate",    operator: "GTE", value: `${year}-01-01` },
        { propertyName: "createdate",    operator: "LT",  value: endDate },
      ],
      ["createdate"]
    )

    const counts: Record<string, number> = {}
    for (const { key } of months) counts[key] = 0

    for (const deal of deals) {
      const month = (deal.properties.createdate ?? "").slice(0, 7)
      if (counts[month] !== undefined) counts[month]++
    }

    const result = months.map(({ key, label, quarter }) => ({
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
