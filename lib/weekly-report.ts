import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import path from "path"

const REPORT_FILE = path.join(process.cwd(), ".weekly-report.json")

export interface WeeklyReport {
  generatedAt: string
  weekLabel: string
  kpis: {
    qtdNormDau: number
    q1NormDau: number
    thisWeekNormDau: number
    prevWeekNormDau: number
    q2Submissions: number
    q1Submissions: number
    apacNormDau: number
    q1ApacNormDau: number
  }
  insights: string
}

function getWeekLabel(): string {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const weekNo = Math.ceil(
    ((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7
  )
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `W${weekNo} · ${fmt(monday)}–${fmt(sunday)} ${now.getFullYear()}`
}

async function fetchAllData(baseUrl: string) {
  const [kpis, weeklyDau, monthlySubmissions, pipelineStages, emailSplit] =
    await Promise.all([
      fetch(`${baseUrl}/api/self-serve/kpis`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`${baseUrl}/api/self-serve/weekly-dau`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`${baseUrl}/api/self-serve/monthly-submissions`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`${baseUrl}/api/self-serve/pipeline-stages`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`${baseUrl}/api/self-serve/email-split`, { cache: "no-store" }).then((r) => r.json()),
    ])
  return { kpis, weeklyDau, monthlySubmissions, pipelineStages, emailSplit }
}

type FetchedData = Awaited<ReturnType<typeof fetchAllData>>

async function generateInsights(data: FetchedData): Promise<string> {
  const client = new Anthropic()

  const wowChange = data.kpis.prevWeekNormDau > 0
    ? Math.round(((data.kpis.thisWeekNormDau - data.kpis.prevWeekNormDau) / data.kpis.prevWeekNormDau) * 100)
    : 0
  const qoqDauChange = data.kpis.q1NormDau > 0
    ? Math.round(((data.kpis.qtdNormDau - data.kpis.q1NormDau) / data.kpis.q1NormDau) * 100)
    : 0
  const approvalRates = data.monthlySubmissions.map((m: { month: string; approvalRate: number }) =>
    `${m.month}: ${m.approvalRate}%`
  ).join(", ")
  const topStages = (data.pipelineStages as Array<{ name: string; normDau: number; count: number }>)
    .slice(0, 4)
    .map((s) => `${s.name}: ${s.normDau.toLocaleString()} DAU (${s.count} deals)`)
    .join("; ")

  const prompt = `You are a growth analyst for BidMachine's self-serve publisher platform. Write a concise weekly performance report based on this data.

## This Week's Data

**Norm DAU QTD:** ${data.kpis.qtdNormDau.toLocaleString()} (${qoqDauChange > 0 ? "+" : ""}${qoqDauChange}% vs Q1's ${data.kpis.q1NormDau.toLocaleString()})
**This week DAU:** ${data.kpis.thisWeekNormDau.toLocaleString()} (${wowChange > 0 ? "+" : ""}${wowChange}% WoW vs ${data.kpis.prevWeekNormDau.toLocaleString()} last week)
**Q2 Submissions:** ${data.kpis.q2Submissions} (vs Q1: ${data.kpis.q1Submissions})
**APAC DAU:** ${data.kpis.apacNormDau.toLocaleString()} (vs Q1: ${data.kpis.q1ApacNormDau.toLocaleString()}, target: 300,000)
**Monthly approval rates:** ${approvalRates}
**Pipeline stage snapshot:** ${topStages}
**Email split Q2:** Business: ${data.emailSplit?.q2?.business ?? "N/A"}, Free: ${data.emailSplit?.q2?.free ?? "N/A"}

## Instructions

Write exactly 4 sections using this markdown format:

### Summary
2-3 sentences covering the week's overall performance.

### What's Working
- 2-3 bullet points. Each must reference a specific number from the data.

### What's Not Working
- 2-3 bullet points. Each must reference a specific number from the data.

### Recommendations
- 2-3 actionable recommendations. Be specific — name stages, metrics, or regions.

Be direct and analytical. No filler phrases. Under 300 words total.`

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

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  })
}

async function postToSlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
}

function formatDeliveryMessage(report: WeeklyReport): string {
  const wowChange = report.kpis.prevWeekNormDau > 0
    ? Math.round(((report.kpis.thisWeekNormDau - report.kpis.prevWeekNormDau) / report.kpis.prevWeekNormDau) * 100)
    : 0
  const qoqChange = report.kpis.q1NormDau > 0
    ? Math.round(((report.kpis.qtdNormDau - report.kpis.q1NormDau) / report.kpis.q1NormDau) * 100)
    : 0

  return [
    `📊 *Weekly Self-Serve Report — ${report.weekLabel}*`,
    ``,
    `Norm DAU QTD: ${report.kpis.qtdNormDau.toLocaleString()} (${qoqChange >= 0 ? "+" : ""}${qoqChange}% vs Q1)`,
    `This week: ${report.kpis.thisWeekNormDau.toLocaleString()} | Last week: ${report.kpis.prevWeekNormDau.toLocaleString()} (${wowChange >= 0 ? "+" : ""}${wowChange}% WoW)`,
    `Submissions: ${report.kpis.q2Submissions} | APAC DAU: ${report.kpis.apacNormDau.toLocaleString()}`,
    ``,
    report.insights,
  ].join("\n")
}

export async function generateWeeklyReport(baseUrl: string): Promise<WeeklyReport> {
  const data = await fetchAllData(baseUrl)
  const insights = await generateInsights(data)

  const report: WeeklyReport = {
    generatedAt: new Date().toISOString(),
    weekLabel: getWeekLabel(),
    kpis: data.kpis,
    insights,
  }

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2))

  const message = formatDeliveryMessage(report)
  await Promise.all([postToTelegram(message), postToSlack(message)])

  return report
}

export function readWeeklyReport(): WeeklyReport | null {
  if (!fs.existsSync(REPORT_FILE)) return null
  try {
    return JSON.parse(fs.readFileSync(REPORT_FILE, "utf-8"))
  } catch {
    return null
  }
}
