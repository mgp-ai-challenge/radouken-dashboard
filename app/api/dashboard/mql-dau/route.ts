import { NextResponse } from "next/server"
import { searchDealsOr } from "@/lib/hubspot-deals"

const DAU_PROP = "normalised_dau__us_dau__tier_1__065"

const OWNER_NAMES: Record<string, string> = {
  "85618920":   "Nathan Boyer",
  "93649099":   "Jade Graves",
  "9728358":    "Joel Chang",
  "18768155":   "Randy Barenscott",
  "91133237":   "Dan Owens",
  "63973247":   "Rachel Lu",
  "73143157":   "Rosa Ru",
  "61862887":   "Paul Childs",
}

const PIPELINE_NAMES: Record<string, string> = {
  "1273603":   "Bidmachine - Sales",
  "145970019": "UA: Sales & AM",
  "961280":    "Bidmachine SDK DAU (Indirect)",
  "922793129": "Agentix Pipeline",
  "867371640": "UA Tricky Pipeline",
  "52357803":  "Bidmachine - Sign Ups",
}

// UA / Tricky pipelines: amount defaults to $125k per bundle if missing
const UA_PIPELINES = new Set(["145970019", "867371640"])
const UA_DEFAULT_GP = 125_000

// Stages at "Signed or later" — weight = 1.0 regardless of hs_deal_stage_probability
const SIGNED_STAGES = new Set([
  // Bidmachine - Sales
  "1256781119",  // Form Signed
  "1422062203",  // Live
  "1273609",     // Closed Won
  "1120630322",  // Awaiting Credentials
  "1406345612",  // MSA/Legal
  // UA: Sales & AM
  "1193765907",  // Signed / Ready to Onboard
  "247773860",   // Onboarding
  "247773861",   // Live - Learning
  "247773862",   // Live - Scaling
  // Bidmachine SDK DAU (Indirect)
  "961285",      // Signed
  "1452883551",  // AM Approved to Onboard
  "1213494111",  // Integrating
  "1213494112",  // Live & Testing
  "1213493907",  // Fully Scaled
  "1452899234",  // Sales Re-engagement
  // UA Tricky
  "1298083690",  // Committed / Signed
  "1298083691",  // Setup: Company & Store Assets
  "1333194814",  // Setup: Attribution Live
  "1333172313",  // Setup: Sources & Bundles
  "1333172314",  // Setup: Creatives Made
  "1333172315",  // Trial Campaign Launched
  "1311050835",  // Live Paid Campaign Launched
  // Agentix
  "1410103151",  // Live
  // Bidmachine - Sign Ups
  "107224655",   // Approved
  "107224657",   // Live
])

// Qualified Out / Closed Lost stages — excluded from GP, shown separately
const EXCLUDED_STAGES: Record<string, string> = {
  "1273611":   "Qualified out/Lost",
  "1142194445": "Qualified Out",
  "247670345":  "Churned",
  "34415407":   "Sales Qualified Out",
  "961286":     "Closed Lost",
  "1176856921": "Pending Cross Sell",
  "1410103152": "Qualified Out",
  "1410103153": "Closed Lost",
  "1298083693": "Qualified Out",
  "1333172316": "Paused/Stopped",
  "114401160":  "Denied",
  "1079394475": "Closed/Trash",
  "1062161234": "For Remarketing",
}

