import { NextResponse } from "next/server"
import { execFileSync } from "child_process"
import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const REPO_DIR = process.cwd()

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd: REPO_DIR, encoding: "utf-8", timeout: 30_000 }).trim()
}

export async function POST() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    const branch = `dashboard-update-${timestamp}`
    const okrRoute = join(REPO_DIR, "app/api/dashboard/okrs/route.ts")

    // Update the OKR snapshot sync date
    const content = readFileSync(okrRoute, "utf-8")
    const syncComment = `// Last dashboard sync: ${new Date().toISOString().split("T")[0]}`

    let updated: string
    if (content.includes("// Last dashboard sync:")) {
      updated = content.replace(/\/\/ Last dashboard sync: .*/, syncComment)
    } else {
      updated = content.replace(
        "export async function GET()",
        `${syncComment}\nexport async function GET()`
      )
    }

    writeFileSync(okrRoute, updated)

    run("git", ["checkout", "-b", branch])
    run("git", ["add", "app/api/dashboard/okrs/route.ts"])
    run("git", ["commit", "-m", `chore: sync dashboard OKR snapshot ${timestamp}`])
    run("git", ["push", "-u", "origin", branch])

    const prUrl = run("gh", [
      "pr", "create",
      "--base", "ui-update",
      "--head", branch,
      "--title", "Sync dashboard OKR data",
      "--body", "Automated dashboard data sync.",
    ])

    const prNumber = prUrl.split("/").pop()!
    run("gh", ["pr", "merge", prNumber, "--merge"])

    run("git", ["checkout", "ui-update"])
    run("git", ["pull"])

    return NextResponse.json({
      success: true,
      message: `PR created and merged: ${prUrl}`,
      prUrl,
    })
  } catch (e) {
    console.error("[create-pr]", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
