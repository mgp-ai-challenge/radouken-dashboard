import { NextRequest, NextResponse } from "next/server"
import { readBugIssues, writeBugIssues, IssueStatus, BugIssue } from "@/lib/bug-scanner"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json() as { status?: IssueStatus; notes?: string }

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
  writeBugIssues(store)

  return NextResponse.json(updated)
}
