// lib/icp-sourcing.ts

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
