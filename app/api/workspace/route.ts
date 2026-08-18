import { NextResponse } from "next/server"
import {
  fetchMyJiraTasks,
  fetchMyConfluenceComments,
  fetchMyConfluencePages,
} from "@/lib/atlassian"

export const dynamic = "force-dynamic"

export async function GET() {
  const missingVars = [
    "ATLASSIAN_EMAIL",
    "ATLASSIAN_API_TOKEN",
    "ATLASSIAN_BASE_URL",
    "ATLASSIAN_ACCOUNT_ID",
  ].filter((k) => !process.env[k])

  if (missingVars.length > 0) {
    return NextResponse.json(
      { error: `Missing env vars: ${missingVars.join(", ")}` },
      { status: 401 }
    )
  }

  try {
    const [tasks, comments, pages] = await Promise.all([
      fetchMyJiraTasks(),
      fetchMyConfluenceComments(),
      fetchMyConfluencePages(),
    ])

    return NextResponse.json(
      { tasks, comments, pages, fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=60" } }
    )
  } catch (err) {
    console.error("[workspace]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
