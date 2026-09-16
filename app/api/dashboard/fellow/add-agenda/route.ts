import { NextRequest, NextResponse } from "next/server"

const FELLOW_API_KEY = process.env.FELLOW_API_KEY ?? "339ebe810d775fa920d0b2fc60f408551f8972caf55faefff0c280b06873796c"
const FELLOW_BASE = "https://appodeal.fellow.app"

function generateAgenda(title: string): string {
  const lower = title.toLowerCase()

  // Pattern-match common meeting types and generate contextual agendas
  if (lower.includes("weekly") || lower.includes("sync") || lower.includes("standup") || lower.includes("stand-up")) {
    return [
      "- ( ) Updates since last meeting",
      "",
      "- ( ) Blockers & dependencies",
      "",
      "- ( ) Priorities for this week",
      "",
      "- ( ) Action items review",
      "",
    ].join("\n")
  }

  if (lower.includes("1:1") || lower.includes("1-1") || lower.includes("one on one") || lower.includes("check-in")) {
    return [
      "- ( ) How are things going?",
      "",
      "- ( ) Progress on current priorities",
      "",
      "- ( ) Blockers or concerns",
      "",
      "- ( ) Feedback & development",
      "",
      "- ( ) Action items",
      "",
    ].join("\n")
  }

  if (lower.includes("review") || lower.includes("retro") || lower.includes("retrospective")) {
    return [
      "- ( ) What went well",
      "",
      "- ( ) What could be improved",
      "",
      "- ( ) Key learnings",
      "",
      "- ( ) Action items for next cycle",
      "",
    ].join("\n")
  }

  if (lower.includes("planning") || lower.includes("sprint") || lower.includes("kickoff") || lower.includes("kick-off")) {
    return [
      "- ( ) Goals & objectives",
      "",
      "- ( ) Scope & deliverables",
      "",
      "- ( ) Timeline & milestones",
      "",
      "- ( ) Risks & dependencies",
      "",
      "- ( ) Assignments & owners",
      "",
    ].join("\n")
  }

  if (lower.includes("brainstorm") || lower.includes("ideation") || lower.includes("workshop")) {
    return [
      "- ( ) Problem statement / context",
      "",
      "- ( ) Idea generation",
      "",
      "- ( ) Evaluation & prioritization",
      "",
      "- ( ) Next steps",
      "",
    ].join("\n")
  }

  if (lower.includes("marketing") || lower.includes("campaign") || lower.includes("content")) {
    return [
      "- ( ) Campaign / content updates",
      "",
      "- ( ) Metrics & performance review",
      "",
      "- ( ) Upcoming initiatives",
      "",
      "- ( ) Blockers & resource needs",
      "",
      "- ( ) Action items",
      "",
    ].join("\n")
  }

  if (lower.includes("sales") || lower.includes("pipeline") || lower.includes("deal")) {
    return [
      "- ( ) Pipeline review",
      "",
      "- ( ) Key deals update",
      "",
      "- ( ) Blockers & support needed",
      "",
      "- ( ) Action items",
      "",
    ].join("\n")
  }

  if (lower.includes("event") || lower.includes("dmexco") || lower.includes("conference") || lower.includes("cab")) {
    return [
      "- ( ) Event logistics update",
      "",
      "- ( ) Agenda & speakers",
      "",
      "- ( ) Materials & collateral status",
      "",
      "- ( ) Open items & deadlines",
      "",
      "- ( ) Action items",
      "",
    ].join("\n")
  }

  // Default generic agenda
  return [
    `- ( ) Context & objectives`,
    "",
    "- ( ) Discussion points",
    "",
    "- ( ) Decisions needed",
    "",
    "- ( ) Action items & next steps",
    "",
  ].join("\n")
}

export async function POST(req: NextRequest) {
  try {
    const { noteId, title } = await req.json()

    if (!noteId) {
      return NextResponse.json({ error: "noteId required" }, { status: 400 })
    }

    const agenda = generateAgenda(title ?? "Meeting")

    const res = await fetch(`${FELLOW_BASE}/api/v1/note/${noteId}/agenda/prepend`, {
      method: "POST",
      headers: {
        "X-API-KEY": FELLOW_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content_fellow_markdown: agenda }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Fellow API error ${res.status}: ${text}`)
    }

    const data = await res.json()
    return NextResponse.json({ success: true, agenda: data })
  } catch (e) {
    console.error("[fellow-add-agenda]", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
