#!/usr/bin/env python3
"""Rebuild data/members.json from Church Directory PDFs + org photos."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import pdfplumber
from pypdf import PdfReader

UPLOADS = Path("/home/ubuntu/.cursor/projects/workspace/uploads")
MAIN_PDF = UPLOADS / "147th_Ward_Directory_and_Map_10-05-26_93c8.pdf"
ORG_PDF = UPLOADS / "Organizations_147th_Ward_Directory_and_Map_70d6.pdf"
WARD_MISSIONARY_PDF = UPLOADS / "Ward_Missionaries___Ward_Directory_and_Map_2b15.pdf"
ASSIGNED_MISSIONARY_PDF = UPLOADS / "Assigned_Missionaries___Ward_Directory_and_Map_be28.pdf"
OUT_JSON = Path("/workspace/data/members.json")
OUT_SAMPLE = Path("/workspace/data/members.sample.json")
PHOTO_DIR = Path("/workspace/data/photos")

# Reuse main directory parser
sys.path.insert(0, "/workspace/scripts")
from parse_directory_pdf import (  # noqa: E402
    LETTER_RE,
    NAME_LINE_RE,
    group_apartments,
    is_skip,
    parse_lines,
)

CALLING_LINE_HINTS = (
    "Bishop",
    "Counselor",
    "President",
    "Secretary",
    "Clerk",
    "Teacher",
    "Missionary",
    "Coordinator",
    "Leader",
    "Consultant",
    "Specialist",
    "Committee",
    "Representative",
    "Accompanist",
    "Social Media",
    "Building Representative",
)


def mid_for(full_name: str) -> str:
    return "m-" + hashlib.md5(full_name.lower().encode()).hexdigest()[:10]


def parse_main_directory(pdf_path: Path) -> list[dict]:
    lines: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for raw in text.splitlines():
                line = raw.strip()
                if is_skip(line) or LETTER_RE.match(line):
                    continue
                lines.append(line)
    return parse_lines(lines)


def normalize_key(last: str, first: str) -> str:
    return f"{last.strip().lower()}|{first.strip().lower()}"


def member_index(members: list[dict]) -> dict[str, dict]:
    idx = {}
    for m in members:
        idx[normalize_key(m["lastName"], m["legalFirst"])] = m
        idx[m["fullName"].lower()] = m
        idx[f"{m['lastName'].lower()}|{m['preferredName'].lower()}"] = m
        # first token of legal first
        first_token = m["legalFirst"].split()[0].lower() if m["legalFirst"] else ""
        idx[f"{m['lastName'].lower()}|{first_token}"] = m
    return idx


def find_member(idx: dict[str, dict], last: str, first: str):
    keys = [
        normalize_key(last, first),
        f"{last.lower()}|{first.split()[0].lower()}",
        f"{first} {last}".lower(),
    ]
    for k in keys:
        if k in idx:
            return idx[k]
    # fuzzy: last name + preferred/legal contains
    last_l = last.lower()
    first_l = first.lower()
    for m in idx.values():
        if m["lastName"].lower() != last_l:
            continue
        if first_l in m["legalFirst"].lower() or first_l in m["preferredName"].lower() or first_l in m["fullName"].lower():
            return m
    return None


def clean_calling(calling: str) -> str:
    calling = re.split(
        r"\d{2}\.\d+|Apt\s|\(\d|PROVO|Provo|Orem|Individual|UNITED STATES|\+\d",
        calling,
        maxsplit=1,
    )[0]
    calling = re.sub(r"\s+", " ", calling).strip(" -–,")
    return calling


def parse_org_callings(pdf_path: Path) -> list[tuple[str, str, str]]:
    """Return list of (last, first, calling)."""
    rows: list[tuple[str, str, str]] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            i = 0
            while i < len(lines):
                line = lines[i]
                if line.startswith("Organizations") or line.startswith("©"):
                    i += 1
                    continue
                m = NAME_LINE_RE.match(line.replace(" Individual", ""))
                # Organizations format: "Last, First ADDRESS" sometimes split
                m2 = re.match(
                    r"^([A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]*(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]*)*),\s+([A-Za-zÀ-ÿ'’\-\s]+?)(?:\s+\d|\s+Apt|\s+apt|\s+State|\s+Orem|\s+Provo|\s+Individual|\s*$)",
                    line,
                )
                if not m2 and "," in line and not line.startswith("Utah"):
                    parts = line.split(",", 1)
                    if len(parts) == 2:
                        last = parts[0].strip()
                        rest = parts[1].strip()
                        first_tokens = []
                        for tok in rest.split():
                            if re.match(r"^\d", tok) or tok.lower() in {"apt", "apartment", "individual", "provo", "orem"}:
                                break
                            first_tokens.append(tok)
                        if first_tokens and re.match(r"^[A-Z]", last):
                            first = " ".join(first_tokens)
                            # calling often on next line
                            calling = ""
                            if i + 1 < len(lines):
                                nxt = lines[i + 1]
                                if any(h in nxt for h in CALLING_LINE_HINTS) and "," not in nxt[:20]:
                                    calling = clean_calling(nxt)
                            if calling:
                                rows.append((last, first, calling))
                            i += 1
                            continue
                if m2:
                    last, first = m2.group(1).strip(), m2.group(2).strip()
                    calling = ""
                    if i + 1 < len(lines):
                        nxt = lines[i + 1]
                        if any(h in nxt for h in CALLING_LINE_HINTS):
                            calling = clean_calling(nxt)
                    if calling:
                        rows.append((last, first, calling))
                i += 1
    return rows


def extract_org_photos(pdf_path: Path, idx: dict[str, dict]) -> dict[str, Path]:
    """Map member id -> photo file path using page image order + name order."""
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(str(pdf_path))
    saved: dict[str, Path] = {}

    with pdfplumber.open(pdf_path) as pdf:
        for pi, page in enumerate(pdf.pages):
            # names in visual order
            lines_map: dict[int, list] = {}
            for c in page.chars:
                y = round(c["top"])
                lines_map.setdefault(y, []).append(c)
            names: list[tuple[str, str]] = []
            seen_local: set[str] = set()
            for y in sorted(lines_map):
                text = "".join(c["text"] for c in sorted(lines_map[y], key=lambda c: c["x0"])).strip()
                if "Organizations" in text or text.startswith("©"):
                    continue
                m = re.match(
                    r"^([A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]*(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]*)*),\s+([A-Za-zÀ-ÿ'’\-]+(?:\s+[A-Za-zÀ-ÿ'’\-]+){0,4})",
                    text,
                )
                if not m:
                    continue
                last, first = m.group(1).strip(), m.group(2).strip()
                # trim trailing address words from first if any slipped
                first_parts = []
                for tok in first.split():
                    if tok.lower() in {"individual", "apt", "provo", "orem"} or re.match(r"^\d", tok):
                        break
                    first_parts.append(tok)
                first = " ".join(first_parts)
                key = f"{last}|{first}"
                if key in seen_local:
                    continue
                seen_local.add(key)
                names.append((last, first))

            # extract jpeg bytes in object order roughly matching visual order via page.images
            images_meta = sorted(page.images, key=lambda im: im["top"])
            xobj = reader.pages[pi].get("/Resources", {}).get("/XObject")
            if xobj is None:
                continue
            xobj = xobj.get_object()
            # Build list of image objects with data in resources order, then sort by page.images tops
            # Collect DCT images from this page resources
            dct_items = []
            for obj_name in xobj:
                obj = xobj[obj_name]
                if obj.get("/Subtype") != "/Image":
                    continue
                if obj.get("/Filter") != "/DCTDecode" and (
                    not isinstance(obj.get("/Filter"), list)
                    or "/DCTDecode" not in [str(f) for f in obj.get("/Filter")]
                ):
                    # still try if DCT
                    filt = obj.get("/Filter")
                    if filt != "/DCTDecode":
                        continue
                data = obj.get_data()
                dct_items.append((str(obj_name), data, obj.get("/Width"), obj.get("/Height")))

            # Heuristic: number of images in page.images should match unique photos drawn;
            # pair names[:len(images)] with jpeg data in resource encounter order filtered by size~200
            jpegs = [(n, d) for n, d, w, h in dct_items if d[:2] == b"\xff\xd8"]
            # Prefer unique by content hash preserving order
            uniq = []
            seen_hash = set()
            for n, d in jpegs:
                h = hashlib.md5(d).hexdigest()
                if h in seen_hash:
                    continue
                seen_hash.add(h)
                uniq.append(d)

            pair_count = min(len(names), len(images_meta), len(uniq))
            for i in range(pair_count):
                last, first = names[i]
                member = find_member(idx, last, first)
                if not member:
                    # try first token only
                    member = find_member(idx, last, first.split()[0])
                if not member:
                    print("no member for photo", last, first)
                    continue
                dest = PHOTO_DIR / f"{member['id']}.jpg"
                dest.write_bytes(uniq[i])
                saved[member["id"]] = dest
                member["photoUrl"] = f"data/photos/{member['id']}.jpg"
                print("photo", member["preferredName"], member["lastName"], "->", dest.name)
    return saved


def apply_callings(members: list[dict], calling_rows: list[tuple[str, str, str]]):
    idx = member_index(members)
    for last, first, calling in calling_rows:
        m = find_member(idx, last, first)
        if not m:
            print("calling unmatched", last, first, calling)
            continue
        if calling and calling not in m["callings"]:
            m["callings"].append(calling)


def parse_assigned_missionaries(pdf_path: Path) -> list[dict]:
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join((p.extract_text() or "") for p in pdf.pages)
    missionaries = []
    emails = re.findall(r"[A-Za-z0-9._%+\-]+@missionary\.org", text)
    # Prefer personal emails (not numeric companionship mailbox)
    personal_emails = [e for e in emails if not re.match(r"^\d+@", e)]
    # Names may appear on one line: "Elder A Elder B"
    names = re.findall(
        r"Elder\s+([A-Z][a-zA-ZÀ-ÿ'’\-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'’\-]+)*?)(?=\s+Elder\b|\s+[a-z0-9._%+\-]+@|\s*$)",
        text,
    )
    if len(names) < 2:
        # Fallback: split on "Elder " tokens
        parts = re.split(r"\bElder\s+", text)
        names = []
        for part in parts[1:]:
            m = re.match(r"([A-Z][a-zA-ZÀ-ÿ'’\-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'’\-]+){1,4})", part)
            if m:
                names.append(m.group(1).strip())
    # dedupe preserving order
    seen = set()
    uniq_names = []
    for n in names:
        n = re.sub(r"\s+", " ", n).strip()
        # Drop if it accidentally still contains another Elder
        if " Elder " in n:
            continue
        if n in seen or len(n.split()) < 2:
            continue
        seen.add(n)
        uniq_names.append(n)
    for i, full in enumerate(uniq_names):
        parts = full.split()
        first = " ".join(parts[:-1])
        last = parts[-1]
        email = personal_emails[i] if i < len(personal_emails) else ""
        missionaries.append(
            {
                "id": mid_for(f"Elder {full}"),
                "lastName": last,
                "legalFirst": first,
                "preferredName": f"Elder {parts[0]}",
                "fullName": f"Elder {full}",
                "photoUrl": "",
                "phone": "",
                "email": email,
                "address": "Utah Provo Mission Office, 85 N 600 E, Provo UT 84606",
                "street": "85 N 600 E",
                "unit": "—",
                "complex": "Assigned Missionaries",
                "city": "Provo UT 84606",
                "coords": "40.235083, -111.647792",
                "callings": ["Assigned Full-Time Missionary"],
                "languages": [],
                "flags": {
                    "returnedMissionary": False,
                    "inactive": False,
                    "doNotContact": False,
                    "solid": True,
                },
                "ministering": {"role": "", "companions": [], "ministeringTo": []},
                "notes": "Utah Provo Mission companionship assigned to the ward.",
            }
        )
    return missionaries


def main():
    print("Parsing main directory…")
    members = parse_main_directory(MAIN_PDF)
    print("members", len(members))

    print("Parsing organizations callings…")
    calling_rows = parse_org_callings(ORG_PDF)
    print("calling rows", len(calling_rows))
    apply_callings(members, calling_rows)

    # Ward missionaries PDF callings reinforcement
    wm_rows = parse_org_callings(WARD_MISSIONARY_PDF)
    apply_callings(members, wm_rows)

    idx = member_index(members)
    print("Extracting organization photos…")
    extract_org_photos(ORG_PDF, idx)

    assigned = parse_assigned_missionaries(ASSIGNED_MISSIONARY_PDF)
    print("assigned missionaries", len(assigned))
    # avoid dup if somehow present
    existing = {m["fullName"].lower() for m in members}
    for a in assigned:
        if a["fullName"].lower() not in existing:
            members.append(a)

    apartments = group_apartments(members)
    with_photos = sum(1 for m in members if m.get("photoUrl"))
    out = {
        "ward": {
            "name": "Provo YSA 147th Ward",
            "shortName": "147th Ward",
            "stake": "Provo YSA",
            "source": "147th Ward Directory + Organizations + Missionary PDFs (10-05-26)",
            "sourceDate": "2026-10-05",
            "note": "Parsed from Church Directory PDFs. For Church use only — confidential.",
        },
        "meta": {
            "lastEditedBy": "PDF Import",
            "lastEditedAt": "2026-10-05T12:00:00-06:00",
            "memberCount": len(members),
            "apartmentCount": len(apartments),
            "photoCount": with_photos,
        },
        "mission": {
            "name": "Utah Provo Mission",
            "office": "85 N 600 E, Provo UT 84606",
            "phone": "+1 801-377-1490",
            "servingMissionaries": [],
            "assignedCompanionshipEmail": "500668894@missionary.org",
        },
        "apartments": apartments,
    }
    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    OUT_SAMPLE.write_text(OUT_JSON.read_text(encoding="utf-8"), encoding="utf-8")
    print("wrote", OUT_JSON, "photos", with_photos)


if __name__ == "__main__":
    main()
