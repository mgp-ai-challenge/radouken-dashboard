# Contact Sources — Transferred Deals Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Source report on the self-serve dashboard to include deals transferred from self-serve to sales pipelines, regardless of whether BD renamed the deal.

**Architecture:** One filter change in one API route. Replace `dealname CONTAINS_TOKEN "Bidmachine"` with `normalised_dau__us_dau__tier_1__065 HAS_PROPERTY` in the HubSpot deal search that fetches transferred self-serve accounts from the sales pipelines. Rename the function to reflect its real intent. No other files change.

**Tech Stack:** Next.js App Router API route, HubSpot CRM REST API, TypeScript.

---

## Context for the implementer

The self-serve dashboard (`/self-serve`) shows a "Last Touch Source" panel that attributes sign-up deals to the contact's originating channel (Organic Search, Direct Traffic, Email, etc.). The source lives on the **contact**, not the deal.

When a large self-serve account is transferred to a sales pipeline, the deal moves out of the self-serve pipeline (ID `52357803`) and into pipeline `961280` ("Bidmachi SDK DAU Indirect") or `145970019`. The self-serve pipeline query no longer sees it.

The existing workaround (`fetchSalesBidmachineDeals`) fetches sales pipeline deals with `dealname CONTAINS_TOKEN "Bidmachine"`. This breaks when BD renames the deal — which is common.

The correct signal: deals that originated from the self-serve sign-up form always have `normalised_dau__us_dau__tier_1__065` populated (set by the form). Pure BD-created sales deals have it `null`.

---

## Files

- **Modify:** `app/api/self-serve/contact-sources/route.ts`

---

### Task 1: Replace name filter with property filter and rename function

**Files:**
- Modify: `app/api/self-serve/contact-sources/route.ts`

- [ ] **Step 1: Read the file**

Read `app/api/self-serve/contact-sources/route.ts` in full before making any changes.

Key things to note:
- `fetchSalesBidmachineDeals()` is defined around line 100
- It is called on line ~223 inside `GET()`
- The HubSpot search body has a `filterGroups` array with two filters: `pipeline IN [...]` and `dealname CONTAINS_TOKEN "Bidmachine"`

- [ ] **Step 2: Replace the function**

Find the entire `fetchSalesBidmachineDeals` function and replace it with `fetchSalesTransferredDeals`, changing only the filter and the name. Keep the pagination loop, the properties fetched, and the response shape exactly the same.

Replace this:

```typescript
async function fetchSalesBidmachineDeals(): Promise<Deal[]> {
  const deals: Deal[] = []
  let after: string | undefined
  do {
    const body: Record<string, unknown> = {
      filterGroups: [{
        filters: [
          { propertyName: "pipeline", operator: "IN", values: SALES_PIPELINES },
          { propertyName: "dealname", operator: "CONTAINS_TOKEN", value: "Bidmachine" },
        ],
      }],
      properties: ["dealname", "createdate", "normalised_dau__us_dau__tier_1__065", "bm_dau_usa_publishers"],
      limit: 100,
    }
    if (after) body.after = after
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
    if (!res.ok) break
    const data = await res.json()
    for (const d of data.results ?? []) {
      deals.push({
        id: d.id,
        properties: {
          dealname:                              d.properties.dealname ?? null,
          createdate:                            d.properties.createdate ?? null,
          normalised_dau__us_dau__tier_1__065:   d.properties.normalised_dau__us_dau__tier_1__065 ?? null,
          bm_dau_usa_publishers:                 d.properties.bm_dau_usa_publishers ?? null,
          bm__account_approval:                  null,
        },
      })
    }
    after = data.paging?.next?.after
  } while (after)
  return deals
}
```

With this (only the function name and the `dealname` filter line change):

```typescript
async function fetchSalesTransferredDeals(): Promise<Deal[]> {
  const deals: Deal[] = []
  let after: string | undefined
  do {
    const body: Record<string, unknown> = {
      filterGroups: [{
        filters: [
          { propertyName: "pipeline", operator: "IN", values: SALES_PIPELINES },
          { propertyName: "normalised_dau__us_dau__tier_1__065", operator: "HAS_PROPERTY" },
        ],
      }],
      properties: ["dealname", "createdate", "normalised_dau__us_dau__tier_1__065", "bm_dau_usa_publishers"],
      limit: 100,
    }
    if (after) body.after = after
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
    if (!res.ok) break
    const data = await res.json()
    for (const d of data.results ?? []) {
      deals.push({
        id: d.id,
        properties: {
          dealname:                              d.properties.dealname ?? null,
          createdate:                            d.properties.createdate ?? null,
          normalised_dau__us_dau__tier_1__065:   d.properties.normalised_dau__us_dau__tier_1__065 ?? null,
          bm_dau_usa_publishers:                 d.properties.bm_dau_usa_publishers ?? null,
          bm__account_approval:                  null,
        },
      })
    }
    after = data.paging?.next?.after
  } while (after)
  return deals
}
```

- [ ] **Step 3: Update the call site**

In the `GET()` function, find the `Promise.all` call that invokes `fetchSalesBidmachineDeals()` and rename it to `fetchSalesTransferredDeals()`.

Find:
```typescript
const [allQuarterDeals, salesDeals, portalId] = await Promise.all([
  ...
  fetchSalesBidmachineDeals(),
  getPortalId(),
])
```

Change `fetchSalesBidmachineDeals()` → `fetchSalesTransferredDeals()`. Nothing else changes.

- [ ] **Step 4: TypeScript check**

```bash
cd /Users/radustoia/outbound-attribution && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (zero errors). If errors appear, fix them before continuing.

- [ ] **Step 5: Smoke test**

```bash
npm run dev
```

Open `http://localhost:3000/self-serve` in a browser. Click Refresh. Wait for the "Last Touch Source" panels to load (they are slow — ~10–20 seconds — because they make sequential HubSpot API calls). Verify:

- Both the per-quarter tabs and the YTD panel load without error
- The source breakdown shows deal counts that are equal to or higher than before (the fix adds previously missing deals, never removes them)
- No "Could not load contact sources" error panel

- [ ] **Step 6: Commit**

```bash
git -C /Users/radustoia/outbound-attribution add app/api/self-serve/contact-sources/route.ts
git -C /Users/radustoia/outbound-attribution commit -m "fix: include transferred self-serve deals in source report via normalised_dau filter"
```
