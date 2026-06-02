import { NextResponse } from "next/server"
import { readBugIssues } from "@/lib/bug-scanner"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(readBugIssues())
}
