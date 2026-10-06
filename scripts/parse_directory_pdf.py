#!/usr/bin/env python3
"""Parse Church Directory PDF into data/members.json."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import pdfplumber

import sys

PDF_PATH = Path(
    sys.argv[1]
    if len(sys.argv) > 1
    else "/home/ubuntu/.cursor/projects/workspace/uploads/147th_Ward_Directory_and_Map_10-05-26_c7e8.pdf"
)
OUT_PATH = Path(sys.argv[2] if len(sys.argv) > 2 else "/workspace/data/members.json")

SKIP_PREFIXES = (
    "Provo YSA",
    "© ",
    "All rights reserved",
    "For Church Use Only",
)

PHONE_RE = re.compile(
    r"(?:\+\d[\d\s().-]{6,}\d)|(?:\(\d{3}\)\s*\d{3}-\d{4})|(?:\d{3}[-.\s]\d{3}[-.\s]\d{4})"
)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
COORD_RE = re.compile(r"^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$")
NAME_LINE_RE = re.compile(
    r"^([A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]*(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]*)*"
    r"(?:\s+&\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]*)?),\s+(.+)$"
)
LETTER_RE = re.compile(r"^[A-Z]$")
CITY_RE = re.compile(
    r"^(?:[A-Za-z .]+)\s+(?:UT|Utah)\s*\d{0,5}(?:-\d{4})?$", re.I
)
APT_RE = re.compile(r"^(?:Apt|Apartment|APT)\s*.+", re.I)

CALLING_HINTS = (
    "President",
    "Counselor",
    "Secretary",
    "Clerk",
    "Bishop",
    "Teacher",
    "Missionary",
    "Committee",
    "Coordinator",
    "Leader",
    "Consultant",
    "Specialist",
    "Worker",
    "Volunteer",
    "Accompanist",
    "Auditor",
    "Councilor",
    "Quorum",
    "Relief Society",
    "Sunday School",
    "Temple",
    "Activities",
    "Music",
    "Sacrament",
    "Linger Longer",
    "Serving outside",
    "Priests",
    "High Council",
    "Executive",
    "Chair",
    "Co-chair",
)


def is_calling(line: str) -> bool:
    if EMAIL_RE.search(line) or COORD_RE.match(line.strip()):
        return False
    if "@" in line:
        return False
    return any(h.lower() in line.lower() for h in CALLING_HINTS)


def is_skip(line: str) -> bool:
    return (not line.strip()) or any(line.startswith(p) for p in SKIP_PREFIXES)


def guess_complex(street: str) -> str:
    patterns = [
        (r"718\s*W(?:est)?\s*1720", "718 W 1720 N"),
        (r"728\s*W(?:est)?\s*1720", "728 W 1720 N"),
        (r"722\s*W(?:est)?\s*1720", "722 W 1720 N"),
        (r"724\s*W(?:est)?\s*1720", "724 W 1720 N"),
        (r"726\s*W(?:est)?\s*1720", "726 W 1720 N"),
        (r"606\s*W(?:est)?\s*1720", "606 W 1720 N"),
    ]
    for pat, label in patterns:
        if re.search(pat, street, re.I):
            return label
    if street:
        return street[:48]
    return "Other / Unassigned"


def phone_digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def parse_lines(lines: list[str]) -> list[dict]:
    blocks: list[dict] = []
    cur = None
    for line in lines:
        m = NAME_LINE_RE.match(line)
        if m:
            last, rest = m.group(1), m.group(2)
            tokens = rest.split()
            name_tokens: list[str] = []
            addr_tokens: list[str] = []
            hit_addr = False
            for tok in tokens:
                if not hit_addr and (
                    re.match(r"^\d", tok) or tok.lower() in {"apt", "apartment"}
                ):
                    hit_addr = True
                if hit_addr:
                    addr_tokens.append(tok)
                else:
                    name_tokens.append(tok)
            if hit_addr:
                first_name = " ".join(name_tokens).strip()
                same_line_addr = " ".join(addr_tokens).strip()
            else:
                first_name = rest
                same_line_addr = ""
            if cur:
                blocks.append(cur)
            cur = {
                "lastName": last,
                "firstFromHeader": first_name,
                "lines": [same_line_addr] if same_line_addr else [],
            }
        elif cur is not None:
            cur["lines"].append(line)
    if cur:
        blocks.append(cur)

    members: list[dict] = []
    for b in blocks:
        phones: list[str] = []
        emails: list[str] = []
        callings: list[str] = []
        coords = ""
        preferred = None
        address_parts: list[str] = []

        for line in b["lines"]:
            if COORD_RE.match(line):
                coords = line
                continue

            em = EMAIL_RE.search(line)
            if em and "@" in line and not is_calling(line):
                emails.append(em.group(0))
                rest = EMAIL_RE.sub("", line).strip()
                ph = PHONE_RE.search(rest)
                if ph and len(phone_digits(ph.group(0))) >= 10:
                    phones.append(ph.group(0).strip())
                continue

            ph = PHONE_RE.search(line)
            if ph and len(phone_digits(ph.group(0))) >= 10:
                if len(line) < 40 or line.replace(ph.group(0), "").strip() == "":
                    phones.append(ph.group(0).strip())
                    continue

            if is_calling(line):
                if ph and len(phone_digits(ph.group(0))) >= 10:
                    phones.append(ph.group(0).strip())
                    call_line = PHONE_RE.sub("", line).strip()
                    if call_line:
                        callings.append(call_line)
                else:
                    callings.append(line)
                continue

            if (
                preferred is None
                and not APT_RE.match(line)
                and not CITY_RE.match(line)
                and not re.search(r"\d", line)
                and len(line.split()) <= 6
                and not line.lower().startswith(("provo", "orem", "spanish"))
            ):
                preferred = line
                continue

            address_parts.append(line)

        first = b["firstFromHeader"]
        full_name = f"{first} {b['lastName']}".strip()
        preferred_name = preferred or (first.split()[0] if first else b["lastName"])
        street = address_parts[0] if address_parts else ""
        unit = ""
        for part in address_parts:
            am = re.search(r"(?:Apt|Apartment|APT)\s*([A-Za-z0-9\-]+)", part, re.I)
            if am:
                unit = am.group(1)
                break
        city = next(
            (
                p
                for p in address_parts
                if CITY_RE.match(p) or re.search(r"\bUT\b", p, re.I)
            ),
            "",
        )
        complex_name = guess_complex(street)
        mid = "m-" + hashlib.md5(full_name.lower().encode()).hexdigest()[:10]
        members.append(
            {
                "id": mid,
                "lastName": b["lastName"],
                "legalFirst": first,
                "preferredName": preferred_name,
                "fullName": full_name,
                "photoUrl": "",
                "phone": phones[0] if phones else "",
                "email": emails[0] if emails else "",
                "address": ", ".join(address_parts),
                "street": street,
                "unit": unit,
                "complex": complex_name,
                "city": city,
                "coords": coords,
                "callings": callings,
                "languages": [],
                "flags": {
                    "returnedMissionary": False,
                    "inactive": False,
                    "doNotContact": False,
                    "superSolid": False,
                },
                "ministering": {
                    "role": "",
                    "companions": [],
                    "ministeringTo": [],
                },
                "notes": "",
            }
        )
    return members


def group_apartments(members: list[dict]) -> list[dict]:
    apts: dict[str, dict] = {}
    for m in members:
        key = f"{m['complex']}|{m['unit']}|{m['street']}"
        if key not in apts:
            apts[key] = {
                "id": "apt-" + hashlib.md5(key.encode()).hexdigest()[:10],
                "complex": m["complex"],
                "unit": m["unit"] or "—",
                "address": m["street"] or m["address"],
                "city": m["city"],
                "members": [],
            }
        apts[key]["members"].append(m)
    return sorted(apts.values(), key=lambda a: (a["complex"], a["unit"]))


def main() -> None:
    lines: list[str] = []
    with pdfplumber.open(PDF_PATH) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for raw in text.splitlines():
                line = raw.strip()
                if is_skip(line) or LETTER_RE.match(line):
                    continue
                lines.append(line)

    members = parse_lines(lines)
    apartments = group_apartments(members)
    out = {
        "ward": {
            "name": "Provo YSA 147th Ward",
            "shortName": "147th Ward",
            "unitNumber": "266485",
            "stake": "Provo YSA",
            "source": "147th Ward Directory and Map 10-05-26.pdf",
            "sourceDate": "2026-10-05",
            "note": "Parsed from Church Directory PDF. For Church use only — confidential.",
        },
        "meta": {
            "lastEditedBy": "PDF Import",
            "lastEditedAt": "2026-10-05T12:00:00-06:00",
            "memberCount": len(members),
            "apartmentCount": len(apartments),
        },
        "apartments": apartments,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print("members", len(members))
    print("apartments", len(apartments))
    print("with phone", sum(1 for m in members if m["phone"]))
    print("with email", sum(1 for m in members if m["email"]))
    print("with calling", sum(1 for m in members if m["callings"]))
    print("complexes", Counter(m["complex"] for m in members).most_common(10))
    celine = [m for m in members if "Celine" in m["fullName"] or m["preferredName"] == "Celine"]
    print("celine", celine[0] if celine else None)
    print("first5", [(m["fullName"], m["preferredName"], m["unit"], m["phone"]) for m in members[:5]])


if __name__ == "__main__":
    main()
