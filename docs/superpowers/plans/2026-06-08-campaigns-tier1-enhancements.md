# Campaigns Tier 1 Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface reply rate, unsubscribe counts, replied company names, and a lead status breakdown on the Campaigns dashboard — all from data Lemlist already returns but the app currently discards.

**Architecture:** Extend `LemlistLead` with `hasResponded` and fix `nbUnsubscribed` mapping in `lib/lemlist.ts`; add `ncReplied`/`cuReplied`/`inboundReplied` arrays to `AttributionResponse` in `lib/hubspot-campaigns.ts`; compute them in the attribution route from already-fetched leads; render five new UI elements in the dashboard. Zero new API calls, zero new routes.

**Tech Stack:** TypeScript, Next.js 15 App Router, React 19, Recharts, inline styles

---

### Task 1: Extend `LemlistLead`, fix `nbUnsubscribed`, update `fetchAllLeads`

**Files:**
- Modify: `lib/lemlist.ts`

**Context:** `LemlistLead` is the shape returned by `fetchAllLeads`. It paginates `/campaigns/{id}/leads` and currently discards `hasResponded`. `parseStats` maps Lemlist aggregate stats but hardcodes `nbUnsubscribed: 0` — the API returns `unsubscribedCount` but it was never wired up.

- [ ] **Step 1: Read the current file**

Read `lib/lemlist.ts` to confirm line numbers before editing.

- [ ] **Step 2: Add `hasResponded` to `LemlistLead`**

The interface currently ends at `lastName`. Add `hasResponded`:

```typescript
export interface LemlistLead {
  email: string
  companyName: string | null
  firstName: string | null
  lastName: string | null
  hasResponded: boolean
}
```

- [ ] **Step 3: Fix `nbUnsubscribed` in `parseStats`**

Find the line:
```typescript
nbUnsubscribed:  0,
```

Replace with:
```typescript
nbUnsubscribed:  Number(data.unsubscribedCount ?? 0),
```

- [ ] **Step 4: Capture `hasResponded` in `fetchAllLeads`**

Find the `results.push(...)` block inside `fetchAllLeads` (around line 146–153). It currently reads:

```typescript
results.push({
  email:       String(l.email ?? ""),
  companyName: l.companyName ? String(l.companyName) : null,
  firstName:   l.firstName  ? String(l.firstName)  : null,
  lastName:    l.lastName   ? String(l.lastName)   : null,
})
```

Replace with:

```typescript
results.push({
  email:        String(l.email ?? ""),
  companyName:  l.companyName ? String(l.companyName) : null,
  firstName:    l.firstName  ? String(l.firstName)  : null,
  lastName:     l.lastName   ? String(l.lastName)   : null,
  hasResponded: Boolean(l.hasResponded ?? false),
})
```

- [ ] **Step 5: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors. If TypeScript complains about `hasResponded` on downstream usages (attribution route uses `LemlistLead[]` for email matching only — `hasResponded` is just an additional field), add it where required.

- [ ] **Step 6: Commit**

```bash
git add lib/lemlist.ts
git commit -m "feat(campaigns): extend LemlistLead with hasResponded, fix nbUnsubscribed mapping"
```

---

### Task 2: Add replied leads to `AttributionResponse` and the attribution route

**Files:**
- Modify: `lib/hubspot-campaigns.ts`
- Modify: `app/api/campaigns/attribution/route.ts`

**Context:** `AttributionResponse` (line 190 of `lib/hubspot-campaigns.ts`) is the shared type for the attribution API response — it's imported by both the route and the dashboard. The attribution route (`app/api/campaigns/attribution/route.ts`) already calls `fetchAllLeads` for all three campaigns — we just need to filter by `hasResponded` and include the result.

- [ ] **Step 1: Read both files**

Read `lib/hubspot-campaigns.ts` lines 190–205 and `app/api/campaigns/attribution/route.ts` lines 67–82 to confirm the exact current shape before editing.

- [ ] **Step 2: Extend `AttributionResponse` in `lib/hubspot-campaigns.ts`**

Find the `AttributionResponse` interface (around line 190). It currently ends at the `inbound` field. Add three new fields:

```typescript
export interface AttributionResponse {
  sentCounts: { nc: number; cu: number; inbound: number }
  nc: TrickyAttribution
  cu: TrickyAttribution
  combined: {
    mqls: MatchedDeal[]
    sqls: MatchedDeal[]
    lost: MatchedDeal[]
    totalTrickyDeals: number
  }
  inbound: {
    matchedCount: number
    totalInboundDeals: number
    skippedDeals: number
  }
  ncReplied:      { company: string; email: string }[]
  cuReplied:      { company: string; email: string }[]
  inboundReplied: { company: string; email: string }[]
}
```

