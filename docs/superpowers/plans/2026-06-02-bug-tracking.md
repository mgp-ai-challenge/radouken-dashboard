# Bug Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty Analytics page with a Bug Tracking page backed by an AI code-review agent that scans all source files and tracks issues through a full lifecycle (open → in_progress → fixed / ignored).

**Architecture:** `lib/bug-scanner.ts` collects all `.ts`/`.tsx` files from `app/`, `components/`, `lib/`, sends them to Claude Haiku in a single prompt, and persists structured issues to `.bug-issues.json`. Two API routes expose read + update. The `code-review` agent wires into the existing agent runner infrastructure. The Bug Tracking page at `/analytics` replaces the current stub.

**Tech Stack:** Next.js 15 App Router, TypeScript strict mode, `@anthropic-ai/sdk` (already installed), file-based JSON state, shadcn/ui (Badge, Button, Card), lucide-react

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/bug-scanner.ts` | Create | File collection, Claude call, JSON persistence, exported types |
| `app/api/bug-issues/route.ts` | Create | `GET` — returns full store |
| `app/api/bug-issues/[id]/route.ts` | Create | `PATCH` — updates status/notes on one issue |
| `lib/agents.ts` | Modify | Add `code-review` to `AGENT_DEFAULTS` |
| `app/api/agents/[id]/run/route.ts` | Modify | Register `runBugScan` runner |
| `components/app-sidebar.tsx` | Modify | Rename Analytics → Bug Tracking, swap icon |
| `app/analytics/page.tsx` | Modify | Full Bug Tracking UI (client component) |
| `app/agents/page.tsx` | Modify | Add code-review to pipeline visualization |

---

## Codebase Context

This project follows these patterns (read before implementing):

- `lib/agents.ts` — `AGENT_DEFAULTS` array + `readAgentStates()` / `writeAgentState()` using `.agents-state.json`
- `lib/weekly-report.ts` — Anthropic SDK usage with `claude-haiku-4-5-20251001`, file-based JSON store
- `app/api/agents/[id]/run/route.ts` — async runner registration pattern, fire-and-forget with polling
- `components/app-sidebar.tsx` — nav items array with `href`, `label`, `icon`
- `app/agents/page.tsx` — `AGENT_META` map, `AgentPipeline` component with sources/middle/outputs groups

---

## Task 1: Create `lib/bug-scanner.ts`

**Files:**
- Create: `lib/bug-scanner.ts`

- [ ] **Step 1: Create the file with all types and helpers**

```typescript
// lib/bug-scanner.ts
import fs from "fs"
import path from "path"
import Anthropic from "@anthropic-ai/sdk"

export type IssueCategory = "bug" | "security" | "optimization" | "other"
export type IssueSeverity = "high" | "medium" | "low"
export type IssueStatus = "open" | "in_progress" | "fixed" | "ignored"

export interface BugIssue {
  id: string
  file: string
  line?: number
  category: IssueCategory
  severity: IssueSeverity
  title: string
  description: string
  suggestion: string
  status: IssueStatus
  notes: string
  detectedAt: string
  updatedAt: string
}

export interface BugIssuesStore {
  lastScanAt: string | null
  issues: BugIssue[]
}

const STORE_FILE = path.join(process.cwd(), ".bug-issues.json")
const SCAN_DIRS = ["app", "components", "lib"]
const SKIP_DIRS = new Set([".next", "node_modules", "dist", ".git"])

function collectFiles(dir: string): string[] {
  const files: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(full))
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full)
    }
  }
  return files
}

export function readBugIssues(): BugIssuesStore {
  if (!fs.existsSync(STORE_FILE)) return { lastScanAt: null, issues: [] }
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) as BugIssuesStore
  } catch {
    return { lastScanAt: null, issues: [] }
  }
}

export function writeBugIssues(store: BugIssuesStore): void {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2))
}

