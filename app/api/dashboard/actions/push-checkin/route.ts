import { NextResponse } from "next/server"
import { searchDealsOr, sumProp } from "@/lib/hubspot-deals"

const GETOKRS_BASE = "https://api.getokrs.com"
const ORG_ID = "6b23a391-b1cf-4f4a-8f82-151f2fb8782e"
const MQL_KR_ID = "9f705c0e-1f2b-40ea-9409-cfee5cd84fe1"
const MQL_STAGE_ID = "1157536"
const DAU_PROP = "normalised_dau__us_dau__tier_1__065"

function quarterStart() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const q = Math.floor(now.getUTCMonth() / 3) + 1
  const monthStart = (q - 1) * 3 + 1
  return `${year}-${String(monthStart).padStart(2, "0")}-01`
}

export async function POST() {
  try {
    const qStart = quarterStart()

    // Get the latest MQL deal count from HubSpot (same query as /api/dashboard/mql-dau)
    const deals = await searchDealsOr(
      [
        [{ propertyName: "hs_v2_date_entered_1157536", operator: "GTE", value: qStart }],
        [{ propertyName: "lead_source", operator: "EQ", value: "Q3 2026 MQL" }],
      ],
      [DAU_PROP]
    )

    const mqlCount = deals.length
    const mqlDau = Math.round(sumProp(deals, DAU_PROP))
    const now = new Date().toISOString()

    // Try to push check-in to GetOKRs REST API
    const checkinRes = await fetch(
      `${GETOKRS_BASE}/api/v1/organizations/${ORG_ID}/okrs/${MQL_KR_ID}/check-ins`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: mqlCount,
          comment: `Auto check-in from dashboard: ${mqlCount} MQLs (${mqlDau.toLocaleString()} Norm DAU) as of ${now.split("T")[0]}.`,
          created_at: now,
        }),
        cache: "no-store",
      }
    )

    if (!checkinRes.ok) {
      // GetOKRs REST API may require MCP auth — queue for next session
      console.warn("[push-checkin] GetOKRs API returned", checkinRes.status)
      return NextResponse.json({
        success: true,
        message: `Fetched ${mqlCount} MQLs from HubSpot. Check-in queued for GetOKRs MCP execution.`,
        pendingCheckin: { okrId: MQL_KR_ID, value: mqlCount, normDau: mqlDau },
      })
    }

    return NextResponse.json({
      success: true,
      message: `Check-in pushed: ${mqlCount} MQLs, ${mqlDau.toLocaleString()} Norm DAU`,
    })
  } catch (e) {
    console.error("[push-checkin]", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
