// lib/hubspot-campaigns.ts

export interface MatchedDeal {
  dealId: string
  company: string
  stageLabel: string
  stageType: "MQL" | "SQL" | "LOST"
}

export interface TrickyAttribution {
  mqls: MatchedDeal[]
  sqls: MatchedDeal[]
  lost: MatchedDeal[]
}

export const TRICKY_STAGES: Record<string, { label: string; type: "MQL" | "SQL" | "LOST" }> = {
  "1298083688": { label: "Qualified for UA", type: "MQL" },
  "1321645224": { label: "New MQL",          type: "MQL" },
  "1333172311": { label: "First Meeting",    type: "SQL" },
  "1333172312": { label: "Legal",            type: "SQL" },
  "1298083693": { label: "Qualified Out",    type: "LOST" },
}

const HS_BASE = "https://api.hubapi.com"

async function hsFetch(path: string, body?: unknown): Promise<unknown> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not set")
  const res = await fetch(`${HS_BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  })
  if (res.status === 401) throw new Error("HubSpot 401 — Check HUBSPOT_ACCESS_TOKEN")
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HubSpot ${path} → ${res.status}${text ? ": " + text.slice(0, 200) : ""}`)
  }
  return res.json()
}

interface HsDeal { id: string; properties: Record<string, string | null> }

// Paginate all deals from a HubSpot search using `after` cursor
async function fetchAllDeals(body: Record<string, unknown>): Promise<HsDeal[]> {
  const all: HsDeal[] = []
  let after: string | undefined

  while (true) {
    const payload = after ? { ...body, after } : body
    const data = await hsFetch("/crm/v3/objects/deals/search", payload) as {
      results: HsDeal[]
      paging?: { next?: { after: string } }
    }
    all.push(...(data.results ?? []))
    after = data.paging?.next?.after
    if (!after) break
  }

  return all
}

// Fetch all Tricky pipeline deals where lead_source = 'Q2 2026 MQL'
export async function fetchTrickyDeals(): Promise<{ deals: HsDeal[]; total: number }> {
  const body = {
    filterGroups: [{
      filters: [
        { propertyName: "pipeline",    operator: "EQ", value: "867371640" },
        { propertyName: "lead_source", operator: "EQ", value: "Q2 2026 MQL" },
      ],
    }],
    properties: ["dealname", "dealstage", "createdate"],
    limit: 100,
  }
  const deals = await fetchAllDeals(body)
  return { deals, total: deals.length }
}

// Fetch all Inbound pipeline deals created since 2026-04-01
export async function fetchInboundDeals(): Promise<HsDeal[]> {
  const body = {
    filterGroups: [{
      filters: [
        { propertyName: "pipeline",   operator: "EQ",  value: "52357803" },
        { propertyName: "createdate", operator: "GTE", value: "1743465600000" },
      ],
    }],
    properties: ["dealname", "dealstage"],
    limit: 100,
  }
  return fetchAllDeals(body)
}

// Fetch contact IDs associated with a deal, then resolve their emails
// emailCache: Map<contactId, email> — mutated in place to avoid re-fetching
export async function fetchDealContactEmails(
  dealId: string,
  emailCache: Map<string, string>,
): Promise<string[]> {
  const assocData = await hsFetch(
    `/crm/v3/objects/deals/${dealId}/associations/contacts`
  ) as { results: Array<{ id: string }> }

  const contactIds = (assocData.results ?? []).map((r) => r.id)
  const emails: string[] = []

  for (const cid of contactIds) {
    if (emailCache.has(cid)) {
      const cached = emailCache.get(cid)!
      if (cached) emails.push(cached)
      continue
    }
    try {
      const contact = await hsFetch(
        `/crm/v3/objects/contacts/${cid}?properties=email`
      ) as { properties: { email?: string } }
      const email = contact.properties.email ?? ""
      emailCache.set(cid, email)
      if (email) emails.push(email)
    } catch {
      emailCache.set(cid, "")  // mark as failed so we don't retry
    }
  }

  return emails
}

// Company name fuzzy match: both strings must be >= 4 chars and one contains the other
function companyMatch(a: string, b: string): boolean {
  const na = a.toLowerCase().trim()
  const nb = b.toLowerCase().trim()
  return na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))
}

// Run MQL/SQL/LOST attribution for a set of sent leads against Tricky deals
export function matchTrickyDeals(
  leads: Array<{ companyName: string | null }>,
  deals: HsDeal[],
): TrickyAttribution {
  const mqls: MatchedDeal[] = []
  const sqls: MatchedDeal[] = []
  const lost: MatchedDeal[] = []

  for (const deal of deals) {
    const stage = TRICKY_STAGES[deal.properties.dealstage ?? ""]
    if (!stage) continue

    // dealname format: "CompanyName from PersonName requests Bidmachine"
    const hsCompany = (deal.properties.dealname ?? "").split(" from ")[0]

    const matched = leads.some((l) => l.companyName && companyMatch(hsCompany, l.companyName))
    if (!matched) continue

    const entry: MatchedDeal = {
      dealId:     deal.id,
      company:    hsCompany,
      stageLabel: stage.label,
      stageType:  stage.type,
    }
    if (stage.type === "MQL")  mqls.push(entry)
    if (stage.type === "SQL")  sqls.push(entry)
    if (stage.type === "LOST") lost.push(entry)
  }

  return { mqls, sqls, lost }
}

// Deduplicate MatchedDeals from two attributions by dealId
export function dedupeDeals(a: MatchedDeal[], b: MatchedDeal[]): MatchedDeal[] {
  const seen = new Set<string>()
  return [...a, ...b].filter((d) => {
    if (seen.has(d.dealId)) return false
    seen.add(d.dealId)
    return true
  })
}

// Add at the bottom of lib/hubspot-campaigns.ts
export interface AttributionResponse {
  sentCounts: { nc: number; cu: number; inbound: number }
  nc: TrickyAttribution
  cu: TrickyAttribution
  combined: {
    mqls: MatchedDeal[]
    sqls: MatchedDeal[]
    lost: MatchedDeal[]
    totalTrickyDeals: number
  }
  inbound: {
    matchedCount: number
    totalInboundDeals: number
    skippedDeals: number
  }
}
