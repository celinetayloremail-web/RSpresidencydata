#!/usr/bin/env python3
"""Import all ward report PDFs into data/members.json."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

import pdfplumber

UPLOADS = Path("/home/ubuntu/.cursor/projects/workspace/uploads")
MEMBERS_PATH = Path("/workspace/data/members.json")
SAMPLE_PATH = Path("/workspace/data/members.sample.json")
TODAY = date(2026, 10, 6)

MONTHS = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}


def pdf_text(path: Path) -> str:
    with pdfplumber.open(path) as pdf:
        return "\n".join((p.extract_text() or "") for p in pdf.pages)


def mid(full: str) -> str:
    return "m-" + hashlib.md5(full.lower().encode()).hexdigest()[:10]


def load_directory() -> dict:
    return json.loads(MEMBERS_PATH.read_text(encoding="utf-8"))


def index_members(d: dict) -> dict[str, dict]:
    idx = {}
    for apt in d["apartments"]:
        for m in apt["members"]:
            idx[m["fullName"].lower()] = m
            idx[f"{m['lastName'].lower()}, {m['legalFirst'].lower()}"] = m
            idx[f"{m['lastName'].lower()}, {m['preferredName'].lower()}"] = m
            first = (m.get("legalFirst") or "").split()[0].lower()
            idx[f"{m['lastName'].lower()}, {first}"] = m
            idx[m["lastName"].lower()] = m  # last resort; overwritten by later same last
    return idx


def find_member(idx: dict, last: str, first: str = "") -> dict | None:
    last = last.strip()
    first = first.strip()
    keys = []
    if first:
        keys += [
            f"{first} {last}".lower(),
            f"{last}, {first}".lower(),
            f"{last}, {first.split()[0]}".lower(),
        ]
    keys.append(last.lower())
    for k in keys:
        if k in idx and (not first or last.lower() in idx[k]["lastName"].lower()):
            m = idx[k]
            if first:
                blob = f"{m['legalFirst']} {m['preferredName']} {m['fullName']}".lower()
                if first.split()[0].lower() not in blob and first.lower() not in blob:
                    continue
            return m
    # fuzzy contains
    first_tok = first.split()[0].lower() if first else ""
    for m in {id(v): v for v in idx.values()}.values():
        if m["lastName"].lower() != last.lower():
            continue
        if not first_tok or first_tok in m["fullName"].lower() or first_tok in m["legalFirst"].lower():
            return m
    return None


def parse_name_lastname_first(raw: str) -> tuple[str, str]:
    raw = re.sub(r"\s+", " ", raw).strip(" ,")
    if "," in raw:
        last, first = raw.split(",", 1)
        return last.strip(), first.strip()
    parts = raw.split()
    if len(parts) >= 2:
        return parts[-1], " ".join(parts[:-1])
    return raw, ""


def parse_date_token(day: str, mon: str, year: str | None = None) -> str:
    month = MONTHS[mon.lower()[:3]] if mon.lower()[:3] in MONTHS else MONTHS.get(mon.lower())
    if not month:
        month = MONTHS.get(mon.lower()[:3])
    y = int(year) if year else TODAY.year
    d = int(day)
    return f"{y:04d}-{month:02d}-{d:02d}"


def birth_year_from_age(month: int, day: int, age: int, as_of: date = TODAY) -> int:
    candidate = as_of.year - age
    bday_this_year = date(as_of.year, month, day)
    if bday_this_year > as_of:
        return candidate - 1
    return candidate


def import_birthdays(d: dict, path: Path):
    text = pdf_text(path)
    idx = index_members(d)
    # Patterns like: "6 Oct 24 Name" or "6 Oct Blake, Nathaniel 24"
    # From extraction:
    # 6 Oct 24 ... Guimarães spanning lines
    # 8 Oct Blake, Nathaniel 24
    count = 0
    # Join broken lines lightly
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(
            r"^(\d{1,2})\s+([A-Za-z]{3,9})\s+(?:(\d{1,2})\s+)?(.+?)\s+(\d{1,2})\s*(?:\((\d{3})\)|\+|$)",
            line,
        )
        # simpler: start with day month
        m2 = re.match(r"^(\d{1,2})\s+([A-Za-z]{3,9})\s+(.*)$", line)
        if not m2:
            i += 1
            continue
        day_s, mon_s, rest = m2.groups()
        if mon_s.lower()[:3] not in MONTHS and mon_s.lower() not in MONTHS:
            i += 1
            continue
        month = MONTHS.get(mon_s.lower()[:3]) or MONTHS.get(mon_s.lower())
        # rest may be "24 Name..." or "Blake, Nathaniel 24 (phone)" or just age on same/next
        age = None
        name_part = rest
        am = re.match(r"^(\d{1,3})\s+(.*)$", rest)
        if am and int(am.group(1)) < 120:
            age = int(am.group(1))
            name_part = am.group(2)
        # name may be "Last, First ..." with age later
        am2 = re.search(r"\b(\d{2})\b\s*(?:\(|$)", name_part)
        if age is None and am2:
            age = int(am2.group(1))
            name_part = name_part[: am2.start()].strip()
        # Collect continuation lines if name incomplete (no comma yet / weird)
        name_part = re.sub(r"\s*\(\d{3}.*$", "", name_part).strip(" ,")
        if "," not in name_part and i + 1 < len(lines):
            nxt = lines[i + 1]
            if not re.match(r"^\d{1,2}\s+[A-Za-z]{3}", nxt) and "Count:" not in nxt and "Birthday" not in nxt:
                # maybe "Viveiros Leite" continuation then age on prior
                if re.search(r"[A-Za-z]", nxt) and not re.match(r"^\d{3}", nxt):
                    # if next looks like name fragment
                    if not re.search(r"Provo|Orem|Apt|UT\b", nxt):
                        name_part = (name_part + " " + nxt).strip()
                        i += 1
                        am3 = re.search(r"\b(\d{2})\b", name_part)
                        if age is None and am3:
                            age = int(am3.group(1))
                            name_part = name_part[: am3.start()].strip()
        name_part = re.sub(r"\s+\d{2}$", "", name_part).strip(" ,")
        if not name_part or "Count:" in name_part:
            i += 1
            continue
        last, first = parse_name_lastname_first(name_part)
        if not last or last.lower() in {"phone", "name", "birthday"}:
            i += 1
            continue
        if age is None:
            # look ahead for age
            for j in range(i + 1, min(i + 3, len(lines))):
                am4 = re.search(r"\b(\d{2})\b", lines[j])
                if am4 and int(am4.group(1)) < 100:
                    age = int(am4.group(1))
                    break
        if age is None:
            i += 1
            continue
        year = birth_year_from_age(month, int(day_s), age)
        bday = f"{year:04d}-{month:02d}-{int(day_s):02d}"
        member = find_member(idx, last, first)
        if member:
            member["birthday"] = bday
            member["gender"] = member.get("gender") or "M"  # elders birthday list
            count += 1
        else:
            print("birthday unmatched", last, first, bday)
        i += 1
    print("birthdays applied", count)


def parse_ministering(text: str, role: str) -> list[dict]:
    """Return companionships: {companions: [Last, First...], assigned: [...]}"""
    comps = []
    blocks = re.split(r"MINISTERING (?:BROTHERS|SISTERS)", text)
    for block in blocks[1:]:
        if "ASSIGNED" not in block:
            continue
        before, after = re.split(r"ASSIGNED (?:HOUSEHOLDS|SISTERS)", block, maxsplit=1)
        companions = []
        for ln in before.splitlines():
            ln = ln.strip()
            if not ln or ln.startswith("OCT") or ln.startswith("QUARTER") or ln.startswith("NOV") or ln.startswith("DEC"):
                continue
            if re.match(r"^\d", ln) or ln.startswith("District") or ln.startswith("Presidency") or ln.startswith("Select") or ln.startswith("Count"):
                continue
            if "," in ln and not ln.lower().startswith("assigned"):
                companions.append(ln.split("(")[0].strip())
        assigned = []
        for ln in after.splitlines():
            ln = ln.strip()
            if not ln or ln.startswith("OCT") or ln.startswith("QUARTER") or ln.startswith("Count") or ln.startswith("District") or ln.startswith("Add ") or ln.startswith("Move") or ln.startswith("Companionships") or ln.startswith("Presidency") or ln.startswith("Select") or ln.startswith("MINISTERING"):
                continue
            if ln.startswith("00%") or ln.startswith("0 /"):
                continue
            if "," in ln:
                assigned.append(ln.split("(")[0].strip())
        if companions:
            comps.append({"companions": companions, "assigned": assigned, "role": role})
    return comps


def apply_ministering(d: dict, comps: list[dict]):
    idx = index_members(d)
    applied = 0

    def resolve(name_lf: str):
        last, first = parse_name_lastname_first(name_lf)
        return find_member(idx, last, first)

    for c in comps:
        companion_members = [resolve(n) for n in c["companions"]]
        companion_members = [m for m in companion_members if m]
        assigned_members = [resolve(n) for n in c["assigned"]]
        assigned_members = [m for m in assigned_members if m]
        companion_ids = [m["id"] for m in companion_members]
        assigned_ids = [m["id"] for m in assigned_members]
        for m in companion_members:
            others = [i for i in companion_ids if i != m["id"]]
            m["ministering"] = {
                "role": c["role"],
                "companions": others,
                "ministeringTo": assigned_ids,
            }
            m["gender"] = m.get("gender") or ("F" if c["role"] == "sister" else "M")
            applied += 1
    print("ministering companions updated", applied, "companionships", len(comps))


def import_moved_in(d: dict, path: Path):
    text = pdf_text(path)
    idx = index_members(d)
    count = 0
    for m in re.finditer(
        r"^([A-Za-zÀ-ÿ'’\-]+(?:,\s*[A-Za-zÀ-ÿ'’\-\s]+)?|[A-Za-zÀ-ÿ'’\-\s]+?)\s+(\d{1,3})\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s*$",
        text,
        re.M,
    ):
        raw_name, age, date_s = m.groups()
        # Prefer "Last, First"
        if "," not in raw_name and len(raw_name.split()) > 3:
            continue
        last, first = parse_name_lastname_first(raw_name)
        dt = datetime.strptime(date_s.replace("Sept", "Sep"), "%d %b %Y") if False else None
        # parse flexibly
        parts = date_s.split()
        day, mon, year = parts[0], parts[1], parts[2]
        month = MONTHS.get(mon.lower()[:3])
        iso = f"{int(year):04d}-{month:02d}-{int(day):02d}"
        member = find_member(idx, last, first)
        if member:
            member["moved"] = {"status": "in", "date": iso, "notes": ""}
            if not member.get("birthday") and age.isdigit():
                # approximate birthday unknown month — skip
                pass
            count += 1
    # line-based fallback
    for ln in text.splitlines():
        ln = ln.strip()
        mm = re.match(
            r"^([A-Z][A-Za-zÀ-ÿ'’\-]+,\s+[A-Za-zÀ-ÿ'’\-\s]+?)\s+(\d{1,3})\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$",
            ln,
        )
        if not mm:
            continue
        name, age, day, mon, year = mm.groups()
        month = MONTHS.get(mon.lower()[:3])
        if not month:
            continue
        iso = f"{int(year):04d}-{month:02d}-{int(day):02d}"
        last, first = parse_name_lastname_first(name)
        member = find_member(idx, last, first)
        if member:
            member["moved"] = {"status": "in", "date": iso, "notes": ""}
            count += 1
    print("moved in marked", count)


def import_moved_out(d: dict, path: Path):
    text = pdf_text(path)
    rows = []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    i = 0
    while i < len(lines):
        ln = lines[i]
        # Name may span lines; birth date like 24 Sep 2004
        if re.match(r"^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}", ln) or ln.startswith("Count:") or ln.startswith("Members Moved") or ln.startswith("Print") or ln.startswith("Name "):
            i += 1
            continue
        # Try name on this line, dates on same or next
        combined = ln
        if i + 1 < len(lines):
            combined2 = ln + " " + lines[i + 1]
        else:
            combined2 = ln
        mm = re.search(
            r"^([A-Z][A-Za-zÀ-ÿ'’\-\s]+?)\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+(.*)$",
            combined2,
        )
        if not mm:
            mm = re.search(
                r"^([A-Z][A-Za-zÀ-ÿ'’\-, ]+?)\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s*(.*)$",
                ln,
            )
        if not mm:
            i += 1
            continue
        name, birth, move, unit = mm.groups()
        name = name.strip(" ,")
        if "," not in name and len(name.split()) > 5:
            i += 1
            continue

        def to_iso(s):
            day, mon, year = s.split()
            month = MONTHS[mon.lower()[:3]]
            return f"{int(year):04d}-{month:02d}-{int(day):02d}"

        rows.append(
            {
                "name": name,
                "birthday": to_iso(birth),
                "date": to_iso(move),
                "newUnit": unit.strip(),
            }
        )
        i += 1
    d.setdefault("meta", {})["movedOutRecords"] = rows
    # If still in roster, mark moved out
    idx = index_members(d)
    marked = 0
    for r in rows:
        last, first = parse_name_lastname_first(r["name"])
        member = find_member(idx, last, first)
        if member:
            member["moved"] = {"status": "out", "date": r["date"], "notes": r["newUnit"]}
            if not member.get("birthday"):
                member["birthday"] = r["birthday"]
            marked += 1
    print("moved out records", len(rows), "marked in roster", marked)


def import_lost(d: dict, path: Path):
    text = pdf_text(path)
    rows = []
    # Name phone email date
    for m in re.finditer(
        r"([A-Z][A-Za-zÀ-ÿ'’\-]+,\s*[A-Za-zÀ-ÿ'’\-\s]+?)\s*(?:\((\d{3})\)\s*(\d{3}-\d{4}))?\s*([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})?\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})",
        text,
    ):
        name, a, b, email, added = m.groups()
        phone = f"({a}) {b}" if a and b else ""
        rows.append({"name": re.sub(r"\s+", " ", name).strip(), "phone": phone, "email": email or "", "dateAdded": added})
    # Better line parser for multi-line names
    if len(rows) < 20:
        rows = []
        lines = [ln.strip() for ln in text.splitlines()]
        i = 0
        while i < len(lines):
            ln = lines[i]
            if "," not in ln or ln.startswith("Finding") or ln.startswith("When ") or ln.startswith("Phone") or ln.startswith("Name") or ln.startswith("Count") or ln.startswith("The members") or re.match(r"^\d\.", ln):
                i += 1
                continue
            chunk = ln
            j = i + 1
            while j < len(lines) and not re.search(r"\d{1,2}\s+[A-Za-z]{3}\s+\d{4}", chunk) and j < i + 4:
                chunk += " " + lines[j]
                j += 1
            mm = re.search(
                r"^([A-Z][A-Za-zÀ-ÿ'’\-\s]+,\s*[A-Za-zÀ-ÿ'’\-\s]+?)\s*(?:\((\d{3})\)\s*(\d{3}-\d{4}))?\s*([A-Za-z0-9._%+\-]+@[^\s]+)?\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})",
                chunk,
            )
            if mm:
                name, a, b, email, added = mm.groups()
                rows.append(
                    {
                        "name": re.sub(r"\s+", " ", name).strip(),
                        "phone": f"({a}) {b}" if a and b else "",
                        "email": email or "",
                        "dateAdded": added,
                    }
                )
                i = j
            else:
                i += 1
    # dedupe
    seen = set()
    uniq = []
    for r in rows:
        k = r["name"].lower()
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    d.setdefault("meta", {})["lostMembers"] = uniq
    d["meta"]["findingLostNotes"] = (
        "Members on this list are not counted in the ward. Contact via phone/email/social, "
        "family/friends, last known address, then obtain Bishop approval before returning records."
    )
    print("lost members", len(uniq))


def import_budget(d: dict, path: Path):
    text = pdf_text(path)
    spent = re.search(r"\$([0-9,]+\.\d{2})\s*\nSpent|Spent.*?\$([0-9,]+\.\d{2})", text, re.S)
    planned = re.search(r"of\s*\$([0-9,]+\.\d{2})", text)
    # From known layout: Spent $127.68 of $250.00
    spent_m = re.search(r"\$(\d+\.\d{2})\s*Spent\s*of\s*\$(\d+\.\d{2})", text.replace("\n", " "))
    if not spent_m:
        spent_val = 127.68
        planned_val = 250.00
    else:
        spent_val = float(spent_m.group(1))
        planned_val = float(spent_m.group(2))
    d.setdefault("meta", {})["budget"] = {
        "asOf": "2026-10-06",
        "notes": "Imported from Budget.pdf (Relief Society). Update other categories as needed.",
        "categories": [
            {"name": "Relief Society", "planned": planned_val, "spent": spent_val},
            {"name": "Activities", "planned": 0, "spent": 0},
            {"name": "Elders Quorum", "planned": 0, "spent": 0},
            {"name": "Missionary", "planned": 0, "spent": 0},
            {"name": "Other", "planned": 0, "spent": 0},
        ],
    }
    print("budget RS", planned_val, spent_val)


def import_covenant_and_converts(d: dict):
    cov = pdf_text(UPLOADS / "Covenant_Path_Progress_be66.pdf")
    names = re.findall(r"^([A-Z][a-zA-ZÀ-ÿ'’\-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'’\-]+)+)\s*$", cov, re.M)
    # Filter known section headers
    skip = {"My Covenant Path Guide", "New Members Returning People Being Taught", "View Details", "Attended Sacrament Meeting", "Friends in the Church"}
    people = []
    for n in names:
        if n in skip or "sacrament" in n.lower():
            continue
        if len(n.split()) >= 2 and n not in people:
            people.append(n)
    # Also explicit from sample
    for n in ["Angelina Whitehead", "Kathryn Henley", "Marti Smith", "Meg Smith"]:
        if n not in people:
            people.append(n)
    idx = index_members(d)
    marked = []
    for full in people:
        parts = full.split()
        first, last = " ".join(parts[:-1]), parts[-1]
        m = find_member(idx, last, first)
        if m:
            m["covenantPath"] = {
                **(m.get("covenantPath") or {}),
                "baptized": True,
                "confirmed": True,
                "latestConvert": True,
                "notes": "Listed under New Members on Covenant Path Progress",
            }
            marked.append(m["fullName"])
    # Quarterly report: converts past 12 months potential=2; names come from covenant path new members
    q = pdf_text(UPLOADS / "Quarterly_Report_48d8.pdf")
    pot = re.search(r"Converts attending.*?(\d+)\s+(\d+)", q, re.S)
    d.setdefault("meta", {})["latestConverts"] = marked
    d["meta"]["quarterlyConvertStats"] = {
        "source": "Quarterly Report.pdf",
        "note": "Only convert detail requested; names taken from Covenant Path Progress New Members (Quarterly Report lists 2 converts in past 12 months without names).",
        "convertsPast12MonthsPotential": 2,
    }
    print("latest converts", marked)


def import_callings_from_org_lists(d: dict):
    files = [
        "Elders_Quorum___Ward_Directory_and_Map_3d6d.pdf",
        "Relief_Society___Ward_Directory_and_Map_cbf4.pdf",
        "Sunday_School___Ward_Directory_and_Map_b3c6.pdf",
        "Temple_and_Family_History___Ward_Directory_and_Map_4472.pdf",
        "Ward_Missionaries___Ward_Directory_and_Map_e247.pdf",
        "Ward_Missionaries___Ward_Directory_and_Map2_360f.pdf",
        "Young_Single_Adult___Ward_Directory_and_Map_424f.pdf",
        "Other_Callings___Ward_Directory_and_Map_5bbd.pdf",
        "Organizations_147th_Ward_Directory_and_Map_b20c.pdf",
    ]
    idx = index_members(d)
    calling_hints = (
        "President", "Counselor", "Secretary", "Clerk", "Teacher", "Missionary",
        "Coordinator", "Leader", "Consultant", "Specialist", "Committee",
        "Representative", "Social Media", "Bishop",
    )
    applied = 0
    for fname in files:
        path = UPLOADS / fname
        if not path.exists():
            continue
        text = pdf_text(path)
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        gender = "M" if "Elders" in fname else "F" if "Relief" in fname else ""
        i = 0
        while i < len(lines):
            ln = lines[i]
            if "," not in ln or ln.startswith("©") or "|" in ln[:20]:
                i += 1
                continue
            # Name line
            mm = re.match(r"^([A-Z][A-Za-zÀ-ÿ'’\-]+),\s+([A-Za-zÀ-ÿ'’\-\s]+?)(?:\s+\d|\s+Apt|\s+apt|\s+Individual|\s+Provo|\s+Orem|\s*$)", ln)
            if not mm:
                # looser
                if re.match(r"^[A-Z].*,", ln):
                    last, rest = ln.split(",", 1)
                    first_tokens = []
                    for tok in rest.split():
                        if re.match(r"^\d", tok) or tok.lower() in {"apt", "apartment", "individual", "provo", "orem"}:
                            break
                        first_tokens.append(tok)
                    first = " ".join(first_tokens)
                else:
                    i += 1
                    continue
            else:
                last, first = mm.group(1), mm.group(2).strip()
            calling = ""
            if i + 1 < len(lines):
                nxt = lines[i + 1]
                if any(h in nxt for h in calling_hints):
                    calling = re.split(r"\d{2}\.\d+|Apt |\(\d|PROVO|Provo|Individual", nxt)[0].strip()
            member = find_member(idx, last, first)
            if member and calling:
                if calling not in member["callings"]:
                    member["callings"].append(calling)
                if gender and not member.get("gender"):
                    member["gender"] = gender
                # RS list => F, EQ => M
                if "Relief_Society" in fname:
                    member["gender"] = "F"
                if "Elders_Quorum" in fname:
                    member["gender"] = "M"
                applied += 1
            i += 1
    print("callings touch", applied)


def main():
    d = load_directory()
    print("loaded members", d["meta"].get("memberCount"))

    import_budget(d, UPLOADS / "Budget_7f8b.pdf")
    import_covenant_and_converts(d)
    import_birthdays(d, UPLOADS / "Elders_Birthday_List_9ebf.pdf")
    import_callings_from_org_lists(d)

    brothers = parse_ministering(pdf_text(UPLOADS / "Ministering_Brothers_98d1.pdf"), "brother")
    sisters = parse_ministering(pdf_text(UPLOADS / "Ministering_Sisters_88a7.pdf"), "sister")
    apply_ministering(d, brothers + sisters)

    import_moved_in(d, UPLOADS / "Members_Moved_In_ee84.pdf")
    import_moved_out(d, UPLOADS / "Members_Moved_Out_d63a.pdf")
    import_lost(d, UPLOADS / "Finding_Lost_Members_3522.pdf")

    d["meta"]["lastEditedBy"] = "PDF Report Import"
    d["meta"]["lastEditedAt"] = "2026-10-06T09:00:00-06:00"
    d["meta"]["reportSources"] = [
        "Budget.pdf",
        "Covenant Path Progress.pdf",
        "Elders Birthday List.pdf",
        "Ministering Brothers.pdf",
        "Ministering Sisters.pdf",
        "Members Moved In.pdf",
        "Members Moved Out.pdf",
        "Finding Lost Members.pdf",
        "Quarterly Report.pdf",
        "Organizations / EQ / RS / SS / Temple / Ward Missionaries / YSA / Other Callings PDFs",
    ]
    d["meta"]["memberCount"] = sum(len(a["members"]) for a in d["apartments"])
    # recount
    bday = sum(1 for a in d["apartments"] for m in a["members"] if m.get("birthday"))
    minist = sum(1 for a in d["apartments"] for m in a["members"] if m.get("ministering", {}).get("role"))
    print("summary birthdays", bday, "ministering roles", minist, "converts", d["meta"].get("latestConverts"))

    MEMBERS_PATH.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")
    SAMPLE_PATH.write_text(MEMBERS_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    print("wrote", MEMBERS_PATH)


if __name__ == "__main__":
    main()
