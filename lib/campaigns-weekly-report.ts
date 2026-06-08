// lib/campaigns-weekly-report.ts
import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import path from "path"
import {
  TARGET_CAMPAIGNS,
  fetchAllCampaigns,
  fetchAllCampaignStats,
  fetchAllLeads,
} from "@/lib/lemlist"
import {
  fetchTrickyDeals,
  fetchInboundDeals,
  fetchDealContactEmails,
  matchTrickyDeals,
} from "@/lib/hubspot-campaigns"

const REPORT_FILE = path.join(process.cwd(), ".campaigns-weekly-report.json")

export interface CampaignWeeklyReport {
  generatedAt: string
  weekLabel: string
  kpis: {
    nc:      { sent: number; openRate: number; replyRate: number; mqls: number; sqls: number }
    cu:      { sent: number; openRate: number; replyRate: number; mqls: number; sqls: number }
    inbound: { sent: number; openRate: number; clickRate: number; matched: number }
    totalTrickyOpps: number
  }
  repliedCompanies: {
    nc:      { company: string; email: string }[]
    cu:      { company: string; email: string }[]
    inbound: { company: string; email: string }[]
  }
  insights: string
}

function getWeekLabel(): string {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const weekNo = Math.ceil(
    ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
  )
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `W${weekNo} · ${fmt(monday)}–${fmt(sunday)} ${now.getFullYear()}`
}

async function generateInsights(
  nc:              { sent: number; openRate: number; replyRate: number; mqls: number; sqls: number },
  cu:              { sent: number; openRate: number; replyRate: number; mqls: number; sqls: number },
  inbound:         { sent: number; openRate: number; clickRate: number; matched: number },
  totalTrickyOpps: number,
  ncReplied:       { company: string; email: string }[],
  cuReplied:       { company: string; email: string }[],
  inboundReplied:  { company: string; email: string }[],
  prev:            CampaignWeeklyReport | null,
): Promise<string> {
  const client = new Anthropic()

  const totalMqls   = nc.mqls + cu.mqls
  const mqlCoverage = totalTrickyOpps > 0 ? (totalMqls / totalTrickyOpps * 100).toFixed(0) : "0"
  const ncRepliedList      = ncReplied.slice(0, 8).map((r) => r.company).join(", ")
  const cuRepliedList      = cuReplied.slice(0, 8).map((r) => r.company).join(", ")
  const inboundRepliedList = inboundReplied.slice(0, 8).map((r) => r.company).join(", ")

  let wowSection = ""
  if (prev) {
    const ncMqlDelta     = nc.mqls - prev.kpis.nc.mqls
    const cuMqlDelta     = cu.mqls - prev.kpis.cu.mqls
    const prevNcReplied  = prev.repliedCompanies.nc.length
    const ncRepliedCount = ncReplied.length
    const prevMatched    = prev.kpis.inbound.matched
    const sign = (n: number) => n >= 0 ? "+" : ""
    wowSection = `**WoW vs last week:**
NC: ${sign(ncMqlDelta)}${ncMqlDelta} MQLs, replies ${prevNcReplied}→${ncRepliedCount}
CU: ${sign(cuMqlDelta)}${cuMqlDelta} MQLs
Inbound: matched ${prevMatched}→${inbound.matched}`
  }

  const prompt = `You are a sales performance analyst for BidMachine. Write a concise weekly campaigns report.

## This Week's Data

**NC Campaign (Non-Customers):**
${nc.sent} sent · ${(nc.openRate*100).toFixed(1)}% open · ${(nc.replyRate*100).toFixed(1)}% reply · ${nc.mqls} MQLs · ${nc.sqls} SQLs

**CU Campaign (Customers):**
${cu.sent} sent · ${(cu.openRate*100).toFixed(1)}% open · ${(cu.replyRate*100).toFixed(1)}% reply · ${cu.mqls} MQLs · ${cu.sqls} SQLs

**Inbound Campaign:**
${inbound.sent} sent · ${(inbound.openRate*100).toFixed(1)}% open · ${(inbound.clickRate*100).toFixed(1)}% click · ${inbound.matched} matched to inbound deals

**Tricky Pipeline:**
${totalTrickyOpps} EMEA Tricky Opps total · ${totalMqls} MQLs matched (${mqlCoverage}% coverage)

**Companies that replied to NC:** ${ncRepliedList || "None"}
**Companies that replied to CU:** ${cuRepliedList || "None"}
**Companies that replied to Inbound:** ${inboundRepliedList || "None"}

${wowSection}

## Instructions

Write exactly 4 sections in this markdown format:

### Summary
2-3 sentences on overall campaign health and the strongest performer.

### Reply Signals
- Named companies that replied. Flag any that match an MQL or SQL.

### Pipeline Impact
- MQL/SQL counts, Tricky Opps coverage %, inbound match rate.

### Recommendations
- 2-3 concrete next actions based on the data.

Be direct and analytical. Under 350 words total. No filler.`

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  })

  const block = message.content[0]
  return block.type === "text" ? block.text : ""
}