// Stage names for the GP breakdown
const STAGE_NAMES: Record<string, string> = {
  // Bidmachine - Sales
  "1439890464": "Marketing Qualified", "1273604": "Prospecting", "1256781119": "Form Signed",
  "1422062203": "Live", "1273609": "Closed Won", "1854658": "Success",
  "1054864468": "On Hold", "1059338631": "Active Discussion",
  "1120630322": "Awaiting Credentials", "1406345611": "Qualified", "1406345612": "MSA/Legal",
  // UA: Sales & AM
  "1193765901": "Lead", "1452908597": "App2Web", "1412577578": "MQL",
  "1422061184": "Started Outreach", "1213426007": "Sales Prospecting",
  "1193765902": "SQL", "1193765903": "Sales Proposal", "1193765904": "Request Approval",
  "1193765905": "Approved to Go Live", "1193765906": "Legal Review",
  "1193765907": "Signed", "1212773442": "Holding Queue",
  "247773860": "Onboarding", "247773861": "Live - Learning", "247773862": "Live - Scaling",
  "247773863": "Paused",
  // Indirect
  "1278450782": "Lead", "1343040315": "Lead with Peer SDK", "1157536": "MQL",
  "1422061987": "Started Outreach", "1855526": "Sales Prospecting",
  "1574904": "SQL", "961283": "Sales Proposal", "1295831362": "Internal Review",
  "961284": "MSA Shared", "961285": "Signed", "1452883551": "AM Approved to Onboard",
  "1213494111": "Integrating", "1213494112": "Live & Testing",
  "1213493907": "Fully Scaled", "1217350681": "Paused", "1452899234": "Sales Re-engagement",
  // UA Tricky
  "1298083687": "MQL", "1321645224": "TAM Review", "1298083688": "Qualified for UA Tricky",
  "1333172311": "First Meeting", "1298083689": "Sales Proposal", "1333172312": "Legal",
  "1298083690": "Committed/Signed", "1298083691": "Setup: Company & Store",
  "1333194814": "Setup: Attribution", "1333172313": "Setup: Sources & Bundles",
  "1333172314": "Setup: Creatives", "1333172315": "Trial Campaign",
  "1311050835": "Live Paid Campaign",
  // Agentix
  "1410103147": "Leads", "1458581345": "MQL", "1410103148": "Contacted",
  "1410103149": "Call Scheduled", "1410103150": "Testing", "1410103151": "Live",
  // Sign Ups
  "1347884654": "Pending Verification", "107224653": "New Registration",
  "107224654": "Under Review", "1275149844": "AdMob/GAM",
  "107224655": "Approved", "107224657": "Live", "1319309459": "Paused",
  "107224658": "Promoted",
}

function quarterInfo() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const q = Math.floor(now.getUTCMonth() / 3) + 1
  const monthStart = (q - 1) * 3 + 1
  return {
    start: `${year}-${String(monthStart).padStart(2, "0")}-01`,
    label: `Q${q} ${year} MQL`,
    quarter: `Q${q} ${year}`,
  }
}

