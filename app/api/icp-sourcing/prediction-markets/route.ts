import { NextResponse } from "next/server"
import { runVerticalPipeline } from "@/lib/icp-sourcing"
import type { ICPSourcingResponse } from "@/lib/icp-sourcing"

export async function GET(): Promise<NextResponse<ICPSourcingResponse>> {
  try {
    const candidates = await runVerticalPipeline("prediction-markets")
    return NextResponse.json({
      candidates,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[icp-sourcing/prediction-markets]", err)
    return NextResponse.json(
      { candidates: [], fetchedAt: new Date().toISOString(), error: String(err) },
      { status: 500 },
    )
  }
}
