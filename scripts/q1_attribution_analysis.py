#!/usr/bin/env python3
"""
Q1 2026 Lemlist → HubSpot Attribution & BD Overlap Analysis
"""
import json, time, subprocess, datetime, sys, os
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import base64

LEMLIST_KEY   = os.environ["LEMLIST_API_KEY"]
HUBSPOT_TOKEN = os.environ["HUBSPOT_ACCESS_TOKEN"]

Q1_START_MS = 1735689600000  # 2026-01-01 UTC
Q1_END_MS   = 1743465600000  # 2026-04-01 UTC

TARGET_PIPELINES = {
    "961280":    "Supply Sales & AM",
    "145970019": "UA Sales & AM",
    "1273603":   "Sales",
    "84566823":  "Demand Sales - PMP",
    "85256627":  "Partnerships",
    "52357803":  "Sign Ups",
    "867371640": "UA Tricky Pipeline",
}
DEAL_STAGE_MAP = {
    "1278450782": "Lead",             "1157536": "Marketing Qualified Lead",
    "1855526":    "Sales Prospecting","1574904": "Sales Qualified Lead",
    "961283":     "Sales Proposal",   "1295831362": "Internal Review",
    "961281":     "Closed Won",       "961282": "Closed Lost",
}
LL_AUTH = "Basic " + base64.b64encode((":" + LEMLIST_KEY).encode()).decode()
HS_AUTH = f"Bearer {HUBSPOT_TOKEN}"

def _curl(cmd, retries=2):
    for _ in range(retries):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
            t = r.stdout.strip()
            if t:
                return json.loads(t)
        except Exception:
            time.sleep(0.3)
    return None

def ll(path):
    r = _curl(["curl","-s","--max-time","8","-H",f"Authorization: {LL_AUTH}",
                f"https://api.lemlist.com/api{path}"])
    return r if isinstance(r,(list,dict)) else []

def load_campaigns_excluding_archived():
    """Same as Next API: all campaigns except status archived (paused/draft included)."""
    raw = ll("/campaigns")
    if not isinstance(raw, list):
        return {}
    out = {}
    for c in raw:
        st = (c.get("status") or "").lower().strip()
        if st == "archived" or c.get("archived") is True:
            continue
        cid = c.get("_id")
        if cid:
            out[cid] = (c.get("name") or "").strip() or cid
    return out

CAMPAIGNS = load_campaigns_excluding_archived()

def hs_get(path, params=""):
    url = f"https://api.hubapi.com{path}" + (f"?{params}" if params else "")
    return _curl(["curl","-s","--max-time","8","-H",f"Authorization: {HS_AUTH}", url]) or {}

def hs_post(path, body):
    return _curl(["curl","-s","--max-time","10","-X","POST",
                  "-H",f"Authorization: {HS_AUTH}",
                  "-H","Content-Type: application/json",
                  "-d",json.dumps(body),
                  f"https://api.hubapi.com{path}"]) or {}

p = lambda m: print(f"  {m}", flush=True)

# ─── STEP 1: Lemlist leads via activities ────────────────────────────────────
print("\n[1/5] Fetching leads via Lemlist activities...")
print(f"     Loaded {len(CAMPAIGNS)} campaigns (excluding archived).")
email_meta    = {}   # email → {email, domain, firstName, lastName, company, campaigns:set}
lead_campaign = {}   # (email, cam_id) → cam_name

for cam_id, cam_name in CAMPAIGNS.items():
    p(f"Campaign: {cam_name}")
    seen = set()
    for act_type in ["emailsSent", "linkedinInviteSent", "linkedinMessageSent"]:
        offset = 0
        while True:
            acts = ll(f"/activities?campaignId={cam_id}&type={act_type}&limit=100&offset={offset}")
            if not isinstance(acts, list) or not acts:
                break
            for a in acts:
                email = (a.get("leadEmail") or a.get("email") or "").lower().strip()
                if not email or "@" not in email:
                    continue
                domain  = email.split("@")[-1]
                # Prefer companyName (standard); gameName is often custom app title
                company = (a.get("companyName") or a.get("leadCompanyName") or a.get("gameName") or "").strip()
                if email not in email_meta:
                    email_meta[email] = {
                        "email":     email, "domain": domain,
                        "firstName": a.get("leadFirstName") or a.get("firstName") or "",
                        "lastName":  a.get("leadLastName")  or a.get("lastName")  or "",
                        "company":   company, "campaigns": set(),
                    }
                email_meta[email]["campaigns"].add(cam_id)
                seen.add(email)
                lead_campaign[(email, cam_id)] = cam_name
            if len(acts) < 100:
                break
            offset += 100
            time.sleep(0.04)
    p(f"  → {len(seen)} contacts")

