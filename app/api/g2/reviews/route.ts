// app/api/g2/reviews/route.ts
import { NextResponse } from "next/server"
import { getG2Product, getG2Reviews } from "@/lib/g2"
import type { DimensionTrend, G2Review } from "@/lib/g2"

export const dynamic = "force-dynamic"

const DIMENSIONS: Array<{ dimension: string; key: keyof G2Review }> = [
  { dimension: "Ease of Use",             key: "easeOfUse" },
  { dimension: "Quality of Support",      key: "qualityOfSupport" },
  { dimension: "Ease of Setup",           key: "easeOfSetup" },
  { dimension: "Meets Requirements",      key: "meetsRequirements" },
  { dimension: "Likelihood to Recommend", key: "likelihoodToRecommend" },
  { dimension: "Ease of Doing Business",  key: "easeOfDoingBusiness" },
]

function windowAvg(reviews: G2Review[], key: keyof G2Review): number {
  const values = reviews
    .map((r) => r[key] as number | null)
    .filter((v): v is number => typeof v === "number")
  if (values.length < 3) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export async function GET() {
  try {
    const product = await getG2Product()
    const reviews = await getG2Reviews(product.id)

    const now = Date.now()
    const MS_90  = 90  * 24 * 60 * 60 * 1000
    const MS_180 = 180 * 24 * 60 * 60 * 1000

    const recentWindow   = reviews.filter((r) => now - new Date(r.createdAt).getTime() < MS_90)
    const previousWindow = reviews.filter((r) => {
      const age = now - new Date(r.createdAt).getTime()
      return age >= MS_90 && age < MS_180
    })

    const dimensionTrends: DimensionTrend[] = DIMENSIONS.map(({ dimension, key }) => {
      const current  = windowAvg(recentWindow,   key)
      const previous = windowAvg(previousWindow, key)
      const delta    = previous > 0
        ? Math.round(((current - previous) / previous) * 1000) / 10
        : 0
      const direction: DimensionTrend["direction"] =
        delta > 1 ? "up" : delta < -1 ? "down" : "flat"
      return { dimension, key: key as string, current, previous, delta, direction }
    })

    return NextResponse.json({
      product: { starRating: product.starRating, reviewsCount: product.reviewsCount },
      reviews,
      dimensionTrends,
    })
  } catch (e) {
    console.error("[g2/reviews]", e)
    return NextResponse.json({ error: "Failed to load G2 reviews" }, { status: 500 })
  }
}
