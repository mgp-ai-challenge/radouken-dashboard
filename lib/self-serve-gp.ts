/**
 * Self-Serve Potential GP — BidMachine
 *
 * Source: Ilya Borisov, "Applying Potential GP to MQLs — Handoff" (10 Nov 2026),
 * which restates Ian Rooney's self-serve methodology.
 *
 *   GP = normalised DAU × spend per US DAU per day × 365 × 0.175
 *   normalised DAU = US DAU + 0.65 × Tier-1 DAU   (no 1.9 multiplier)
 *
 * Use ONLY for self-serve sign-ups (HubSpot pipeline "Bidmachine - Sign Ups", 52357803).
 * Indirect SDK, Direct and UA deals use different methods — do not apply this to them.
 */

export const SELF_SERVE_PIPELINE_ID = "52357803"
export const APPROVED_STAGE_ID = "107224655"
export const APPROVED_ENTERED_PROP = `hs_v2_date_entered_${APPROVED_STAGE_ID}`

export const DAYS_PER_YEAR = 365
export const MARGIN = 0.175
export const TIER1_WEIGHT = 0.65

export const RATES = {
  "Social / Dating": 0.009624,
  "Utilities": 0.008446,
  "Gaming": 0.00636,
  "Finance": 0.00503,
  "Other non-gaming": 0.003907,
  "Short Video / Entertainment": 0.003693,
  "Health & Fitness": 0.002815,
  "Productivity / AI": 0.002115,
  "Sports": 0.002109,
  "Weather": 0.001702,
  "News": 0.00142,
  "Communications": 0.001396,
} as const

export type Category = keyof typeof RATES

const MIN_RATE = Math.min(...Object.values(RATES))
const MAX_RATE = Math.max(...Object.values(RATES))

export interface SelfServeDeal {
  id: string
  name: string
  approvedAt: string | null
  usDau?: number | null
  tier1Dau?: number | null
  normalisedDau?: number | null
  category?: string | null
  isGaming?: boolean | null
  bundle?: string | null
}

export interface GpResult {
  id: string
  name: string
  normalisedDau: number
  category: Category | null
  gp: number | null
  gpRange?: [number, number]
}

export function computeNormalisedDau(d: SelfServeDeal): number {
  if (d.usDau != null || d.tier1Dau != null) {
    return (d.usDau ?? 0) + TIER1_WEIGHT * (d.tier1Dau ?? 0)
  }
  return d.normalisedDau ?? 0
}

export function potentialGp(normDau: number, rate: number): number {
  return normDau * rate * DAYS_PER_YEAR * MARGIN
}

export function classify(d: SelfServeDeal): Category | null {
  if (d.category && d.category in RATES) return d.category as Category
  if (d.isGaming === true) return "Gaming"
  return null
}

export function dedupe(deals: SelfServeDeal[]): SelfServeDeal[] {
  const byKey = new Map<string, SelfServeDeal>()
  for (const d of deals) {
    const key = d.bundle ? `bundle:${d.bundle.toLowerCase()}` : `id:${d.id}`
    const existing = byKey.get(key)
    if (!existing || computeNormalisedDau(d) > computeNormalisedDau(existing)) byKey.set(key, d)
  }
  return [...byKey.values()]
}

export function inWindow(d: SelfServeDeal, start: string, endExclusive: string): boolean {
  if (!d.approvedAt) return false
  return d.approvedAt >= start && d.approvedAt < endExclusive
}

export function computeCohort(deals: SelfServeDeal[], start: string, endExclusive: string) {
  const cohort = dedupe(deals.filter((d) => inWindow(d, start, endExclusive)))

  const results: GpResult[] = cohort.map((d) => {
    const nd = computeNormalisedDau(d)
    const category = classify(d)
    if (!category) {
      return {
        id: d.id, name: d.name, normalisedDau: nd, category: null, gp: null,
        gpRange: [potentialGp(nd, MIN_RATE), potentialGp(nd, MAX_RATE)] as [number, number],
      }
    }
    return { id: d.id, name: d.name, normalisedDau: nd, category, gp: potentialGp(nd, RATES[category]) }
  })

  const classified = results.filter((r) => r.gp != null)
  const unclassified = results.filter((r) => r.gp == null)
  const total = classified.reduce((s, r) => s + (r.gp ?? 0), 0)

  return {
    publishers: results.length,
    totalGp: Math.round(total),
    classifiedCount: classified.length,
    unclassifiedCount: unclassified.length,
    unclassifiedRange: unclassified.reduce<[number, number]>(
      (acc, r) => [acc[0] + (r.gpRange?.[0] ?? 0), acc[1] + (r.gpRange?.[1] ?? 0)], [0, 0]
    ).map(Math.round) as [number, number],
    results,
  }
}
