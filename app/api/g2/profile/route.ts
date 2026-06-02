// app/api/g2/profile/route.ts
import { NextResponse } from "next/server"
import { getG2Product, getG2Rank, getG2ProfileViews } from "@/lib/g2"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const product = await getG2Product()
    const [rank, allViews] = await Promise.all([
      getG2Rank(product.id),
      getG2ProfileViews(product.id),
    ])

    // Sort oldest-first, take last 8 weeks
    const sorted = [...allViews].sort((a, b) => a.week.localeCompare(b.week))
    const weeklyViews = sorted.slice(-8)

    // Current month = this calendar month; last month = previous calendar month
    const now = new Date()
    const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`

    let totalViewsThisMonth = 0
    let totalViewsLastMonth = 0
    for (const v of allViews) {
      if (v.week.startsWith(thisMonthStr)) totalViewsThisMonth += v.views
      if (v.week.startsWith(lastMonthStr)) totalViewsLastMonth += v.views
    }

    return NextResponse.json({
      rank: rank ?? { category: "", rank: 0, rankChange: 0 },
      weeklyViews,
      totalViewsThisMonth,
      totalViewsLastMonth,
    })
  } catch (e) {
    console.error("[g2/profile]", e)
    return NextResponse.json({ error: "Failed to load G2 profile" }, { status: 500 })
  }
}
