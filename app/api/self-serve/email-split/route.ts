import { NextResponse } from "next/server"
import { searchDeals } from "@/lib/hubspot-deals"

const PIPELINE = "52357803"
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!

const FREE_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.fr",
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "outlook.com", "outlook.co.uk",
  "icloud.com", "me.com", "mac.com", "live.com", "live.co.uk",
  "aol.com", "mail.com", "protonmail.com", "proton.me",
  "yandex.com", "yandex.ru", "qq.com", "163.com", "126.com",
  "msn.com", "comcast.net", "sbcglobal.net", "verizon.net",
])

function isFreeDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? ""
  return FREE_DOMAINS.has(domain)
}

// Simple in-memory cache (55-second TTL)
let cache: { ts: number; data: unknown } | null = null
const CACHE_TTL = 55_000

async function batchGetContactEmails(dealIds: string[]): Promise<Map<string, string>> {
  const emailMap = new Map<string, string>()
  if (dealIds.length === 0) return emailMap

  // Step 1: batch associations deals → contacts
  const contactIds = new Set<string>()
  const assocMap = new Map<string, string[]>() // dealId → contactIds

  for (let i = 0; i < dealIds.length; i += 100) {
    const chunk = dealIds.slice(i, i + 100)
    const res = await fetch("https://api.hubapi.com/crm/v3/associations/deals/contacts/batch/read", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
      cache: "no-store",
    })
    if (!res.ok) continue
    const data = await res.json()
    for (const item of data.results ?? []) {
      const cids = (item.to ?? []).map((t: { id: string }) => t.id)
      assocMap.set(item.from.id, cids)
      cids.forEach((id: string) => contactIds.add(id))
    }
  }

  if (contactIds.size === 0) return emailMap

  // Step 2: batch read contact emails
  const allContactIds = Array.from(contactIds)
  const contactEmails = new Map<string, string>()

  for (let i = 0; i < allContactIds.length; i += 100) {
    const chunk = allContactIds.slice(i, i + 100)
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })), properties: ["email"] }),
      cache: "no-store",
    })
    if (!res.ok) continue
    const data = await res.json()
    for (const contact of data.results ?? []) {
      const email = contact.properties?.email ?? ""
      if (email) contactEmails.set(contact.id, email)
    }
  }

  // Step 3: map deal → first contact email
  for (const [dealId, cids] of assocMap.entries()) {
    for (const cid of cids) {
      const email = contactEmails.get(cid)
      if (email) {
        emailMap.set(dealId, email)
        break
      }
    }
  }

  return emailMap
}

// Build quarter date ranges for the current year up to today
function buildQuarters() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() // 0-indexed
  const currentQ = Math.floor(currentMonth / 3) + 1 // 1-indexed
  const pad = (n: number) => String(n).padStart(2, "0")

  const quarters = []
  for (let q = 1; q <= currentQ; q++) {
    const startMonth = (q - 1) * 3 + 1
    const endMonth = q * 3 + 1 <= 12 ? q * 3 + 1 : 1
    const endYear = q * 3 + 1 <= 12 ? year : year + 1
    quarters.push({
      label: `Q${q}`,
      start: `${year}-${pad(startMonth)}-01`,
      end:   `${endYear}-${pad(endMonth)}-01`, // exclusive
    })
  }
  return quarters
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  try {
    const quarters = buildQuarters()

    const classify = (emailMap: Map<string, string>, deals: { id: string }[]) => {
      let business = 0, free = 0, unknown = 0
      for (const deal of deals) {
        const email = emailMap.get(deal.id)
        if (!email) { unknown++; continue }
        isFreeDomain(email) ? free++ : business++
      }
      return { business, free, unknown }
    }

    const allDeals = await Promise.all(
      quarters.map(({ start, end }) =>
        searchDeals(
          [
            { propertyName: "pipeline",   operator: "EQ",  value: PIPELINE },
            { propertyName: "createdate", operator: "GTE", value: start },
            { propertyName: "createdate", operator: "LT",  value: end },
          ],
          ["createdate"]
        )
      )
    )

    const allEmails = await Promise.all(
      allDeals.map((deals) => batchGetContactEmails(deals.map((d) => d.id)))
    )

    const data = quarters.map(({ label }, i) => ({
      quarter: label,
      ...classify(allEmails[i], allDeals[i]),
    }))

    cache = { ts: Date.now(), data }
    return NextResponse.json(data)
  } catch (e) {
    console.error("[email-split]", e)
    return NextResponse.json({ error: "Failed to load email split" }, { status: 500 })
  }
}
