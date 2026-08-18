# Workspace Page Redesign

**Date:** 2026-08-18
**Status:** Approved

## Goal

Replace the static, card-heavy workspace page with a compact, live-data layout that gives an at-a-glance view of assigned Jira tasks and Confluence mentions — prioritised by urgency.

## Layout: Priority-First

The page is structured top-to-bottom by urgency:

1. **Action Needed banner** — Confluence comments flagged as urgent, displayed as side-by-side cards. Always visible at the top. Disappears if there are no urgent comments.
2. **My Jira Tasks table** — compact table rows (key, summary, status, updated, link). Filters for Active / To Do / Done. Shows tasks assigned to the current user only.
3. **Bottom 2-column strip** — Pages Mentioning You (left) and Other Comments (right) as compact list rows.

Header includes a "Refreshed N min ago" indicator and a "+ New Task" link to the Jira board.

## Data: Live from Atlassian API

All data is fetched live via a new API route. No hardcoded data remains in the component.

### Jira

- **Endpoint:** `GET /rest/api/3/search` with JQL `assignee = currentUser() ORDER BY updated DESC`
- **Auth:** Basic auth with `ATLASSIAN_EMAIL` + `ATLASSIAN_API_TOKEN` env vars
- **Fields fetched:** `key`, `summary`, `status`, `issuetype`, `updated`
- **Scope:** Only tasks assigned to the user (not the whole GT project)
- **Response shape:**
  ```ts
  interface JiraTask {
    key: string
    summary: string
    status: "In Progress" | "To Do" | "Open" | "Done"
    type: "Task" | "Sub-task"
    updated: string // formatted date string
  }
  ```

### Confluence

- **Comments:** `GET /wiki/rest/api/search?cql=type=comment AND mention={accountId}` — fetches comments that mention the user
- **Pages:** `GET /wiki/rest/api/search?cql=type=page AND mention={accountId} ORDER BY lastmodified DESC LIMIT 10` — pages mentioning the user
- **Urgency flag:** A comment is marked urgent if it was created in the last 14 days and the page space is `MGP` (the active marketing space). This replaces the previous manual `urgent` boolean.
- **Response shapes:**
  ```ts
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
  ```

## API Route

**`GET /api/workspace`** — new Next.js route that:
1. Fetches Jira tasks assigned to the user
2. Fetches Confluence comments mentioning the user
3. Fetches Confluence pages mentioning the user
4. Returns a single JSON object: `{ tasks, comments, pages, fetchedAt }`
5. Caches for 2 minutes (`Cache-Control: max-age=120`) to avoid hammering the Atlassian API on every render

**New env vars required:**
```
ATLASSIAN_EMAIL=radu.stoia@appodeal.com
ATLASSIAN_API_TOKEN=<token from id.atlassian.com>
ATLASSIAN_BASE_URL=https://appodeal.atlassian.net
ATLASSIAN_ACCOUNT_ID=<your Atlassian account ID, used for mention queries>
```

## Component Changes

`app/workspace/page.tsx` becomes a client component that:
- Calls `/api/workspace` on mount via `useEffect` + `useState`
- Shows a skeleton loader while fetching
- Displays the "Refreshed N min ago" timestamp from `fetchedAt`
- Has a manual refresh button that re-fetches

All sub-components (`JiraCard`, `CommentCard`, `PageCard`) are replaced:
- `JiraCard` → `JiraRow` — a compact table row (no `Card` wrapper, no two-line layout)
- `CommentCard` → stays as a card but smaller padding, single-line snippet with `line-clamp-1`
- `PageCard` → `PageRow` — compact list row with title, space, date, and link

The KPI strip (4 stat cards) is removed — the counts are visible from the section headers and filter tabs, so the strip is redundant.

## Error Handling

- If the `/api/workspace` call fails, show a non-blocking error banner: "Could not load live data — showing last cached results" (or empty state if no cache).
- If Atlassian credentials are missing, the API route returns `401` and the page shows a setup prompt: "Add ATLASSIAN_API_TOKEN to .env.local to enable live data."

## Out of Scope

- Creating or updating Jira tasks from the UI (the "+ New Task" button links to the Jira board)
- Showing tasks from other projects beyond what the Atlassian API returns for `assignee = currentUser()`
- Retroactive urgency scoring beyond the 14-day + MGP-space heuristic
