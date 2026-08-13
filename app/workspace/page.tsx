"use client"

import { useState } from "react"
import { ExternalLink, Plus, CheckCircle2, Clock, Circle, MessageSquare, FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

// ─── Data ─────────────────────────────────────────────────────────────────────

const JIRA_BASE = "https://appodeal.atlassian.net/browse"

type JiraStatus = "In Progress" | "To Do" | "Open" | "Done"

interface JiraTask {
  key: string
  summary: string
  status: JiraStatus
  type: "Task" | "Sub-task"
  updated: string
}

const JIRA_TASKS: JiraTask[] = [
  { key: "GT-25", summary: "Flyers and Tabletents for the Whitepaper - State of Brand Demand", status: "In Progress", type: "Sub-task", updated: "Aug 12" },
  { key: "GT-10", summary: "Digital Account Completion",                                        status: "In Progress", type: "Sub-task", updated: "Jul 23" },
  { key: "GT-2",  summary: "Publisher Sign up page optimisation",                               status: "In Progress", type: "Task",     updated: "Jul 23" },
  { key: "GT-4",  summary: "Review & change the copy of the form",                              status: "In Progress", type: "Sub-task", updated: "Jul 23" },
  { key: "GT-1",  summary: "Budget Spent TD",                                                   status: "In Progress", type: "Task",     updated: "Jul 23" },
  { key: "GT-9",  summary: "DMEXCO 2026",                                                       status: "In Progress", type: "Task",     updated: "Jun 29" },
  { key: "GT-23", summary: "Q3 Inbound Campaign",                                               status: "To Do",       type: "Sub-task", updated: "Jul 23" },
  { key: "GT-22", summary: "Outbounding Campaigns",                                             status: "Open",        type: "Task",     updated: "Jul 23" },
  { key: "GT-20", summary: "Data Cleanup",                                                      status: "Open",        type: "Task",     updated: "Jul 23" },
  { key: "GT-21", summary: "Review Max numbers in Pivot vs Reality",                            status: "To Do",       type: "Sub-task", updated: "Jul 23" },
  { key: "GT-19", summary: "After sync and review / Paul - Ryan - Radu",                        status: "To Do",       type: "Sub-task", updated: "Jul 23" },
  { key: "GT-17", summary: "Checking for Opportunities on both Hotel Lobby and Booth (Prices)", status: "Done",        type: "Sub-task", updated: "Aug 12" },
  { key: "GT-12", summary: "Booth Setup",                                                       status: "Done",        type: "Sub-task", updated: "Aug 12" },
  { key: "GT-5",  summary: "SelfServe Processes",                                               status: "Done",        type: "Task",     updated: "Aug 12" },
  { key: "GT-18", summary: "Confirm with Ilyia if there is any other spend on Appodeal",        status: "Done",        type: "Sub-task", updated: "Aug 12" },
  { key: "GT-14", summary: "New Pub sign - Needs for Demand team",                              status: "Done",        type: "Task",     updated: "Jul 3"  },
  { key: "GT-16", summary: "Weather Channel - Media kit",                                       status: "Done",        type: "Sub-task", updated: "Jul 3"  },
  { key: "GT-15", summary: "Discuss with Paul",                                                 status: "Done",        type: "Sub-task", updated: "Jul 3"  },
  { key: "GT-11", summary: "Tickets Assigned",                                                  status: "Done",        type: "Sub-task", updated: "Jul 3"  },
  { key: "GT-7",  summary: "Change comms for Google Admob",                                     status: "Done",        type: "Sub-task", updated: "Jul 3"  },
  { key: "GT-8",  summary: "Automation for Auto deny low DAU admob deals",                      status: "Done",        type: "Sub-task", updated: "Jul 3"  },
  { key: "GT-13", summary: "Create a Slack thread for Ironsource DAU data",                     status: "Done",        type: "Sub-task", updated: "Jul 3"  },
  { key: "GT-6",  summary: "Add Email comms for Denied - Low Rating",                           status: "Done",        type: "Sub-task", updated: "Jun 30" },
  { key: "GT-3",  summary: "Add G2 testimonials & Logo Reel on the landing page",               status: "Done",        type: "Sub-task", updated: "Jun 17" },
]

interface ConfluenceComment {
  id: string
  page: string
  snippet: string
  author: string
  date: string
  url: string
  urgent: boolean
}

interface ConfluencePage {
  id: string
  title: string
  space: string
  date: string
  url: string
}

const CONFLUENCE_COMMENTS: ConfluenceComment[] = [
  {
    id: "c1",
    page: "Q3 content and comms plan",
    snippet: "Mark wants us to get this promotion up and running sooner — let's discuss getting something together in the next couple of weeks and promoting it to drive meeting signups.",
    author: "Ryan Barrett Christopher",
    date: "Aug 4",
    url: "https://appodeal.atlassian.net/wiki/spaces/MGP/pages/6982926360/Q3+content+and+comms+plan?focusedCommentId=7106330758",
    urgent: true,
  },
  {
    id: "c2",
    page: "Q3 content and comms plan",
    snippet: "Speak to Radu about doing some sort of email promotion if we can (not required, but let's see if it makes sense).",
    author: "Ryan Barrett Christopher",
    date: "Aug 4",
    url: "https://appodeal.atlassian.net/wiki/spaces/MGP/pages/6982926360/Q3+content+and+comms+plan?focusedCommentId=7106494553",
    urgent: true,
  },
  {
    id: "c3",
    page: "Marketing Team Homepage",
    snippet: "If we have any existing spaces for this, please add them.",
    author: "Ryan Barrett Christopher",
    date: "Jul 29",
    url: "https://appodeal.atlassian.net/wiki/spaces/MGP/pages/7086866474/Marketing+Team+Homepage?focusedCommentId=7086243879",
    urgent: false,
  },
  {
    id: "c4",
    page: "Marketing Team Homepage",
    snippet: "Let's work together to define this.",
    author: "Ryan Barrett Christopher",
    date: "Jul 29",
    url: "https://appodeal.atlassian.net/wiki/spaces/MGP/pages/7086866474/Marketing+Team+Homepage?focusedCommentId=7086440481",
    urgent: false,
  },
  {
    id: "c5",
    page: "BidMachine SDK — Internal Commercialisation Document",
    snippet: "Can we connect on this?",
    author: "Ryan Barrett Christopher",
    date: "Jul 16",
    url: "https://appodeal.atlassian.net/wiki/spaces/MGP/pages/6853918753/BidMachine+SDK+Internal+Commercialisation+Document?focusedCommentId=7045546029",
    urgent: false,
  },
  {
    id: "c6",
    page: "BM SDK pipeline for Q3",
    snippet: "FYI",
    author: "Ian Rooney",
    date: "Jun 24",
    url: "https://appodeal.atlassian.net/wiki/spaces/MGP/pages/6958383111/BM+SDK+pipeline+for+Q3?focusedCommentId=6959890449",
    urgent: false,
  },
]

const CONFLUENCE_PAGES: ConfluencePage[] = [
  { id: "p1", title: "Customer Advisory Board (CAB) — Barcelona October 2026", space: "MGP",           date: "Aug 5",  url: "https://appodeal.atlassian.net/wiki/spaces/MGP/pages/7113637919" },
  { id: "p2", title: "Marketing Team Homepage",                                 space: "MGP",           date: "Aug 3",  url: "https://appodeal.atlassian.net/wiki/spaces/MGP/pages/7086866474" },
  { id: "p3", title: "Q3 2026 Marketing Strategy",                              space: "MGP",           date: "Jul 30", url: "https://appodeal.atlassian.net/wiki/spaces/MGP/pages/7091486800" },
  { id: "p4", title: "New Registrations Onboarding",                            space: "Appodeal Acc.", date: "Jul 21", url: "https://appodeal.atlassian.net/wiki/spaces/AP1/pages/7061045252" },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

type JiraFilter = "all" | "active" | "todo" | "done"
type SectionFilter = "all" | "jira" | "confluence"

function statusMeta(status: JiraStatus) {
  switch (status) {
    case "In Progress": return { label: "In Progress", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",    icon: <Clock className="size-3" /> }
    case "To Do":       return { label: "To Do",       cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", icon: <Circle className="size-3" /> }
    case "Open":        return { label: "Open",        cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", icon: <Circle className="size-3" /> }
    case "Done":        return { label: "Done",        cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", icon: <CheckCircle2 className="size-3" /> }
  }
}

function pill(active: boolean) {
  return `text-xs px-3 py-1 rounded-full border transition-colors cursor-pointer ${
    active
      ? "bg-foreground text-background border-foreground"
      : "bg-transparent text-muted-foreground border-border hover:border-foreground/40"
  }`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function JiraCard({ task }: { task: JiraTask }) {
  const meta = statusMeta(task.status)
  return (
    <Card className="px-4 py-3 flex items-center gap-3 group">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono font-semibold text-muted-foreground shrink-0">{task.key}</span>
          <Badge className={`${meta.cls} flex items-center gap-1`}>
            {meta.icon}
            {meta.label}
          </Badge>
          {task.type === "Sub-task" && (
            <Badge className="bg-muted text-muted-foreground border-border text-[10px]">sub-task</Badge>
          )}
        </div>
        <p className="text-sm font-medium leading-snug truncate">{task.summary}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-muted-foreground hidden sm:block">{task.updated}</span>
        <a
          href={`${JIRA_BASE}/${task.key}`}
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    </Card>
  )
}

function CommentCard({ comment }: { comment: ConfluenceComment }) {
  return (
    <Card className="px-4 py-3 space-y-2 group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate">{comment.page}</span>
          {comment.urgent && (
            <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 text-[10px] shrink-0">
              action needed
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">{comment.date}</span>
          <a
            href={comment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">{comment.snippet}</p>
      <p className="text-xs text-muted-foreground/60">by {comment.author}</p>
    </Card>
  )
}

function PageCard({ page }: { page: ConfluencePage }) {
  return (
    <Card className="px-4 py-3 flex items-center gap-3 group">
      <FileText className="size-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-medium leading-snug truncate">{page.title}</p>
        <p className="text-xs text-muted-foreground">{page.space}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-muted-foreground hidden sm:block">{page.date}</span>
        <a
          href={page.url}
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectWorkspacePage() {
  const [section,    setSection]    = useState<SectionFilter>("all")
  const [jiraFilter, setJiraFilter] = useState<JiraFilter>("active")

  const activeJira = JIRA_TASKS.filter((t) => t.status === "In Progress").length
  const todoJira   = JIRA_TASKS.filter((t) => t.status === "To Do" || t.status === "Open").length
  const urgentMentions = CONFLUENCE_COMMENTS.filter((c) => c.urgent).length

  const filteredJira = JIRA_TASKS.filter((t) => {
    if (jiraFilter === "active") return t.status === "In Progress"
    if (jiraFilter === "todo")   return t.status === "To Do" || t.status === "Open"
    if (jiraFilter === "done")   return t.status === "Done"
    return true
  })

  const showJira       = section === "all" || section === "jira"
  const showConfluence = section === "all" || section === "confluence"

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Project Workspace</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Jira tasks and Confluence mentions assigned to or tagged with you
          </p>
        </div>
        <a
          href="https://appodeal.atlassian.net/jira/software/projects/GT/boards"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button size="sm" variant="outline" className="gap-2">
            <Plus className="size-3.5" />
            New Jira Task
          </Button>
        </a>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "In Progress",        value: activeJira,                            color: "text-blue-500"    },
          { label: "To Do / Open",        value: todoJira,                              color: "text-amber-500"   },
          { label: "Confluence Mentions", value: CONFLUENCE_COMMENTS.length + CONFLUENCE_PAGES.length, color: "text-foreground"  },
          { label: "Action Needed",       value: urgentMentions,                        color: "text-red-500"     },
        ].map(({ label, value, color }) => (
          <Card key={label} className="px-4 py-3">
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {/* Section filter */}
      <div className="flex gap-1.5">
        {(["all", "jira", "confluence"] as SectionFilter[]).map((s) => (
          <button key={s} onClick={() => setSection(s)} className={pill(section === s)}>
            {s === "all" ? "All" : s === "jira" ? "Jira Tasks" : "Confluence"}
          </button>
        ))}
      </div>

      {/* ── Jira Tasks ─────────────────────────────────────────────────────── */}
      {showJira && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Jira Tasks</h2>
            <div className="flex gap-1.5">
              {(["active", "todo", "done", "all"] as JiraFilter[]).map((f) => (
                <button key={f} onClick={() => setJiraFilter(f)} className={pill(jiraFilter === f)}>
                  {f === "active" ? "In Progress" : f === "todo" ? "To Do" : f === "done" ? "Done" : "All"}
                </button>
              ))}
            </div>
          </div>

          {filteredJira.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground border border-dashed rounded-xl">
              No tasks in this filter
            </div>
          ) : (
            <div className="space-y-2">
              {filteredJira.map((task) => (
                <JiraCard key={task.key} task={task} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Confluence Mentions ────────────────────────────────────────────── */}
      {showConfluence && (
        <div className="space-y-6">

          {/* Action needed */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Action Needed</h2>
              <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">{urgentMentions}</Badge>
            </div>
            <div className="space-y-2">
              {CONFLUENCE_COMMENTS.filter((c) => c.urgent).map((c) => (
                <CommentCard key={c.id} comment={c} />
              ))}
            </div>
          </div>

          {/* Other comments */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Other Comments</h2>
            <div className="space-y-2">
              {CONFLUENCE_COMMENTS.filter((c) => !c.urgent).map((c) => (
                <CommentCard key={c.id} comment={c} />
              ))}
            </div>
          </div>

          {/* Pages */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Pages Mentioning You</h2>
            <div className="space-y-2">
              {CONFLUENCE_PAGES.map((p) => (
                <PageCard key={p.id} page={p} />
              ))}
            </div>
          </div>

        </div>
      )}

    </div>
  )
}
