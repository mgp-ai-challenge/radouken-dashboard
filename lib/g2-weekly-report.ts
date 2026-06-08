// lib/g2-weekly-report.ts
import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import path from "path"

const REPORT_FILE = path.join(process.cwd(), ".g2-weekly-report.json")

export interface G2WeeklyReport {
  generatedAt: string
  weekLabel: string
  kpis: {
    qualifiedThisWeek: number
    qualifiedLastWeek: number
    newThisWeek: number
    escalatedCount: number
    hotCount?: number
  }
  insights: string
}

interface IntentCompany {
  id: string
  name: string
  lifecycleStage: string | null
  buyingStage: string | null
  activityLevel: string | null
  productName: string | null
  relatedProducts: string[]
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean)
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

async function fetchIntentWindow(afterMs: number, beforeMs: number): Promise<IntentCompany[]> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not set")

  const all: IntentCompany[] = []
  let after: string | undefined

  while (true) {
    const body: Record<string, unknown> = {
      filterGroups: [{
        filters: [
          { propertyName: "g2_buyer_intent_activity_level", operator: "HAS_PROPERTY" },
          { propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(afterMs) },
          { propertyName: "hs_lastmodifieddate", operator: "LTE", value: String(beforeMs) },
        ],
      }],
      properties: [
        "name", "g2_buyer_intent_activity_level", "g2_buyer_intent_buying_stage",
        "hs_lastmodifieddate", "lifecyclestage", "g2_product_name", "g2_related_products",
      ],
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
      limit: 100,
      ...(after ? { after } : {}),
    }

    const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    if (!res.ok) {
      if (res.status === 400) {
        console.warn("[g2-weekly-report] HubSpot 400 — G2 integration may be inactive or filter invalid")
        break
      }
      throw new Error(`HubSpot intent search → ${res.status}`)
    }

    const data = await res.json() as {
      results: Array<{ id: string; properties: Record<string, string | null> }>
      paging?: { next?: { after: string } }
    }

    for (const c of data.results ?? []) {
      all.push({
        id: c.id,
        name: c.properties.name ?? "",
        lifecycleStage: c.properties.lifecyclestage ?? null,
        buyingStage: c.properties.g2_buyer_intent_buying_stage ?? null,
        activityLevel: c.properties.g2_buyer_intent_activity_level ?? null,
        productName: c.properties.g2_product_name ?? null,
        relatedProducts: parseList(c.properties.g2_related_products),
      })
    }

    after = data.paging?.next?.after
    if (!after) break
  }

  return all
}

function isQualified(co: IntentCompany): boolean {
  return !!co.lifecycleStage && co.lifecycleStage.trim() !== ""
}

const STAGE_RANK: Record<string, number> = { awareness: 1, consideration: 2, decision: 3 }
const ACTIVITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 }

function didEscalate(prev: IntentCompany, curr: IntentCompany): boolean {
  const stageUp =
    (STAGE_RANK[curr.buyingStage ?? ""] ?? 0) > (STAGE_RANK[prev.buyingStage ?? ""] ?? 0)
  const activityUp =
    (ACTIVITY_RANK[curr.activityLevel ?? ""] ?? 0) > (ACTIVITY_RANK[prev.activityLevel ?? ""] ?? 0)
  return stageUp || activityUp
}

function topProducts(companies: IntentCompany[], n = 5): string[] {
  const tally = new Map<string, number>()
  for (const co of companies) {
    const seen = new Set<string>()
    if (co.productName) seen.add(co.productName)
    for (const p of co.relatedProducts) seen.add(p)
    for (const name of seen) tally.set(name, (tally.get(name) ?? 0) + 1)
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => `${name} × ${count}`)
}

function fitScore(co: IntentCompany): number {
  let score = 0
  if (co.activityLevel === "high")        score += 40
  else if (co.activityLevel === "medium") score += 25
  else if (co.activityLevel === "low")    score += 10
  if (co.buyingStage === "decision")           score += 25
  else if (co.buyingStage === "consideration") score += 15
  else if (co.buyingStage === "awareness")     score += 5
  const ls = co.lifecycleStage?.toLowerCase() ?? ""
  if      (ls === "opportunity")              score += 20
  else if (ls === "salesqualifiedlead")       score += 15
  else if (ls === "marketingqualifiedlead")   score += 10
  else if (ls === "lead" || ls === "subscriber") score += 5
  if (co.relatedProducts.length > 0 || co.productName) score += 5
  return score
}

