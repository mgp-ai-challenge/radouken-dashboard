// app/api/campaigns/attribution/route.ts
import { NextResponse } from "next/server"
import { fetchAllLeads }    from "@/lib/lemlist"
import {
  fetchTrickyDeals,
  fetchInboundDeals,
  fetchDealContactEmails,
  matchTrickyDeals,
  dedupeDeals,
} from "@/lib/hubspot-campaigns"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json() as { nc: string; cu: string; inbound: string }
    const { nc: ncId, cu: cuId, inbound: inboundId } = body

    if (!ncId || !cuId || !inboundId) {
      return NextResponse.json({ error: "nc, cu, and inbound campaign IDs are required" }, { status: 400 })
    }

    // ── Step 1: Fetch all leads sequentially to respect Lemlist rate limit ──
    const ncLeads      = await fetchAllLeads(ncId)
    const cuLeads      = await fetchAllLeads(cuId)
    const inboundLeads = await fetchAllLeads(inboundId)

    // ── Compute replied leads per campaign ─────────────────────────────────
    const ncReplied      = ncLeads.filter((l) => l.hasResponded).map((l) => ({ company: l.companyName ?? l.email, email: l.email }))
    const cuReplied      = cuLeads.filter((l) => l.hasResponded).map((l) => ({ company: l.companyName ?? l.email, email: l.email }))
    const inboundReplied = inboundLeads.filter((l) => l.hasResponded).map((l) => ({ company: l.companyName ?? l.email, email: l.email }))

    // ── Step 2: Fetch HubSpot deals (parallel) ────────────────────────────
    const [{ deals: trickyDeals, total: totalTrickyDeals }, inboundDeals] = await Promise.all([
      fetchTrickyDeals(),
      fetchInboundDeals(),
    ])

    // ── Step 3: MQL attribution (Tricky campaigns) ────────────────────────
    const ncAttrib  = matchTrickyDeals(ncLeads,  trickyDeals)
    const cuAttrib  = matchTrickyDeals(cuLeads,  trickyDeals)

    const combined = {
      mqls: dedupeDeals(ncAttrib.mqls, cuAttrib.mqls),
      sqls: dedupeDeals(ncAttrib.sqls, cuAttrib.sqls),
      lost: dedupeDeals(ncAttrib.lost, cuAttrib.lost),
      totalTrickyDeals,
    }

    // ── Step 4: Inbound email match ───────────────────────────────────────
    const inboundEmailSet = new Set(inboundLeads.map((l) => l.email.toLowerCase()))
    const emailCache = new Map<string, string>()
    let matchedCount = 0
    let skippedDeals = 0

    for (const deal of inboundDeals) {
      try {
        const emails = await fetchDealContactEmails(deal.id, emailCache)
        if (emails.some((e) => inboundEmailSet.has(e.toLowerCase()))) {
          matchedCount++
        }
      } catch {
        skippedDeals++
      }
    }

    return NextResponse.json({
      sentCounts: { nc: ncLeads.length, cu: cuLeads.length, inbound: inboundLeads.length },
      nc:  ncAttrib,
      cu:  cuAttrib,
      combined,
      inbound: {
        matchedCount,
        totalInboundDeals: inboundDeals.length,
        skippedDeals,
      },
      ncReplied,
      cuReplied,
      inboundReplied,
    })
  } catch (err) {
    console.error("[campaigns/attribution]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
