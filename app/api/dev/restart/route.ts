import { NextResponse } from "next/server"

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Only available in development" }, { status: 403 })
  }
  // Delay slightly so the response can be sent before process exits
  setTimeout(() => process.exit(0), 100)
  return NextResponse.json({ restarting: true })
}
