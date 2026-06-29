# G2 Weekly Report ICP Fit Hot Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `hotCount` KPI to the G2 weekly report showing how many qualified intent companies this week scored in the Hot fit tier (score ≥ 76).

**Architecture:** One pure `fitScore` function added to `lib/g2-weekly-report.ts` computes the score per company; `hotCount` is derived from `thisWeek` and stored in `kpis`; the Telegram message and dashboard KPI chip both consume it. No new files, no new routes, no new env vars.

**Tech Stack:** TypeScript, Next.js 15 App Router, React 19, inline styles

---

### Task 1: Add fitScore + hotCount to `lib/g2-weekly-report.ts`

**Files:**
- Modify: `lib/g2-weekly-report.ts`

- [ ] **Step 1: Read the current file**

Read `lib/g2-weekly-report.ts` to understand the existing `IntentCompany` interface and `generateG2WeeklyReport` function before making changes.

- [ ] **Step 2: Add the fitScore helper function**

After the `topProducts` function (around line 141), insert:

```typescript
function fitScore(co: IntentCompany): number {
  let score = 0
  if (co.activityLevel === "high")        score += 40
  else if (co.activityLevel === "medium") score += 25
  else if (co.activityLevel === "low")    score += 10
  if (co.buyingStage === "decision")           score += 25
  else if (co.buyingStage === "consideration") score += 15
  else if (co.buyingStage === "awareness")     score += 5
  const ls = co.lifecycleStage?.toLowerCase() ?? ""
  if      (ls === "opportunity")              score += 20
  else if (ls === "salesqualifiedlead")       score += 15
  else if (ls === "marketingqualifiedlead")   score += 10
  else if (ls === "lead" || ls === "subscriber") score += 5
  if (co.relatedProducts.length > 0 || co.productName) score += 5
  return score
}
```

- [ ] **Step 3: Add hotCount to the G2WeeklyReport interface**

The `G2WeeklyReport` interface currently has:
```typescript
kpis: {
  qualifiedThisWeek: number
  qualifiedLastWeek: number
  newThisWeek: number
  escalatedCount: number
}
```

Add `hotCount`:
```typescript
kpis: {
  qualifiedThisWeek: number
  qualifiedLastWeek: number
  newThisWeek: number
  escalatedCount: number
  hotCount: number
}
```

- [ ] **Step 4: Compute hotCount in generateG2WeeklyReport**

In `generateG2WeeklyReport`, after the `escalated` computation (around line 278), add:

```typescript
const hotCount = thisWeek.filter((co) => fitScore(co) >= 76).length
```

- [ ] **Step 5: Include hotCount in the report object**

Update the `report` object construction to include `hotCount` in `kpis`:

```typescript
const report: G2WeeklyReport = {
  generatedAt: new Date().toISOString(),
  weekLabel: getWeekLabel(),
  kpis: {
    qualifiedThisWeek: thisWeek.length,
    qualifiedLastWeek: lastWeek.length,
    newThisWeek: newEntrants.length,
    escalatedCount: escalated.length,
    hotCount,
  },
  insights,
}
```

- [ ] **Step 6: Update formatTelegramMessage to include hot count**

The current second line of the Telegram message is:
```typescript
`New companies: ${report.kpis.newThisWeek} | Escalations: ${report.kpis.escalatedCount}`,
```

Change it to:
```typescript
`New companies: ${report.kpis.newThisWeek} | Escalations: ${report.kpis.escalatedCount} | 🔥 Hot: ${report.kpis.hotCount}`,
```

- [ ] **Step 7: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add lib/g2-weekly-report.ts
git commit -m "feat(g2-report): add ICP fit hot count KPI to weekly report"
```

---

### Task 2: Add hotCount chip to Weekly Intent Report panel in `components/g2-dashboard.tsx`

**Files:**
- Modify: `components/g2-dashboard.tsx`

- [ ] **Step 1: Read the Weekly Intent Report panel**

Read `components/g2-dashboard.tsx` and search for `Weekly Intent Report` to find the panel. It currently shows 3 KPI chips using `g2Report.kpis`. Note their exact structure before making changes.

- [ ] **Step 2: Add the hotCount KPI chip**

The existing chips look like this (there are 3 of them in a flex row):

```tsx
<span style={{ padding: "3px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 700, background: C.accentDim, color: C.accent }}>
  {g2Report.kpis.qualifiedThisWeek} qualified
</span>
```

After the last existing chip (escalatedCount), add:

```tsx
{g2Report.kpis.hotCount !== undefined && (
  <span style={{ padding: "3px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 700, background: C.accentDim, color: C.accent }}>
    🔥 {g2Report.kpis.hotCount} hot
  </span>
)}
```

The `!== undefined` guard ensures the chip is invisible on cached reports generated before this change.

- [ ] **Step 3: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: Build completes without errors.

- [ ] **Step 5: Commit**

```bash
git add components/g2-dashboard.tsx
git commit -m "feat(g2-report): add hot count KPI chip to weekly report panel"
```
