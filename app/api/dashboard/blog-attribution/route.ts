import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"

const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

export const dynamic = "force-dynamic"

async function batchGetContactFirstUrl(
  contactIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < contactIds.length; i += 100) {
    const chunk = contactIds.slice(i, i + 100)
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: chunk.map((id) => ({ id })),
        properties: ["hs_analytics_first_url", "hs_analytics_last_url"],
      }),
      cache: "no-store",
    })
    if (!res.ok) {
      console.warn(`[blog-attribution] contact batch failed: ${res.status}`)
      continue
    }
    const data = await res.json()
    for (const c of data.results ?? []) {
      const firstUrl = c.properties?.hs_analytics_first_url ?? ""
      const lastUrl = c.properties?.hs_analytics_last_url ?? ""
      map.set(c.id, JSON.stringify({ firstUrl, lastUrl }))
    }
  }
  return map
}

async function batchGetDealContacts(
  dealIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  for (let i = 0; i < dealIds.length; i += 100) {
    const chunk = dealIds.slice(i, i + 100)
    const res = await fetch("https://api.hubapi.com/crm/v3/associations/deals/contacts/batch/read", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
      cache: "no-store",
    })
    if (!res.ok) {
      console.warn(`[blog-attribution] deal→contact batch failed: ${res.status}`)
      continue
    }
    const data = await res.json()
    for (const item of data.results ?? []) {
      map.set(item.from.id, (item.to ?? []).map((t: { id: string }) => t.id))
    }
  }
  return map
}

export async function GET() {
  try {
    const yearStart = `${new Date().getUTCFullYear()}-01-01`
    const today = new Date().toISOString().split("T")[0]

    // Get all deals created this year
    const deals = await searchDeals(
      [
        { propertyName: "createdate", operator: "GTE", value: yearStart },
        { propertyName: "createdate", operator: "LTE", value: today },
      ],
      ["dealname", "createdate", "pipeline", "dealstage", "normalised_dau__us_dau__tier_1__065"]
    )

    // Get associated contacts for all deals
    const dealContactMap = await batchGetDealContacts(deals.map((d) => d.id))

    // Get all unique contact IDs
    const allContactIds = Array.from(new Set(
      Array.from(dealContactMap.values()).flat()
    ))

    // Batch fetch contact first URLs
    const contactUrls = await batchGetContactFirstUrl(allContactIds)

    // Classify deals
    let blogFirstTouch = 0
    let blogLastTouch = 0
    let blogAnyTouch = 0
    const blogDeals: Array<{ id: string; name: string; createDate: string; touchType: string }> = []

    for (const deal of deals) {
      const contactIds = dealContactMap.get(deal.id) ?? []
      let isFirstTouch = false
      let isLastTouch = false

      for (const cid of contactIds) {
        const raw = contactUrls.get(cid)
        if (!raw) continue
        const { firstUrl, lastUrl } = JSON.parse(raw)
        if (firstUrl && firstUrl.toLowerCase().includes("blog")) isFirstTouch = true
        if (lastUrl && lastUrl.toLowerCase().includes("blog")) isLastTouch = true
      }

      if (isFirstTouch || isLastTouch) {
        blogAnyTouch++
        if (isFirstTouch) blogFirstTouch++
        if (isLastTouch) blogLastTouch++

        blogDeals.push({
          id: deal.id,
          name: deal.properties.dealname ?? "Untitled",
          createDate: (deal.properties.createdate ?? "").split("T")[0],
          touchType: isFirstTouch && isLastTouch ? "first+last" : isFirstTouch ? "first" : "last",
        })
      }
    }

    // Monthly breakdown for first-touch
    const monthlyFirstTouch: Record<string, number> = {}
    for (const deal of deals) {
      const contactIds = dealContactMap.get(deal.id) ?? []
      let isBlog = false
      for (const cid of contactIds) {
        const raw = contactUrls.get(cid)
        if (!raw) continue
        const { firstUrl } = JSON.parse(raw)
        if (firstUrl && firstUrl.toLowerCase().includes("blog")) { isBlog = true; break }
      }
      if (isBlog) {
        const month = (deal.properties.createdate ?? "").slice(0, 7) // YYYY-MM
        monthlyFirstTouch[month] = (monthlyFirstTouch[month] ?? 0) + 1
      }
    }

    const monthlyData = Object.entries(monthlyFirstTouch)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count }))

    return NextResponse.json({
      totalDeals: deals.length,
      blogFirstTouch,
      blogLastTouch,
      blogAnyTouch,
      blogPct: deals.length > 0 ? Math.round((blogFirstTouch / deals.length) * 1000) / 10 : 0,
      monthlyData,
      blogDeals: blogDeals.sort((a, b) => b.createDate.localeCompare(a.createDate)).slice(0, 20),
    })
  } catch (e) {
    console.error("[blog-attribution]", e)
    return NextResponse.json({ error: "Failed to load blog attribution" }, { status: 500 })
  }
}