- [ ] **Step 3: Compute replied leads in the attribution route**

In `app/api/campaigns/attribution/route.ts`, after the three `fetchAllLeads` calls (after line 27), add:

```typescript
// ── Step 1b: Compute replied leads per campaign ────────────────────────
const ncReplied      = ncLeads.filter((l) => l.hasResponded).map((l) => ({ company: l.companyName ?? l.email, email: l.email }))
const cuReplied      = cuLeads.filter((l) => l.hasResponded).map((l) => ({ company: l.companyName ?? l.email, email: l.email }))
const inboundReplied = inboundLeads.filter((l) => l.hasResponded).map((l) => ({ company: l.companyName ?? l.email, email: l.email }))
```

- [ ] **Step 4: Include replied leads in the return value**

Find the `return NextResponse.json({...})` at the end of the route. The current shape is:

```typescript
return NextResponse.json({
  sentCounts: { nc: ncLeads.length, cu: cuLeads.length, inbound: inboundLeads.length },
  nc:  ncAttrib,
  cu:  cuAttrib,
  combined,
  inbound: {
    matchedCount,
    totalInboundDeals: inboundDeals.length,
    skippedDeals,
  },
})
```

Replace with:

```typescript
return NextResponse.json({
  sentCounts: { nc: ncLeads.length, cu: cuLeads.length, inbound: inboundLeads.length },
  nc:  ncAttrib,
  cu:  cuAttrib,
  combined,
  inbound: {
    matchedCount,
    totalInboundDeals: inboundDeals.length,
    skippedDeals,
  },
  ncReplied,
  cuReplied,
  inboundReplied,
})
```

- [ ] **Step 5: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add lib/hubspot-campaigns.ts app/api/campaigns/attribution/route.ts
git commit -m "feat(campaigns): add replied leads to attribution response"
```

---

### Task 3: Dashboard — reply step in funnel, reply/unsubscribe in stats table, reply rate in chart

**Files:**
- Modify: `components/campaigns-dashboard.tsx`

**Context:** Three existing components need small additions. `FunnelPanel` (around line 144) renders funnel steps — add Replied after Clicked. `StatsTable` (around line 185) renders a metrics table — add Reply and Unsubscribed rows after the Clicked row. `ComparisonChart` (around line 245) renders a bar chart — add a third `replyRate` bar.

- [ ] **Step 1: Read the file**

Read `components/campaigns-dashboard.tsx` and locate: the `FunnelPanel` function, the `StatsTable` tbody section, and the `ComparisonChart` data mapping.

- [ ] **Step 2: Add Replied step to `FunnelPanel`**

Find the four `FunnelStep` calls inside `FunnelPanel`. They currently end with:

```tsx
<FunnelStep label="Clicked"   count={clicked} pctLabel={pct(clicked, reached)}   color={campaign.color} maxCount={sent} />
```

Add a Replied step immediately after:

```tsx
<FunnelStep label="Clicked"   count={clicked}       pctLabel={pct(clicked, reached)}       color={campaign.color} maxCount={sent} />
<FunnelStep label="Replied"   count={s.nbReplied}   pctLabel={pct(s.nbReplied, reached)}   color={campaign.color} maxCount={sent} />
```

- [ ] **Step 3: Add Reply and Unsubscribed rows to `StatsTable`**

Find the `StatRow` for "Clicked" in the stats table tbody:

```tsx
<StatRow label="Clicked"             count={s.nbEmailsClicked} rate={pct(s.nbEmailsClicked, reached)}  />
```

Add two rows immediately after (before the attribution block):

```tsx
<StatRow label="Clicked"             count={s.nbEmailsClicked} rate={pct(s.nbEmailsClicked, reached)}  />
<StatRow label="Replied"             count={s.nbReplied}       rate={pct(s.nbReplied, reached)}        />
<StatRow label="Unsubscribed"        count={s.nbUnsubscribed}  rate={pct(s.nbUnsubscribed, reached)}   />
```

- [ ] **Step 4: Add reply rate to `ComparisonChart`**

Find the `data` mapping in `ComparisonChart`:

```typescript
const data = ready.map((c) => ({
  name:      c.label,
  openRate:  parseFloat((c.stats!.openRate * 100).toFixed(1)),
  clickRate: parseFloat((c.stats!.clickRate * 100).toFixed(1)),
  color:     c.color,
}))
```

Replace with:

```typescript
const data = ready.map((c) => ({
  name:      c.label,
  openRate:  parseFloat((c.stats!.openRate * 100).toFixed(1)),
  clickRate: parseFloat((c.stats!.clickRate * 100).toFixed(1)),
  replyRate: parseFloat((c.stats!.nbReplied / Math.max(c.stats!.nbContacted, 1) * 100).toFixed(1)),
  color:     c.color,
}))
```

- [ ] **Step 5: Add the Reply Rate `<Bar>` to the chart**

Find the two existing `<Bar>` elements and the `<ResponsiveContainer height={200}>`. Update height to `240` and add a third bar after the clickRate bar:

```tsx
<ResponsiveContainer width="100%" height={240}>
  <BarChart ...>
    ...
    <Bar dataKey="openRate"  name="Open Rate"  radius={[0, 4, 4, 0]}>
      {data.map((d, i) => <Cell key={i} fill={d.color} opacity={0.85} />)}
    </Bar>
    <Bar dataKey="clickRate" name="Click Rate" radius={[0, 4, 4, 0]}>
      {data.map((d, i) => <Cell key={i} fill={d.color} opacity={0.45} />)}
    </Bar>
    <Bar dataKey="replyRate" name="Reply Rate" radius={[0, 4, 4, 0]}>
      {data.map((d, i) => <Cell key={i} fill={d.color} opacity={0.25} />)}
    </Bar>
  </BarChart>
