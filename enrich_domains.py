#!/usr/bin/env python3
"""
Enrich publisher list with domains from SensorTower.

Usage (from the outbound-attribution directory):
    python enrich_domains.py

Requires:
    SENSORTOWER_API_TOKEN (or SENSORTOWER_API_KEY) env var set,
    or a .env.local file in the same directory.

Input:
    ./data/Mediation_Target_List__APD_SDK__-_Unique_publishers_-_No_Domain.csv

Output:
    ./data/Mediation_Target_List__APD_SDK__-_Unique_publishers_-_No_Domain_enriched.csv
    ./data/Mediation_Target_List__APD_SDK__-_Unique_publishers_-_No_Domain_checkpoint.json
"""

import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

# ── Load .env.local if env vars aren't already set ───────────────────────────
_env_file = Path(__file__).parent / ".env.local"
if _env_file.exists():
    with open(_env_file) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

# ── Config ───────────────────────────────────────────────────────────────────
INPUT_CSV = "./data/Mediation_Target_List__APD_SDK__-_Unique_publishers_-_No_Domain.csv"
CHECKPOINT_EVERY = 100
MAX_RETRIES = 5
INITIAL_BACKOFF = 2.0   # seconds, doubles on each 429
REQUEST_DELAY = 0.25    # seconds between calls

ST_BASE = "https://api.sensortower.com"

TOKEN = os.environ.get("SENSORTOWER_API_TOKEN") or os.environ.get("SENSORTOWER_API_KEY")
if not TOKEN:
    sys.exit(
        "Error: SENSORTOWER_API_TOKEN not found.\n"
        "Set it in your environment or in .env.local."
    )

# ── Optional tldextract for accurate eTLD+1 extraction ───────────────────────
try:
    import tldextract as _tldextract
    def registered_domain(url: str) -> str | None:
        ext = _tldextract.extract(url)
        if ext.domain and ext.suffix:
            return f"{ext.domain}.{ext.suffix}"
        return ext.domain or None
except ImportError:
    def registered_domain(url: str) -> str | None:  # type: ignore[misc]
        """Fallback: strip subdomains by taking last 2 (or 3 for .co.uk etc.) parts."""
        try:
            parsed = urlparse(url if "://" in url else "https://" + url)
            host = parsed.netloc.lower().lstrip("www.")
            parts = host.split(".")
            # Heuristic: country SLDs like co.uk, com.au, co.jp, net.au …
            COUNTRY_SLDS = {"co", "com", "net", "org", "gov", "edu", "ac"}
            if len(parts) >= 3 and parts[-2] in COUNTRY_SLDS:
                return ".".join(parts[-3:])
            return ".".join(parts[-2:]) if len(parts) >= 2 else host or None
        except Exception:
            return None


# ── Name normalisation ───────────────────────────────────────────────────────
def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


_LEGAL = (
    "inc", "corp", "ltd", "llc", "co", "gmbh", "ag", "sa", "plc",
    "group", "holdings", "holding", "international", "technologies",
    "technology", "software", "solutions", "services", "systems",
    "digital", "global", "worldwide", "studios", "studio", "games",
    "entertainment", "mobile", "interactive",
)
_LEGAL_PAT = re.compile(
    r"\b(" + "|".join(_LEGAL) + r")\.?\b", re.IGNORECASE
)


def clean_name(name: str) -> str:
    return re.sub(r"\s+", " ", _LEGAL_PAT.sub("", name)).strip()


def names_match(query: str, candidate: str) -> bool:
    a, b = norm(query), norm(candidate)
    return len(a) > 2 and len(b) > 2 and (a in b or b in a)


# ── HTTP helper ───────────────────────────────────────────────────────────────
def st_get(path: str) -> object:
    sep = "&" if "?" in path else "?"
    url = f"{ST_BASE}{path}{sep}auth_token={TOKEN}"
    backoff = INITIAL_BACKOFF
    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 429:
                print(f"  [rate limit] sleeping {backoff:.0f}s …", flush=True)
                time.sleep(backoff)
                backoff = min(backoff * 2, 120)
                continue
            if e.code in (401, 403):
                raise RuntimeError(f"Auth error {e.code} — check SENSORTOWER_API_TOKEN") from e
            raise
        except OSError as e:
            last_err = e
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
    raise RuntimeError(f"Failed after {MAX_RETRIES} retries ({last_err}): {path}")


