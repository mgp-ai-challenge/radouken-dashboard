import { NextResponse } from "next/server"
import { readBugIssues } from "@/lib/bug-scanner"

export async function GET() {
  return NextResponse.json(readBugIssues())
}
