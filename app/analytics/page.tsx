// app/analytics/page.tsx
"use client"

import { useEffect, useState, useCallback } from "react"
import { Play, Loader2, ChevronRight, ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { BugIssue, BugIssuesStore, IssueCategory, IssueSeverity, IssueStatus } from "@/lib/bug-scanner"

const CATEGORY_STYLES: Record<IssueCategory, string> = {
  bug:          "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  security:     "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  optimization: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  other:        "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
}

const SEVERITY_STYLES: Record<IssueSeverity, string> = {
  high:   "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  low:    "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
}

const SEV_ORDER: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2 }

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function IssueCard({
  issue,
  onUpdate,
}: {
  issue: BugIssue
  onUpdate: (updated: BugIssue) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState(issue.notes)

  async function patchIssue(body: { status?: IssueStatus; notes?: string }) {
    const res = await fetch(`/api/bug-issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (res.ok) onUpdate(await res.json() as BugIssue)
  }

  async function handleNotesBlur() {
    if (notes === issue.notes) return
    await patchIssue({ notes })
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded
            ? <ChevronDown className="size-4" />
            : <ChevronRight className="size-4" />}
        </button>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={CATEGORY_STYLES[issue.category]}>{issue.category}</Badge>
            <Badge className={SEVERITY_STYLES[issue.severity]}>{issue.severity}</Badge>
            <code className="text-[11px] text-muted-foreground font-mono truncate max-w-[360px]">
              {issue.file}{issue.line ? `:${issue.line}` : ""}
            </code>
          </div>
          <p className="text-sm font-semibold leading-snug">{issue.title}</p>

          {expanded && (
            <div className="space-y-2 pt-1">
              <p className="text-sm text-muted-foreground leading-relaxed">{issue.description}</p>
              <div className="rounded-lg bg-muted/50 px-3 py-2.5 space-y-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Suggestion
                </p>
                <p className="text-sm text-foreground">{issue.suggestion}</p>
              </div>
            </div>
          )}
        </div>

        <select
          value={issue.status}
          onChange={(e) => patchIssue({ status: e.target.value as IssueStatus })}
          className="shrink-0 text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground cursor-pointer"
        >
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="fixed">Fixed</option>
          <option value="ignored">Ignored</option>
        </select>
      </div>

      {expanded && (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleNotesBlur}
          placeholder="Add notes…"
          rows={2}
          className="w-full text-xs border border-border rounded-md px-3 py-2 bg-muted/30 text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
    </Card>
  )
}

type StatusFilter   = IssueStatus | "all"
type CategoryFilter = IssueCategory | "all"
type SeverityFilter = IssueSeverity | "all"

export default function BugTrackingPage() {
  const [store,    setStore]    = useState<BugIssuesStore | null>(null)
  const [scanning, setScanning] = useState(false)
  const [statusFilter,   setStatusFilter]   = useState<StatusFilter>("open")
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all")
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all")

  const fetchIssues = useCallback(async () => {
    const res = await fetch("/api/bug-issues")
    setStore(await res.json() as BugIssuesStore)
  }, [])

  useEffect(() => { fetchIssues() }, [fetchIssues])

  async function runScan() {
    setScanning(true)
    try {
      await fetch("/api/agents/code-review/run", { method: "POST" })
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const res = await fetch("/api/agents")
        const agents = await res.json() as { id: string; status: string }[]
        const agent  = agents.find((a) => a.id === "code-review")
        if (agent?.status !== "running") break
      }
      await fetchIssues()
    } finally {
      setScanning(false)
    }
  }

  function handleUpdate(updated: BugIssue) {
    setStore((prev) =>
      prev ? { ...prev, issues: prev.issues.map((i) => i.id === updated.id ? updated : i) } : prev
    )
  }

  const issues = store?.issues ?? []

  const filtered = issues
    .filter((i) => {
      if (statusFilter   !== "all" && i.status   !== statusFilter)   return false
      if (categoryFilter !== "all" && i.category !== categoryFilter) return false
      if (severityFilter !== "all" && i.severity !== severityFilter) return false
      return true
    })
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])

  const openCount       = issues.filter((i) => i.status === "open").length
  const highCount       = issues.filter((i) => i.status === "open" && i.severity === "high").length
  const inProgressCount = issues.filter((i) => i.status === "in_progress").length
  const fixedCount      = issues.filter((i) => i.status === "fixed").length

  const pill = (active: boolean) =>
    `text-xs px-3 py-1 rounded-full border transition-colors cursor-pointer ${
      active
        ? "bg-foreground text-background border-foreground"
        : "bg-transparent text-muted-foreground border-border hover:border-foreground/40"
    }`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bug Tracking</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-powered code review — bugs, security, and optimisations
            {store?.lastScanAt && (
              <span className="ml-2 text-muted-foreground/60">
                · Last scan {formatRelativeTime(store.lastScanAt)}
              </span>
            )}
          </p>
        </div>
        <Button onClick={runScan} disabled={scanning} size="sm" className="gap-2">
          {scanning
            ? <Loader2 className="size-3.5 animate-spin" />
            : <Play className="size-3.5" />}
          {scanning ? "Scanning…" : "Run Scan"}
        </Button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Open",         value: openCount,       color: "text-foreground"    },
          { label: "High Severity", value: highCount,       color: "text-red-500"       },
          { label: "In Progress",  value: inProgressCount, color: "text-blue-500"      },
          { label: "Fixed",        value: fixedCount,      color: "text-emerald-500"   },
        ].map(({ label, value, color }) => (
          <Card key={label} className="px-4 py-3">
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "open", "in_progress", "fixed", "ignored"] as StatusFilter[]).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={pill(statusFilter === s)}>
              {s === "all" ? "All" : s === "in_progress" ? "In Progress" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "bug", "security", "optimization", "other"] as CategoryFilter[]).map((c) => (
            <button key={c} onClick={() => setCategoryFilter(c)} className={pill(categoryFilter === c)}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "high", "medium", "low"] as SeverityFilter[]).map((s) => (
            <button key={s} onClick={() => setSeverityFilter(s)} className={pill(severityFilter === s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Issue list */}
      {store === null ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : store.lastScanAt === null ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
          <p className="text-sm font-medium">No scan has been run yet</p>
          <p className="text-xs text-muted-foreground">Click Run Scan to analyse the codebase</p>
          <Button onClick={runScan} disabled={scanning} size="sm" variant="outline" className="gap-2 mt-1">
            {scanning ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Run Scan
          </Button>
        </div>
      ) : filtered.length === 0 && statusFilter === "open" && categoryFilter === "all" && severityFilter === "all" ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-500/30 bg-emerald-500/5 py-20 text-center">
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">No open issues</p>
          <p className="text-xs text-muted-foreground">Codebase looks clean</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          No issues match the current filters
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((issue) => (
            <IssueCard key={issue.id} issue={issue} onUpdate={handleUpdate} />
          ))}
        </div>
      )}
    </div>
  )
}
