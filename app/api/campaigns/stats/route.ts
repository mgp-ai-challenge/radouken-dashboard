import { NextResponse } from "next/server"
import {
  TARGET_CAMPAIGNS,
  fetchAllCampaigns,
  fetchCampaignStats,
  type DiscoveredCampaign,
} from "@/lib/lemlist"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const allCampaigns = await fetchAllCampaigns()

    // Match each target by substring
    const discovered = TARGET_CAMPAIGNS.map((target) => {
      const found = allCampaigns.find((c) => c.name.includes(target.match))
      return {
        key:   target.key,
        id:    found?._id ?? null,
        label: target.label,
        color: target.color,
      }
    })

    // Fetch stats for all found campaigns in parallel
    const withStats: DiscoveredCampaign[] = await Promise.all(
      discovered.map(async (c) => {
        if (!c.id) {
          return { ...c, stats: null, error: `Campaign not found by name — check Lemlist (match: "${TARGET_CAMPAIGNS.find(t => t.key === c.key)?.match}")` }
        }
        try {
          const stats = await fetchCampaignStats(c.id)
          return { ...c, stats, error: null }
        } catch (err) {
          return { ...c, stats: null, error: String(err) }
        }
      })
    )

    return NextResponse.json({ campaigns: withStats })
  } catch (err) {
    console.error("[campaigns/stats]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