export async function GET() {
  try {
    const { start: qStart, label: qLabel, quarter } = quarterInfo()

    // OR logic: matches the HubSpot report filters
    // Group 1: Date entered MQL this quarter
    // Group 2: Lead source = current quarter MQL label
    const deals = await searchDealsOr(
      [
        [
          { propertyName: "hs_v2_date_entered_1157536", operator: "GTE", value: qStart },
        ],
        [
          { propertyName: "lead_source", operator: "EQ", value: qLabel },
        ],
      ],
      [DAU_PROP, "pipeline", "dealname", "dealstage", "hubspot_owner_id", "notes_last_updated", "amount", "hs_deal_stage_probability"]
    )

    let totalNormDau = 0
    let rawGp = 0
    let weightedGp = 0
    const gpIncluded: Array<{ id: string; name: string; pipeline: string; stage: string; amount: number; gpAmount: number; weight: number; weightLabel: string; dealGp: number }> = []
    const gpExcluded: Array<{ id: string; name: string; pipeline: string; stage: string; reason: string; amount: number }> = []
    const byPipeline: Record<string, { count: number; normDau: number; deals: Array<{ id: string; name: string; normDau: number }> }> = {}

    for (const deal of deals) {
      const dau = parseFloat(deal.properties[DAU_PROP] ?? "0") || 0
      const pipelineId = deal.properties.pipeline ?? "unknown"
      const stageId = deal.properties.dealstage ?? ""
      const amt = parseFloat(deal.properties.amount ?? "0") || 0
      const prob = parseFloat(deal.properties.hs_deal_stage_probability ?? "0") || 0
      const dealName = deal.properties.dealname ?? `Deal ${deal.id}`
      const pipelineName = PIPELINE_NAMES[pipelineId] ?? pipelineId
      const stageName = EXCLUDED_STAGES[stageId] ?? STAGE_NAMES[stageId] ?? stageId

      totalNormDau += dau

      // Excluded deals: Qualified Out / Closed Lost — don't count in GP
      if (EXCLUDED_STAGES[stageId]) {
        gpExcluded.push({ id: deal.id, name: dealName, pipeline: pipelineName, stage: stageName, reason: EXCLUDED_STAGES[stageId], amount: amt })
        // Still count in pipeline split and MQL totals, just not GP
      } else {
        // GP rules: weight=1.0 if Signed or later, else stage probability
        const weight = SIGNED_STAGES.has(stageId) ? 1.0 : prob
        const weightLabel = SIGNED_STAGES.has(stageId) ? "Signed" : `${Math.round(prob * 100)}%`
        // UA/Tricky deals default to $125k per bundle if no amount
        const gpAmount = UA_PIPELINES.has(pipelineId) ? (amt > 0 ? amt : UA_DEFAULT_GP) : amt
        const dealGp = gpAmount * weight

        rawGp += gpAmount
        weightedGp += dealGp

        if (gpAmount > 0) {
          gpIncluded.push({ id: deal.id, name: dealName, pipeline: pipelineName, stage: stageName, amount: amt, gpAmount, weight, weightLabel, dealGp: Math.round(dealGp) })
        }
      }

      if (!byPipeline[pipelineId]) byPipeline[pipelineId] = { count: 0, normDau: 0, deals: [] }
      byPipeline[pipelineId].count++
      byPipeline[pipelineId].normDau += dau
      byPipeline[pipelineId].deals.push({
        id: deal.id,
        name: deal.properties.dealname ?? `Deal ${deal.id}`,
        normDau: Math.round(dau),
      })
    }

    // Sort deals within each pipeline by DAU descending
    for (const p of Object.values(byPipeline)) {
      p.deals.sort((a, b) => b.normDau - a.normDau)
    }

    const pipelineSplit = Object.entries(byPipeline)
      .map(([id, data]) => ({
        pipelineId: id,
        pipelineName: PIPELINE_NAMES[id] ?? id,
        count: data.count,
        normDau: Math.round(data.normDau),
        pct: Math.round((data.count / deals.length) * 100),
        deals: data.deals,
      }))
      .sort((a, b) => b.count - a.count)

    // Deals currently sitting in the MQL stage (stage 1157536)
    const mqlDeals = deals.filter((d) => d.properties.dealstage === "1157536")

    const mqlDealsList = mqlDeals.map((d) => {
      const ownerId = d.properties.hubspot_owner_id
      return {
        id: d.id,
        name: d.properties.dealname ?? `Deal ${d.id}`,
        normDau: Math.round(parseFloat(d.properties[DAU_PROP] ?? "0") || 0),
        pipeline: PIPELINE_NAMES[d.properties.pipeline ?? ""] ?? d.properties.pipeline ?? "Unknown",
        owner: ownerId ? (OWNER_NAMES[ownerId] ?? `Owner ${ownerId}`) : "Unassigned",
        lastActivity: d.properties.notes_last_updated ?? null,
      }
    }).sort((a, b) => {
      // Sort by last activity, nulls last
      if (!a.lastActivity && !b.lastActivity) return 0
      if (!a.lastActivity) return 1
      if (!b.lastActivity) return -1
      return b.lastActivity.localeCompare(a.lastActivity)
    })

    return NextResponse.json({
      quarter,
      mqlNormDau: Math.round(totalNormDau),
      weightedGp: Math.round(weightedGp),
      rawGp: Math.round(rawGp),
      gpBreakdown: {
        included: gpIncluded.sort((a, b) => b.dealGp - a.dealGp),
        excluded: gpExcluded,
        includedCount: gpIncluded.length,
        excludedCount: gpExcluded.length,
        dealsWithNoAmount: deals.filter((d) => !EXCLUDED_STAGES[d.properties.dealstage ?? ""] && (parseFloat(d.properties.amount ?? "0") || 0) === 0 && !UA_PIPELINES.has(d.properties.pipeline ?? "")).length,
      },
      dealCount: deals.length,
      stillInMql: mqlDealsList.length,
      mqlDealsList,
      pipelineSplit,
    })
  } catch (e) {
    console.error("[mql-dau]", e)
    return NextResponse.json({ error: "Failed to load MQL DAU" }, { status: 500 })
  }
}
