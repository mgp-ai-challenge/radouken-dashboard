import { NextRequest, NextResponse } from "next/server"

// FELLOW_API_KEY must be set in environment — no hardcoded fallback
const FELLOW_API_KEY = process.env.FELLOW_API_KEY
if (!FELLOW_API_KEY) console.warn("[fellow/complete] FELLOW_API_KEY is not set — Fellow API calls will fail")
const FELLOW_BASE = "https://appodeal.fellow.app"

export async function POST(req: NextRequest) {
  try {
    const { itemId, completed } = await req.json()

    if (!itemId) {
      return NextResponse.json({ error: "itemId required" }, { status: 400 })
    }

    const res = await fetch(`${FELLOW_BASE}/api/v1/action_item/${itemId}/complete`, {
      method: "POST",
      headers: {
        "X-API-KEY": FELLOW_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ completed: completed ?? true }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Fellow API error ${res.status}: ${text}`)
    }

    const data = await res.json()
    return NextResponse.json({ success: true, item: data })
  } catch (e) {
    console.error("[fellow-complete]", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