# ── SensorTower lookups ───────────────────────────────────────────────────────
def search_publishers(name: str, store: str) -> list[dict]:
    """Return deduped list of plausible publisher matches on a given store."""
    cleaned = clean_name(name)
    words = cleaned.split()
    first_word = words[0] if words else name
    seen_ids: set[str] = set()
    matches: list[dict] = []

    for term in dict.fromkeys([name, cleaned, first_word]):  # ordered dedup
        if not term:
            continue
        try:
            time.sleep(REQUEST_DELAY)
            results = st_get(
                f"/v1/{store}/search_entities"
                f"?term={urllib.parse.quote(term)}&entity_type=publisher"
            )
        except Exception as e:
            print(f"  [warn] search_entities('{term}', {store}): {e}", flush=True)
            continue
        if not isinstance(results, list):
            continue
        for pub in results:
            pid = str(pub.get("publisher_id", ""))
            if pid and pid not in seen_ids and names_match(name, pub.get("publisher_name", "")):
                seen_ids.add(pid)
                matches.append(pub)

    return matches


def get_domain_for_publisher(publisher_id: str | int, store: str) -> str | None:
    """Fetch the publisher's top app → get its website_url → extract domain."""
    try:
        time.sleep(REQUEST_DELAY)
        resp = st_get(
            f"/v1/{store}/publishers/{publisher_id}/apps"
            f"?limit=1&sort_by=downloads"
        )
        apps = resp.get("data", []) if isinstance(resp, dict) else []
        if not apps:
            return None
        app_id = apps[0].get("app_id")
        if not app_id:
            return None

        time.sleep(REQUEST_DELAY)
        detail = st_get(f"/v1/{store}/apps?app_ids={urllib.parse.quote(str(app_id))}")
        if not isinstance(detail, dict):
            return None
        app_list = detail.get("apps", [])
        if not app_list:
            return None
        website_url = app_list[0].get("website_url")
        return registered_domain(website_url) if website_url else None
    except Exception as e:
        print(f"  [warn] get_domain({publisher_id}, {store}): {e}", flush=True)
        return None


def resolve_publisher(name: str, location: str) -> dict:
    """
    Returns dict with keys:
      domain       : str | None
      confidence   : "High" | "Ambiguous" | "No match"
      candidates   : str  (pipe-separated list for Ambiguous, else "")
    """
    ios_matches = search_publishers(name, "ios")
    android_matches = search_publishers(name, "android")

    # Merge stores, deduplicate by normalised publisher name.
    # When a publisher appears on both stores, prefer iOS for domain lookup.
    merged: dict[str, dict] = {}  # norm_name → {pub, store}
    for pub in ios_matches:
        k = norm(pub["publisher_name"])
        if k not in merged:
            merged[k] = {"pub": pub, "store": "ios"}
    for pub in android_matches:
        k = norm(pub["publisher_name"])
        if k not in merged:
            merged[k] = {"pub": pub, "store": "android"}

    unique = list(merged.values())

    if not unique:
        return {"domain": None, "confidence": "No match", "candidates": ""}

    # ── Single match ──────────────────────────────────────────────────────────
    if len(unique) == 1:
        entry = unique[0]
        pub = entry["pub"]

        # If location is known, verify country as a sanity check (soft — don't
        # reject if the API returns null for publisher_country).
        pub_country = (pub.get("publisher_country") or "").strip()
        if location and pub_country and not names_match(location, pub_country):
            # Country mismatch — downgrade to Ambiguous so user can verify
            domain = get_domain_for_publisher(pub["publisher_id"], entry["store"])
            return {
                "domain": None,
                "confidence": "Ambiguous",
                "candidates": (
                    f"{pub['publisher_name']} ({pub_country}) "
                    f"→ {domain or 'no domain'} "
                    f"[location mismatch: expected {location}]"
                ),
            }

        domain = get_domain_for_publisher(pub["publisher_id"], entry["store"])
        if domain:
            return {"domain": domain, "confidence": "High", "candidates": ""}
        # Publisher found but couldn't get a domain
        return {
            "domain": None,
            "confidence": "Ambiguous",
            "candidates": f"{pub['publisher_name']} ({pub_country or '?'}) → no domain",
        }

    # ── Multiple distinct publishers ──────────────────────────────────────────
    # Try to narrow by location before giving up
    if location:
        location_filtered = [
            e for e in unique
            if names_match(location, e["pub"].get("publisher_country") or "")
        ]
        if len(location_filtered) == 1:
            entry = location_filtered[0]
            domain = get_domain_for_publisher(entry["pub"]["publisher_id"], entry["store"])
            if domain:
                return {"domain": domain, "confidence": "High", "candidates": ""}

    # Still ambiguous — collect all candidates with their domains
    candidate_parts: list[str] = []
    for entry in unique:
        pub = entry["pub"]
        domain = get_domain_for_publisher(pub["publisher_id"], entry["store"])
        country = pub.get("publisher_country") or "?"
        candidate_parts.append(
            f"{pub['publisher_name']} ({country}) → {domain or 'no domain'}"
        )

    return {
        "domain": None,
        "confidence": "Ambiguous",
        "candidates": " | ".join(candidate_parts),
    }


