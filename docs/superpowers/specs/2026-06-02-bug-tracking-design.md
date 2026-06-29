# Bug Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty Analytics page with a Bug Tracking page backed by an AI-powered code-review agent that scans all source files for bugs, security issues, and optimizations.

**Architecture:** A `code-review` agent reads all `.ts`/`.tsx` files from `app/`, `components/`, and `lib/`, sends them to Claude Haiku in a single prompt requesting structured JSON output, and persists issues to `.bug-issues.json`. The Bug Tracking page provides a full issue lifecycle (open → in_progress → fixed / ignored) with per-issue notes, filters, and a Run Scan button.

**Tech Stack:** Next.js 15 App Router, TypeScript, Anthropic SDK (`claude-haiku-4-5-20251001`), file-based JSON state (`.bug-issues.json`), Recharts design system (existing dark fintech tokens)

---

## Data Model

```typescript
interface BugIssue {
  id: string            // "bug_<timestamp>_<index>"
  file: string          // relative path e.g. "app/api/self-serve/kpis/route.ts"
  line?: number         // optional line number
  category: "bug" | "security" | "optimization" | "other"
  severity: "high" | "medium" | "low"
  title: string
  description: string
  suggestion: string
  status: "open" | "in_progress" | "fixed" | "ignored"
  notes: string
  detectedAt: string    // ISO timestamp
  updatedAt: string     // ISO timestamp
}

interface BugIssuesStore {
  lastScanAt: string | null
  issues: BugIssue[]
}
```

Stored at `.bug-issues.json` in the project root. On each new scan: all `open` issues are replaced with fresh results; `in_progress`, `fixed`, and `ignored` issues are preserved.

---

## Files

**Create:**
- `lib/bug-scanner.ts` — reads source files, calls Claude, merges and writes `.bug-issues.json`
- `app/api/bug-issues/route.ts` — `GET` returns full store
- `app/api/bug-issues/[id]/route.ts` — `PATCH` updates status and/or notes on one issue

**Modify:**
- `lib/agents.ts` — add `code-review` agent to `AGENT_DEFAULTS`
- `app/api/agents/[id]/run/route.ts` — register `runBugScan` runner
- `components/app-sidebar.tsx` — rename "Analytics" → "Bug Tracking", swap icon to `Bug`
- `app/analytics/page.tsx` — replace stub with full Bug Tracking page (client component)

---

## Scanning Logic (`lib/bug-scanner.ts`)

1. Recursively collect all `.ts` and `.tsx` files under `app/`, `components/`, `lib/` (skip `node_modules`, `.next`)
2. Concatenate with `// FILE: <relative-path>\n<contents>` separators
3. Call Claude Haiku with prompt:

```
You are a senior code reviewer. Analyze the following TypeScript/React codebase and find real issues.

Return ONLY a valid JSON object with this shape:
{
  "issues": [
    {
      "file": "relative/path/to/file.ts",
      "line": 42,
      "category": "bug" | "security" | "optimization" | "other",
      "severity": "high" | "medium" | "low",
      "title": "Short title",
      "description": "Detailed explanation of the problem",
      "suggestion": "Concrete fix or improvement"
    }
  ]
}

Focus on: missing error handling, security vulnerabilities (unvalidated input, exposed secrets, missing auth), performance bottlenecks, memory leaks, type safety gaps, and dead code. Do not invent issues. If something is fine, omit it.

<codebase>
{concatenated source}
</codebase>
```

4. Parse response JSON, assign `id`, `status: "open"`, `notes: ""`, `detectedAt`, `updatedAt`
5. Load existing `.bug-issues.json`, filter out old `open` issues, append new ones, write back

---

## API Routes

### `GET /api/bug-issues`
Returns `BugIssuesStore` from `.bug-issues.json`. Returns `{ lastScanAt: null, issues: [] }` if file does not exist.

### `PATCH /api/bug-issues/[id]`
Body: `{ status?: IssueStatus, notes?: string }`
Finds the issue by id, updates `status` and/or `notes` plus `updatedAt`, writes back. Returns updated issue.

---

## Agent Registration

**`lib/agents.ts`** — add to `AGENT_DEFAULTS`:
```typescript
{
  id: "code-review",
  name: "Code Review",
  description: "Scans all source files for bugs, security issues, and optimization opportunities.",
  schedule: "On demand",
}
```

**`app/api/agents/[id]/run/route.ts`** — add runner:
```typescript
async function runBugScan(): Promise<Record<string, number | string>> {
  const { filesScanned, issuesFound } = await scanCodebase()
  return { filesScanned, issuesFound }
}
// Register: "code-review": runBugScan
```

`scanCodebase()` is exported from `lib/bug-scanner.ts` and returns `{ filesScanned, issuesFound }`.

---

## Bug Tracking Page (`app/analytics/page.tsx`)

Client component. Fetches `GET /api/bug-issues` on mount and after scan completes.

### Layout

**Header row**
- Title: "Bug Tracking"
- Subtitle: "AI-powered code review — bugs, security, and optimisations"
- "Run Scan" button: `POST /api/agents/code-review/run`, then polls `GET /api/agents` every 3s until `code-review` status leaves `running`, then re-fetches issues

**Summary strip** (4 chips)
- Open (total open issues)
- High Severity (open issues with severity = high)
- In Progress
- Fixed

**Filter bar**
- Status filter: All / Open / In Progress / Fixed / Ignored (default: Open)
- Category filter: All / Bug / Security / Optimization / Other
- Severity filter: All / High / Medium / Low

**Issue cards** (filtered list, sorted by severity desc)
Each card:
- File path (monospace, truncated, relative) + optional `:line`
- Category badge (color-coded: red=bug, orange=security, blue=optimization, gray=other)
- Severity badge (red=high, amber=medium, green=low)
- Title (bold) + description + suggestion (description+suggestion collapsed by default, expand on click)
- Status `<select>` dropdown — `onChange` calls `PATCH /api/bug-issues/[id]`
- Notes `<textarea>` — `onBlur` calls `PATCH /api/bug-issues/[id]`

**Empty states**
- No scan yet: "No scan has been run yet. Click Run Scan to analyse the codebase."
- Scan ran, zero issues: green checkmark "No issues found — codebase looks clean."
- Scan ran, issues exist but filters hide all: "No issues match the current filters."

### Design
Matches existing dark fintech design system: `C` color tokens, `Panel` component, `MONO` font family for file paths.

---

## Pipeline Visualization (Agents Page)

Add `code-review` to `AGENT_META` in `app/agents/page.tsx`:
```typescript
"code-review": { icon: ShieldCheck, role: "Scans source files for bugs and security issues", feeds: [] }
```

Add it to the `outputs` group in `AgentPipeline` (alongside `communications` and `weekly-report`).