async function generateInsights(
  thisWeek: IntentCompany[],
  lastWeek: IntentCompany[],
  newEntrants: IntentCompany[],
  escalated: Array<{ prev: IntentCompany; curr: IntentCompany }>,
): Promise<string> {
  const client = new Anthropic()

  const wowDelta = thisWeek.length - lastWeek.length
  const productsThis = topProducts(thisWeek)
  const productsLastNames = new Set(topProducts(lastWeek).map((s) => s.split(" × ")[0]))
  const productsAnnotated = productsThis.map((p) => {
    const name = p.split(" × ")[0]
    return productsLastNames.has(name) ? p : `★ ${p}`
  })

  const newList = newEntrants
    .slice(0, 8)
    .map(
      (co) =>
        `- ${co.name} (${co.lifecycleStage}, ${co.buyingStage ?? "unknown stage"}${co.productName ? `, researching ${co.productName}` : ""})`,
    )
    .join("\n")

  const escalatedList = escalated
    .slice(0, 6)
    .map(({ prev, curr }) => {
      const changes: string[] = []
      if (
        (STAGE_RANK[curr.buyingStage ?? ""] ?? 0) >
        (STAGE_RANK[prev.buyingStage ?? ""] ?? 0)
      ) {
        changes.push(`${prev.buyingStage ?? "?"} → ${curr.buyingStage}`)
      }
      if (
        (ACTIVITY_RANK[curr.activityLevel ?? ""] ?? 0) >
        (ACTIVITY_RANK[prev.activityLevel ?? ""] ?? 0)
      ) {
        changes.push(`activity ${prev.activityLevel ?? "?"} → ${curr.activityLevel}`)
      }
      return `- ${curr.name} (${curr.lifecycleStage}): ${changes.join(", ")}`
    })
    .join("\n")

  const prompt = `You are a sales intelligence analyst for BidMachine. Write a concise weekly G2 buyer intent report.

## This Week's Data

**Qualified signals:** ${thisWeek.length} this week vs ${lastWeek.length} last week (${wowDelta >= 0 ? "+" : ""}${wowDelta} WoW)
**New companies:** ${newEntrants.length}
**Escalations:** ${escalated.length}

**New this week (qualified companies with new intent signals):**
${newList || "None"}

**Escalations (stage or activity moved up):**
${escalatedList || "None"}

**Top researched competitor products (★ = new vs last week):**
${productsAnnotated.join(", ") || "No data"}

## Instructions

Write exactly 4 sections in this markdown format:

### Summary
2-3 sentences on overall signal health and the WoW change.

### New This Week
- Named companies with lifecycle stage, buying stage, and what they are researching. If none, say so.

### Escalations to Watch
- Named companies with what changed. If none, say so.

### Competitive Signals
- Top researched products. Flag ★ new ones. Note any patterns.

Be direct and analytical. Under 350 words total. No filler.`

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  })

  const block = message.content[0]
  return block.type === "text" ? block.text : ""
}

async function postToTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    })
    if (!res.ok) console.warn("[g2-weekly-report/telegram] failed", res.status, await res.text())
  } catch (err) {
    console.warn("[g2-weekly-report/telegram] network error", err)
  }
}

function formatTelegramMessage(report: G2WeeklyReport): string {
  const wowDelta = report.kpis.qualifiedThisWeek - report.kpis.qualifiedLastWeek
  return [
    `📊 *G2 Intent Report — ${report.weekLabel}*`,
    ``,
    `Qualified signals: ${report.kpis.qualifiedThisWeek} this week (was ${report.kpis.qualifiedLastWeek}, ${wowDelta >= 0 ? "+" : ""}${wowDelta} WoW)`,
    `New companies: ${report.kpis.newThisWeek} | Escalations: ${report.kpis.escalatedCount}${report.kpis.hotCount !== undefined ? ` | 🔥 Hot: ${report.kpis.hotCount}` : ""}`,
    ``,
    report.insights,
  ].join("\n")
}

export async function generateG2WeeklyReport(): Promise<G2WeeklyReport> {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  const [thisWeekRaw, lastWeekRaw] = await Promise.all([
    fetchIntentWindow(now - 7 * day, now),
    fetchIntentWindow(now - 14 * day, now - 7 * day),
  ])

  const thisWeek = thisWeekRaw.filter(isQualified)
  const lastWeek = lastWeekRaw.filter(isQualified)

  const lastWeekMap = new Map(lastWeek.map((co) => [co.id, co]))
  const newEntrants = thisWeek.filter((co) => !lastWeekMap.has(co.id))
  const escalated = thisWeek
    .filter((co) => lastWeekMap.has(co.id))
    .map((curr) => ({ prev: lastWeekMap.get(curr.id)!, curr }))
    .filter(({ prev, curr }) => didEscalate(prev, curr))

  const hotCount = thisWeek.filter((co) => fitScore(co) >= 76).length

  const insights = await generateInsights(thisWeek, lastWeek, newEntrants, escalated)

  const report: G2WeeklyReport = {
    generatedAt: new Date().toISOString(),
    weekLabel: getWeekLabel(),
    kpis: {
      qualifiedThisWeek: thisWeek.length,
      qualifiedLastWeek: lastWeek.length,
      newThisWeek: newEntrants.length,
      escalatedCount: escalated.length,
      hotCount,
    },
    insights,
  }

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2))
  await postToTelegram(formatTelegramMessage(report))
  return report
}

export function readG2WeeklyReport(): G2WeeklyReport | null {
  if (!fs.existsSync(REPORT_FILE)) return null
  try {
    const r = JSON.parse(fs.readFileSync(REPORT_FILE, "utf-8"))
    if (
      !r ||
      typeof r.generatedAt !== "string" ||
      typeof r.insights !== "string" ||
      typeof r.kpis?.qualifiedThisWeek !== "number"
    ) return null
    return r as G2WeeklyReport
  } catch {
    return null
  }
}
