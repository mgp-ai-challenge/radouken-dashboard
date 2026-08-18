// lib/atlassian.ts

const BASE   = process.env.ATLASSIAN_BASE_URL   ?? ""
const EMAIL  = process.env.ATLASSIAN_EMAIL       ?? ""
const TOKEN  = process.env.ATLASSIAN_API_TOKEN   ?? ""
const ACCT   = process.env.ATLASSIAN_ACCOUNT_ID  ?? ""

function authHeader() {
  return "Basic " + Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")
}

async function atlassianFetch(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
    next: { revalidate: 120 }, // 2-minute cache
  })
  if (!res.ok) throw new Error(`Atlassian API error ${res.status}: ${path}`)
  return res.json()
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type JiraStatus = "In Progress" | "To Do" | "Open" | "Done"

export interface JiraTask {
  key: string
  summary: string
  status: JiraStatus
  type: "Task" | "Sub-task"
  updated: string
}

export interface ConfluenceComment {
  id: string
  page: string
  snippet: string
  author: string
  date: string
  url: string
  urgent: boolean
}

export interface ConfluencePage {
  id: string
  title: string
  space: string
  date: string
  url: string
}

// ─── Jira ─────────────────────────────────────────────────────────────────────

export async function fetchMyJiraTasks(): Promise<JiraTask[]> {
  const jql = encodeURIComponent(
    "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
  )
  const data = await atlassianFetch(
    `/rest/api/3/search?jql=${jql}&fields=summary,status,issuetype,updated&maxResults=50`
  )

  const doneJql = encodeURIComponent(
    "assignee = currentUser() AND statusCategory = Done ORDER BY updated DESC"
  )
  const doneData = await atlassianFetch(
    `/rest/api/3/search?jql=${doneJql}&fields=summary,status,issuetype,updated&maxResults=20`
  )

  return [...data.issues, ...doneData.issues].map((issue: any) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: normaliseStatus(issue.fields.status.name),
    type: issue.fields.issuetype.subtask ? "Sub-task" : "Task",
    updated: formatDate(issue.fields.updated),
  }))
}

function normaliseStatus(raw: string): JiraStatus {
  if (raw === "In Progress")  return "In Progress"
  if (raw === "To Do")        return "To Do"
  if (raw === "Done" || raw === "Closed" || raw === "Resolved") return "Done"
  return "Open"
}

// ─── Confluence ───────────────────────────────────────────────────────────────

export async function fetchMyConfluenceComments(): Promise<ConfluenceComment[]> {
  const cql = encodeURIComponent(
    `type = comment AND mention = "${ACCT}" ORDER BY created DESC`
  )
  const data = await atlassianFetch(
    `/wiki/rest/api/search?cql=${cql}&limit=20&expand=content.space,content.history`
  )

  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000

  return (data.results ?? []).map((r: any) => {
    const created = new Date(r.content?.history?.createdDate ?? r.lastModified)
    const spaceKey = r.content?.space?.key ?? ""
    return {
      id: r.content?.id ?? r.id,
      page: r.content?.title ?? r.title ?? "Untitled",
      snippet: r.excerpt?.replace(/<[^>]+>/g, "").trim() ?? "",
      author: r.content?.history?.createdBy?.displayName ?? "Unknown",
      date: formatDate(created.toISOString()),
      url: `${BASE}/wiki${r.content?._links?.webui ?? ""}`,
      urgent: created.getTime() > fourteenDaysAgo && spaceKey === "MGP",
    }
  })
}

export async function fetchMyConfluencePages(): Promise<ConfluencePage[]> {
  const cql = encodeURIComponent(
    `type = page AND mention = "${ACCT}" ORDER BY lastmodified DESC`
  )
  const data = await atlassianFetch(
    `/wiki/rest/api/search?cql=${cql}&limit=10&expand=space`
  )

  return (data.results ?? []).map((r: any) => ({
    id: r.content?.id ?? r.id,
    title: r.title ?? "Untitled",
    space: r.space?.name ?? r.content?.space?.name ?? "",
    date: formatDate(r.lastModified),
    url: `${BASE}/wiki${r._links?.webui ?? ""}`,
  }))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}
