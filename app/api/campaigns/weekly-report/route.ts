// app/api/campaigns/weekly-report/route.ts
import { NextResponse } from "next/server"
import { readCampaignWeeklyReport, generateCampaignWeeklyReport } from "@/lib/campaigns-weekly-report"

export const dynamic = "force-dynamic"

export async function GET() {
  const report = readCampaignWeeklyReport()
  if (!report) return NextResponse.json({ available: false }, { status: 404 })
  return NextResponse.json(report)
}

export async function POST() {
  try {
    const report = await generateCampaignWeeklyReport()
    return NextResponse.json(report)
  } catch (e) {
    console.error("[campaigns/weekly-report]", e)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
