# Paid Search Attribution Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the source breakdown panels on the self-serve dashboard so that deals attributed to Paid Search in any HubSpot source field are correctly counted under Paid Search.

**Architecture:** One function change in one API route. In `getContactSources`, add an early-exit check: if any of the three contact source fields equals `"PAID_SEARCH"`, immediately attribute the contact to Paid Search and skip the existing priority chain. For all other sources the priority chain is unchanged.

**Tech Stack:** Next.js App Router API route, HubSpot CRM REST API, TypeScript.

---

## Context for the implementer

The self-serve dashboard (`/self-serve`) shows "Last Touch Source" panels that break down sign-up and transferred deals by the originating channel of their associated contacts. Source is stored on the HubSpot contact, not the deal, across three fields:

- `hs_analytics_source` — original first-touch source set at contact creation
- `hs_analytics_last_source` — most recent source, overwritten on each new visit
- `hs_latest_source` — similar to last_source, also updated on visits

The current code picks the first non-OFFLINE value in `[hs_analytics_last_source, hs_latest_source, hs_analytics_source]` priority order. For publishers who first arrived via Google Ads but later returned organically, last_source is overwritten to ORGANIC_SEARCH and Paid Search attribution is lost.

The fix: if ANY of the three source fields is `"PAID_SEARCH"`, attribute the contact to Paid Search. Otherwise, use the existing priority chain.

---

## Files

- **Modify:** `app/api/self-serve/contact-sources/route.ts` (lines 85–93 inside `getContactSources`)

---

### Task 1: Apply Paid Search first-touch win in `getContactSources`

**Files:**
- Modify: `app/api/self-serve/contact-sources/route.ts:85-93`

- [ ] **Step 1: Read the file**

Read `app/api/self-serve/contact-sources/route.ts` in full before making any changes.

Key things to locate:
- `getContactSources` function, around line 70
- The inner loop over `data.results` around line 85
- The three-field candidates array and `.find()` call

- [ ] **Step 2: Replace the attribution logic inside the results loop**

Find this block inside the `for (const c of data.results ?? [])` loop in `getContactSources`:

```typescript
      const p = c.properties ?? {}
      // Prefer hs_analytics_last_source, then hs_latest_source, then hs_analytics_source.
      // Skip OFFLINE (manually imported) — for self-serve contacts imported from lists,
      // hs_latest_source reflects the actual web visit source (Organic Search, Referral, etc.)
      const candidates = [p.hs_analytics_last_source, p.hs_latest_source, p.hs_analytics_source]
      const src = candidates.find((s) => s && s !== "OFFLINE") ?? "UNKNOWN"
      map.set(c.id, src)
```

Replace it with:

```typescript
      const p = c.properties ?? {}
      // Paid Search wins if it appears in ANY source field — publishers who first
      // arrived via Google Ads but later returned organically would otherwise lose
      // Paid Search credit when hs_analytics_last_source is overwritten.
      const allSources = [p.hs_analytics_source, p.hs_analytics_last_source, p.hs_latest_source]
      if (allSources.some((s) => s === "PAID_SEARCH")) {
        map.set(c.id, "PAID_SEARCH")
        continue
      }
      // For all other sources: prefer last_source, then latest_source, then source.
      // Skip OFFLINE (manually imported contacts).
      const candidates = [p.hs_analytics_last_source, p.hs_latest_source, p.hs_analytics_source]
      const src = candidates.find((s) => s && s !== "OFFLINE") ?? "UNKNOWN"
      map.set(c.id, src)
```

Nothing else in the file changes.

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/radustoia/outbound-attribution && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (zero errors). If errors appear, fix them before continuing.

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```

Open `http://localhost:3000/self-serve` in a browser. Click Refresh. Wait for the "Last Touch Source" panels to load (~10–20 seconds). Verify:

- The YTD Paid Search row shows a norm DAU value noticeably higher than before (expected ~1.3M norm DAU across all pipelines)
- No "Could not load contact sources" error panel
- All other source rows (Organic, Direct, Email, etc.) still load without error
- Per-quarter tabs (Q1, Q2, Q3) all load correctly

- [ ] **Step 5: Commit**

```bash
git -C /Users/radustoia/outbound-attribution add app/api/self-serve/contact-sources/route.ts
git -C /Users/radustoia/outbound-attribution commit -m "fix: attribute to Paid Search if any contact source field is PAID_SEARCH"
```
