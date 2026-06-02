// app/api/g2/campaigns/route.ts
import { NextResponse } from "next/server"
import { getG2Product, getG2Campaigns } from "@/lib/g2"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const product = await getG2Product()
    const campaigns = await getG2Campaigns(product.id)
    const sorted = [...campaigns].sort((a, b) => b.spend - a.spend)
    return NextResponse.json({ campaigns: sorted })
  } catch (e) {
    console.error("[g2/campaigns]", e)
    return NextResponse.json({ error: "Failed to load G2 campaigns" }, { status: 500 })
  }
}
