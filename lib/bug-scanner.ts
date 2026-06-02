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
