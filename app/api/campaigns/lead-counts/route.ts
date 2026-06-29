import { NextResponse } from "next/server"
import { fetchCampaignLeadCount } from "@/lib/lemlist"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const nc      = searchParams.get("nc")
    const cu      = searchParams.get("cu")
    const inbound = searchParams.get("inbound")

    if (!nc || !cu || !inbound) {
      return NextResponse.json({ error: "nc, cu, and inbound campaign IDs are required" }, { status: 400 })
    }

    // Sequential to respect Lemlist 10 req/s limit
    const ncTotal      = await fetchCampaignLeadCount(nc)
    const cuTotal      = await fetchCampaignLeadCount(cu)
    const inboundTotal = await fetchCampaignLeadCount(inbound)

    return NextResponse.json({ nc: ncTotal, cu: cuTotal, inbound: inboundTotal })
  } catch (err) {
    console.error("[campaigns/lead-counts]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
