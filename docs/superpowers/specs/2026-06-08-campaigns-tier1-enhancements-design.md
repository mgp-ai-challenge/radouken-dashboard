# Campaigns Dashboard — Tier 1 Enhancements — Design

## Goal

Surface engagement data that Lemlist already returns but the dashboard currently hides: reply rate, unsubscribe count, and — most importantly — which companies replied. No new API calls, no new routes, no increase in load time.

## Architecture

Four files touched, nothing new created. No new env vars.

| File | Change |
|------|--------|
| `lib/lemlist.ts` | Add `hasResponded` to `LemlistLead`; fix `nbUnsubscribed` mapping; update `fetchAllLeads` to capture `hasResponded` |
| `lib/hubspot-campaigns.ts` | Add `ncReplied`, `cuReplied`, `inboundReplied` to `AttributionResponse` |
| `app/api/campaigns/attribution/route.ts` | Compute replied leads per campaign from already-fetched leads; include in response |
| `components/campaigns-dashboard.tsx` | Reply step in funnel, reply/unsubscribe rows in stats table, reply rate in comparison chart, new Replied Companies panel, new Lead Status breakdown panel |

---

## Data Changes

### `LemlistLead` (lib/lemlist.ts)

Add one field:

```typescript
export interface LemlistLead {
  email: string
  companyName: string | null
  firstName: string | null
  lastName: string | null
  hasResponded: boolean
}
```

Captured in `fetchAllLeads` from `l.hasResponded ?? false`. Applied to all leads where `sentAt` is set (existing filter unchanged).

### `CampaignStats.nbUnsubscribed` fix (lib/lemlist.ts)

Currently hardcoded to `0` in `parseStats`. Fix:

```typescript
nbUnsubscribed: Number(data.unsubscribedCount ?? 0),
```

### `AttributionResponse` (lib/hubspot-campaigns.ts)

Add three fields:

```typescript
export interface AttributionResponse {
  sentCounts:     { nc: number; cu: number; inbound: number }
  nc:             TrickyAttribution
  cu:             TrickyAttribution
  combined:       { mqls: MatchedDeal[]; sqls: MatchedDeal[]; lost: MatchedDeal[]; totalTrickyDeals: number }
  inbound:        { matchedCount: number; totalInboundDeals: number; skippedDeals: number }
  ncReplied:      { company: string; email: string }[]
  cuReplied:      { company: string; email: string }[]
  inboundReplied: { company: string; email: string }[]
}
```

### Attribution route computation (app/api/campaigns/attribution/route.ts)

After `fetchAllLeads` for each campaign, compute replied leads:

```typescript
const ncReplied      = ncLeads.filter((l) => l.hasResponded).map((l) => ({ company: l.companyName ?? l.email, email: l.email }))
const cuReplied      = cuLeads.filter((l) => l.hasResponded).map((l) => ({ company: l.companyName ?? l.email, email: l.email }))
const inboundReplied = inboundLeads.filter((l) => l.hasResponded).map((l) => ({ company: l.companyName ?? l.email, email: l.email }))
```

Include in the `NextResponse.json(...)` return object.

---

## UI Changes

### 1. Funnel panel — 5th step

`FunnelPanel` adds a Replied step after Clicked:

```
Sent       100%
Delivered  X%   (of sent)
Opened     X%   (of delivered)
Clicked    X%   (of delivered)
Replied    X%   (of delivered)
```

Reply rate denominator is delivered (same as open/click rates).

### 2. Stats table — two new rows

After the Clicked row, add:

| Metric | Count | Rate | Note |
|--------|-------|------|------|
| Replied | `nbReplied` | % of delivered | |
| Unsubscribed | `nbUnsubscribed` | % of delivered | was always 0 — now fixed |

### 3. Comparison chart — third bar

`ComparisonChart` adds `replyRate` alongside `openRate` and `clickRate`:

```typescript
replyRate: parseFloat((c.stats!.nbReplied / Math.max(c.stats!.nbContacted, 1) * 100).toFixed(1)),
```

Third `<Bar>` rendered at lower opacity to distinguish from open/click.

### 4. Lead Status breakdown panel

New panel positioned between the comparison chart and the MQL Attribution panel. One row per campaign. Five labeled counts:

| Bucket | Source |
|--------|--------|
| Active | `stats.nbActive` |
| Completed | `stats.nbCompleted` |
| Replied | `stats.nbReplied` |
| Bounced | `stats.nbEmailsBounced` |
| Unsubscribed | `stats.nbUnsubscribed` |

Rendered as a horizontal bar-per-campaign, each bucket as a colored pill chip with count. Buckets can overlap (a lead can reply and complete), so the panel is labeled "Signal counts — not mutually exclusive". Appears as soon as stats load (~1s).

Colors:
- Active → campaign color
- Completed → accent (`#05c79b`)
- Replied → amber (`#f5a623`)
- Bounced → red (`#ef4444`)
- Unsubscribed → slate (`#7c8c94`)

### 5. Replied companies panel

New `RepliedPanel` component positioned between the MQL Attribution panel and the Inbound Attribution panel. Shows one column per campaign (nc, cu, inbound). Each column:

- Campaign label (same uppercase style)
- Count: `X replied`
- Company name chips in amber, one per replied lead
- Falls back to a loading skeleton while attribution is still loading
- If `repliedLeads` is empty: "No replies yet" in muted text

Chip style (matches existing `CompanyChip` pattern):
```tsx
<span style={{ background: C.amberDim, color: C.amber, padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, margin: "2px" }}>
  {company}
</span>
```

---

## Page Layout (updated)

```
[KPI row — 3 cards]
[Funnel row — 3 funnels, now with Replied step]
[Stats tables — with Reply + Unsubscribe rows]
[Open & Click & Reply Rate comparison chart]
[Lead Status breakdown — new]
[MQL Attribution panel]
[Replied Companies panel — new]
[Inbound Attribution panel]
```

---

## Error Handling

- `nbUnsubscribed` fix: `Number(data.unsubscribedCount ?? 0)` — safe if field absent (old API versions).
- `hasResponded` capture: `l.hasResponded ?? false` — safe if field absent.
- `repliedLeads` fallback: `company: l.companyName ?? l.email` — always has a label even if companyName is null.
- Replied panel: renders skeleton while `attrib === null`; renders "No replies yet" if `repliedLeads.length === 0`.
- Lead Status panel: appears after stats load; buckets default to `0` if stats are null.

## Dependencies

No new env vars. No new routes. Uses existing `LEMLIST_API_KEY`, `HUBSPOT_ACCESS_TOKEN`.
