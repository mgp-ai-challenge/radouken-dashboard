import fs from "fs"
import path from "path"

export type AgentStatus = "idle" | "running" | "success" | "error"

export interface AgentState {
  id: string
  name: string
  description: string
  schedule: string
  status: AgentStatus
  lastRunAt: string | null
  lastRunDuration: number | null // ms
  lastError: string | null
  stats: Record<string, number | string>
}

export const AGENT_DEFAULTS: Omit<AgentState, "status" | "lastRunAt" | "lastRunDuration" | "lastError" | "stats">[] = [
  {
    id: "lemlist-sync",
    name: "Lemlist Sync",
    description: "Fetches campaigns and leads from Lemlist and stores them locally.",
    schedule: "Every 4 hours",
  },
  {
    id: "hubspot-sync",
    name: "HubSpot Sync",
    description: "Fetches contacts and deals from HubSpot and stores them locally.",
    schedule: "Every 4 hours",
  },
  {
    id: "attribution",
    name: "Attribution",
    description: "Runs attribution analysis on locally stored Lemlist and HubSpot data.",
    schedule: "Every 4 hours",
  },
  {
    id: "communications",
    name: "Communications",
    description: "Builds reports and sends notifications to Slack and other channels.",
    schedule: "Every 4 hours",
  },
  {
    id: "weekly-report",
    name: "Weekly Report",
    description: "Generates the weekly self-serve performance report and delivers it to Telegram and Slack.",
    schedule: "Every Wednesday 9am",
  },
]

const STATE_FILE = path.join(process.cwd(), ".agents-state.json")

export function readAgentStates(): AgentState[] {
  if (!fs.existsSync(STATE_FILE)) {
    return AGENT_DEFAULTS.map((a) => ({
      ...a,
      status: "idle" as AgentStatus,
      lastRunAt: null,
      lastRunDuration: null,
      lastError: null,
      stats: {},
    }))
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8")
    const stored: Record<string, AgentState> = JSON.parse(raw)
    return AGENT_DEFAULTS.map((a) => stored[a.id] ?? {
      ...a,
      status: "idle" as AgentStatus,
      lastRunAt: null,
      lastRunDuration: null,
      lastError: null,
      stats: {},
    })
  } catch {
    return AGENT_DEFAULTS.map((a) => ({
      ...a,
      status: "idle" as AgentStatus,
      lastRunAt: null,
      lastRunDuration: null,
      lastError: null,
      stats: {},
    }))
  }
}

export function writeAgentState(state: AgentState) {
  let stored: Record<string, AgentState> = {}
  if (fs.existsSync(STATE_FILE)) {
    try {
      stored = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"))
    } catch {}
  }
  stored[state.id] = state
  fs.writeFileSync(STATE_FILE, JSON.stringify(stored, null, 2))
}
