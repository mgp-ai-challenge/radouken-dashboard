import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Snapshot from Appodeal Life MCP (getScorecard for radu.stoia@appodeal.com)
// In production this would be backed by a cron calling the Appodeal Life API.
export async function GET() {
  return NextResponse.json({
    cultureScore: 46,
    scoreBreakdown: [
      { label: "Base", value: "100", tone: "neutral", detail: "Every score starts at 100." },
      { label: "OKR health", value: "-54", tone: "negative", detail: "25% of OKRs unhealthy this cycle, repeated ×5 cycles." },
      { label: "Final score", value: "46", tone: "final", detail: "Clamped to 0-100 after adjustments." },
    ],
    github: { commits: 8, prsOpened: 1, prsMerged: 1, activeDays: 2 },
    atlassian: { ticketsCreated: 3, ticketsResolved: 2, pagesCreated: 1, pagesEdited: 3, jiraComments: 14 },
    fellow: { meetingsInvited: 47, meetingsWithAgenda: 42, actionItemsAssigned: 73, actionItemsCompleted: 21 },
    meetingDiscipline: { score: 87 },
    okrHealth: { healthy: 3, warning: 1, critical: 0, total: 4, healthRate: 75 },
  })
}
