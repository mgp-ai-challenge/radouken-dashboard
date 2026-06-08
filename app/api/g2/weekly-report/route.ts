// app/api/g2/weekly-report/route.ts
import { NextResponse } from "next/server"
import { readG2WeeklyReport, generateG2WeeklyReport } from "@/lib/g2-weekly-report"

export const dynamic = "force-dynamic"

export async function GET() {
  const report = readG2WeeklyReport()
  return NextResponse.json(report)
}

export async function POST() {
  try {
    const report = await generateG2WeeklyReport()
    return NextResponse.json(report)
  } catch (e) {
    console.error("[g2/weekly-report]", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
