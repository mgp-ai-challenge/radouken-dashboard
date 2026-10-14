import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const APPODEAL_LIFE_URL = process.env.APPODEAL_LIFE_URL ?? "https://life.appodeal.com"
const APPODEAL_LIFE_TOKEN = process.env.APPODEAL_LIFE_TOKEN
const EMAIL = "radu.stoia@appodeal.com"

export async function GET() {
  // Try fetching live data from Appodeal Life API
  if (APPODEAL_LIFE_TOKEN) {
    try {
      const res = await fetch(`${APPODEAL_LIFE_URL}/api/v1/scorecard?email=${encodeURIComponent(EMAIL)}`, {
        headers: { Authorization: `Bearer ${APPODEAL_LIFE_TOKEN}` },
        cache: "no-store",
      })
      if (res.ok) {
        const data = await res.json()
        return NextResponse.json({
          cultureScore: data.cultureHealthRate ?? 100,
          scoreBreakdown: data.cultureScoreBreakdown ?? [],
          github: data.scorecard?.github ?? { commits: 0, prsOpened: 0, prsMerged: 0, activeDays: 0 },
          atlassian: data.scorecard?.atlassian ?? { ticketsCreated: 0, ticketsResolved: 0, pagesCreated: 0, pagesEdited: 0, jiraComments: 0 },
          fellow: data.scorecard?.fellow ?? { meetingsInvited: 0, meetingsWithAgenda: 0, actionItemsAssigned: 0, actionItemsCompleted: 0 },
          meetingDiscipline: { score: Math.round((data.scorecard?.meetingDiscipline?.score ?? 0) * 100) },
          okrHealth: data.scorecard?.okrCounts ?? { healthy: 0, warning: 0, critical: 0, total: 0, healthRate: 0 },
        })
      }
      console.warn("[culture-score] Appodeal Life API returned", res.status, "— using fallback")
    } catch (e) {
      console.warn("[culture-score] Appodeal Life API unreachable:", e)
    }
  }

  // Fallback: latest known snapshot (updated 2026-10-14)
  return NextResponse.json({
    cultureScore: 100,
    scoreBreakdown: [
      { label: "Base", value: "100", tone: "neutral", detail: "Every score starts at 100." },
      { label: "Repeat flags", value: "0", tone: "positive", detail: "No score-affecting repeat flags in the latest cycle." },
      { label: "Final score", value: "100", tone: "final", detail: "Clamped to 0-100 after adjustments." },
    ],
    github: { commits: 2, prsOpened: 0, prsMerged: 0, activeDays: 2 },
    atlassian: { ticketsCreated: 2, ticketsResolved: 1, pagesCreated: 1, pagesEdited: 2, jiraComments: 15 },
    fellow: { meetingsInvited: 58, meetingsWithAgenda: 58, actionItemsAssigned: 39, actionItemsCompleted: 24 },
    meetingDiscipline: { score: 70 },
    okrHealth: { healthy: 0, warning: 1, critical: 0, total: 1, healthRate: 0 },
  })
}
