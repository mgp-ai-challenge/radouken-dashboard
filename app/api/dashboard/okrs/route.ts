import { NextResponse } from "next/server"

const GETOKRS_ORG = "6b23a391-b1cf-4f4a-8f82-151f2fb8782e"
const OBJECTIVE_ID = "1a2f9d6d-d316-4def-b7f7-b1893337543c"

// Radu's objective + its 3 KRs are fetched directly by ID
// The MCP tools require auth via Claude, so we hardcode a periodic snapshot approach
// and expose the data structure the frontend needs.

export const dynamic = "force-dynamic"

type OkrData = {
  objective: {
    title: string
    progress: number
    status: number
  }
  keyResults: Array<{
    id: string
    title: string
    progress: number
    status: number
    metric: {
      name: string
      current: number
      target: number
      start: number
    } | null
  }>
}

// Status codes from GetOKRs
const STATUS_LABELS: Record<number, string> = {
  1: "On Track",
  2: "At Risk",
  3: "Behind",
  4: "Not Started",
  5: "Not Started",
}

export async function GET() {
  // Since GetOKRs API requires MCP auth through Claude, we return the latest
  // snapshot data from the last MCP fetch. In production this would be backed
  // by a cron that calls GetOKRs API with a service token.
  const data: OkrData = {
    objective: {
      title: "Build automated HubSpot/n8n content attribution pipeline",
      progress: 50,
      status: 3,
    },
    keyResults: [
      {
        id: "9f705c0e-1f2b-40ea-9409-cfee5cd84fe1",
        title: "135 total MQLs tracked by Q3 end",
        progress: 0,
        status: 3,
        metric: { name: "Total MQLs generated", current: 94, target: 135, start: 110 },
      },
      {
        id: "d96bbea1-465d-4950-9c64-2912c2238cca",
        title: "4 weekly auto-generated reports in September",
        progress: 75,
        status: 2,
        metric: { name: "Weekly reports", current: 3, target: 4, start: 0 },
      },
      {
        id: "3c74c1f0-07c3-4670-b4ab-f19672459462",
        title: "Weekly pipeline-tagged MQL rate ≥4/week",
        progress: 75,
        status: 2,
        metric: { name: "Pipeline-tagged MQLs/week", current: 3, target: 4, start: 0 },
      },
    ],
  }

  return NextResponse.json({ ...data, statusLabels: STATUS_LABELS })
}
