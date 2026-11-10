import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"
import {
  SELF_SERVE_PIPELINE_ID,
  APPROVED_STAGE_ID,
  APPROVED_ENTERED_PROP,
  computeCohort,
  type SelfServeDeal,
} from "@/lib/self-serve-gp"

function quarterBounds() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const q = Math.floor(now.getUTCMonth() / 3) + 1
  const pad = (n: number) => String(n).padStart(2, "0")
  const startMonth = (q - 1) * 3 + 1
  const start = `${year}-${pad(startMonth)}-01`
  const endMonth = q * 3 + 1
  const endYear = endMonth > 12 ? year + 1 : year
  const endM = endMonth > 12 ? 1 : endMonth
  const endExclusive = `${endYear}-${pad(endM)}-01`
  return { quarter: `Q${q} ${year}`, start, endExclusive }
}

const DEAL_PROPS = [
  "dealname",
  "normalised_dau__us_dau__tier_1__065",
  "bm_dau_usa_publishers",
  "dau_tier_1",
  "publisher_app_category",
  "gaming_or_non_gaming",
  "bm__app_store_company_name",
  APPROVED_ENTERED_PROP,
]

export async function GET() {
  try {
    const { quarter, start, endExclusive } = quarterBounds()

    // Fetch all deals in the self-serve pipeline that entered Approved in this quarter
    const deals = await searchDeals(
      [
        { propertyName: "pipeline", operator: "EQ", value: SELF_SERVE_PIPELINE_ID },
        { propertyName: APPROVED_ENTERED_PROP, operator: "GTE", value: start },
        { propertyName: APPROVED_ENTERED_PROP, operator: "LT", value: endExclusive },
      ],
      DEAL_PROPS
    )

    const mapped: SelfServeDeal[] = deals.map((d) => {
      const p = d.properties
      const parseNum = (v: string | null) => {
        if (v == null || v === "" || v === "-1") return null
        const n = parseFloat(v)
        return Number.isFinite(n) && n >= 0 ? n : null
      }
      return {
        id: d.id,
        name: p.dealname ?? `Deal ${d.id}`,
        approvedAt: p[APPROVED_ENTERED_PROP] ?? null,
        usDau: parseNum(p.bm_dau_usa_publishers ?? null),
        tier1Dau: parseNum(p.dau_tier_1 ?? null),
        normalisedDau: parseNum(p.normalised_dau__us_dau__tier_1__065 ?? null),
        category: p.publisher_app_category ?? null,
        isGaming: p.gaming_or_non_gaming === "true" || p.gaming_or_non_gaming === "Gaming" ? true
          : p.gaming_or_non_gaming === "false" || p.gaming_or_non_gaming === "Non-Gaming" ? false
          : null,
        bundle: p.bm__app_store_company_name ?? null,
      }
    })

    const result = computeCohort(mapped, start, endExclusive)

    return NextResponse.json({
      quarter,
      ...result,
    })
  } catch (e) {
    console.error("[self-serve-gp]", e)
    return NextResponse.json({ error: "Failed to load self-serve GP" }, { status: 500 })
  }
}
