import { NextResponse } from "next/server"
import { readWeeklyReport } from "@/lib/weekly-report"

export async function GET() {
  const report = readWeeklyReport()
  if (!report) {
    return NextResponse.json(null)
  }
  return NextResponse.json(report)
}
