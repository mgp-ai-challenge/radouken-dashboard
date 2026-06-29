import { NextRequest, NextResponse } from "next/server"

import { companyFromLemlistContactFields } from "@/lib/lemlist-company"

const LEMLIST_KEY = process.env.LEMLIST_API_KEY!
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!
const LEMLIST_AUTH = "Basic " + Buffer.from(":" + LEMLIST_KEY).toString("base64")

// HubSpot deal stage map (Bidmachine: Supply Sales & AM pipeline)
const DEAL_STAGE_MAP: Record<string, string> = {
  "1278450782": "Lead",
  "1157536": "Marketing Qualified Lead",
  "1855526": "Sales Prospecting",
  "1574904": "Sales Qualified Lead",
  "961283": "Sales Proposal",
  "1295831362": "Internal Review and Approval",
}

async function fetchAllLeads(campaignId: string) {
  const leads: Array<{ _id: string; state: string; contactId: string }> = []
  let offset = 0
  const limit = 100
  while (true) {
    const res = await fetch(
      `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: LEMLIST_AUTH }, cache: "no-store" }
    )
    if (!res.ok) break
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    leads.push(...batch)
    if (batch.length < limit) break
    offset += limit
  }
  return leads
}

async function fetchContact(contactId: string) {
  const res = await fetch(`https://api.lemlist.com/api/contacts/${contactId}`, {
    headers: { Authorization: LEMLIST_AUTH },
    cache: "no-store",
  })
  if (!res.ok) return null
  return res.json()
}

async function fetchClickedEmails(campaignId: string): Promise<Set<string>> {
  const clicked = new Set<string>()
  let offset = 0
  const limit = 100
  while (true) {
    const res = await fetch(
      `https://api.lemlist.com/api/activities?campaignId=${campaignId}&type=emailsClicked&limit=${limit}&offset=${offset}`,
      { headers: { Authorization: LEMLIST_AUTH }, cache: "no-store" }
    )
    if (!res.ok) break
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const act of batch) {
      if (act.contactId) clicked.add(act.contactId)
    }
    if (batch.length < limit) break
    offset += limit
  }
  return clicked
}

async function batchSearchHubspotContacts(emails: string[]) {
  const emailMap: Record<string, { contactId: string; dealStage: string | null; dealName: string | null; hubspotUrl: string | null }> = {}
  if (emails.length === 0) return emailMap

  // HubSpot batch search: max 100 per request
  const chunks: string[][] = []
  for (let i = 0; i < emails.length; i += 100) {
    chunks.push(emails.slice(i, i + 100))
  }

  for (const chunk of chunks) {
    const body = {
      filterGroups: chunk.map((email) => ({
        filters: [{ propertyName: "email", operator: "EQ", value: email }],
      })),
      properties: ["email", "firstname", "lastname"],
      limit: 100,
    }
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })
    if (!res.ok) continue
    const data = await res.json()

    // For each found contact, fetch their deals
    const dealPromises = (data.results || []).map(async (contact: { id: string; properties: { email: string }; url: string }) => {
      const assocRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${contact.id}/associations/deals`,
        { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` }, cache: "no-store" }
      )
      if (!assocRes.ok) {
        emailMap[contact.properties.email] = { contactId: contact.id, dealStage: null, dealName: null, hubspotUrl: contact.url }
        return
      }
      const assocData = await assocRes.json()
      const dealIds: string[] = (assocData.results || []).map((r: { id: string }) => r.id)

      if (dealIds.length === 0) {
        emailMap[contact.properties.email] = { contactId: contact.id, dealStage: null, dealName: null, hubspotUrl: contact.url }
        return
      }

      // Get the most recent deal
      const dealRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/deals/${dealIds[0]}?properties=dealname,dealstage,pipeline`,
        { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` }, cache: "no-store" }
      )
      if (!dealRes.ok) {
        emailMap[contact.properties.email] = { contactId: contact.id, dealStage: null, dealName: null, hubspotUrl: contact.url }
        return
      }
      const deal = await dealRes.json()
      emailMap[contact.properties.email] = {
        contactId: contact.id,
        dealStage: DEAL_STAGE_MAP[deal.properties.dealstage] ?? deal.properties.dealstage ?? null,
        dealName: deal.properties.dealname ?? null,
        hubspotUrl: `https://app.hubspot.com/contacts/5606823/record/0-3/${dealIds[0]}`,
      }
    })
    await Promise.all(dealPromises)
  }

  return emailMap
}

export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId")
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 })

  // 1. Fetch all leads
  const leads = await fetchAllLeads(campaignId)

  // 2. Fetch clicked contact IDs
  const clickedIds = await fetchClickedEmails(campaignId)

  // 3. Fetch contact details in parallel batches of 10
  const contacts: Array<{
    leadId: string
    leadState: string
    contactId: string
    email: string
    firstName: string
    lastName: string
    jobTitle: string
    company: string
    usdau: string
    linkedinUrl: string
    campaigns: string[]
    clicked: boolean
  }> = []

  const batchSize = 10
  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map(async (lead) => {
        const contact = await fetchContact(lead.contactId)
        if (!contact) return null
        return {
          leadId: lead._id,
          leadState: lead.state,
          contactId: lead.contactId,
          email: contact.email ?? "",
          firstName: contact.fields?.firstName ?? "",
          lastName: contact.fields?.lastName ?? "",
          jobTitle: contact.fields?.jobTitle ?? "",
          company: companyFromLemlistContactFields(contact.fields as Record<string, unknown>),
          usdau: contact.fields?.uSDAU ?? "",
          linkedinUrl: contact.linkedinUrl ?? "",
          campaigns: (contact.campaigns ?? []).map((c: { campaignId: string }) => c.campaignId),
          clicked: clickedIds.has(lead.contactId),
        }
      })
    )
    contacts.push(...results.filter(Boolean) as typeof contacts)
  }

  // 4. Batch search HubSpot
  const emails = contacts.map((c) => c.email).filter(Boolean)
  const hubspotData = await batchSearchHubspotContacts(emails)

  // 5. Merge
  const rows = contacts.map((c) => ({
    ...c,
    hubspot: hubspotData[c.email] ?? null,
    bdOverlap: c.campaigns.length > 1,
  }))

  return NextResponse.json({ rows })
}