function formatTelegramMessage(report: CampaignWeeklyReport): string {
  const { kpis: k, repliedCompanies: r } = report
  const totalMqls   = k.nc.mqls + k.cu.mqls
  const mqlCoverage = k.totalTrickyOpps > 0
    ? (totalMqls / k.totalTrickyOpps * 100).toFixed(0)
    : "0"
  return [
    `📊 *Campaigns Report — ${report.weekLabel}*`,
    ``,
    `NC: ${k.nc.sent} sent · ${(k.nc.openRate*100).toFixed(1)}% open · ${r.nc.length} replied · ${k.nc.mqls} MQLs · ${k.nc.sqls} SQLs`,
    `CU: ${k.cu.sent} sent · ${(k.cu.openRate*100).toFixed(1)}% open · ${r.cu.length} replied · ${k.cu.mqls} MQLs · ${k.cu.sqls} SQLs`,
    `Inbound: ${k.inbound.sent} sent · ${(k.inbound.clickRate*100).toFixed(1)}% click · ${k.inbound.matched} matched`,
    `Tricky Opps: ${k.totalTrickyOpps} total · ${mqlCoverage}% MQL coverage`,
    ``,
    report.insights,
  ].join("\n")
}

async function postToTelegram(text: string): Promise<void> {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    })
    if (!res.ok) console.warn("[campaigns-weekly-report/telegram] failed", res.status, await res.text())
  } catch (err) {
    console.warn("[campaigns-weekly-report/telegram] network error", err)
  }
}