export async function scanCodebase(): Promise<{ filesScanned: number; issuesFound: number }> {
  const root = process.cwd()

  // Collect all source files
  const filePaths: string[] = []
  for (const dir of SCAN_DIRS) {
    const full = path.join(root, dir)
    if (fs.existsSync(full)) filePaths.push(...collectFiles(full))
  }

  // Build concatenated source with file headers
  const codebase = filePaths
    .map((f) => `// FILE: ${path.relative(root, f)}\n${fs.readFileSync(f, "utf-8")}`)
    .join("\n\n")

  // Call Claude Haiku
  const client = new Anthropic()
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are a senior code reviewer. Analyze the following TypeScript/React codebase and find real issues.

Return ONLY a valid JSON object with this exact shape (no markdown fences, no explanation outside the JSON):
{
  "issues": [
    {
      "file": "relative/path/to/file.ts",
      "line": 42,
      "category": "bug",
      "severity": "high",
      "title": "Short descriptive title",
      "description": "Detailed explanation of why this is a problem",
      "suggestion": "Concrete, actionable fix"
    }
  ]
}

Rules:
- "line" is optional — omit if you cannot pinpoint a line
- category must be one of: "bug", "security", "optimization", "other"
- severity must be one of: "high", "medium", "low"
- Focus on: missing error handling, security vulnerabilities (unvalidated input, missing auth checks, exposed env vars), memory leaks, type safety gaps, N+1 query patterns, dead code
- Do NOT invent issues. If a file looks correct, omit it entirely.

<codebase>
${codebase}
</codebase>`,
      },
    ],
  })

  // Parse response
  const raw = message.content[0].type === "text" ? message.content[0].text.trim() : ""
  let newRaw: Omit<BugIssue, "id" | "status" | "notes" | "detectedAt" | "updatedAt">[] = []
  try {
    const parsed = JSON.parse(raw) as { issues: typeof newRaw }
    newRaw = parsed.issues ?? []
  } catch {
    newRaw = []
  }

  const now = new Date().toISOString()

  // Preserve non-open issues from previous scans
  const existing = readBugIssues()
  const preserved = existing.issues.filter((i) => i.status !== "open")

  // Build fresh open issues
  const fresh: BugIssue[] = newRaw.map((issue, idx) => ({
    ...issue,
    id: `bug_${Date.now()}_${idx}`,
    status: "open" as IssueStatus,
    notes: "",
    detectedAt: now,
    updatedAt: now,
  }))

  writeBugIssues({ lastScanAt: now, issues: [...preserved, ...fresh] })

  return { filesScanned: filePaths.length, issuesFound: fresh.length }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/radustoia/outbound-attribution && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `lib/bug-scanner.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/bug-scanner.ts
git commit -m "feat: add bug-scanner library with Claude-powered codebase analysis"
```

---

## Task 2: Create API routes for bug issues

**Files:**
- Create: `app/api/bug-issues/route.ts`
- Create: `app/api/bug-issues/[id]/route.ts`

- [ ] **Step 1: Create `app/api/bug-issues/route.ts`**

```typescript
// app/api/bug-issues/route.ts
import { NextResponse } from "next/server"
import { readBugIssues } from "@/lib/bug-scanner"

export async function GET() {
  return NextResponse.json(readBugIssues())
}
```

- [ ] **Step 2: Create the `[id]` directory and route**

```bash
mkdir -p /Users/radustoia/outbound-attribution/app/api/bug-issues/\[id\]
```

- [ ] **Step 3: Create `app/api/bug-issues/[id]/route.ts`**

```typescript
// app/api/bug-issues/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { readBugIssues, writeBugIssues, IssueStatus, BugIssue } from "@/lib/bug-scanner"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json() as { status?: IssueStatus; notes?: string }

  const store = readBugIssues()
  const idx = store.issues.findIndex((i) => i.id === id)
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const updated: BugIssue = {
    ...store.issues[idx],
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    updatedAt: new Date().toISOString(),
  }
  store.issues[idx] = updated
  writeBugIssues(store)

  return NextResponse.json(updated)
}
```

- [ ] **Step 4: Verify both routes compile**

```bash
cd /Users/radustoia/outbound-attribution && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors

- [ ] **Step 5: Verify GET route returns empty store (server must be running)**

```bash
curl -s http://localhost:3000/api/bug-issues | head -c 200
```

Expected: `{"lastScanAt":null,"issues":[]}`

- [ ] **Step 6: Commit**

```bash
git add app/api/bug-issues/route.ts "app/api/bug-issues/[id]/route.ts"
git commit -m "feat: add GET /api/bug-issues and PATCH /api/bug-issues/[id] routes"
```

---

