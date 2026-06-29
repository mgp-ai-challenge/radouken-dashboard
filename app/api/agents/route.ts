import { NextResponse } from "next/server"
import { readAgentStates } from "@/lib/agents"

export async function GET() {
  const states = readAgentStates()
  return NextResponse.json(states)
}
