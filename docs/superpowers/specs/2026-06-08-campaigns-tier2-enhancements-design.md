# Campaigns Dashboard — Tier 2 Enhancements — Design

## Goal

Two targeted display improvements to the Campaigns dashboard using data already fetched:
1. Show "Clicked" (not "Replied") for the Inbound campaign row in the Lead Status panel — clicks on the Inbound campaign link are meaningful because the link is a HubSpot-tracked form URL.
2. Surface `totalTrickyDeals` (EMEA Tricky pipeline deals created since Q2) as a prominent "Tricky Opps" KPI chip in the MQL Attribution panel header.

No new API calls, no new routes, no new env vars.

## Architecture

One file touched: `components/campaigns-dashboard.tsx`.

| Change | Location |
|--------|----------|
| Split `BUCKETS` into `NC_CU_BUCKETS` + `INBOUND_BUCKETS` | Module-level constants |
| `LeadStatusPanel` picks bucket set per campaign key | Inside `ready.map()` |
| "Tricky Opps" chip in MQL Attribution panel | JSX after `<SectionLabel>` |

---

## Data Changes

None. Both values are already in scope:
- `nbEmailsClicked` — on `CampaignStats`, available at ~1s
- `attrib.combined.totalTrickyDeals` — on `AttributionResponse`, available at ~5min

---

## UI Changes

### 1. Lead Status panel — campaign-specific buckets

Two module-level bucket arrays replace the single `BUCKETS` constant:

```typescript
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

Inside `LeadStatusPanel`, in the `ready.map((c) => ...)` loop:

```typescript
const buckets = c.key === "inbound" ? INBOUND_BUCKETS : NC_CU_BUCKETS
```

### 2. MQL Attribution panel — Tricky Opps chip

In the MQL Attribution panel, after the `<SectionLabel>`, add:

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

Falls back to nothing while `attrib` is null (attribution still loading).

---

## Error Handling

- `nbEmailsClicked` is already on `CampaignStats` — safe, no new field access.
- `totalTrickyDeals` is already on `attrib.combined` — guarded by `attrib &&`.

## Dependencies

No new env vars. No new routes. Uses existing `LEMLIST_API_KEY`, `HUBSPOT_ACCESS_TOKEN`.
