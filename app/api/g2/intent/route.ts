// app/api/g2/intent/route.ts
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

interface HsCompany {
  id: string
  properties: Record<string, string | null>
}

async function searchIntentCompanies(days: number): Promise<HsCompany[]> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN environment variable is not set")

  const afterMs = Date.now() - days * 24 * 60 * 60 * 1000

  // Filter companies that have G2 intent data and were modified in the last 30 days
  const body = {
    filterGroups: [
      {
        filters: [
          { propertyName: "g2_buyer_intent_activity_level", operator: "HAS_PROPERTY" },
          { propertyName: "hs_lastmodifieddate", operator: "GTE", value: afterMs },
        ],
      },
    ],
    properties: ["name", "domain", "g2_intent_score", "g2_buyer_intent_activity_level", "g2_buyer_intent_buying_stage", "g2_buyer_intent_details", "hs_lastmodifieddate", "lifecyclestage"],
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
    limit: 50,
  }

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })

  if (!res.ok) {
    // 400 = property doesn't exist yet (G2 integration not active)
    if (res.status === 400) return []
    throw new Error(`HubSpot company search → ${res.status}`)
  }

  const data = await res.json()
  return data.results ?? []
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const days = Math.min(Math.max(Number(searchParams.get("days") ?? 30), 1), 90)
    const companies = await searchIntentCompanies(days)

    const now = new Date()
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const thisWeekStart = new Date(now)
    thisWeekStart.setDate(now.getDate() - now.getDay()) // Sunday
    thisWeekStart.setHours(0, 0, 0, 0)

    let totalThisMonth = 0
    let totalThisWeek = 0

    const result = companies.map((c) => {
      const lastSignalAt = c.properties.hs_lastmodifieddate ?? ""
      const signalDate = lastSignalAt ? new Date(lastSignalAt) : null
      if (signalDate) {
        if (signalDate >= thisMonthStart) totalThisMonth++
        if (signalDate >= thisWeekStart) totalThisWeek++
      }
      return {
        id: c.id,
        name: c.properties.name ?? "",
        domain: c.properties.domain ?? "",
        intentScore: c.properties.g2_intent_score
          ? Number(c.properties.g2_intent_score)
          : null,
        activityLevel: c.properties.g2_buyer_intent_activity_level ?? null,
        buyingStage: c.properties.g2_buyer_intent_buying_stage ?? null,
        intentDetails: c.properties.g2_buyer_intent_details ?? null,
        lastSignalAt,
        lifecycleStage: c.properties.lifecyclestage ?? null,
      }
    })

    const hubspotPortalId = "5606823"
    return NextResponse.json({ companies: result, totalThisMonth, totalThisWeek, hubspotPortalId })
  } catch (e) {
    console.error("[g2/intent]", e)
    return NextResponse.json({ error: "Failed to load G2 intent" }, { status: 500 })
  }
}