export async function generateCampaignWeeklyReport(): Promise<CampaignWeeklyReport> {
  // Read previous report for WoW comparison BEFORE overwriting
  const prev = readCampaignWeeklyReport()

  // ── Step 1: Discover campaign IDs (same pattern as stats route) ──────────
  const allCampaigns = await fetchAllCampaigns()
  const discovered = TARGET_CAMPAIGNS.map((target) => {
    const matches = allCampaigns.filter((c) => c.name.includes(target.match))
    const found   = matches.find((c) => !(c as Record<string, unknown>).archived) ?? matches[0]
    return { key: target.key, id: found?._id ?? null }
  })

  const ncId      = discovered.find((c) => c.key === "nc")?.id
  const cuId      = discovered.find((c) => c.key === "cu")?.id
  const inboundId = discovered.find((c) => c.key === "inbound")?.id

  if (!ncId || !cuId || !inboundId) {
    throw new Error(
      `[campaigns-weekly-report] Missing campaign IDs: nc=${ncId ?? "null"}, cu=${cuId ?? "null"}, inbound=${inboundId ?? "null"}`,
    )
  }

  // ── Step 2: Fetch campaign stats ─────────────────────────────────────────
  const statsMap     = await fetchAllCampaignStats([ncId, cuId, inboundId])
  const ncStats      = statsMap.get(ncId)
  const cuStats      = statsMap.get(cuId)
  const inboundStats = statsMap.get(inboundId)

  if (!ncStats || !cuStats || !inboundStats) {
    throw new Error("[campaigns-weekly-report] Campaign stats failed to load")
  }

  // ── Step 3: Fetch leads for all three campaigns sequentially ─────────────
  const ncLeads      = await fetchAllLeads(ncId)
  const cuLeads      = await fetchAllLeads(cuId)
  const inboundLeads = await fetchAllLeads(inboundId)

  // ── Step 4: Tricky deals + MQL attribution ───────────────────────────────
  const { deals: trickyDeals, total: totalTrickyOpps } = await fetchTrickyDeals()
  const ncAttrib = matchTrickyDeals(ncLeads, trickyDeals)
  const cuAttrib = matchTrickyDeals(cuLeads, trickyDeals)

  // ── Step 5: Inbound email match ──────────────────────────────────────────
  const inboundDeals    = await fetchInboundDeals()
  const inboundEmailSet = new Set(inboundLeads.map((l) => l.email.toLowerCase()))
  const emailCache      = new Map<string, string>()
  let inboundMatchedCount = 0

  for (const deal of inboundDeals) {
    try {
      const emails = await fetchDealContactEmails(deal.id, emailCache)
      if (emails.some((e) => inboundEmailSet.has(e.toLowerCase()))) {
        inboundMatchedCount++
      }
    } catch {
      // skip deals where contact email fetch fails
    }
  }

  // ── Step 6: Replied companies ────────────────────────────────────────────
  const mapReplied = (leads: Awaited<ReturnType<typeof fetchAllLeads>>) =>
    leads
      .filter((l) => l.hasResponded)
      .map((l) => ({
        company: l.companyName ?? l.email.split("@")[1] ?? l.email,
        email:   l.email,
      }))

  const ncReplied      = mapReplied(ncLeads)
  const cuReplied      = mapReplied(cuLeads)
  const inboundReplied = mapReplied(inboundLeads)

  // ── Step 7: KPIs ─────────────────────────────────────────────────────────
  const nc: CampaignWeeklyReport["kpis"]["nc"] = {
    sent:      ncStats.nbEmailsSent,
    openRate:  ncStats.openRate,
    replyRate: ncStats.nbContacted > 0 ? ncStats.nbReplied / ncStats.nbContacted : 0,
    mqls:      ncAttrib.mqls.length,
    sqls:      ncAttrib.sqls.length,
  }
  const cu: CampaignWeeklyReport["kpis"]["cu"] = {
    sent:      cuStats.nbEmailsSent,
    openRate:  cuStats.openRate,
    replyRate: cuStats.nbContacted > 0 ? cuStats.nbReplied / cuStats.nbContacted : 0,
    mqls:      cuAttrib.mqls.length,
    sqls:      cuAttrib.sqls.length,
  }
  const inbound: CampaignWeeklyReport["kpis"]["inbound"] = {
    sent:      inboundStats.nbEmailsSent,
    openRate:  inboundStats.openRate,
    clickRate: inboundStats.clickRate,
    matched:   inboundMatchedCount,
  }

  // ── Step 8: Generate Claude insights ─────────────────────────────────────
  const insights = await generateInsights(
    nc, cu, inbound, totalTrickyOpps,
    ncReplied, cuReplied, inboundReplied,
    prev,
  )

  const report: CampaignWeeklyReport = {
    generatedAt:      new Date().toISOString(),
    weekLabel:        getWeekLabel(),
    kpis:             { nc, cu, inbound, totalTrickyOpps },
    repliedCompanies: { nc: ncReplied, cu: cuReplied, inbound: inboundReplied },
    insights,
  }

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2))
  await postToTelegram(formatTelegramMessage(report))
  return report
}

export function readCampaignWeeklyReport(): CampaignWeeklyReport | null {
  if (!fs.existsSync(REPORT_FILE)) return null
  try {
    const r = JSON.parse(fs.readFileSync(REPORT_FILE, "utf-8"))
    if (
      !r ||
      typeof r.generatedAt !== "string" ||
      typeof r.insights    !== "string" ||
      typeof r.kpis?.nc?.sent !== "number"
    ) return null
    return r as CampaignWeeklyReport
  } catch {
    return null
  }
}
