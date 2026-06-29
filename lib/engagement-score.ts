/** Points per Lemlist activity type (must stay in sync with API aggregation). */
export const ENGAGEMENT_POINTS = {
  open: 1,
  click: 3,
  reply: 5,
} as const

/**
 * Raw engagement score for one contact in one campaign.
 * Higher = more engaged (replies weighted heaviest, then clicks, then opens).
 */
export function computeEngagementScore(opens: number, clicks: number, replies: number): number {
  return opens * ENGAGEMENT_POINTS.open + clicks * ENGAGEMENT_POINTS.click + replies * ENGAGEMENT_POINTS.reply
}

/**
 * Scores at or above this map to “full green” in the heat bubble.
 * Tune if your campaigns routinely exceed this.
 */
export const ENGAGEMENT_SCORE_COLOR_CAP = 100

/** 0 = unengaged (red), 1 = fully engaged hue (green) */
export function engagementHeatRatio(score: number): number {
  if (score <= 0) return 0
  return Math.min(1, score / ENGAGEMENT_SCORE_COLOR_CAP)
}

/** Pastel bubble: red (0°) → green (120°) in HSL */
export function engagementBubbleColors(score: number): { background: string; color: string; border: string } {
  const t = engagementHeatRatio(score)
  const hue = Math.round(120 * t)
  return {
    background: `hsl(${hue} 52% 88%)`,
    color: `hsl(${hue} 42% 20%)`,
    border: `hsl(${hue} 35% 72%)`,
  }
}