unique_emails = list(email_meta.keys())
print(f"     Total unique contacts: {len(unique_emails)}")

# ─── STEP 2: HubSpot email lookup using IN operator ─────────────────────────
print("\n[2/5] Searching HubSpot contacts (IN operator batches)...")
email_to_hs = {}

# HubSpot supports up to 100 values with IN operator
BATCH = 100
for i in range(0, len(unique_emails), BATCH):
    chunk = unique_emails[i:i+BATCH]
    body = {
        "filterGroups": [{"filters": [{
            "propertyName": "email",
            "operator": "IN",
            "values": chunk
        }]}],
        "properties": ["email", "hs_analytics_source"],
        "limit": 100,
    }
    res = hs_post("/crm/v3/objects/contacts/search", body)
    for c in res.get("results", []):
        e = c.get("properties", {}).get("email", "").lower()
        if e:
            email_to_hs[e] = c
    time.sleep(0.15)

p(f"Matched {len(email_to_hs)}/{len(unique_emails)} contacts in HubSpot")

# ─── STEP 3: Deals per contact ───────────────────────────────────────────────
print("\n[3/5] Fetching associated deals...")
deal_cache = {}

def fetch_deal(deal_id):
    if deal_id in deal_cache:
        return deal_cache[deal_id]
    props = "dealname,dealstage,pipeline,createdate,hubspot_owner_id,hs_analytics_source,amount,hs_lastmodifieddate"
    d = hs_get(f"/crm/v3/objects/deals/{deal_id}", f"properties={props}")
    deal_cache[deal_id] = d
    return d

def deals_for_contact(contact_id):
    assoc = hs_get(f"/crm/v3/objects/contacts/{contact_id}/associations/deals")
    ids   = [r["id"] for r in assoc.get("results", [])]
    out   = []
    for did in ids:
        d = fetch_deal(did)
        if d.get("properties", {}).get("pipeline") in TARGET_PIPELINES:
            out.append(d)
    return out

def domain_deal_search(domain):
    part = domain.split(".")[0].lower()
    if len(part) < 3:
        return []
    body = {
        "filterGroups": [{"filters": [
            {"propertyName": "pipeline", "operator": "IN",
             "values": list(TARGET_PIPELINES.keys())}
        ]}],
        "query": part,
        "properties": ["dealname","dealstage","pipeline","createdate",
                       "hubspot_owner_id","hs_analytics_source","amount","hs_lastmodifieddate"],
        "limit": 5,
    }
    res = hs_post("/crm/v3/objects/deals/search", body)
    return [d for d in res.get("results", [])
            if part in d.get("properties", {}).get("dealname", "").lower()]

email_to_deals = {}

# Parallel deal fetch for email-matched contacts
def fetch_email_deals(email_contact_pair):
    email, contact = email_contact_pair
    return email, deals_for_contact(contact["id"])

with ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(fetch_email_deals, (e, c)): e for e, c in email_to_hs.items()}
    for fut in as_completed(futs):
        try:
            email, deals = fut.result()
            email_to_deals[email] = deals
        except Exception:
            pass

# Domain fallback for unmatched
unmatched      = [e for e in unique_emails if e not in email_to_hs]
unmatched_doms = {e.split("@")[-1] for e in unmatched if "@" in e}
p(f"Domain fallback for {len(unmatched_doms)} domains...")
domain_to_deals = {}

with ThreadPoolExecutor(max_workers=6) as ex:
    futs = {ex.submit(domain_deal_search, dom): dom for dom in unmatched_doms}
    for fut in as_completed(futs):
        dom = futs[fut]
        try:
            deals = fut.result()
            if deals:
                domain_to_deals[dom] = deals
        except Exception:
            pass

total = sum(len(v) for v in email_to_deals.values()) + sum(len(v) for v in domain_to_deals.values())
p(f"Total deal matches: {total}")

