# Contact Sources — Transferred Deals Fix Design Spec
**Date:** 2026-07-22
**Project:** radouken-dashboard (outbound-attribution)
**Status:** Approved — ready for implementation planning

---

## Problem

The "Last Touch Source" panels on the self-serve dashboard (`/self-serve`) attribute inbound sign-up deals to their originating contact source (Organic Search, Direct Traffic, Email, etc.). Some large self-serve accounts are transferred by BD to a sales pipeline after sign-up. When a deal moves out of the self-serve pipeline (52357803), it is no longer returned by the self-serve pipeline query, so it disappears from the source report entirely.

The existing workaround fetches deals from the sales pipelines (961280, 145970019) filtered by `dealname CONTAINS_TOKEN "Bidmachine"`. This catches the original self-serve deal name format but fails when BD renames the deal — which happens frequently.

---

## Confirmed Facts (from live HubSpot data)

- Pipeline **961280** ("Bidmachi SDK DAU Indirect") is a mixed pipeline: it contains both deals transferred from self-serve and pure sales deals created by BD.
- Transferred self-serve deals have `normalised_dau__us_dau__tier_1__065` populated — this field is set when a publisher submits the self-serve sign-up form.
- Pure sales deals created manually by BD have `normalised_dau__us_dau__tier_1__065 = null`.
- Contact source attribution (`hs_analytics_last_source`, `hs_latest_source`) is preserved on the contact after the deal is transferred — it does not change when the deal moves pipelines.
- Pure sales contacts are created `OFFLINE` by BD and are already filtered out by the existing `src !== "OFFLINE"` logic in `aggregateBySource`.

---

## Decision

Replace the `dealname CONTAINS_TOKEN "Bidmachine"` filter in `fetchSalesBidmachineDeals()` with `normalised_dau__us_dau__tier_1__065 HAS_PROPERTY`. This reliably identifies deals that originated from the self-serve form regardless of subsequent deal name changes.

---

## Changes

### File modified: `app/api/self-serve/contact-sources/route.ts`

**1. Filter change in the sales deal fetch**

Old filter (fragile — breaks on rename):
```
pipeline IN [961280, 145970019]
AND dealname CONTAINS_TOKEN "Bidmachine"
```

New filter (robust — property-based):
```
pipeline IN [961280, 145970019]
AND normalised_dau__us_dau__tier_1__065 HAS_PROPERTY
```

**2. Rename function**

`fetchSalesBidmachineDeals` → `fetchSalesTransferredDeals`

Reflects the actual intent: fetch deals that were originally created via the self-serve form and subsequently transferred to a sales pipeline.

**3. No other changes**

- Contact association lookup: unchanged
- Source aggregation and QoQ logic: unchanged
- UI (`components/self-serve-dashboard.tsx`): unchanged
- All other self-serve API routes: unchanged

---

## Out of Scope

- Backfilling historical source data for deals that were previously missed
- Changing the source attribution logic (contact source is the correct signal)
- Modifying the pipeline stage breakdown or KPI routes

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| BD manually fills `normalised_dau` on a pure sales deal | Deal is included; if the contact is `OFFLINE` it maps to "Unknown" (same as today) |
| Transferred deal has no associated contact | DAU is counted, source is "Unknown" (same as self-serve pipeline deals with no contact) |
| Deal in 145970019 renamed away from "Bidmachine" | Now correctly included via `HAS_PROPERTY` filter |