</ResponsiveContainer>
```

- [ ] **Step 6: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add components/campaigns-dashboard.tsx
git commit -m "feat(campaigns): add reply step to funnel, reply/unsubscribe rows to stats table, reply rate to chart"
```

---

### Task 4: Dashboard — Lead Status breakdown panel

**Files:**
- Modify: `components/campaigns-dashboard.tsx`

**Context:** New panel showing Active / Completed / Replied / Bounced / Unsubscribed counts per campaign as colored chips. These all come from `CampaignStats` (already loaded at ~1s). Positioned between the `ComparisonChart` and the MQL Attribution panel.

- [ ] **Step 1: Read the file**

Read `components/campaigns-dashboard.tsx` to locate the `ComparisonChart` call in the JSX (around line 480) and the design system constants `C` at the top.

- [ ] **Step 2: Add `LeadStatusPanel` component**

Add this component after `ComparisonChart` (keep component definitions together before `CampaignsDashboard`):

```tsx
// ─── Lead Status breakdown panel ──────────────────────────────────────────────
function LeadStatusPanel({ campaigns }: { campaigns: DiscoveredCampaign[] }) {
  const ready = campaigns.filter((c) => c.stats)
  if (campaigns.length > 0 && ready.length === 0) {
    return (
      <Panel style={{ marginBottom: "24px" }}>
        <SectionLabel>Lead Status Breakdown</SectionLabel>
        <LoadingSkeleton h={100} />
      </Panel>
    )
  }
  if (ready.length === 0) return null

  type Bucket = { key: string; label: string; color: string; dimColor: string }
  const BUCKETS: Bucket[] = [
    { key: "nbActive",        label: "Active",     color: "campaignColor", dimColor: "campaignDim" },
    { key: "nbCompleted",     label: "Completed",  color: C.accent,        dimColor: C.accentDim   },
    { key: "nbReplied",       label: "Replied",    color: C.amber,         dimColor: C.amberDim    },
    { key: "nbEmailsBounced", label: "Bounced",    color: C.red,           dimColor: C.redDim      },
    { key: "nbUnsubscribed",  label: "Unsub",      color: C.slate,         dimColor: "rgba(124,140,148,0.10)" },
  ]

  return (
    <Panel style={{ marginBottom: "24px" }}>
      <SectionLabel>Lead Status Breakdown</SectionLabel>
      <p style={{ fontSize: "10px", color: C.muted, marginBottom: "16px", fontStyle: "italic" }}>
        Signal counts — not mutually exclusive
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {ready.map((c) => (
          <div key={c.key}>
            <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: c.color, marginBottom: "8px" }}>
              {c.label}
            </p>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {BUCKETS.map((b) => {
                const count = ((c.stats as unknown as Record<string, number>)[b.key]) ?? 0
                const color   = b.color    === "campaignColor" ? c.color : b.color
                const dimColor = b.dimColor === "campaignDim"  ? "rgba(55,138,221,0.12)" : b.dimColor
                return (
                  <span key={b.key} style={{ padding: "4px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 600, background: dimColor, color }}>
                    {count.toLocaleString()} {b.label}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}
```

- [ ] **Step 3: Render `LeadStatusPanel` in `CampaignsDashboard`**

Find the `{/* ── Comparison chart */}` block in the JSX return. It currently looks like:

```tsx
{/* ── Comparison chart ────────────────────────────────────────────────────── */}
<ComparisonChart campaigns={campaigns} />

{/* ── MQL Attribution panel ───────────────────────────────────────────── */}
```

Add `LeadStatusPanel` between them:

```tsx
{/* ── Comparison chart ────────────────────────────────────────────────────── */}
<ComparisonChart campaigns={campaigns} />

{/* ── Lead Status breakdown ───────────────────────────────────────────── */}
<LeadStatusPanel campaigns={campaigns} />

{/* ── MQL Attribution panel ───────────────────────────────────────────── */}
```

- [ ] **Step 4: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors. If TypeScript complains about `keyof typeof c.stats`, cast to `number` explicitly (already done in the snippet above with `as number`).

- [ ] **Step 5: Commit**

```bash
git add components/campaigns-dashboard.tsx
git commit -m "feat(campaigns): add lead status breakdown panel"
```

---

### Task 5: Dashboard — Replied Companies panel

**Files:**
- Modify: `components/campaigns-dashboard.tsx`

**Context:** New panel showing amber company name chips for every lead that replied, per campaign. Positioned between the MQL Attribution panel and the Inbound Attribution panel. Appears when `attrib` loads (~5min). Falls back to a skeleton while loading.

- [ ] **Step 1: Read the file**

Read `components/campaigns-dashboard.tsx` to locate: the `MqlColumn` component area, the MQL Attribution panel in the JSX return, and the `CampaignsDashboard` component signature to confirm `attrib` and `attribErr` are in scope.

- [ ] **Step 2: Add `RepliedPanel` component**

Add after `MqlColumn` (before `CampaignsDashboard`):

```tsx
// ─── Replied companies panel ───────────────────────────────────────────────────
function RepliedPanel({
  attrib,
  attribErr,
  campaigns,
}: {
  attrib: AttributionResponse | null
  attribErr: string | null
  campaigns: DiscoveredCampaign[]
}) {
  return (
    <Panel style={{ marginBottom: "24px" }}>
      <SectionLabel>Replied Companies</SectionLabel>
      {!attrib && !attribErr ? (
        <LoadingSkeleton h={100} />
      ) : attribErr ? (
        <DataError message={attribErr} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px" }}>
          {(
            [
              { key: "nc"      as const, replied: attrib!.ncReplied      },
              { key: "cu"      as const, replied: attrib!.cuReplied      },
              { key: "inbound" as const, replied: attrib!.inboundReplied },
            ]
          ).map(({ key, replied }) => {
            const campaign = campaigns.find((c) => c.key === key)
            return (
              <div key={key}>
                <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: campaign?.color ?? C.muted, marginBottom: "8px" }}>
                  {campaign?.label ?? key}
                </p>
                <p style={{ fontSize: "22px", fontWeight: 700, fontFamily: MONO, color: C.amber, lineHeight: 1, marginBottom: "4px" }}>
                  {replied.length}
                </p>
                <p style={{ fontSize: "11px", color: C.muted, marginBottom: "10px" }}>replied</p>
                {replied.length === 0 ? (
                  <p style={{ fontSize: "11px", color: C.muted, fontStyle: "italic" }}>No replies yet</p>
                ) : (
                  <div>
                    {replied.map((r) => (
                      <span key={r.email} style={{ display: "inline-block", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, background: C.amberDim, color: C.amber, margin: "2px" }}>
                        {r.company}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
```

- [ ] **Step 3: Render `RepliedPanel` in `CampaignsDashboard`**

Find the MQL Attribution panel block and the Inbound Attribution panel block in the JSX return. They currently look like:

```tsx
{/* ── MQL Attribution panel ───────────────────────────────────────────── */}
<Panel style={{ marginBottom: "24px" }}>
  ...
</Panel>

{/* ── Inbound attribution panel ───────────────────────────────────────── */}
<Panel>
```

Add `RepliedPanel` between them:

```tsx
{/* ── MQL Attribution panel ───────────────────────────────────────────── */}
<Panel style={{ marginBottom: "24px" }}>
  ...
</Panel>

{/* ── Replied companies panel ─────────────────────────────────────────── */}
<RepliedPanel attrib={attrib} attribErr={attribErr} campaigns={campaigns} />

{/* ── Inbound attribution panel ───────────────────────────────────────── */}
<Panel>
```

- [ ] **Step 4: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: Build completes without errors.

- [ ] **Step 6: Commit**

```bash
git add components/campaigns-dashboard.tsx
git commit -m "feat(campaigns): add replied companies panel"
```