## Task 3: Register code-review agent

**Files:**
- Modify: `lib/agents.ts`
- Modify: `app/api/agents/[id]/run/route.ts`

- [ ] **Step 1: Add `code-review` to `AGENT_DEFAULTS` in `lib/agents.ts`**

The current `AGENT_DEFAULTS` array ends with the `weekly-report` entry. Add after it:

```typescript
// In lib/agents.ts, add to AGENT_DEFAULTS array after weekly-report entry:
  {
    id: "code-review",
    name: "Code Review",
    description: "Scans all source files for bugs, security issues, and optimization opportunities.",
    schedule: "On demand",
  },
```

Full updated array (replace the entire `AGENT_DEFAULTS` const):

```typescript
export const AGENT_DEFAULTS: Omit<AgentState, "status" | "lastRunAt" | "lastRunDuration" | "lastError" | "stats">[] = [
  {
    id: "lemlist-sync",
    name: "Lemlist Sync",
    description: "Fetches campaigns and leads from Lemlist and stores them locally.",
    schedule: "Every 4 hours",
  },
  {
    id: "hubspot-sync",
    name: "HubSpot Sync",
    description: "Fetches contacts and deals from HubSpot and stores them locally.",
    schedule: "Every 4 hours",
  },
  {
    id: "attribution",
    name: "Attribution",
    description: "Runs attribution analysis on locally stored Lemlist and HubSpot data.",
    schedule: "Every 4 hours",
  },
  {
    id: "communications",
    name: "Communications",
    description: "Builds reports and sends notifications to Slack and other channels.",
    schedule: "Every 4 hours",
  },
  {
    id: "weekly-report",
    name: "Weekly Report",
    description: "Generates the weekly self-serve performance report and delivers it to Telegram and Slack.",
    schedule: "Every Wednesday 9am",
  },
  {
    id: "code-review",
    name: "Code Review",
    description: "Scans all source files for bugs, security issues, and optimization opportunities.",
    schedule: "On demand",
  },
]
```

- [ ] **Step 2: Add `runBugScan` runner to `app/api/agents/[id]/run/route.ts`**

Add import at top (after existing import):

```typescript
import { scanCodebase } from "@/lib/bug-scanner"
```

Add runner function (after `runWeeklyReport`):

```typescript
async function runBugScan(): Promise<Record<string, number | string>> {
  const { filesScanned, issuesFound } = await scanCodebase()
  return { filesScanned, issuesFound }
}
```

Add to `runners` map:

```typescript
const runners: Record<string, () => Promise<Record<string, number | string>>> = {
  "lemlist-sync": runLemlistSync,
  "hubspot-sync": runHubspotSync,
  attribution: runAttribution,
  communications: runCommunications,
  "weekly-report": runWeeklyReport,
  "code-review": runBugScan,
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/radustoia/outbound-attribution && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 4: Verify the new agent appears in the agents list (server must be running)**

```bash
curl -s http://localhost:3000/api/agents | python3 -m json.tool | grep -A3 '"code-review"'
```

Expected: entry with `"id": "code-review"` and `"status": "idle"`

- [ ] **Step 5: Commit**

```bash
git add lib/agents.ts "app/api/agents/[id]/run/route.ts"
git commit -m "feat: register code-review agent with bug scanner runner"
```

---

## Task 4: Update sidebar — rename Analytics to Bug Tracking

**Files:**
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: Update the import line to swap `BarChart3` for `Bug`**

Current import line in `components/app-sidebar.tsx`:
```typescript
import { LayoutDashboard, LayoutList, BarChart3, Settings, Bot, TrendingUp, RotateCcw } from "lucide-react"
```

Replace with:
```typescript
import { LayoutDashboard, LayoutList, Bug, Settings, Bot, TrendingUp, RotateCcw } from "lucide-react"
```

- [ ] **Step 2: Update the navItems entry**

Current:
```typescript
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
```

Replace with:
```typescript
  { href: "/analytics", label: "Bug Tracking", icon: Bug },
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:3000`. The sidebar should show "Bug Tracking" with a bug icon instead of "Analytics" with a bar chart icon.

- [ ] **Step 4: Commit**

```bash
git add components/app-sidebar.tsx
git commit -m "feat: rename Analytics to Bug Tracking in sidebar"
```

---

## Task 5: Build Bug Tracking page

**Files:**
- Modify: `app/analytics/page.tsx`

- [ ] **Step 1: Replace the stub with the full client component**

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/radustoia/outbound-attribution && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 3: Verify page loads in browser**

Open `http://localhost:3000/analytics`. Should show "Bug Tracking" heading, 4 stat cards all showing 0, and the "No scan has been run yet" empty state with a Run Scan button.