# ─── STEP 4: HubSpot logged emails (BD email overlap — see app/api/attribution/route.ts) ─
# Legacy script: kept for rough CLI runs. Production logic: Lemlist emailsSent window ∩ HS outbound emails.
print("\n[4/5] Checking HubSpot logged emails on deals (simplified; prefer Next API for full logic)...")
act_cache = {}

def bd_activities(deal_id):
    if deal_id in act_cache:
        return act_cache[deal_id]
    out = []
    assoc = hs_get(f"/crm/v3/objects/deals/{deal_id}/associations/emails")
    ids = [r["id"] for r in assoc.get("results", [])][:50]
    for eid in ids:
        qp = "properties=hs_timestamp,hubspot_owner_id,hs_email_direction"
        eng = hs_get(f"/crm/v3/objects/emails/{eid}", qp)
        pr = eng.get("properties", {})
        if (pr.get("hs_email_direction") or "") == "INCOMING_EMAIL":
            continue
        ts = pr.get("hs_timestamp") or pr.get("createdate") or ""
        try:
            ts_ms = int(float(ts)) if ts else 0
        except Exception:
            ts_ms = 0
        if Q1_START_MS <= ts_ms <= Q1_END_MS:
            date = datetime.datetime.utcfromtimestamp(ts_ms / 1000).strftime("%Y-%m-%d") if ts_ms else ""
            out.append({"type": "Email (BD)", "date": date, "owner_id": pr.get("hubspot_owner_id", "—")})
    act_cache[deal_id] = out
    return out

# Collect all unique deal IDs that have matches
all_deal_ids = set()
for deals in email_to_deals.values():
    for d in deals:
        if d.get("id"):
            all_deal_ids.add(d["id"])
for deals in domain_to_deals.values():
    for d in deals:
        if d.get("id"):
            all_deal_ids.add(d["id"])

p(f"Checking {len(all_deal_ids)} unique deals for BD activity...")
with ThreadPoolExecutor(max_workers=10) as ex:
    futs = {ex.submit(bd_activities, did): did for did in all_deal_ids}
    done = 0
    for fut in as_completed(futs):
        done += 1
        if done % 50 == 0:
            p(f"  {done}/{len(all_deal_ids)} deals checked")

# ─── STEP 5: Build tables ─────────────────────────────────────────────────────
print("\n[5/5] Building tables...")

table1, table2 = [], []
processed = set()

def fmt_amount(raw):
    try:
        return f"${int(float(raw)):,}" if raw else "—"
    except Exception:
        return "—"

def process(email, cam_id, cam_name):
    key = (email, cam_id)
    if key in processed:
        return
    processed.add(key)

    meta    = email_meta.get(email, {})
    company = meta.get("company") or meta.get("domain") or email
    hs_c    = email_to_hs.get(email, {})
    hs_src  = hs_c.get("properties", {}).get("hs_analytics_source", "") if hs_c else ""

    deals = email_to_deals.get(email)
    if deals is None:
        dom   = email.split("@")[-1] if "@" in email else ""
        deals = domain_to_deals.get(dom, [])

    if not deals:
        table1.append({"company": company, "campaign": cam_name, "deal_name": "—",
                        "stage": "—", "pipeline": "—", "amount": "—",
                        "hs_source": hs_src or "—", "flag": "NO DEAL FOUND"})
        return

    for deal in deals:
        pr      = deal.get("properties", {})
        did     = deal.get("id", "")
        src     = (pr.get("hs_analytics_source") or "").strip()
        pipeline = TARGET_PIPELINES.get(pr.get("pipeline", ""), "—")
        stage   = DEAL_STAGE_MAP.get(pr.get("dealstage", ""), pr.get("dealstage", "") or "—")
        amount  = fmt_amount(pr.get("amount"))
        dname   = pr.get("dealname", "—")
        owner   = pr.get("hubspot_owner_id", "—")

        flag = ("CORRECT" if src.upper() == "EMAIL_MARKETING"
                else f"MISATTRIBUTED ({src})" if src
                else "MISATTRIBUTED (no source)")

        table1.append({"company": company, "campaign": cam_name, "deal_name": dname,
                        "stage": stage, "pipeline": pipeline, "amount": amount,
                        "hs_source": src or "—", "flag": flag, "deal_id": did})

        if did:
            for act in (act_cache.get(did) or []):
                table2.append({"company": company, "campaign": cam_name,
                                "deal_name": dname, "owner_id": act["owner_id"],
                                "act_type": act["type"], "act_date": act["date"],
                                "amount": amount})

