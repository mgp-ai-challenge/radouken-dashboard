// app/api/g2/intent/route.ts
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

interface HsCompany {
  id: string
  properties: Record<string, string | null>
}

async function searchIntentCompanies(): Promise<HsCompany[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const afterMs = thirtyDaysAgo.getTime()

  // Search companies where g2_researched_date was updated in last 30 days
  // If g2_researched_date doesn't exist, fall back to hs_lastmodifieddate as proxy
  const body = {
    filterGroups: [
      {
        filters: [
          { propertyName: "g2_researched_date", operator: "GTE", value: String(afterMs) },
        ],
      },
    ],
    properties: ["name", "domain", "g2_buying_intent_score", "g2_researched_date"],
    sorts: [{ propertyName: "g2_researched_date", direction: "DESCENDING" }],
    limit: 50,
  }

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HS_TOKEN}`,
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

export async function GET() {
  try {
    const companies = await searchIntentCompanies()

    const now = new Date()
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const thisWeekStart = new Date(now)
    thisWeekStart.setDate(now.getDate() - now.getDay()) // Sunday
    thisWeekStart.setHours(0, 0, 0, 0)

    let totalThisMonth = 0
    let totalThisWeek = 0

    const result = companies.map((c) => {
      const lastSignalAt = c.properties.g2_researched_date ?? ""
      const signalDate = lastSignalAt ? new Date(lastSignalAt) : null
      if (signalDate) {
        if (signalDate >= thisMonthStart) totalThisMonth++
        if (signalDate >= thisWeekStart) totalThisWeek++
      }
      return {
        id: c.id,
        name: c.properties.name ?? "",
        domain: c.properties.domain ?? "",
        intentScore: c.properties.g2_buying_intent_score
          ? Number(c.properties.g2_buying_intent_score)
          : null,
        lastSignalAt,
      }
    })

    return NextResponse.json({ companies: result, totalThisMonth, totalThisWeek })
  } catch (e) {
    console.error("[g2/intent]", e)
    return NextResponse.json({ error: "Failed to load G2 intent" }, { status: 500 })
  }
}
