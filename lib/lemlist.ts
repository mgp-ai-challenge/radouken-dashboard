// lib/lemlist.ts

const LL_BASE = "https://api.lemlist.com/api"

export const TARGET_CAMPAIGNS = [
  { key: "nc"      as const, match: "Non Customers", label: "Tricky — Non-Customers", color: "#378ADD" },
  { key: "cu"      as const, match: "Q2 Customers",  label: "Tricky — Customers",     color: "#534AB7" },
  { key: "inbound" as const, match: "Inbound",       label: "Inbound SDK",            color: "#1D9E75" },
]

export type CampaignKey = "nc" | "cu" | "inbound"

export interface CampaignStats {
  nbLeads: number
  nbContacted: number
  nbEmailsSent: number
  nbEmailsOpened: number
  openRate: number
  nbEmailsClicked: number
  clickRate: number
  nbEmailsBounced: number
  bounceRate: number
  nbUnsubscribed: number
  nbReplied: number
}

export interface LemlistLead {
  email: string
  companyName: string | null
  firstName: string | null
  lastName: string | null
}

export interface DiscoveredCampaign {
  key: CampaignKey
  id: string | null
  label: string
  color: string
  stats: CampaignStats | null
  error: string | null
}

async function llFetch(path: string): Promise<unknown> {
  const key = process.env.LEMLIST_API_KEY
  if (!key) throw new Error("LEMLIST_API_KEY is not set")
  const res = await fetch(`${LL_BASE}${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(":" + key).toString("base64")}` },
    cache: "no-store",
  })
  if (res.status === 401) throw new Error("Lemlist 401 — Check LEMLIST_API_KEY")
  if (res.status === 429) {
    const retry = res.headers.get("Retry-After") ?? "10"
    throw new Error(`Lemlist 429 — Rate limited — retry in ${retry}s`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Lemlist ${path} → ${res.status}${body ? ": " + body.slice(0, 200) : ""}`)
  }
  return res.json()
}

export async function fetchAllCampaigns(): Promise<Array<{ _id: string; name: string }>> {
  const data = await llFetch("/campaigns")
  return (data as Array<{ _id: string; name: string }>) ?? []
}

export async function fetchCampaignStats(campaignId: string): Promise<CampaignStats & { _raw?: unknown }> {
  const endDate = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  // Use batch endpoint — individual /stats endpoint has unpredictable shape with date params
  const res = await llFetch(`/campaigns/stats?campaignIds=${campaignId}&startDate=${startDate}&endDate=${endDate}`) as { results?: Record<string, unknown>[]; errors?: unknown[] }
  const data: Record<string, unknown> = res.results?.[0] ?? {}
  const sent    = Number(data.messagesSent ?? 0)
  const reached = Number(data.nbLeadsReached ?? 0)
  const opened  = Number(data.opened ?? 0)
  const clicked = Number(data.clicked ?? 0)
  const bounced = Number(data.messagesBounced ?? 0)
  return {
    nbLeads:         Number(data.nbLeads ?? 0),
    nbContacted:     reached,
    nbEmailsSent:    sent,
    nbEmailsOpened:  opened,
    openRate:        sent > 0 ? opened / sent : 0,
    nbEmailsClicked: clicked,
    clickRate:       sent > 0 ? clicked / sent : 0,
    nbEmailsBounced: bounced,
    bounceRate:      sent > 0 ? bounced / sent : 0,
    nbUnsubscribed:  Number(data.nbLeadsUnsubscribed ?? 0),
    nbReplied:       Number(data.replied ?? 0),
    _raw: res,  // temporary — remove once field mapping is confirmed
  }
}

// Paginate all leads for a campaign, 100ms delay between pages (10 req/sec limit)
// Returns only leads where sentAt is set (isSent = true)
export async function fetchAllLeads(campaignId: string): Promise<LemlistLead[]> {
  const results: LemlistLead[] = []
  const limit = 100
  let offset = 0

  while (true) {
    const data = await llFetch(`/campaigns/${campaignId}/leads?limit=${limit}&offset=${offset}`)
    const page = data as Array<Record<string, unknown>>
    if (!Array.isArray(page) || page.length === 0) break

    for (const l of page) {
      if (l.sentAt) {
        results.push({
          email:       String(l.email ?? ""),
          companyName: l.companyName ? String(l.companyName) : null,
          firstName:   l.firstName  ? String(l.firstName)  : null,
          lastName:    l.lastName   ? String(l.lastName)   : null,
        })
      }
    }

    if (page.length < limit) break
    offset += limit
    await new Promise((r) => setTimeout(r, 100))
  }

  return results
}
