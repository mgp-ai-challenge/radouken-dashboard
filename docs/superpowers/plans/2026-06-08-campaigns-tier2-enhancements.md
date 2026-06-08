# Campaigns Tier 2 Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show "Clicked" (not "Replied") in the Lead Status panel for the Inbound campaign, and surface the Tricky Opps count as a KPI chip in the MQL Attribution panel header.

**Architecture:** One file changed: `components/campaigns-dashboard.tsx`. The single `BUCKETS` constant at module scope is split into `NC_CU_BUCKETS` and `INBOUND_BUCKETS`; `LeadStatusPanel` picks the right set per campaign key. The `totalTrickyDeals` value already in `attrib.combined` is rendered as an accent pill chip beneath the MQL Attribution section label.

**Tech Stack:** TypeScript, Next.js 15 App Router, React 19, inline styles

---

### Task 1: Campaign-specific buckets in `LeadStatusPanel`

**Files:**
- Modify: `components/campaigns-dashboard.tsx` (lines 297–303 and 329)

**Context:** The `BUCKETS` constant (lines 297–303) is currently shared for all three campaigns. The Inbound campaign link is a HubSpot-tracked URL, so clicks are the meaningful engagement signal — not replies. The fix is to define two bucket arrays at module scope and select between them inside the render loop.

- [ ] **Step 1: Read the file**

Read `components/campaigns-dashboard.tsx` lines 295–345 to confirm the exact current state of `BUCKETS` and the `BUCKETS.map(...)` call inside `LeadStatusPanel` before editing.

- [ ] **Step 2: Replace `BUCKETS` with two campaign-specific arrays**

Find the block at lines 296–303:

```typescript
type Bucket = { key: keyof CampaignStats; label: string; color: string; dimColor: string }
const BUCKETS: Bucket[] = [
  { key: "nbActive",        label: "Active",     color: "campaignColor", dimColor: "campaignDim" },
  { key: "nbCompleted",     label: "Completed",  color: C.accent,        dimColor: C.accentDim   },
  { key: "nbReplied",       label: "Replied",    color: C.amber,         dimColor: C.amberDim    },
  { key: "nbEmailsBounced", label: "Bounced",    color: C.red,           dimColor: C.redDim      },
  { key: "nbUnsubscribed",  label: "Unsub",      color: C.slate,         dimColor: C.slateDim    },
]
```

Replace with:

```typescript
type Bucket = { key: keyof CampaignStats; label: string; color: string; dimColor: string }
const NC_CU_BUCKETS: Bucket[] = [
  { key: "nbActive",        label: "Active",     color: "campaignColor", dimColor: "campaignDim" },
  { key: "nbCompleted",     label: "Completed",  color: C.accent,        dimColor: C.accentDim   },
  { key: "nbReplied",       label: "Replied",    color: C.amber,         dimColor: C.amberDim    },
  { key: "nbEmailsBounced", label: "Bounced",    color: C.red,           dimColor: C.redDim      },
  { key: "nbUnsubscribed",  label: "Unsub",      color: C.slate,         dimColor: C.slateDim    },
]
const INBOUND_BUCKETS: Bucket[] = [
  { key: "nbActive",        label: "Active",     color: "campaignColor", dimColor: "campaignDim" },
  { key: "nbCompleted",     label: "Completed",  color: C.accent,        dimColor: C.accentDim   },
  { key: "nbEmailsClicked", label: "Clicked",    color: C.amber,         dimColor: C.amberDim    },
  { key: "nbEmailsBounced", label: "Bounced",    color: C.red,           dimColor: C.redDim      },
  { key: "nbUnsubscribed",  label: "Unsub",      color: C.slate,         dimColor: C.slateDim    },
]
```

- [ ] **Step 3: Update `LeadStatusPanel` to pick bucket set per campaign**

Inside `LeadStatusPanel`, in the `ready.map((c) => (...))` block, find:

```typescript
{BUCKETS.map((b) => {
```

Replace with:

```typescript
{(c.key === "inbound" ? INBOUND_BUCKETS : NC_CU_BUCKETS).map((b) => {
```

Everything else in the map body stays identical.

- [ ] **Step 4: Type-check**

```bash
cd /Users/radustoia/outbound-attribution
npm run typecheck
```

Expected: 0 errors. Both `nbEmailsClicked` and `nbReplied` are valid `keyof CampaignStats` so no cast changes are needed.

- [ ] **Step 5: Commit**

```bash
git add components/campaigns-dashboard.tsx
git commit -m "feat(campaigns): show Clicked bucket for inbound in lead status panel"
```

---

### Task 2: Tricky Opps KPI chip in MQL Attribution panel

**Files:**
- Modify: `components/campaigns-dashboard.tsx` (line 619)

**Context:** `attrib.combined.totalTrickyDeals` is the count of all EMEA Tricky pipeline deals created since Q2 start — the full opportunity pool the campaigns are targeting. It's already fetched and already referenced in the footer text of the MQL Attribution panel. The change is to also surface it as a prominent pill chip immediately below the section label so it reads at a glance.

- [ ] **Step 1: Read the file**

Read `components/campaigns-dashboard.tsx` lines 617–645 to confirm the current MQL Attribution panel structure before editing.

- [ ] **Step 2: Add the Tricky Opps chip**

Find line 619:

```tsx
<SectionLabel>MQL Attribution — Tricky Pipeline</SectionLabel>
```

Add the chip immediately after it (before the grid `<div>`):

```tsx
<SectionLabel>MQL Attribution — Tricky Pipeline</SectionLabel>
{attrib && (
  <p style={{ marginBottom: "16px" }}>
    <span style={{ padding: "3px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 700, background: C.accentDim, color: C.accent }}>
      {attrib.combined.totalTrickyDeals} Tricky Opps
    </span>
  </p>
)}
```

The `attrib &&` guard means the chip is invisible while attribution is still loading — no skeleton needed since the `MqlColumn` placeholders already fill the panel during that window.

- [ ] **Step 3: Type-check**

```bash
cd /Users/radustoia/outbound-attribution
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Build**

```bash
cd /Users/radustoia/outbound-attribution
npm run build
```

Expected: Build completes without errors.

- [ ] **Step 5: Commit**

```bash
git add components/campaigns-dashboard.tsx
git commit -m "feat(campaigns): add Tricky Opps KPI chip to MQL Attribution panel"
```
