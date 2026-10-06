#!/usr/bin/env python3
"""
Merge additional Ward Directory / Map PDFs into data/members.json
without wiping prior report-import meta (budget, lost, ministering, etc.).

Sources:
  - 147th Ward Directory and Map (full roster refresh)
  - Bishopric / Aaronic Priesthood Quorums / Assigned Missionaries subsets
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber
from pypdf import PdfReader

UPLOADS = Path("/home/ubuntu/.cursor/projects/workspace/uploads")
MEMBERS_PATH = Path("/workspace/data/members.json")
SAMPLE_PATH = Path("/workspace/data/members.sample.json")
PHOTO_DIR = Path("/workspace/data/photos")

sys.path.insert(0, "/workspace/scripts")
from parse_directory_pdf import (  # noqa: E402
    LETTER_RE,
    group_apartments,
    is_skip,
    parse_lines,
)
from rebuild_from_pdfs import (  # noqa: E402
    apply_callings,
    extract_org_photos,
    find_member,
    member_index,
    mid_for,
    parse_assigned_missionaries,
    parse_main_directory,
    parse_org_callings,
)

MAIN_PDF = UPLOADS / "147th_Ward_Directory_and_Map_10-05-26_24db.pdf"
BISHOPRIC_PDF = UPLOADS / "Bishopric___Ward_Directory_and_Map_1150.pdf"
AARONIC_PDF = UPLOADS / "Aaronic_Priesthood_Quorums___Ward_Directory_and_Map_6f69.pdf"
ASSIGNED_PDF = UPLOADS / "Assigned_Missionaries___Ward_Directory_and_Map_e02c.pdf"
# Prefer newest Organizations map when present for photos
ORG_CANDIDATES = [
    UPLOADS / "Organizations_147th_Ward_Directory_and_Map_b20c.pdf",
    UPLOADS / "Organizations_147th_Ward_Directory_and_Map_70d6.pdf",
]


def default_flags():
    return {
        "returnedMissionary": False,
        "inactive": False,
        "doNotContact": False,
        "solid": False,
        "endowed": False,
    }


def normalize_member(m: dict) -> dict:
    flags = {**default_flags(), **(m.get("flags") or {})}
    if "superSolid" in flags:
        flags["solid"] = flags.get("solid") or flags.pop("superSolid")
    m = {
        **m,
        "gender": m.get("gender") or "",
        "birthday": m.get("birthday") or "",
        "photoSource": m.get("photoSource")
        or ("ward-directory" if m.get("photoUrl") else "missing"),
        "flags": flags,
        "covenantPath": {
            "baptized": False,
            "confirmed": False,
            "endowed": flags.get("endowed", False),
            "latestConvert": False,
            "notes": "",
            **(m.get("covenantPath") or {}),
        },
        "moved": m.get("moved") or {"status": "", "date": "", "notes": ""},
        "lostMember": bool(m.get("lostMember")),
        "ministering": m.get("ministering")
        or {"role": "", "companions": [], "ministeringTo": []},
        "languages": m.get("languages") or [],
        "callings": m.get("callings") or [],
        "notes": m.get("notes") or "",
    }
    return m


def merge_member(prev: dict | None, incoming: dict) -> dict:
    if not prev:
        return normalize_member(incoming)
    photo = prev.get("photoUrl") or ""
    keep_leader_photo = photo.startswith("data:")
    merged = {
        **incoming,
        "id": prev.get("id") or incoming.get("id"),
        "preferredName": prev.get("preferredName") or incoming.get("preferredName"),
        "photoUrl": photo if keep_leader_photo else (incoming.get("photoUrl") or photo or ""),
        "photoSource": (
            "leader-upload"
            if keep_leader_photo
            else (
                incoming.get("photoSource")
                or prev.get("photoSource")
                or ("ward-directory" if (incoming.get("photoUrl") or photo) else "missing")
            )
        ),
        "languages": prev.get("languages") or incoming.get("languages") or [],
        "gender": prev.get("gender") or incoming.get("gender") or "",
        "birthday": prev.get("birthday") or incoming.get("birthday") or "",
        "flags": {**default_flags(), **(incoming.get("flags") or {}), **(prev.get("flags") or {})},
        "ministering": prev.get("ministering") or incoming.get("ministering"),
        "notes": prev.get("notes") or "",
        "covenantPath": {
            **(incoming.get("covenantPath") or {}),
            **(prev.get("covenantPath") or {}),
        },
        "moved": prev.get("moved") or incoming.get("moved") or {"status": "", "date": "", "notes": ""},
        "lostMember": prev.get("lostMember") or incoming.get("lostMember") or False,
        "phone": incoming.get("phone") or prev.get("phone") or "",
        "email": incoming.get("email") or prev.get("email") or "",
        "callings": list(
            dict.fromkeys((incoming.get("callings") or []) + (prev.get("callings") or []))
        ),
        "address": incoming.get("address") or prev.get("address") or "",
        "street": incoming.get("street") or prev.get("street") or "",
        "unit": incoming.get("unit") or prev.get("unit") or "",
        "complex": incoming.get("complex") or prev.get("complex") or "",
        "city": incoming.get("city") or prev.get("city") or "",
        "coords": incoming.get("coords") or prev.get("coords") or "",
        "livesAtOldMill": incoming.get("livesAtOldMill", prev.get("livesAtOldMill")),
    }
    return normalize_member(merged)


def all_members(d: dict) -> list[dict]:
    return [m for a in d.get("apartments", []) for m in a.get("members", [])]


def reindex_apartments(members: list[dict]) -> list[dict]:
    # Prefer existing group_apartments from parser when possible
    try:
        return group_apartments(members)
    except Exception:
        # Fallback: keep flat apartments by complex|unit|street
        buckets: dict[str, dict] = {}
        for m in members:
            key = f"{m.get('complex')}|{m.get('unit')}|{m.get('street')}"
            if key not in buckets:
                buckets[key] = {
                    "id": "apt-" + hashlib.md5(key.encode()).hexdigest()[:10],
                    "complex": m.get("complex") or "Other / Unassigned",
                    "unit": m.get("unit") or "—",
                    "address": m.get("street") or m.get("address") or "",
                    "city": m.get("city") or "",
                    "members": [],
                }
            buckets[key]["members"].append(m)
        return sorted(buckets.values(), key=lambda a: f"{a['complex']} {a['unit']}")


def upsert_from_directory(d: dict, pdf_path: Path) -> int:
    incoming = parse_main_directory(pdf_path)
    print("directory members parsed", len(incoming), "from", pdf_path.name)
    by_name = {m["fullName"].lower(): m for m in all_members(d)}
    by_id = {m["id"]: m for m in all_members(d)}
    upserted: dict[str, dict] = {}

    for inc in incoming:
        prev = by_name.get(inc["fullName"].lower()) or by_id.get(inc.get("id"))
        # also try preferred+last
        if not prev:
            for m in by_name.values():
                if m["lastName"].lower() == inc["lastName"].lower() and (
                    inc["legalFirst"].split()[0].lower() in m["fullName"].lower()
                ):
                    prev = m
                    break
        merged = merge_member(prev, inc)
        # preserve Old Mill flag heuristic
        street = merged.get("street") or ""
        if "livesAtOldMill" not in merged or merged["livesAtOldMill"] is None:
            merged["livesAtOldMill"] = bool(re.search(r"1720\s*N", street, re.I))
        upserted[merged["fullName"].lower()] = merged

    # Keep members not in the new directory (e.g. assigned missionaries, Lori Berrett, meta-only)
    for prev in all_members(d):
        key = prev["fullName"].lower()
        if key not in upserted:
            # Drop only if clearly a stale duplicate of an upserted person
            upserted[key] = normalize_member(prev)

    members = list(upserted.values())
    d["apartments"] = reindex_apartments(members)
    return len(incoming)


def extract_assigned_photos(pdf_path: Path, missionaries: list[dict]) -> int:
    """Pair page JPEG photos with Elder names in order."""
    if not pdf_path.exists() or not missionaries:
        return 0
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(str(pdf_path))
    saved = 0
    with pdfplumber.open(pdf_path) as pdf:
        for pi, page in enumerate(pdf.pages):
            xobj = reader.pages[pi].get("/Resources", {}).get("/XObject")
            if xobj is None:
                continue
            xobj = xobj.get_object()
            jpegs = []
            seen = set()
            for obj_name in xobj:
                obj = xobj[obj_name]
                if obj.get("/Subtype") != "/Image":
                    continue
                data = obj.get_data()
                if data[:2] != b"\xff\xd8":
                    continue
                h = hashlib.md5(data).hexdigest()
                if h in seen:
                    continue
                seen.add(h)
                jpegs.append(data)
            for i, data in enumerate(jpegs):
                if i >= len(missionaries):
                    break
                m = missionaries[i]
                dest = PHOTO_DIR / f"{m['id']}.jpg"
                dest.write_bytes(data)
                m["photoUrl"] = f"data/photos/{m['id']}.jpg"
                m["photoSource"] = "ward-directory"
                saved += 1
                print("missionary photo", m["fullName"], "->", dest.name)
    return saved


def ensure_assigned(d: dict, pdf_path: Path) -> int:
    assigned = parse_assigned_missionaries(pdf_path)
    print("assigned missionaries parsed", [a["fullName"] for a in assigned])
    extract_assigned_photos(pdf_path, assigned)

    members = all_members(d)
    # Drop bad combined Elder names from earlier buggy imports
    members = [
        m
        for m in members
        if not (m.get("fullName", "").startswith("Elder ") and " Elder " in m.get("fullName", ""))
    ]
    by_name = {m["fullName"].lower(): m for m in members}
    added = 0
    for a in assigned:
        a = normalize_member(a)
        a["flags"]["solid"] = True
        a["complex"] = "Assigned Missionaries"
        a["livesAtOldMill"] = False
        key = a["fullName"].lower()
        if key in by_name:
            prev = by_name[key]
            if a.get("photoUrl") and not (prev.get("photoUrl") or "").startswith("data:"):
                prev["photoUrl"] = a["photoUrl"]
                prev["photoSource"] = "ward-directory"
            if a.get("email") and not prev.get("email"):
                prev["email"] = a["email"]
            for c in a.get("callings") or []:
                if c not in prev.get("callings", []):
                    prev.setdefault("callings", []).append(c)
        else:
            members.append(a)
            added += 1
    d["apartments"] = reindex_apartments(members)
    d.setdefault("mission", {})
    d["mission"].update(
        {
            "name": "Utah Provo Mission",
            "office": "85 N 600 E, Provo UT 84606",
            "phone": "+1 801-377-1490",
            "assignedCompanionshipEmail": "500668894@missionary.org",
        }
    )
    return added


def apply_subset(d: dict, pdf_path: Path, label: str) -> tuple[int, int]:
    if not pdf_path.exists():
        print("missing", pdf_path.name)
        return 0, 0
    rows = parse_org_callings(pdf_path)
    apply_callings(all_members(d), rows)
    # Gender hints
    idx = member_index(all_members(d))
    for last, first, calling in rows:
        m = find_member(idx, last, first)
        if not m:
            continue
        if re.search(r"bishop|elders|priests|aaronic|clerk|executive secretary", calling, re.I):
            m["gender"] = m.get("gender") or "M"
    photos = extract_org_photos(pdf_path, idx)
    print(label, "callings", len(rows), "photos", len(photos))
    return len(rows), len(photos)


def main():
    d = json.loads(MEMBERS_PATH.read_text(encoding="utf-8"))
    print("loaded", d["meta"].get("memberCount"), "members")

    if MAIN_PDF.exists():
        upsert_from_directory(d, MAIN_PDF)
    else:
        print("main directory PDF missing", MAIN_PDF)

    for org in ORG_CANDIDATES:
        if org.exists():
            apply_subset(d, org, "organizations")
            break

    apply_subset(d, BISHOPRIC_PDF, "bishopric")
    apply_subset(d, AARONIC_PDF, "aaronic")
    ensure_assigned(d, ASSIGNED_PDF)

    members = all_members(d)
    photos = sum(1 for m in members if m.get("photoUrl"))
    d["ward"] = {
        **d.get("ward", {}),
        "name": "Provo YSA 147th Ward",
        "shortName": "147th Ward",
        "unitNumber": "266485",
        "stake": "Provo Utah YSA 10th Stake",
        "stakeNumber": "511455",
        "source": (
            "147th Ward Directory + Bishopric + Aaronic + Assigned Missionaries "
            "+ Organizations (10-05-26)"
        ),
        "sourceDate": "2026-10-05",
        "note": "Parsed from Church Directory PDFs. For Church use only — confidential.",
    }
    d.setdefault("meta", {})
    d["meta"]["memberCount"] = len(members)
    d["meta"]["apartmentCount"] = len(d["apartments"])
    d["meta"]["photoCount"] = photos
    d["meta"]["lastEditedBy"] = "Directory Supplement Import"
    d["meta"]["lastEditedAt"] = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    sources = set(d["meta"].get("reportSources") or [])
    for name in [
        MAIN_PDF.name,
        BISHOPRIC_PDF.name,
        AARONIC_PDF.name,
        ASSIGNED_PDF.name,
    ]:
        if (UPLOADS / name).exists() or True:
            sources.add(name.replace("___", " · ").replace("_", " "))
    d["meta"]["reportSources"] = sorted(sources)

    MEMBERS_PATH.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")
    SAMPLE_PATH.write_text(MEMBERS_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    print("wrote", MEMBERS_PATH, "members", len(members), "photos", photos)


if __name__ == "__main__":
    main()
