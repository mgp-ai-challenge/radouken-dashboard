// lib/lemlist.ts

const LL_BASE = "https://api.lemlist.com/api"

export const TARGET_CAMPAIGNS = [
  { key: "nc"      as const, match: "Q2 Non Customers", label: "Tricky — Non-Customers", color: "#378ADD" },
  { key: "cu"      as const, match: "Q2 Customers",     label: "Tricky — Customers",     color: "#534AB7" },
  { key: "inbound" as const, match: "Inbound",          label: "Inbound SDK",            color: "#1D9E75" },
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
  nbCompleted: number   // leads that finished the sequence
  nbActive: number      // leads currently in-sequence or ready
}


export interface LemlistLead {
  email: string
  companyName: string | null
  firstName: string | null
  lastName: string | null
  hasResponded: boolean
}

export interface DiscoveredCampaign {
  key: CampaignKey
  id: string | null
  label: string
  color: string
  stats: CampaignStats | null
  error: string | null
}

async function llFetch(path: string, attempt = 0): Promise<unknown> {
  const key = process.env.LEMLIST_API_KEY
  if (!key) throw new Error("LEMLIST_API_KEY is not set")
  const res = await fetch(`${LL_BASE}${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(":" + key).toString("base64")}` },
    cache: "no-store",
  })
  if (res.status === 401) throw new Error("Lemlist 401 — Check LEMLIST_API_KEY")
  if (res.status === 429) {
    if (attempt >= 3) throw new Error("Lemlist 429 — Rate limited after 3 retries")
    const retryAfter = parseFloat(res.headers.get("Retry-After") ?? "2")
    const waitMs = Math.max(retryAfter * 1000, 2000)
    await new Promise((r) => setTimeout(r, waitMs))
    return llFetch(path, attempt + 1)
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

function parseStats(data: Record<string, unknown>): CampaignStats {
  const sent      = Number(data.sentCount ?? 0)
  const delivered = Number(data.deliveredCount ?? 0)
  const opened    = Number(data.openedCount ?? 0)
  const clicked   = Number(data.clickedCount ?? 0)
  const bounced   = Math.max(sent - delivered, 0)
  const completed = Number(data.leadCompleted ?? 0)
  const active    = Number(data.leadInProgress ?? 0) + Number(data.leadReadyToSend ?? 0) + Number(data.leadToLaunch ?? 0)
  return {
    nbLeads:         0,  // filled in later by lead-counts route
    nbContacted:     delivered,
    nbEmailsSent:    sent,
    nbEmailsOpened:  opened,
    openRate:        sent > 0 ? opened / sent : 0,
    nbEmailsClicked: clicked,
    clickRate:       sent > 0 ? clicked / sent : 0,
    nbEmailsBounced: bounced,
    bounceRate:      sent > 0 ? bounced / sent : 0,
    nbUnsubscribed:  Number(data.unsubscribedCount ?? 0),
    nbReplied:       Number(data.repliedCount ?? 0),
    nbCompleted:     completed,
    nbActive:        active,
  }
}


// Fetch stats for multiple campaigns sequentially (100ms delay, respects 10 req/s limit)
export async function fetchAllCampaignStats(
  campaignIds: string[],
): Promise<Map<string, CampaignStats>> {
  const endDate   = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const map = new Map<string, CampaignStats>()
  for (let i = 0; i < campaignIds.length; i++) {
    const id = campaignIds[i]
    const res = await llFetch(
      `/campaigns/${id}/stats?startDate=${startDate}&endDate=${endDate}`,
    ) as Record<string, unknown>
    map.set(id, parseStats(res))
    if (i < campaignIds.length - 1) await new Promise((r) => setTimeout(r, 150))
  }
  return map
}

// Count total leads in a campaign (no sentAt filter) for KPI display
export async function fetchCampaignLeadCount(campaignId: string): Promise<number> {
  let total = 0
  let offset = 0
  const limit = 100
  while (true) {
    const data = await llFetch(`/campaigns/${campaignId}/leads?limit=${limit}&offset=${offset}`)
    const page = data as Array<unknown>
    if (!Array.isArray(page) || page.length === 0) break
    total += page.length
    if (page.length < limit) break
    offset += limit
    await new Promise((r) => setTimeout(r, 100))
  }
  return total
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
          email:        String(l.email ?? ""),
          companyName:  l.companyName ? String(l.companyName) : null,
          firstName:    l.firstName  ? String(l.firstName)  : null,
          lastName:     l.lastName   ? String(l.lastName)   : null,
          hasResponded: Boolean(l.hasResponded ?? false),
        })
      }
    }

    if (page.length < limit) break
    offset += limit
    await new Promise((r) => setTimeout(r, 100))
  }

  return results
}
