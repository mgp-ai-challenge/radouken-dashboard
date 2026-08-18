// app/workspace/page.tsx
"use client"

import { useEffect, useState, useCallback } from "react"
import { ExternalLink, Plus, RefreshCw, AlertTriangle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { JiraTask, ConfluenceComment, ConfluencePage, JiraStatus } from "@/lib/atlassian"

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceData {
  tasks: JiraTask[]
  comments: ConfluenceComment[]
  pages: ConfluencePage[]
  fetchedAt: string
}

type JiraFilter = "active" | "todo" | "done"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const JIRA_BASE = "https://appodeal.atlassian.net/browse"

function statusStyle(status: JiraStatus): string {
  switch (status) {
    case "In Progress": return "bg-blue-500/10 text-blue-500 border-blue-500/20"
    case "To Do":
    case "Open":        return "bg-amber-500/10 text-amber-500 border-amber-500/20"
    case "Done":        return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
    default:            return ""
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function filterPill(active: boolean) {
  return `text-xs px-3 py-1 rounded-full border transition-colors cursor-pointer ${
    active
      ? "bg-foreground text-background border-foreground"
      : "bg-transparent text-muted-foreground border-border hover:border-foreground/40"
  }`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function JiraRow({ task }: { task: JiraTask }) {
  return (
    <div className="grid items-center border-b border-border last:border-0"
         style={{ gridTemplateColumns: "52px 1fr 100px 54px 20px" }}>
      <span className="py-2 pl-3 text-[10px] font-mono font-semibold text-blue-500 shrink-0">{task.key}</span>
      <span className="py-2 pr-3 text-sm truncate">{task.summary}</span>
      <span className="py-2">
        <Badge className={`${statusStyle(task.status)} text-[10px]`}>{task.status}</Badge>
      </span>
      <span className="py-2 text-xs text-muted-foreground">{task.updated}</span>
      <a
        href={`${JIRA_BASE}/${task.key}`}
        target="_blank"
        rel="noopener noreferrer"
        className="py-2 pr-3 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ExternalLink className="size-3" />
      </a>
    </div>
  )
}

function ActionCard({ comment }: { comment: ConfluenceComment }) {
  return (
    <div className="flex-1 bg-card border border-red-500/20 rounded-md p-3 space-y-1.5">
      <p className="text-xs font-semibold truncate">{comment.page}</p>
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{comment.snippet}</p>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/60">{comment.author} · {comment.date}</span>
        <a href={comment.url} target="_blank" rel="noopener noreferrer"
           className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
          Open <ExternalLink className="size-2.5" />
        </a>
      </div>
    </div>
  )
}

function CommentRow({ comment }: { comment: ConfluenceComment }) {
  return (
    <div className="px-3 py-2 border-b border-border last:border-0">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-xs font-medium truncate">💬 {comment.page}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">{comment.date}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className="text-xs text-muted-foreground line-clamp-1">{comment.snippet}</p>
        <a href={comment.url} target="_blank" rel="noopener noreferrer"
           className="text-muted-foreground hover:text-foreground shrink-0">
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  )
}

function PageRow({ page }: { page: ConfluencePage }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-0">
      <span className="text-sm opacity-50 shrink-0">📄</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{page.title}</p>
        <p className="text-[10px] text-muted-foreground">{page.space} · {page.date}</p>
      </div>
      <a href={page.url} target="_blank" rel="noopener noreferrer"
         className="text-muted-foreground hover:text-foreground shrink-0">
        <ExternalLink className="size-3" />
      </a>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="border border-border rounded-lg overflow-hidden animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3 items-center px-3 py-2.5 border-b border-border last:border-0">
          <div className="h-3 w-10 bg-muted rounded" />
          <div className="h-3 flex-1 bg-muted rounded" />
          <div className="h-5 w-20 bg-muted rounded-full" />
          <div className="h-3 w-10 bg-muted rounded" />
        </div>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectWorkspacePage() {
  const [data,       setData]       = useState<WorkspaceData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [jiraFilter, setJiraFilter] = useState<JiraFilter>("active")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/workspace")
      if (res.status === 401) {
        const json = await res.json()
        setError(json.error ?? "Atlassian credentials not configured.")
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const urgentComments  = data?.comments.filter((c) => c.urgent)  ?? []
  const otherComments   = data?.comments.filter((c) => !c.urgent) ?? []

  const filteredTasks = (data?.tasks ?? []).filter((t) => {
    if (jiraFilter === "active") return t.status === "In Progress"
    if (jiraFilter === "todo")   return t.status === "To Do" || t.status === "Open"
    return t.status === "Done"
  })

  const taskCounts = {
    active: (data?.tasks ?? []).filter((t) => t.status === "In Progress").length,
    todo:   (data?.tasks ?? []).filter((t) => t.status === "To Do" || t.status === "Open").length,
    done:   (data?.tasks ?? []).filter((t) => t.status === "Done").length,
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Project Workspace</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your Jira tasks · Confluence mentions</p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-xs text-muted-foreground border border-border rounded-full px-3 py-1">
              ↻ {relativeTime(data.fetchedAt)}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <a href="https://appodeal.atlassian.net/jira/software/projects/GT/boards"
             target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="size-3.5" /> New Task
            </Button>
          </a>
        </div>
      </div>

      {/* Error / setup prompt */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Could not load workspace data</p>
            <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Action Needed */}
      {!loading && urgentComments.length > 0 && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-3 space-y-2">
          <p className="text-[10px] font-bold tracking-widest text-red-500 uppercase">
            Action Needed · {urgentComments.length}
          </p>
          <div className="flex gap-3 overflow-x-auto">
            {urgentComments.slice(0, 3).map((c) => <ActionCard key={c.id} comment={c} />)}
          </div>
        </div>
      )}

      {/* Jira Tasks */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">My Jira Tasks</h2>
          <div className="flex gap-1.5">
            {(["active", "todo", "done"] as JiraFilter[]).map((f) => (
              <button key={f} onClick={() => setJiraFilter(f)} className={filterPill(jiraFilter === f)}>
                {f === "active" ? `Active (${taskCounts.active})` : f === "todo" ? `To Do (${taskCounts.todo})` : `Done (${taskCounts.done})`}
              </button>
            ))}
          </div>
        </div>

        {loading ? <TableSkeleton /> : (
          <div className="border border-border rounded-lg overflow-hidden">
            {/* Column headers */}
            <div className="grid bg-muted/50 border-b border-border px-0"
                 style={{ gridTemplateColumns: "52px 1fr 100px 54px 20px" }}>
              {["KEY", "SUMMARY", "STATUS", "UPDATED", ""].map((h) => (
                <span key={h} className="py-1.5 pl-3 text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">
                  {h}
                </span>
              ))}
            </div>

            {filteredTasks.length === 0 ? (
              <div className="py-10 text-center space-y-1">
                <p className="text-sm text-muted-foreground">No tasks in this filter</p>
                {jiraFilter === "active" && taskCounts.todo > 0 && (
                  <p className="text-xs text-muted-foreground/60">
                    {taskCounts.todo} task{taskCounts.todo !== 1 ? "s" : ""} in To Do
                  </p>
                )}
              </div>
            ) : (
              filteredTasks.map((t) => <JiraRow key={t.key} task={t} />)
            )}

            <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground border-t border-border">
              Showing {filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""} ·{" "}
              <a href="https://appodeal.atlassian.net/jira/software/projects/GT/boards"
                 target="_blank" rel="noopener noreferrer"
                 className="underline underline-offset-2 hover:text-foreground">
                View board ↗
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Bottom strip: pages + other comments */}
      {!loading && (data?.pages.length || otherComments.length) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {(data?.pages ?? []).length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Pages Mentioning You</h2>
              <div className="border border-border rounded-lg overflow-hidden">
                {(data?.pages ?? []).map((p) => <PageRow key={p.id} page={p} />)}
              </div>
            </div>
          )}

          {otherComments.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Other Comments</h2>
              <div className="border border-border rounded-lg overflow-hidden">
                {otherComments.map((c) => <CommentRow key={c.id} comment={c} />)}
              </div>
            </div>
          )}

        </div>
      ) : null}

    </div>
  )
}
