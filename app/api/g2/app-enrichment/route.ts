import { NextResponse } from "next/server"
import { enrichCompany, type AppEnrichment } from "@/lib/sensortower"

export const dynamic = "force-dynamic"

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<(R | null)[]> {
  const results: (R | null)[] = []
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    const settled = await Promise.allSettled(batch.map(fn))
    for (const r of settled) {
      results.push(r.status === "fulfilled" ? r.value : null)
    }
  }
  return results
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { companies?: Array<{ id: string; name: string }> }
    const companies = body.companies ?? []
    if (companies.length === 0) {
      return NextResponse.json({ enrichments: [] })
    }
    const enrichments = await withConcurrency(
      companies,
      20,
      (c) => enrichCompany(c.id, c.name)
    )
    return NextResponse.json({ enrichments: enrichments.filter(Boolean) as AppEnrichment[] })
  } catch (e) {
    console.error("[g2/app-enrichment]", e)
    return NextResponse.json({ error: "Failed to enrich companies" }, { status: 500 })
  }
}