for email, meta in email_meta.items():
    for cam_id in meta["campaigns"]:
        process(email, cam_id, CAMPAIGNS.get(cam_id, cam_id))

# ─── TABLE 1 ─────────────────────────────────────────────────────────────────
W = 138
print("\n" + "="*W)
print("TABLE 1 — ATTRIBUTION MISSES")
print("="*W)
print(f"{'Company':<28} {'Campaign':<32} {'Deal Name':<30} {'Stage':<22} {'Amount':>10}  {'HS Source':<24} {'Flag'}")
print("-"*W)
table1.sort(key=lambda r: (r["flag"], r["campaign"], r["company"]))
for r in table1:
    print(f"{r['company'][:27]:<28} {r['campaign'][:31]:<32} {r['deal_name'][:29]:<30} "
          f"{r['stage'][:21]:<22} {r['amount']:>10}  {r['hs_source'][:23]:<24} {r['flag']}")

# ─── TABLE 2 ─────────────────────────────────────────────────────────────────
print("\n" + "="*W)
print("TABLE 2 — BD OVERLAPS  (HubSpot logged emails; full overlap window = Next API)")
print("="*W)
if not table2:
    print("  No BD activity overlaps detected in Q1 2026.")
else:
    print(f"{'Company':<28} {'Campaign':<32} {'Deal Name':<30} {'Owner ID':<18} {'Type':<10} {'Date':<12} {'Amount':>10}")
    print("-"*W)
    for r in sorted(table2, key=lambda r: (r["campaign"], r["company"])):
        print(f"{r['company'][:27]:<28} {r['campaign'][:31]:<32} {r['deal_name'][:29]:<30} "
              f"{r['owner_id'][:17]:<18} {r['act_type']:<10} {r['act_date']:<12} {r['amount']:>10}")

# ─── SUMMARY ─────────────────────────────────────────────────────────────────
print("\n" + "="*W)
print("SUMMARY")
print("="*W)

flag_counts = Counter(r["flag"] for r in table1)
flag_value  = defaultdict(int)
for r in table1:
    try:
        v = int(r["amount"].replace("$","").replace(",","")) if r["amount"] != "—" else 0
        flag_value[r["flag"]] += v
    except Exception:
        pass

print("\nAttribution flags (all campaigns):")
for flag, count in sorted(flag_counts.items()):
    print(f"  {flag:<54} {count:>4} records   ${flag_value[flag]:>12,} pipeline")

print("\nPer-campaign breakdown:")
cam_stats = defaultdict(lambda: {"total":0,"no_deal":0,"correct":0,"misattrib":0,"value":0})
for r in table1:
    c = cam_stats[r["campaign"]]
    c["total"] += 1
    if "NO DEAL" in r["flag"]:   c["no_deal"]   += 1
    elif r["flag"] == "CORRECT": c["correct"]   += 1
    else:                        c["misattrib"] += 1
    try:
        c["value"] += int(r["amount"].replace("$","").replace(",","")) if r["amount"] != "—" else 0
    except Exception:
        pass

overlap_by_cam = Counter(r["campaign"] for r in table2)
for cam_name in CAMPAIGNS.values():
    d = cam_stats[cam_name]
    if not d["total"]:
        print(f"\n  {cam_name}  — no data")
        continue
    print(f"\n  {cam_name}")
    print(f"    Contacts: {d['total']}  |  No deal: {d['no_deal']}  |  Correct attr: {d['correct']}  "
          f"|  Misattributed: {d['misattrib']}  |  Linked pipeline: ${d['value']:,}")
    print(f"    BD overlap cases: {overlap_by_cam.get(cam_name, 0)}")

seen_deals, overlap_value = set(), 0
for r in table2:
    if r["deal_name"] not in seen_deals:
        seen_deals.add(r["deal_name"])
        try:
            overlap_value += int(r["amount"].replace("$","").replace(",","")) if r["amount"] != "—" else 0
        except Exception:
            pass

print(f"\nTotal BD overlap activity records:     {len(table2)}")
print(f"Unique deals with BD overlap:          {len(seen_deals)}")
print(f"Pipeline at risk (unique deal values): ${overlap_value:,}")
print("\n✓ Done.")
