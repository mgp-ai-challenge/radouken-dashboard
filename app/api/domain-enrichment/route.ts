import type { NextRequest } from "next/server"
import { parseCSV, resolvePublisherDomain } from "@/lib/domain-enrichment"

export async function POST(request: NextRequest) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid form data" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const file = formData.get("csv")
  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: 'No "csv" file in form data' }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const text = await file.text()
  const { headers, rows } = parseCSV(text)

  if (!headers.includes("Publisher")) {
    return new Response(
      JSON.stringify({ error: 'CSV must contain a "Publisher" column' }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }

  const signal = request.signal
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
      }

      send({ type: "start", total: rows.length })

      const summary = { high: 0, ambiguous: 0, noMatch: 0 }

      for (let i = 0; i < rows.length; i++) {
        if (signal.aborted) {
          send({ type: "cancelled", summary })
          controller.close()
          return
        }

        const row = rows[i]
        const publisher = (row["Publisher"] ?? "").trim()
        const location = (row["Publisher location"] ?? "").trim()

        let domain: string | null = null
        let domain2: string | null = null
        let confidence: "High" | "Ambiguous" | "No match" = "No match"
        let candidates = ""

        if (publisher) {
          try {
            const result = await resolvePublisherDomain(publisher, location)
            domain = result.domain
            domain2 = result.domain2
            confidence = result.confidence
            candidates = result.candidates
          } catch (e) {
            candidates = e instanceof Error ? e.message.slice(0, 200) : String(e)
          }
        }

        if (confidence === "High") summary.high++
        else if (confidence === "Ambiguous") summary.ambiguous++
        else summary.noMatch++

        send({ type: "row", rowIndex: i, publisher, domain, domain2, confidence, candidates })
      }

      send({ type: "done", summary })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