# ── Checkpoint helpers ────────────────────────────────────────────────────────
def checkpoint_path(output_path: str) -> str:
    return output_path.replace("_enriched.csv", "_checkpoint.json")


def load_checkpoint(output_path: str) -> dict:
    cp = checkpoint_path(output_path)
    if Path(cp).exists():
        with open(cp) as f:
            data = json.load(f)
        print(f"Resuming from checkpoint — {len(data)} rows already processed.", flush=True)
        return data
    return {}


def save_checkpoint(output_path: str, results: dict) -> None:
    cp = checkpoint_path(output_path)
    with open(cp, "w") as f:
        json.dump(results, f)


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    input_path = Path(INPUT_CSV)
    if not input_path.exists():
        sys.exit(
            f"Input file not found: {INPUT_CSV}\n"
            f"Make sure you run this script from the outbound-attribution directory\n"
            f"and that the file exists at ./data/<filename>.csv"
        )

    output_path = str(input_path.parent / (input_path.stem + "_enriched.csv"))

    with open(input_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        original_fieldnames: list[str] = list(reader.fieldnames or [])

    print(f"Loaded {len(rows):,} rows from {INPUT_CSV}", flush=True)

    # Build output fieldnames: keep originals, add/replace Domain + new cols
    extra = ["Domain", "Match Confidence", "Candidate Matches"]
    out_fieldnames = [c for c in original_fieldnames if c not in extra] + extra

    checkpoint = load_checkpoint(output_path)
    counts: dict[str, int] = {"High": 0, "Ambiguous": 0, "No match": 0}

    for i, row in enumerate(rows):
        idx = str(i)

        if idx in checkpoint:
            saved = checkpoint[idx]
            row["Domain"] = saved.get("domain") or ""
            row["Match Confidence"] = saved["confidence"]
            row["Candidate Matches"] = saved.get("candidates", "")
            counts[saved["confidence"]] = counts.get(saved["confidence"], 0) + 1
            continue

        publisher = row.get("Publisher", "").strip()
        location = row.get("Publisher location", "").strip()
        category = row.get("Category", "").strip()

        print(
            f"[{i+1}/{len(rows)}] {publisher!r}"
            + (f"  [{location}]" if location else "")
            + (f"  [{category}]" if category else ""),
            flush=True, end=" … ",
        )

        if not publisher:
            result: dict = {"domain": None, "confidence": "No match", "candidates": ""}
        else:
            try:
                result = resolve_publisher(publisher, location)
            except Exception as e:
                print(f"\n  [error] {e}", flush=True)
                result = {"domain": None, "confidence": "No match", "candidates": str(e)[:200]}

        row["Domain"] = result["domain"] or ""
        row["Match Confidence"] = result["confidence"]
        row["Candidate Matches"] = result["candidates"]
        counts[result["confidence"]] = counts.get(result["confidence"], 0) + 1
        print(f"{result['confidence']} → {result['domain'] or '(none)'}", flush=True)

        checkpoint[idx] = result
        if (i + 1) % CHECKPOINT_EVERY == 0:
            save_checkpoint(output_path, checkpoint)
            print(
                f"  --- checkpoint saved ({i+1} rows | "
                f"High: {counts['High']}  Ambiguous: {counts['Ambiguous']}  "
                f"No match: {counts['No match']}) ---",
                flush=True,
            )

    # Final checkpoint + output
    save_checkpoint(output_path, checkpoint)

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=out_fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    total = len(rows)
    print(f"\n{'─' * 52}")
    print(f"Output : {output_path}")
    print(f"{'─' * 52}")
    print(f"Total      : {total:>6,}")
    print(f"High       : {counts.get('High', 0):>6,}  ({counts.get('High', 0)/total*100:.1f}%)")
    print(f"Ambiguous  : {counts.get('Ambiguous', 0):>6,}  ({counts.get('Ambiguous', 0)/total*100:.1f}%)")
    print(f"No match   : {counts.get('No match', 0):>6,}  ({counts.get('No match', 0)/total*100:.1f}%)")
    print(f"{'─' * 52}")


if __name__ == "__main__":
    main()
