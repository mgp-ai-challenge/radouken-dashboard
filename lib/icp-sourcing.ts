// lib/icp-sourcing.ts
import { fetchAllCampaigns, fetchLeadsWithState, TARGET_CAMPAIGNS } from "./lemlist"

export type Vertical = "iap-gaming" | "igaming" | "ecommerce" | "prediction-markets" | "ctv"
export type EngagementTier = "replied" | "interested" | "clicked" | "opened" | "contacted" | null
export type RecommendedAction = "warm-re-approach" | "cold-outreach" | "manual-verify-mmp"

// Defined here (not in sensortower.ts) to avoid a circular dependency:
// lib/icp-sourcing.ts imports from lib/sensortower.ts; sensortower.ts must not import back.
export type MMPDetected = "appsflyer" | "adjust" | "both" | "none" | "unknown"

export interface ICPCandidate {
  appId: string
  appName: string
  publisherName: string
  publisherDomain: string | null
  vertical: Vertical
  store: "ios" | "android"              // platform the app was sourced from
  stEstimatedUSDAU: number | null       // ST panel estimate, not MMP-verified
  stMonthlyDownloads: number | null
  mmpDetected: MMPDetected
  isExistingBMPublisher: boolean        // always false in returned results (customers are hard-excluded)
  lemlistEngagement: EngagementTier
  lastContactedAt: string | null        // ISO string
  recommendedAction: RecommendedAction
  storeUrl: string | null
}

export interface ICPSourcingResponse {
  candidates: ICPCandidate[]
  fetchedAt: string
  error?: string
}

export interface VerticalConfig {
  vertical: Vertical
  iosCategories: string[]
  androidCategories: string[]
  fetchDAU: boolean       // IAP gaming only — requires Usage Intelligence module
  fetchRevenue: boolean   // e-commerce and prediction markets — directional signal
  dauGate: number | null  // null = no gate; excludes candidates below threshold
  downloadsGate: number | null
}

