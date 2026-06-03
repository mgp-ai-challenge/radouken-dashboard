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

export async function fetchCampaignStats(campaignId: string): Promise<CampaignStats> {
  const data = await llFetch(`/campaigns/${campaignId}/stats`) as Record<string, unknown>
  return {
    nbLeads:          Number(data.nbLeads ?? 0),
    nbContacted:      Number(data.nbContacted ?? 0),
    nbEmailsSent:     Number(data.nbEmailsSent ?? 0),
    nbEmailsOpened:   Number(data.nbEmailsOpened ?? 0),
    openRate:         Number(data.openRate ?? 0),
    nbEmailsClicked:  Number(data.nbEmailsClicked ?? 0),
    clickRate:        Number(data.clickRate ?? 0),
    nbEmailsBounced:  Number(data.nbEmailsBounced ?? 0),
    bounceRate:       Number(data.bounceRate ?? 0),
    nbUnsubscribed:   Number(data.nbUnsubscribed ?? 0),
    nbReplied:        Number(data.nbReplied ?? 0),
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
