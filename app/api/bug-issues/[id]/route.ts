import { NextRequest, NextResponse } from "next/server"
import { readBugIssues, writeBugIssues, IssueStatus, BugIssue } from "@/lib/bug-scanner"

export const dynamic = "force-dynamic"

const VALID_STATUSES: IssueStatus[] = ["open", "in_progress", "fixed", "ignored"]

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { status?: IssueStatus; notes?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status value" }, { status: 400 })
  }

  const store = readBugIssues()
  const idx = store.issues.findIndex((i) => i.id === id)
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const updated: BugIssue = {
    ...store.issues[idx],
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    updatedAt: new Date().toISOString(),
  }
  store.issues[idx] = updated

  try {
    writeBugIssues(store)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  return NextResponse.json(updated)
}
