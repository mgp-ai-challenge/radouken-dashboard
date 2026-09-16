import { NextResponse } from "next/server"

const FELLOW_API_KEY = process.env.FELLOW_API_KEY ?? "339ebe810d775fa920d0b2fc60f408551f8972caf55faefff0c280b06873796c"
const FELLOW_BASE = "https://appodeal.fellow.app"

export const dynamic = "force-dynamic"

type FellowNote = {
  id: string
  title: string | null
  content_fellow_markdown: string | null
  event_start: string | null
  event_end: string | null
}

function hasRealAgenda(content: string | null): boolean {
  if (!content) return false
  // Strip the default Fellow template placeholders
  const stripped = content
    .replace(/# Talking Points.*?(?=\n#|\n*$)/s, "")
    .replace(/# Action Items.*?(?=\n#|\n*$)/s, "")
    .replace(/# Notepad.*?(?=\n#|\n*$)/s, "")
    .replace(/- \( \) \n/g, "")
    .replace(/- \[ \] \n/g, "")
    .replace(/- \n/g, "")
    .replace(/<br>[^\n]*/g, "")
    .trim()
  // If after stripping template there's meaningful content (talking points, action items with text)
  return stripped.length > 20
}

async function fetchAllNotes(): Promise<FellowNote[]> {
  const all: FellowNote[] = []
  let cursor: string | null = null

  do {
    const body: Record<string, unknown> = {
      pagination: { page_size: 50, ...(cursor ? { cursor } : {}) },
      include: { content_fellow_markdown: true },
    }

    const res = await fetch(`${FELLOW_BASE}/api/v1/notes`, {
      method: "POST",
      headers: {
        "X-API-KEY": FELLOW_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    if (!res.ok) throw new Error(`Fellow API error: ${res.status}`)

    const data = await res.json()
    const notes = data.notes?.data ?? []
    all.push(...notes)
    cursor = data.notes?.page_info?.cursor ?? null
    // Limit to 200 notes max
    if (all.length >= 200) break
  } while (cursor)

  return all
}

export async function GET() {
  try {
    const notes = await fetchAllNotes()

    // Only look at notes from last 14 days with events
    const twoWeeksAgo = Date.now() - 14 * 86400000
    const recent = notes.filter((n) => {
      if (!n.event_start) return false
      return new Date(n.event_start).getTime() > twoWeeksAgo
    })

    const withoutAgenda = recent
      .filter((n) => !hasRealAgenda(n.content_fellow_markdown))
      .map((n) => ({
        id: n.id,
        title: n.title ?? "Untitled Meeting",
        hasAgenda: false,
        startTime: n.event_start,
      }))
      .sort((a, b) => {
        if (!a.startTime || !b.startTime) return 0
        return new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      })

    const withAgendaCount = recent.length - withoutAgenda.length

    return NextResponse.json({
      total: recent.length,
      withoutAgenda,
      withAgenda: withAgendaCount,
      withoutAgendaCount: withoutAgenda.length,
    })
  } catch (e) {
    console.error("[fellow-meetings]", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
