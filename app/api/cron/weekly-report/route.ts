import { NextRequest, NextResponse } from "next/server"
import { generateWeeklyReport } from "@/lib/weekly-report"

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get("authorization")

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"

  try {
    const report = await generateWeeklyReport(baseUrl)
    return NextResponse.json({ ok: true, weekLabel: report.weekLabel })
  } catch (e) {
    console.error("[cron/weekly-report]", e)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
