// app/api/cron/campaigns-weekly-report/route.ts
import { NextRequest, NextResponse } from "next/server"
import { generateCampaignWeeklyReport } from "@/lib/campaigns-weekly-report"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const report = await generateCampaignWeeklyReport()
    return NextResponse.json({ ok: true, weekLabel: report.weekLabel })
  } catch (e) {
    console.error("[cron/campaigns-weekly-report]", e)
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 })
  }
}
