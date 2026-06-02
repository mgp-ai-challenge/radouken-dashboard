// app/api/g2/reviews/route.ts
import { NextResponse } from "next/server"
import { getG2Product, getG2Reviews } from "@/lib/g2"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const product = await getG2Product()
    const reviews = await getG2Reviews(product.id)
    return NextResponse.json({
      product: { starRating: product.starRating, reviewsCount: product.reviewsCount },
      reviews,
    })
  } catch (e) {
    console.error("[g2/reviews]", e)
    return NextResponse.json({ error: "Failed to load G2 reviews" }, { status: 500 })
  }
}