// Category IDs verified via Task 1 API probe.
// iOS: numeric string IDs. Android: lowercase snake_case strings.
export const VERTICAL_CONFIGS: Record<Exclude<Vertical, "ctv">, VerticalConfig> = {
  "iap-gaming": {
    vertical: "iap-gaming",
    iosCategories: ["7001", "7012", "7017", "6016"],   // Casual, Puzzle, Simulation, Casino
    androidCategories: ["game_casual", "game_puzzle", "game_simulation", "game_casino"],
    fetchDAU: true,
    fetchRevenue: false,
    dauGate: 100_000,
    downloadsGate: null,
  },
  "igaming": {
    vertical: "igaming",
    iosCategories: ["6016"],                            // Casino
    androidCategories: ["game_casino"],
    fetchDAU: false,
    fetchRevenue: false,
    dauGate: null,
    downloadsGate: null,
  },
  "ecommerce": {
    vertical: "ecommerce",
    iosCategories: ["6024"],                            // Shopping
    androidCategories: ["shopping"],
    fetchDAU: false,
    fetchRevenue: true,
    dauGate: null,
    downloadsGate: 500_000,
  },
  "prediction-markets": {
    vertical: "prediction-markets",
    iosCategories: ["6004", "6015"],                    // Sports, Finance
    androidCategories: ["sports", "finance"],
    fetchDAU: false,
    fetchRevenue: true,
    dauGate: null,
    downloadsGate: null,
  },
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

const ENGAGEMENT_WEIGHT: Record<NonNullable<EngagementTier>, number> = {
  replied:    6,
  interested: 5,
  clicked:    4,
  opened:     3,
  contacted:  2,
}

export function scoreCandidate(candidate: ICPCandidate): number {
  // mmpDetected = "unknown" → lowest priority group
  if (candidate.mmpDetected === "unknown") return 0

  const engagementScore = candidate.lemlistEngagement
    ? ENGAGEMENT_WEIGHT[candidate.lemlistEngagement]
    : 1 // cold outreach baseline

  // Scale engagement score + normalised DAU signal (capped contribution)
  const dau = candidate.stEstimatedUSDAU ?? 0
  const dauSignal = Math.min(dau / 1_000_000, 5) // max 5 points from DAU
  const downloads = candidate.stMonthlyDownloads ?? 0
  const dlSignal = Math.min(downloads / 5_000_000, 3) // max 3 points

  return engagementScore * 10 + dauSignal + dlSignal
}

export function deriveRecommendedAction(
  mmpDetected: MMPDetected,
  lemlistEngagement: EngagementTier,
): RecommendedAction {
  if (mmpDetected === "unknown") return "manual-verify-mmp"
  if (lemlistEngagement !== null) return "warm-re-approach"
  return "cold-outreach"
}

// ─── Lemlist engagement index ─────────────────────────────────────────────────

export interface DomainEngagement {
  tier: EngagementTier
  lastContactedAt: string | null
}

function stateToEngagementTier(state: string): EngagementTier {
  const s = state.toLowerCase()
  if (s.includes("replied") || s.includes("reply")) return "replied"
  if (s.includes("interested"))                        return "interested"
  if (s.includes("click"))                             return "clicked"
  if (s.includes("open"))                              return "opened"
  if (s.includes("sent") || s.includes("contacted"))  return "contacted"
  return null
}

function extractDomain(email: string): string | null {
  const parts = email.split("@")
  return parts.length === 2 && parts[1] ? parts[1].toLowerCase() : null
}

// Builds a domain → engagement map by scanning all TARGET_CAMPAIGNS leads.
// Call once at the start of runVerticalPipeline and pass the result downstream.
export async function buildLemlistEngagementIndex(): Promise<Map<string, DomainEngagement>> {
  const index = new Map<string, DomainEngagement>()

  let allCampaigns: Array<{ _id: string; name: string }>
  try {
    allCampaigns = await fetchAllCampaigns()
  } catch {
    console.warn("[icp-sourcing] Lemlist campaign fetch failed — engagement will be null for all candidates")
    return index
  }

  const targetIds = TARGET_CAMPAIGNS
    .map(({ match }) => allCampaigns.find((c) => c.name.includes(match))?._id)
    .filter(Boolean) as string[]

  for (const campaignId of targetIds) {
    let leads: Awaited<ReturnType<typeof fetchLeadsWithState>>
    try {
      leads = await fetchLeadsWithState(campaignId)
    } catch {
      console.warn(`[icp-sourcing] Lemlist leads fetch failed for campaign ${campaignId}`)
      continue
    }

    for (const lead of leads) {
      const domain = extractDomain(lead.email)
      if (!domain) continue

      const tier = stateToEngagementTier(lead.state)
      const existing = index.get(domain)

      // Keep the highest-weight engagement for this domain
      const existingWeight = existing?.tier ? (ENGAGEMENT_WEIGHT[existing.tier] ?? 0) : 0
      const newWeight = tier ? (ENGAGEMENT_WEIGHT[tier] ?? 0) : 0

      if (!existing || newWeight > existingWeight || (newWeight === existingWeight && (lead.sentAt ?? "") > (existing.lastContactedAt ?? ""))) {
        index.set(domain, {
          tier,
          lastContactedAt: lead.sentAt ?? null,
        })
      }
    }
  }

  return index
}

// ─── HubSpot customer check ───────────────────────────────────────────────────

const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN

// Returns true if the domain belongs to an existing HubSpot customer.
// On API failure, returns false (conservative: don't exclude on error).
export async function isCustomerDomain(domain: string): Promise<boolean> {
  if (!HS_TOKEN) return false
  try {
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: "domain", operator: "EQ", value: domain },
          { propertyName: "lifecyclestage", operator: "EQ", value: "customer" },
        ],
      }],
      properties: ["domain", "lifecyclestage"],
      limit: 1,
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
      console.warn(`[icp-sourcing] HubSpot customer check failed for ${domain}: ${res.status}`)
      return false
    }
    const data = await res.json()
    return (data.total ?? 0) > 0
  } catch (e) {
    console.warn(`[icp-sourcing] HubSpot customer check threw for ${domain}:`, e)
    return false
  }
}