- [ ] **Step 4: Run a scan and verify issues appear**

Click "Run Scan" on the page. The button should spin for ~30-60 seconds (Claude processing). After completion, the stats should update and issue cards should appear in the list.

- [ ] **Step 5: Test issue status update**

Expand an issue card (click the chevron). Change the status dropdown from "Open" to "In Progress". The "In Progress" stat counter in the summary strip should increment immediately.

- [ ] **Step 6: Test notes persistence**

Expand an issue, type some text in the notes textarea, click outside (blur). Reload the page — the notes should still be there.

- [ ] **Step 7: Commit**

```bash
git add app/analytics/page.tsx
git commit -m "feat: build Bug Tracking page with issue lifecycle and filters"
```

---

## Task 6: Add code-review to Agents pipeline visualization

**Files:**
- Modify: `app/agents/page.tsx`

- [ ] **Step 1: Add `ShieldCheck` to the lucide-react import**

Current import line:
```typescript
import { RefreshCw, Play, Clock, CheckCircle2, XCircle, Loader2, Bot, Database, GitMerge, MessageSquare, FileText, ArrowRight } from "lucide-react"
```

Replace with:
```typescript
import { RefreshCw, Play, Clock, CheckCircle2, XCircle, Loader2, Bot, Database, GitMerge, MessageSquare, FileText, ArrowRight, ShieldCheck } from "lucide-react"
```

- [ ] **Step 2: Add `code-review` to `AGENT_META`**

Current `AGENT_META`:
```typescript
const AGENT_META: Record<string, { icon: React.ElementType; role: string; feeds: string[] }> = {
  "lemlist-sync":  { icon: Database,     role: "Pulls campaigns & leads from Lemlist",        feeds: ["attribution"] },
  "hubspot-sync":  { icon: Database,     role: "Pulls contacts & deals from HubSpot",          feeds: ["attribution"] },
  "attribution":   { icon: GitMerge,     role: "Matches Lemlist leads to HubSpot deals",       feeds: ["communications", "weekly-report"] },
  "communications":{ icon: MessageSquare,role: "Builds reports & posts to Slack",              feeds: [] },
  "weekly-report": { icon: FileText,     role: "Generates AI insights & delivers to Telegram", feeds: [] },
}
```

Replace with:
```typescript
const AGENT_META: Record<string, { icon: React.ElementType; role: string; feeds: string[] }> = {
  "lemlist-sync":  { icon: Database,     role: "Pulls campaigns & leads from Lemlist",        feeds: ["attribution"] },
  "hubspot-sync":  { icon: Database,     role: "Pulls contacts & deals from HubSpot",          feeds: ["attribution"] },
  "attribution":   { icon: GitMerge,     role: "Matches Lemlist leads to HubSpot deals",       feeds: ["communications", "weekly-report"] },
  "communications":{ icon: MessageSquare,role: "Builds reports & posts to Slack",              feeds: [] },
  "weekly-report": { icon: FileText,     role: "Generates AI insights & delivers to Telegram", feeds: [] },
  "code-review":   { icon: ShieldCheck,  role: "Scans source files for bugs & security issues", feeds: [] },
}
```

- [ ] **Step 3: Add `code-review` to the outputs group in `AgentPipeline`**

Current line:
```typescript
const outputs  = agents.filter((a) => [\"communications\", \"weekly-report\"].includes(a.id))
```

Replace with:
```typescript
const outputs  = agents.filter((a) => ["communications", "weekly-report", "code-review"].includes(a.id))
```

- [ ] **Step 4: Verify in browser**

Open `http://localhost:3000/agents`. The pipeline should now show a third card in the outputs column for "Code Review" with a shield icon and status dot.

- [ ] **Step 5: Commit**

```bash
git add app/agents/page.tsx
git commit -m "feat: add code-review agent to pipeline visualization"
```
