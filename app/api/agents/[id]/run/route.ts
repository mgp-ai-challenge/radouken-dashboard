import { NextRequest, NextResponse } from "next/server"
import { readAgentStates, writeAgentState, AGENT_DEFAULTS, AgentState } from "@/lib/agents"
import { generateWeeklyReport } from "@/lib/weekly-report"
import { scanCodebase } from "@/lib/bug-scanner"

// Stubs — each will be replaced with real logic as agents are built
async function runLemlistSync(): Promise<Record<string, number | string>> {
  // TODO: fetch campaigns + leads from Lemlist, store to .lemlist-data.json
  await new Promise((r) => setTimeout(r, 1200))
  return { campaigns: 0, leads: 0 }
}

async function runHubspotSync(): Promise<Record<string, number | string>> {
  // TODO: fetch contacts + deals from HubSpot, store to .hubspot-data.json
  await new Promise((r) => setTimeout(r, 1200))
  return { contacts: 0, deals: 0 }
}

async function runAttribution(): Promise<Record<string, number | string>> {
  // TODO: run attribution analysis on stored data, write to .attribution-cache.json
  await new Promise((r) => setTimeout(r, 800))
  return { records: 0, misattributed: 0, bdOverlaps: 0 }
}

async function runCommunications(): Promise<Record<string, number | string>> {
  // TODO: build report, post to Slack webhook
  await new Promise((r) => setTimeout(r, 600))
  return { reportsSent: 0 }
}

async function runWeeklyReport(): Promise<Record<string, number | string>> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
  const report = await generateWeeklyReport(baseUrl)
  return {
    weekLabel: report.weekLabel,
    qtdNormDau: report.kpis.qtdNormDau,
    submissions: report.kpis.q2Submissions,
  }
}

async function runBugScan(): Promise<Record<string, number | string>> {
  const { filesScanned, issuesFound } = await scanCodebase()
  return { filesScanned, issuesFound }
}

const runners: Record<string, () => Promise<Record<string, number | string>>> = {
  "lemlist-sync": runLemlistSync,
  "hubspot-sync": runHubspotSync,
  attribution: runAttribution,
  communications: runCommunications,
  "weekly-report": runWeeklyReport,
  "code-review": runBugScan,
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const runner = runners[id]

  if (!runner) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 404 })
  }

  const states = readAgentStates()
  const existing = states.find((s) => s.id === id)
  const defaults = AGENT_DEFAULTS.find((a) => a.id === id)!

  if (existing?.status === "running") {
    return NextResponse.json({ error: "Agent already running" }, { status: 409 })
  }

  // Mark as running
  const running: AgentState = {
    ...(existing ?? { ...defaults, lastRunAt: null, lastRunDuration: null, lastError: null, stats: {} }),
    status: "running",
    lastRunAt: new Date().toISOString(),
    lastRunDuration: null,
    lastError: null,
  }
  writeAgentState(running)

  const start = Date.now()

  // Run async, don't await — return immediately so the UI can poll
  runner()
    .then((stats) => {
      writeAgentState({
        ...running,
        status: "success",
        lastRunDuration: Date.now() - start,
        stats,
      })
    })
    .catch((err: Error) => {
      writeAgentState({
        ...running,
        status: "error",
        lastRunDuration: Date.now() - start,
        lastError: err.message ?? "Unknown error",
      })
    })

  return NextResponse.json({ started: true })
}
