import { NextResponse } from "next/server"

// FELLOW_API_KEY must be set in environment — no hardcoded fallback
const FELLOW_API_KEY = process.env.FELLOW_API_KEY
if (!FELLOW_API_KEY) console.warn("[fellow] FELLOW_API_KEY is not set — Fellow API calls will fail")
const FELLOW_BASE = "https://appodeal.fellow.app"

export const dynamic = "force-dynamic"

type FellowItem = {
  id: string
  text: string
  status: "Done" | "Archived" | "Incomplete"
  created_at: string
  updated_at: string
  due_date: string | null
  note_id: string | null
  assignees: Array<{ id: string; full_name: string; email: string }>
  ai_detected: boolean
}

async function fetchItems(completed: boolean, pageSize = 50): Promise<FellowItem[]> {
  const all: FellowItem[] = []
  let cursor: string | null = null
  const MAX_PAGES = 20
  let page = 0

  do {
    const body: Record<string, unknown> = {
      pagination: { page_size: pageSize, ...(cursor ? { cursor } : {}) },
      ordering: { order_by: "created_at_desc" },
      filters: { completed, scope: "assigned_to_me" },
    }

    const res = await fetch(`${FELLOW_BASE}/api/v1/action_items`, {
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
    const items = data.action_items?.data ?? []
    if (items.length === 0) break
    all.push(...items)
    const prevCursor = cursor
    cursor = data.action_items?.page_info?.cursor ?? null
    if (cursor && cursor === prevCursor) break
    page++
  } while (cursor && page < MAX_PAGES)

  return all
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim()
}

function findDuplicates(items: FellowItem[]): Set<string> {
  const dupeIds = new Set<string>()
  const seen = new Map<string, string>() // normalized text → first item id

  for (const item of items) {
    const norm = normalizeText(item.text)
    if (norm.length < 5) continue // skip very short items
    const existing = seen.get(norm)
    if (existing) {
      dupeIds.add(item.id)
      dupeIds.add(existing)
    } else {
      seen.set(norm, item.id)
    }
  }

  return dupeIds
}

function isOverdue(item: FellowItem): boolean {
  if (!item.due_date || item.status === "Done") return false
  return new Date(item.due_date) < new Date()
}

function suggestCompletable(openItems: FellowItem[], doneItems: FellowItem[]): Set<string> {
  // Items that look like they could be marked done:
  // 1. They have a matching done item with very similar text
  // 2. They are duplicates of done items
  const suggestions = new Set<string>()
  const doneNorms = new Set(doneItems.map((d) => normalizeText(d.text)))

  for (const item of openItems) {
    const norm = normalizeText(item.text)
    if (doneNorms.has(norm)) {
      suggestions.add(item.id)
    }
  }

  return suggestions
}

export async function GET() {
  try {
    const [openItems, doneItems] = await Promise.all([
      fetchItems(false),
      fetchItems(true),
    ])

    const allOpen = openItems.filter((i) => i.status !== "Archived")
    const duplicateIds = findDuplicates(allOpen)
    const completableIds = suggestCompletable(allOpen, doneItems)

    const enriched = allOpen.map((item) => ({
      id: item.id,
      text: item.text,
      status: item.status,
      createdAt: item.created_at,
      dueDate: item.due_date,
      overdue: isOverdue(item),
      isDuplicate: duplicateIds.has(item.id),
      suggestComplete: completableIds.has(item.id),
      aiDetected: item.ai_detected,
      assignees: item.assignees.map((a) => a.full_name),
    }))

    // Sort: overdue first, then by due date, then by created date
    enriched.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
      if (a.suggestComplete !== b.suggestComplete) return a.suggestComplete ? -1 : 1
      if (a.isDuplicate !== b.isDuplicate) return a.isDuplicate ? -1 : 1
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      return b.createdAt.localeCompare(a.createdAt)
    })

    return NextResponse.json({
      items: enriched,
      stats: {
        total: allOpen.length,
        overdue: enriched.filter((i) => i.overdue).length,
        duplicates: enriched.filter((i) => i.isDuplicate).length,
        suggestComplete: enriched.filter((i) => i.suggestComplete).length,
        recentlyDone: doneItems.length,
      },
    })
  } catch (e) {
    console.error("[fellow]", e)
    return NextResponse.json({ error: "Failed to load Fellow items" }, { status: 500 })
  }
}
