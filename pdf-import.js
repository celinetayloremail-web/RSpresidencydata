/**
 * Client-side Church Directory + ward report PDF/JSON/CSV importer.
 * Mirrors scripts/parse_directory_pdf.py and scripts/import_all_reports.py
 * so leaders can refresh the site from uploaded LDS Tools exports.
 */

const PHONE_RE =
  /(?:\+\d[\d\s().-]{6,}\d)|(?:\(\d{3}\)\s*\d{3}-\d{4})|(?:\d{3}[-.\s]\d{3}[-.\s]\d{4})/;
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
const COORD_RE = /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/;
const NAME_LINE_RE =
  /^([A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]*(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]*)*(?:\s+&\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]*)?),\s+(.+)$/;
const LETTER_RE = /^[A-Z]$/;
const CITY_RE = /^(?:[A-Za-z .]+)\s+(?:UT|Utah)\s*\d{0,5}(?:-\d{4})?$/i;
const APT_RE = /^(?:Apt|Apartment|APT)\s*.+/i;

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const CALLING_HINTS = [
  "President", "Counselor", "Secretary", "Clerk", "Bishop", "Teacher",
  "Missionary", "Committee", "Coordinator", "Leader", "Consultant",
  "Specialist", "Worker", "Volunteer", "Accompanist", "Auditor",
  "Councilor", "Quorum", "Relief Society", "Sunday School", "Temple",
  "Activities", "Music", "Sacrament", "Linger Longer", "Serving outside",
  "Priests", "High Council", "Executive", "Chair", "Co-chair",
  "Representative", "Social Media",
];

const SKIP_PREFIXES = [
  "Provo YSA",
  "© ",
  "All rights reserved",
  "For Church Use Only",
];

function isCalling(line) {
  if (EMAIL_RE.test(line) || COORD_RE.test(line.trim()) || line.includes("@")) return false;
  const lower = line.toLowerCase();
  return CALLING_HINTS.some((h) => lower.includes(h.toLowerCase()));
}

function isSkip(line) {
  return !line.trim() || SKIP_PREFIXES.some((p) => line.startsWith(p));
}

function phoneDigits(value) {
  return String(value).replace(/\D/g, "");
}

function guessComplex(street) {
  const patterns = [
    [/718\s*W(?:est)?\s*1720/i, "718 W 1720 N"],
    [/728\s*W(?:est)?\s*1720/i, "728 W 1720 N"],
    [/722\s*W(?:est)?\s*1720/i, "722 W 1720 N"],
    [/724\s*W(?:est)?\s*1720/i, "724 W 1720 N"],
    [/726\s*W(?:est)?\s*1720/i, "726 W 1720 N"],
    [/606\s*W(?:est)?\s*1720/i, "606 W 1720 N"],
  ];
  for (const [pat, label] of patterns) {
    if (pat.test(street)) return label;
  }
  return street ? street.slice(0, 48) : "Other / Unassigned";
}

function hashId(text, prefix) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return `${prefix}-${h.toString(16).padStart(8, "0")}`;
}

function cloneDirectory(dir) {
  return JSON.parse(JSON.stringify(dir));
}

function allMembersFrom(dir) {
  return (dir.apartments || []).flatMap((a) => a.members || []);
}

function indexMembers(dir) {
  const idx = new Map();
  for (const m of allMembersFrom(dir)) {
    idx.set(m.fullName.toLowerCase(), m);
    idx.set(`${m.lastName.toLowerCase()}, ${(m.legalFirst || "").toLowerCase()}`, m);
    idx.set(`${m.lastName.toLowerCase()}, ${(m.preferredName || "").toLowerCase()}`, m);
    const first = (m.legalFirst || "").split(/\s+/)[0].toLowerCase();
    if (first) idx.set(`${m.lastName.toLowerCase()}, ${first}`, m);
    idx.set(m.lastName.toLowerCase(), m);
  }
  return idx;
}

function parseNameLastFirst(raw) {
  const cleaned = String(raw || "").replace(/\s+/g, " ").replace(/^[, ]+|[, ]+$/g, "");
  if (cleaned.includes(",")) {
    const [last, first] = cleaned.split(",", 2);
    return { last: last.trim(), first: (first || "").trim() };
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { last: parts[parts.length - 1], first: parts.slice(0, -1).join(" ") };
  }
  return { last: cleaned, first: "" };
}

function findMember(idx, last, first = "") {
  last = (last || "").trim();
  first = (first || "").trim();
  const keys = [];
  if (first) {
    keys.push(`${first} ${last}`.toLowerCase());
    keys.push(`${last}, ${first}`.toLowerCase());
    keys.push(`${last}, ${first.split(/\s+/)[0]}`.toLowerCase());
  }
  keys.push(last.toLowerCase());
  for (const k of keys) {
    if (!idx.has(k)) continue;
    const m = idx.get(k);
    if (first && !last.toLowerCase().includes(m.lastName.toLowerCase()) && m.lastName.toLowerCase() !== last.toLowerCase()) {
      continue;
    }
    if (first) {
      const blob = `${m.legalFirst} ${m.preferredName} ${m.fullName}`.toLowerCase();
      const tok = first.split(/\s+/)[0].toLowerCase();
      if (!blob.includes(tok) && !blob.includes(first.toLowerCase())) continue;
    }
    return m;
  }
  const firstTok = first.split(/\s+/)[0]?.toLowerCase() || "";
  const unique = [...new Map([...idx.values()].map((m) => [m.id, m])).values()];
  for (const m of unique) {
    if (m.lastName.toLowerCase() !== last.toLowerCase()) continue;
    if (!firstTok || m.fullName.toLowerCase().includes(firstTok) || (m.legalFirst || "").toLowerCase().includes(firstTok)) {
      return m;
    }
  }
  return null;
}

function monthNum(mon) {
  const key = String(mon || "").toLowerCase();
  return MONTHS[key] || MONTHS[key.slice(0, 3)] || null;
}

function birthYearFromAge(month, day, age, asOf = new Date()) {
  let candidate = asOf.getFullYear() - age;
  const bdayThisYear = new Date(asOf.getFullYear(), month - 1, day);
  if (bdayThisYear > asOf) candidate -= 1;
  return candidate;
}

function normalizeFileKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Classify LDS Tools / Leader report PDFs by filename, then content. */
export function classifyReport(filename, text = "") {
  const n = normalizeFileKey(filename);
  const head = String(text || "").slice(0, 2500);

  if (/\bbudget\b/.test(n) || /^Budget\b/m.test(head)) return "budget";
  if (/covenant\s*path/.test(n) || /Covenant Path Progress/.test(head)) return "covenant";
  if (/birthday/.test(n) || /Birthday List/.test(head)) return "birthday";
  if (/ministering\s*brother/.test(n) || /^Ministering Brothers/m.test(head)) return "ministering-brothers";
  if (/ministering\s*sister/.test(n) || /^Ministering Sisters/m.test(head)) return "ministering-sisters";
  if (/members?\s*moved\s*in|moved\s*in/.test(n) || /^Members Moved In/m.test(head)) return "moved-in";
  if (/members?\s*moved\s*out|moved\s*out/.test(n) || /^Members Moved Out/m.test(head)) return "moved-out";
  if (/finding\s*lost|lost\s*member/.test(n) || /^Finding Lost Members/m.test(head)) return "lost";
  if (/quarterly\s*report/.test(n) || /^Quarterly Report/m.test(head)) return "quarterly";
  if (/serving\s*missionar/.test(n) || (/Serving Missionaries/.test(head) && !/Assigned Missionaries/.test(head))) {
    return "serving-missionaries";
  }
  if (/assigned\s*missionar/.test(n) || /^Assigned Missionaries/m.test(head)) {
    return "assigned-missionaries";
  }

  // Organizations.pdf (calling table) vs Organizations … Ward Directory and Map (roster)
  if (
    (/^organizations$/.test(n) || /^organizations\b/.test(n)) &&
    !/directory\s*and\s*map/.test(n) &&
    (/Calling Name Sustained/.test(head) || /^Organizations\b/m.test(head))
  ) {
    return "organizations-table";
  }
  if (/Calling Name Sustained/.test(head) && !/Ward Directory and Map/.test(head)) {
    return "organizations-table";
  }

  // Org / EQ / RS / SS / Temple / Ward Missionaries / YSA / Other Callings directory maps
  return "directory";
}

function parseMemberLines(allLines) {
  const blocks = [];
  let cur = null;
  for (const line of allLines) {
    const m = line.match(NAME_LINE_RE);
    if (m) {
      const last = m[1];
      const rest = m[2];
      const tokens = rest.split(/\s+/);
      const nameTokens = [];
      const addrTokens = [];
      let hitAddr = false;
      for (const tok of tokens) {
        if (!hitAddr && (/^\d/.test(tok) || ["apt", "apartment"].includes(tok.toLowerCase()))) {
          hitAddr = true;
        }
        (hitAddr ? addrTokens : nameTokens).push(tok);
      }
      const firstName = hitAddr ? nameTokens.join(" ").trim() : rest;
      const sameLineAddr = hitAddr ? addrTokens.join(" ").trim() : "";
      if (cur) blocks.push(cur);
      cur = {
        lastName: last,
        firstFromHeader: firstName,
        lines: sameLineAddr ? [sameLineAddr] : [],
      };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) blocks.push(cur);

  return blocks.map((b) => {
    const phones = [];
    const emails = [];
    const callings = [];
    let coords = "";
    let preferred = null;
    const addressParts = [];

    for (const line of b.lines) {
      if (COORD_RE.test(line)) {
        coords = line;
        continue;
      }
      const em = line.match(EMAIL_RE);
      if (em && line.includes("@") && !isCalling(line)) {
        emails.push(em[0]);
        const rest = line.replace(EMAIL_RE, "").trim();
        const ph = rest.match(PHONE_RE);
        if (ph && phoneDigits(ph[0]).length >= 10) phones.push(ph[0].trim());
        continue;
      }
      const ph = line.match(PHONE_RE);
      if (ph && phoneDigits(ph[0]).length >= 10) {
        if (line.length < 40 || line.replace(ph[0], "").trim() === "") {
          phones.push(ph[0].trim());
          continue;
        }
      }
      if (isCalling(line)) {
        if (ph && phoneDigits(ph[0]).length >= 10) {
          phones.push(ph[0].trim());
          const callLine = line.replace(PHONE_RE, "").trim();
          if (callLine) callings.push(callLine);
        } else {
          callings.push(line);
        }
        continue;
      }
      if (
        preferred == null &&
        !APT_RE.test(line) &&
        !CITY_RE.test(line) &&
        !/\d/.test(line) &&
        line.split(/\s+/).length <= 6 &&
        !/^(provo|orem|spanish)/i.test(line)
      ) {
        preferred = line;
        continue;
      }
      addressParts.push(line);
    }

    const first = b.firstFromHeader;
    const fullName = `${first} ${b.lastName}`.trim();
    const preferredName = preferred || (first.split(/\s+/)[0] || b.lastName);
    const street = addressParts[0] || "";
    let unit = "";
    for (const part of addressParts) {
      const am = part.match(/(?:Apt|Apartment|APT)\s*([A-Za-z0-9\-]+)/i);
      if (am) {
        unit = am[1];
        break;
      }
    }
    const city =
      addressParts.find((p) => CITY_RE.test(p) || /\bUT\b/i.test(p)) || "";
    return {
      id: hashId(fullName.toLowerCase(), "m"),
      lastName: b.lastName,
      legalFirst: first,
      preferredName,
      fullName,
      photoUrl: "",
      phone: phones[0] || "",
      email: emails[0] || "",
      address: addressParts.join(", "),
      street,
      unit,
      complex: guessComplex(street),
      city,
      coords,
      callings,
      languages: [],
      flags: {
        returnedMissionary: false,
        inactive: false,
        doNotContact: false,
        superSolid: false,
      },
      ministering: { role: "", companions: [], ministeringTo: [] },
      notes: "",
    };
  });
}

function groupApartments(members) {
  const map = new Map();
  for (const m of members) {
    const key = `${m.complex}|${m.unit}|${m.street}`;
    if (!map.has(key)) {
      map.set(key, {
        id: hashId(key, "apt"),
        complex: m.complex,
        unit: m.unit || "—",
        address: m.street || m.address,
        city: m.city,
        members: [],
      });
    }
    map.get(key).members.push(m);
  }
  return [...map.values()].sort((a, b) =>
    `${a.complex} ${a.unit}`.localeCompare(`${b.complex} ${b.unit}`)
  );
}

async function extractPdfContent(file) {
  const pdfjs = await import(
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs"
  );
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const lines = [];
  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const byLine = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      const prev = byLine.get(y) || [];
      prev.push(item.str);
      byLine.set(y, prev);
    }
    const sortedYs = [...byLine.keys()].sort((a, b) => b - a);
    const pageLines = [];
    for (const y of sortedYs) {
      const line = byLine.get(y).join(" ").replace(/\s+/g, " ").trim();
      if (!line) continue;
      pageLines.push(line);
      if (!(isSkip(line) || LETTER_RE.test(line))) lines.push(line);
    }
    pageTexts.push(pageLines.join("\n"));
  }
  return { lines, text: pageTexts.join("\n") };
}

function directoryPayload(file, members) {
  const apartments = groupApartments(members.map(normalizeMember));
  return {
    ward: {
      name: "Provo YSA 147th Ward",
      shortName: "147th Ward",
      unitNumber: "266485",
      stake: "Provo Utah YSA 10th Stake",
      stakeNumber: "511455",
      source: file.name,
      sourceDate: new Date().toISOString().slice(0, 10),
      note: "Parsed from Church Directory PDF. For Church use only — confidential.",
    },
    meta: {
      lastEditedBy: "",
      lastEditedAt: new Date().toISOString(),
      memberCount: members.length,
      apartmentCount: apartments.length,
      importKind: "directory",
      reportSources: [file.name],
    },
    apartments,
  };
}

export async function parseDirectoryPdf(file) {
  const { lines } = await extractPdfContent(file);
  const members = parseMemberLines(lines);
  return directoryPayload(file, members);
}

/* ---------- Specialized report importers (apply onto a directory clone) ---------- */

function touchReportSource(dir, fileName) {
  dir.meta = dir.meta || {};
  const sources = new Set(dir.meta.reportSources || []);
  sources.add(fileName);
  dir.meta.reportSources = [...sources];
  dir.meta.importKind = "report";
  dir.meta.lastEditedAt = new Date().toISOString();
}

function importBudget(dir, text, fileName) {
  const flat = text.replace(/\n/g, " ").replace(/\s+/g, " ");
  const patterns = [
    /\$(\d+(?:,\d{3})*(?:\.\d{2})?)\s*Spent\s*of\s*\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
    /Spent\s*(?:of\s*)?\$(\d+(?:,\d{3})*(?:\.\d{2})?).*?\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
    /\$(\d+(?:,\d{3})*(?:\.\d{2})?)\s+of\s+\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
  ];
  let spentVal = null;
  let plannedVal = null;
  for (const re of patterns) {
    const m = flat.match(re);
    if (!m) continue;
    // Prefer pattern where first is spent and second planned when "Spent of" ordering
    if (/Spent\s*of/i.test(m[0]) || /\$[\d.,]+\s+Spent/i.test(flat)) {
      spentVal = Number(m[1].replace(/,/g, ""));
      plannedVal = Number(m[2].replace(/,/g, ""));
    } else if (/of\s*\$/.test(m[0])) {
      spentVal = Number(m[1].replace(/,/g, ""));
      plannedVal = Number(m[2].replace(/,/g, ""));
    } else {
      spentVal = Number(m[1].replace(/,/g, ""));
      plannedVal = Number(m[2].replace(/,/g, ""));
    }
    break;
  }
  // Also try adjacent money amounts near "Spent"
  if (spentVal == null) {
    const near = flat.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)[^$]{0,40}Spent[^$]{0,40}\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i)
      || flat.match(/Spent[^$]{0,20}\$(\d+(?:,\d{3})*(?:\.\d{2})?)[^$]{0,40}\$(\d+(?:,\d{3})*(?:\.\d{2})?)/i);
    if (near) {
      spentVal = Number(near[1].replace(/,/g, ""));
      plannedVal = Number(near[2].replace(/,/g, ""));
    }
  }

  dir.meta = dir.meta || {};
  const categories = dir.meta.budget?.categories?.length
    ? dir.meta.budget.categories.map((c) => ({ ...c }))
    : [
        { name: "Relief Society", planned: 0, spent: 0 },
        { name: "Activities", planned: 0, spent: 0 },
        { name: "Elders Quorum", planned: 0, spent: 0 },
        { name: "Missionary", planned: 0, spent: 0 },
        { name: "Other", planned: 0, spent: 0 },
      ];
  const rs = categories.find((c) => /relief society/i.test(c.name));
  if (rs && spentVal != null && plannedVal != null) {
    rs.planned = plannedVal;
    rs.spent = spentVal;
  } else if (!rs && spentVal != null && plannedVal != null) {
    categories.unshift({ name: "Relief Society", planned: plannedVal, spent: spentVal });
  }
  const parsed = spentVal != null && plannedVal != null;
  dir.meta.budget = {
    asOf: new Date().toISOString().slice(0, 10),
    notes: parsed
      ? `Imported from ${fileName}. Update other categories as needed.`
      : `Imported from ${fileName}; amounts not detected in PDF text — previous values kept. Update manually if needed.`,
    categories,
  };
  dir.meta.budgetImport = parsed
    ? { spent: spentVal, planned: plannedVal }
    : { spent: null, planned: null, parseFailed: true };
  touchReportSource(dir, fileName);
  return dir;
}

function importCovenant(dir, text, fileName) {
  const idx = indexMembers(dir);
  const known = ["Angelina Whitehead", "Kathryn Henley", "Marti Smith", "Meg Smith"];
  const names = [];
  for (const n of known) {
    if (text.includes(n) && !names.includes(n)) names.push(n);
  }
  // Capture "First Last" lines under New Members style pages
  for (const m of text.matchAll(/^([A-Z][a-zA-ZÀ-ÿ'’\-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'’\-]+)+)\s*$/gm)) {
    const n = m[1];
    if (/Covenant|Members|Sacrament|Friends|View Details|Guide|Returning|Taught/i.test(n)) continue;
    if (n.split(/\s+/).length >= 2 && !names.includes(n)) names.push(n);
  }
  const marked = [];
  for (const full of names) {
    const parts = full.split(/\s+/);
    const first = parts.slice(0, -1).join(" ");
    const last = parts[parts.length - 1];
    const member = findMember(idx, last, first);
    if (member) {
      member.covenantPath = {
        ...(member.covenantPath || {}),
        baptized: true,
        confirmed: true,
        latestConvert: true,
        notes: "Listed under New Members on Covenant Path Progress",
      };
      marked.push(member.fullName);
    }
  }
  dir.meta = dir.meta || {};
  dir.meta.latestConverts = marked.length ? marked : names;
  touchReportSource(dir, fileName);
  return dir;
}

function importBirthday(dir, text, fileName) {
  const idx = indexMembers(dir);
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  let count = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m2 = lines[i].match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(.*)$/);
    if (!m2) continue;
    const [, dayS, monS, rest] = m2;
    const month = monthNum(monS);
    if (!month) continue;
    let age = null;
    let namePart = rest;
    const am = rest.match(/^(\d{1,3})\s+(.*)$/);
    if (am && Number(am[1]) < 120) {
      age = Number(am[1]);
      namePart = am[2];
    }
    const am2 = namePart.match(/\b(\d{2})\b\s*(?:\(|$)/);
    if (age == null && am2) {
      age = Number(am2[1]);
      namePart = namePart.slice(0, am2.index).trim();
    }
    namePart = namePart.replace(/\s*\(\d{3}.*$/, "").replace(/^[, ]+|[, ]+$/g, "");
    if (!namePart.includes(",") && i + 1 < lines.length) {
      const nxt = lines[i + 1];
      if (!/^\d{1,2}\s+[A-Za-z]{3}/.test(nxt) && !/Count:|Birthday/i.test(nxt)
        && /[A-Za-z]/.test(nxt) && !/Provo|Orem|Apt|UT\b/.test(nxt)) {
        namePart = `${namePart} ${nxt}`.trim();
        i += 1;
        const am3 = namePart.match(/\b(\d{2})\b/);
        if (age == null && am3) {
          age = Number(am3[1]);
          namePart = namePart.slice(0, am3.index).trim();
        }
      }
    }
    namePart = namePart.replace(/\s+\d{2}$/, "").replace(/^[, ]+|[, ]+$/g, "");
    if (!namePart || /Count:/i.test(namePart)) continue;
    const { last, first } = parseNameLastFirst(namePart);
    if (!last || /^(phone|name|birthday)$/i.test(last)) continue;
    if (age == null) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j += 1) {
        const am4 = lines[j].match(/\b(\d{2})\b/);
        if (am4 && Number(am4[1]) < 100) {
          age = Number(am4[1]);
          break;
        }
      }
    }
    if (age == null) continue;
    const year = birthYearFromAge(month, Number(dayS), age);
    const bday = `${year}-${String(month).padStart(2, "0")}-${String(Number(dayS)).padStart(2, "0")}`;
    const member = findMember(idx, last, first);
    if (member) {
      member.birthday = bday;
      member.gender = member.gender || "M";
      count += 1;
    }
  }
  dir.meta = dir.meta || {};
  dir.meta.birthdayImportCount = count;
  touchReportSource(dir, fileName);
  return dir;
}

function parseMinisteringBlocks(text, role) {
  const comps = [];
  const blocks = text.split(/MINISTERING (?:BROTHERS|SISTERS)/i);
  for (const block of blocks.slice(1)) {
    if (!/ASSIGNED/i.test(block)) continue;
    const parts = block.split(/ASSIGNED (?:HOUSEHOLDS|SISTERS)/i);
    if (parts.length < 2) continue;
    const [before, after] = parts;
    const companions = [];
    for (const ln of before.split(/\n/)) {
      const line = ln.trim();
      if (!line || /^(OCT|QUARTER|NOV|DEC|District|Presidency|Select|Count|\d)/i.test(line)) continue;
      if (line.includes(",") && !/^assigned/i.test(line)) {
        companions.push(line.split("(")[0].trim());
      }
    }
    const assigned = [];
    for (const ln of after.split(/\n/)) {
      const line = ln.trim();
      if (!line || /^(OCT|QUARTER|Count|District|Add |Move|Companionships|Presidency|Select|MINISTERING|00%|0 \/)/i.test(line)) continue;
      if (line.includes(",")) assigned.push(line.split("(")[0].trim());
    }
    if (companions.length) comps.push({ companions, assigned, role });
  }
  return comps;
}

function applyMinistering(dir, comps) {
  const idx = indexMembers(dir);
  const resolve = (nameLf) => {
    const { last, first } = parseNameLastFirst(nameLf);
    return findMember(idx, last, first);
  };
  let applied = 0;
  for (const c of comps) {
    const companionMembers = c.companions.map(resolve).filter(Boolean);
    const assignedMembers = c.assigned.map(resolve).filter(Boolean);
    const companionIds = companionMembers.map((m) => m.id);
    const assignedIds = assignedMembers.map((m) => m.id);
    for (const m of companionMembers) {
      m.ministering = {
        role: c.role,
        companions: companionIds.filter((id) => id !== m.id),
        ministeringTo: assignedIds,
      };
      m.gender = m.gender || (c.role === "sister" ? "F" : "M");
      applied += 1;
    }
  }
  return applied;
}

function importMinistering(dir, text, role, fileName) {
  const comps = parseMinisteringBlocks(text, role);
  const applied = applyMinistering(dir, comps);
  dir.meta = dir.meta || {};
  dir.meta.ministeringImportCount = (dir.meta.ministeringImportCount || 0) + applied;
  touchReportSource(dir, fileName);
  return dir;
}

function importMovedIn(dir, text, fileName) {
  const idx = indexMembers(dir);
  let count = 0;
  for (const ln of text.split(/\n/)) {
    const line = ln.trim();
    const mm = line.match(
      /^([A-Z][A-Za-zÀ-ÿ'’\-]+,\s+[A-Za-zÀ-ÿ'’\-\s]+?)\s+(\d{1,3})\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/
    );
    if (!mm) continue;
    const [, name, , day, mon, year] = mm;
    const month = monthNum(mon);
    if (!month) continue;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
    const { last, first } = parseNameLastFirst(name);
    const member = findMember(idx, last, first);
    if (member) {
      member.moved = { status: "in", date: iso, notes: "" };
      count += 1;
    }
  }
  dir.meta = dir.meta || {};
  dir.meta.movedInImportCount = count;
  touchReportSource(dir, fileName);
  return dir;
}

function importMovedOut(dir, text, fileName) {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    if (/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(ln) || /^(Count:|Members Moved|Print|Name )/i.test(ln)) continue;
    const combined2 = i + 1 < lines.length ? `${ln} ${lines[i + 1]}` : ln;
    let mm = combined2.match(
      /^([A-Z][A-Za-zÀ-ÿ'’\-\s]+?)\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+(.*)$/
    );
    if (!mm) {
      mm = ln.match(
        /^([A-Z][A-Za-zÀ-ÿ'’\-, ]+?)\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s*(.*)$/
      );
    }
    if (!mm) continue;
    const [, nameRaw, birth, move, unit] = mm;
    const name = nameRaw.replace(/^[, ]+|[, ]+$/g, "");
    if (!name.includes(",") && name.split(/\s+/).length > 5) continue;

    const toIso = (s) => {
      const [day, mon, year] = s.split(/\s+/);
      const month = monthNum(mon);
      return `${year}-${String(month).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
    };
    rows.push({
      name,
      birthday: toIso(birth),
      date: toIso(move),
      newUnit: (unit || "").trim(),
    });
  }
  dir.meta = dir.meta || {};
  dir.meta.movedOutRecords = rows;
  const idx = indexMembers(dir);
  let marked = 0;
  for (const r of rows) {
    const { last, first } = parseNameLastFirst(r.name);
    const member = findMember(idx, last, first);
    if (member) {
      member.moved = { status: "out", date: r.date, notes: r.newUnit };
      if (!member.birthday) member.birthday = r.birthday;
      marked += 1;
    }
  }
  dir.meta.movedOutImportCount = marked;
  touchReportSource(dir, fileName);
  return dir;
}

function importLost(dir, text, fileName) {
  let rows = [];
  const lines = text.split(/\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    if (!ln.includes(",") || /^(Finding|When |Phone|Name|Count|The members)/i.test(ln) || /^\d\./.test(ln)) {
      continue;
    }
    let chunk = ln;
    let j = i + 1;
    while (j < lines.length && !/\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(chunk) && j < i + 4) {
      chunk += ` ${lines[j]}`;
      j += 1;
    }
    const mm = chunk.match(
      /^([A-Z][A-Za-zÀ-ÿ'’\-\s]+,\s*[A-Za-zÀ-ÿ'’\-\s]+?)\s*(?:\((\d{3})\)\s*(\d{3}-\d{4}))?\s*([A-Za-z0-9._%+\-]+@[^\s]+)?\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/
    );
    if (mm) {
      const [, name, a, b, email, added] = mm;
      rows.push({
        name: name.replace(/\s+/g, " ").trim(),
        phone: a && b ? `(${a}) ${b}` : "",
        email: email || "",
        dateAdded: added,
      });
      i = j - 1;
    }
  }
  const seen = new Set();
  const uniq = [];
  for (const r of rows) {
    const k = r.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(r);
  }
  dir.meta = dir.meta || {};
  dir.meta.lostMembers = uniq;
  dir.meta.findingLostNotes =
    "Members on this list are not counted in the ward. Contact via phone/email/social, "
    + "family/friends, last known address, then obtain Bishop approval before returning records.";
  const idx = indexMembers(dir);
  for (const r of uniq) {
    const { last, first } = parseNameLastFirst(r.name);
    const member = findMember(idx, last, first);
    if (member) {
      member.lostMember = true;
      if (r.phone && !member.phone) member.phone = r.phone;
      if (r.email && !member.email) member.email = r.email;
    }
  }
  touchReportSource(dir, fileName);
  return dir;
}

function importQuarterly(dir, text, fileName) {
  dir.meta = dir.meta || {};
  const pot = text.match(/Converts attending[\s\S]*?(\d+)\s+(\d+)/i);
  dir.meta.quarterlyConvertStats = {
    source: fileName,
    note:
      "Convert names come from Covenant Path Progress New Members when available. "
      + "Quarterly Report lists convert counts without names.",
    convertsPast12MonthsPotential: pot ? Number(pot[2]) : dir.meta.quarterlyConvertStats?.convertsPast12MonthsPotential || 2,
  };
  touchReportSource(dir, fileName);
  return dir;
}

function importServingMissionaries(dir, text, fileName) {
  dir.meta = dir.meta || {};
  const none = /No serving missionaries/i.test(text);
  dir.meta.servingMissionaries = {
    source: fileName,
    asOf: new Date().toISOString().slice(0, 10),
    note: none ? "No serving missionaries at this time." : "See Serving Missionaries PDF for details.",
    empty: none,
  };
  touchReportSource(dir, fileName);
  return dir;
}

function importOrganizationsTable(dir, text, fileName) {
  const idx = indexMembers(dir);
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  let applied = 0;
  // "Bishop Berrett, Britt 26 Apr 2026" or "Elders Quorum President Atkinson, Joshua Farr 2 Aug 2026"
  const rowRe =
    /^(.+?)\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]+(?:\s+[A-ZÀ-ÿ][A-Za-zÀ-ÿ'’\-]+)*),\s+([A-Za-zÀ-ÿ'’\-\s]+?)\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s*$/;
  for (const ln of lines) {
    if (/^Calling Name|^Count:|Presidency$|^Organizations$/i.test(ln)) continue;
    const mm = ln.match(rowRe);
    if (!mm) continue;
    const calling = mm[1].trim();
    const last = mm[2].trim();
    const first = mm[3].trim();
    if (!CALLING_HINTS.some((h) => calling.toLowerCase().includes(h.toLowerCase()))
      && !/bishop|clerk|secretary|president|counselor|teacher|missionary|coordinator|leader|specialist|representative|accompanist|auditor|committee/i.test(calling)) {
      continue;
    }
    const member = findMember(idx, last, first);
    if (!member) continue;
    member.callings = member.callings || [];
    if (!member.callings.includes(calling)) member.callings.push(calling);
    if (/relief society|young women|primary/i.test(calling)) member.gender = member.gender || "F";
    if (/elders quorum|bishop|priests|deacons|teachers quorum/i.test(calling)) member.gender = member.gender || "M";
    applied += 1;
  }
  dir.meta = dir.meta || {};
  dir.meta.organizationsImportCount = applied;
  touchReportSource(dir, fileName);
  return dir;
}

function importOrgDirectoryCallings(dir, lines, fileName) {
  // Partial org directory maps: upsert callings/gender onto existing members without full roster replace
  const idx = indexMembers(dir);
  const gender = /elders.?quorum/i.test(fileName)
    ? "M"
    : /relief.?society/i.test(fileName)
      ? "F"
      : "";
  let applied = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    if (!ln.includes(",") || ln.startsWith("©") || ln.includes("|")) continue;
    let last = "";
    let first = "";
    const mm = ln.match(
      /^([A-Z][A-Za-zÀ-ÿ'’\-]+),\s+([A-Za-zÀ-ÿ'’\-\s]+?)(?:\s+\d|\s+Apt|\s+apt|\s+Individual|\s+Provo|\s+Orem|\s*$)/
    );
    if (mm) {
      last = mm[1];
      first = mm[2].trim();
    } else if (/^[A-Z].*,/.test(ln)) {
      const [l, rest] = ln.split(",", 2);
      last = l;
      const firstTokens = [];
      for (const tok of (rest || "").split(/\s+/)) {
        if (/^\d/.test(tok) || /^(apt|apartment|individual|provo|orem)$/i.test(tok)) break;
        firstTokens.push(tok);
      }
      first = firstTokens.join(" ");
    } else continue;

    let calling = "";
    if (i + 1 < lines.length) {
      const nxt = lines[i + 1];
      if (CALLING_HINTS.some((h) => nxt.includes(h))) {
        calling = nxt.split(/\d{2}\.\d+|Apt |\(\d|PROVO|Provo|Individual/)[0].trim();
      }
    }
    const member = findMember(idx, last, first);
    if (member && calling) {
      member.callings = member.callings || [];
      if (!member.callings.includes(calling)) member.callings.push(calling);
      if (gender) member.gender = gender;
      if (/Relief.?Society/i.test(fileName)) member.gender = "F";
      if (/Elders.?Quorum/i.test(fileName)) member.gender = "M";
      applied += 1;
    }
  }
  dir.meta = dir.meta || {};
  dir.meta.callingsImportCount = (dir.meta.callingsImportCount || 0) + applied;
  touchReportSource(dir, fileName);
  return dir;
}

function isOrgSubsetDirectory(fileName) {
  const n = normalizeFileKey(fileName);
  return (
    /elders\s*quorum|relief\s*society|sunday\s*school|temple|ward\s*missionar|young\s*single|other\s*callings|organizations\s*147|assigned\s*missionar|bishopric|aaronic\s*priesthood|priests\s*quorum/.test(n)
    && /directory|map|ward|quorum|bishopric|missionar/.test(n)
  );
}

function importAssignedMissionaries(dir, text, fileName) {
  const emails = [...text.matchAll(/[A-Za-z0-9._%+\-]+@missionary\.org/g)].map((m) => m[0]);
  const personalEmails = emails.filter((e) => !/^\d+@/.test(e));
  const companionship = emails.find((e) => /^\d+@/.test(e)) || "";
  let names = [];
  const seen = new Set();
  // "Elder A B Elder C D" on one line
  for (const m of text.matchAll(
    /Elder\s+([A-Z][a-zA-ZÀ-ÿ'’\-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'’\-]+)*?)(?=\s+Elder\b|\s+[a-z0-9._%+\-]+@|\s*$)/g
  )) {
    const full = m[1].replace(/\s+/g, " ").trim();
    if (seen.has(full) || full.split(/\s+/).length < 2 || / Elder /.test(full)) continue;
    seen.add(full);
    names.push(full);
  }
  if (names.length < 2) {
    names = [];
    for (const part of text.split(/\bElder\s+/).slice(1)) {
      const m = part.match(/^([A-Z][a-zA-ZÀ-ÿ'’\-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'’\-]+){1,4})/);
      if (!m) continue;
      const full = m[1].replace(/\s+/g, " ").trim();
      if (seen.has(full) || full.split(/\s+/).length < 2) continue;
      seen.add(full);
      names.push(full);
    }
  }
  const members = allMembersFrom(dir);
  const byName = new Map(members.map((m) => [m.fullName.toLowerCase(), m]));
  let added = 0;
  names.forEach((full, i) => {
    const parts = full.split(/\s+/);
    const first = parts.slice(0, -1).join(" ");
    const last = parts[parts.length - 1];
    const fullName = `Elder ${full}`;
    const email = personalEmails[i] || "";
    const existing = byName.get(fullName.toLowerCase());
    if (existing) {
      if (email && !existing.email) existing.email = email;
      if (!(existing.callings || []).includes("Assigned Full-Time Missionary")) {
        existing.callings = [...(existing.callings || []), "Assigned Full-Time Missionary"];
      }
      return;
    }
    const member = normalizeMember({
      id: hashId(fullName.toLowerCase(), "m"),
      lastName: last,
      legalFirst: first,
      preferredName: `Elder ${parts[0]}`,
      fullName,
      photoUrl: "",
      phone: "",
      email,
      address: "Utah Provo Mission Office, 85 N 600 E, Provo UT 84606",
      street: "85 N 600 E",
      unit: "—",
      complex: "Assigned Missionaries",
      city: "Provo UT 84606",
      coords: "40.235083, -111.647792",
      callings: ["Assigned Full-Time Missionary"],
      notes: "Utah Provo Mission companionship assigned to the ward.",
      flags: { solid: true },
      livesAtOldMill: false,
    });
    members.push(member);
    added += 1;
  });
  // Drop bad combined Elder names from earlier buggy imports
  const cleaned = members.filter(
    (m) => !(m.fullName.startsWith("Elder ") && / Elder /.test(m.fullName))
  );
  dir.apartments = groupApartments(cleaned);
  dir.mission = {
    ...(dir.mission || {}),
    name: "Utah Provo Mission",
    office: "85 N 600 E, Provo UT 84606",
    phone: "+1 801-377-1490",
    assignedCompanionshipEmail: companionship || dir.mission?.assignedCompanionshipEmail || "",
  };
  dir.meta = dir.meta || {};
  dir.meta.assignedMissionaryImportCount = names.length;
  dir.meta.assignedMissionariesAdded = added;
  touchReportSource(dir, fileName);
  return dir;
}

function applySpecializedReport(previous, kind, text, lines, file) {
  const dir = cloneDirectory(previous);
  switch (kind) {
    case "budget":
      return importBudget(dir, text, file.name);
    case "covenant":
      return importCovenant(dir, text, file.name);
    case "birthday":
      return importBirthday(dir, text, file.name);
    case "ministering-brothers":
      return importMinistering(dir, text, "brother", file.name);
    case "ministering-sisters":
      return importMinistering(dir, text, "sister", file.name);
    case "moved-in":
      return importMovedIn(dir, text, file.name);
    case "moved-out":
      return importMovedOut(dir, text, file.name);
    case "lost":
      return importLost(dir, text, file.name);
    case "quarterly":
      return importQuarterly(dir, text, file.name);
    case "serving-missionaries":
      return importServingMissionaries(dir, text, file.name);
    case "assigned-missionaries":
      return importAssignedMissionaries(dir, text, file.name);
    case "organizations-table":
      return importOrganizationsTable(dir, text, file.name);
    default:
      return dir;
  }
}

/** Apply a classified report from extracted text (for tests / offline import). */
export function applyReportFromText(previous, kind, text, fileName = "report.pdf") {
  const lines = String(text).split(/\n/).map((l) => l.trim()).filter(Boolean);
  return applySpecializedReport(previous, kind, text, lines, { name: fileName });
}

export function mergeDirectory(previous, incoming) {
  const prevMembers = previous.apartments.flatMap((a) => a.members);
  const incomingMembers = incoming.apartments.flatMap((a) => a.members);
  const byPrevName = new Map(prevMembers.map((m) => [m.fullName.toLowerCase(), m]));
  const byPrevId = new Map(prevMembers.map((m) => [m.id, m]));

  // Report patches already contain the full roster with updates applied
  const reportPatch = incoming.meta?.importKind === "report";
  // Full roster replace when import is large (typical Church Directory PDF/JSON dump)
  const fullReplace =
    reportPatch
    || incomingMembers.length >= Math.max(20, prevMembers.length * 0.5);

  const upserted = new Map();

  const mergeOne = (incomingMember, prev) => {
    if (!prev) return normalizeMember(incomingMember);
    // For report patches, incoming already has leader edits + new report fields
    if (reportPatch) return normalizeMember(incomingMember);
    return normalizeMember({
      ...incomingMember,
      id: prev.id || incomingMember.id,
      preferredName: prev.preferredName || incomingMember.preferredName,
      photoUrl: prev.photoUrl?.startsWith("data:")
        ? prev.photoUrl
        : incomingMember.photoUrl || prev.photoUrl || "",
      photoSource: prev.photoUrl?.startsWith("data:")
        ? "leader-upload"
        : incomingMember.photoUrl
          ? incomingMember.photoSource || "ward-directory"
          : prev.photoSource || "missing",
      languages: prev.languages?.length ? prev.languages : incomingMember.languages,
      gender: incomingMember.gender || prev.gender || "",
      birthday: incomingMember.birthday || prev.birthday || "",
      flags: { ...defaultFlags(), ...incomingMember.flags, ...prev.flags },
      ministering: incomingMember.ministering?.role
        ? incomingMember.ministering
        : prev.ministering || incomingMember.ministering,
      notes: prev.notes || "",
      covenantPath: {
        ...defaultCovenant(),
        ...prev.covenantPath,
        ...incomingMember.covenantPath,
      },
      moved: incomingMember.moved?.status
        ? incomingMember.moved
        : prev.moved || incomingMember.moved || { status: "", date: "", notes: "" },
      lostMember: incomingMember.lostMember || prev.lostMember || false,
      phone: incomingMember.phone || prev.phone || "",
      email: incomingMember.email || prev.email || "",
      callings: incomingMember.callings?.length
        ? Array.from(new Set([...(prev.callings || []), ...incomingMember.callings]))
        : prev.callings || [],
      address: incomingMember.address || prev.address || "",
      street: incomingMember.street || prev.street || "",
      unit: incomingMember.unit || prev.unit || "",
      complex: incomingMember.complex || prev.complex || "",
      city: incomingMember.city || prev.city || "",
    });
  };

  if (fullReplace) {
    for (const m of incomingMembers) {
      const prev = byPrevName.get(m.fullName.toLowerCase()) || byPrevId.get(m.id);
      upserted.set(m.fullName.toLowerCase(), mergeOne(m, prev));
    }
  } else {
    for (const m of prevMembers) {
      upserted.set(m.fullName.toLowerCase(), normalizeMember(m));
    }
    for (const m of incomingMembers) {
      const key = m.fullName.toLowerCase();
      const prev = upserted.get(key) || byPrevName.get(key);
      upserted.set(key, mergeOne(m, prev));
    }
  }

  const members = [...upserted.values()];
  const apartments = groupApartments(members);

  const reportSources = [
    ...new Set([
      ...(previous.meta?.reportSources || []),
      ...(incoming.meta?.reportSources || []),
      incoming.ward?.source,
    ].filter(Boolean)),
  ];

  return {
    ward: {
      ...previous.ward,
      ...incoming.ward,
      stake: "Provo Utah YSA 10th Stake",
      stakeNumber: "511455",
      unitNumber: "266485",
      name: "Provo YSA 147th Ward",
    },
    meta: {
      ...previous.meta,
      ...incoming.meta,
      memberCount: members.length,
      apartmentCount: apartments.length,
      latestConverts: incoming.meta?.latestConverts ?? previous.meta?.latestConverts ?? [],
      budget: incoming.meta?.budget ?? previous.meta?.budget,
      findingLostNotes:
        incoming.meta?.findingLostNotes || previous.meta?.findingLostNotes || "",
      lostMembers: incoming.meta?.lostMembers ?? previous.meta?.lostMembers ?? [],
      movedOutRecords: incoming.meta?.movedOutRecords ?? previous.meta?.movedOutRecords ?? [],
      quarterlyConvertStats:
        incoming.meta?.quarterlyConvertStats ?? previous.meta?.quarterlyConvertStats,
      servingMissionaries:
        incoming.meta?.servingMissionaries ?? previous.meta?.servingMissionaries,
      reportSources,
    },
    mission: previous.mission || incoming.mission,
    apartments,
  };
}

function defaultFlags() {
  return {
    returnedMissionary: false,
    inactive: false,
    doNotContact: false,
    solid: false,
    endowed: false,
  };
}

function defaultCovenant() {
  return {
    baptized: false,
    confirmed: false,
    endowed: false,
    latestConvert: false,
    notes: "",
  };
}

function normalizeMember(m) {
  const flags = { ...defaultFlags(), ...(m.flags || {}) };
  if ("superSolid" in flags) {
    flags.solid = flags.solid || flags.superSolid;
    delete flags.superSolid;
  }
  return {
    ...m,
    gender: m.gender || "",
    birthday: m.birthday || "",
    photoSource: m.photoSource || (m.photoUrl ? "ward-directory" : "missing"),
    flags,
    covenantPath: { ...defaultCovenant(), ...(m.covenantPath || {}), endowed: flags.endowed },
    moved: m.moved || { status: "", date: "", notes: "" },
    lostMember: Boolean(m.lostMember),
    ministering: m.ministering || { role: "", companions: [], ministeringTo: [] },
    languages: m.languages || [],
    callings: m.callings || [],
  };
}

function emptyMemberFromRow(row) {
  const fullName = row.fullName || `${row.preferredName || row.legalFirst || ""} ${row.lastName || ""}`.trim();
  const lastName = row.lastName || fullName.split(" ").slice(-1)[0] || "";
  const legalFirst = row.legalFirst || row.preferredName || fullName.replace(lastName, "").trim();
  return normalizeMember({
    id: row.id || `m-${Math.abs(hashCode(fullName.toLowerCase())).toString(16)}`,
    lastName,
    legalFirst,
    preferredName: row.preferredName || legalFirst.split(" ")[0] || lastName,
    fullName,
    photoUrl: row.photoUrl || "",
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    street: row.street || row.address || "",
    unit: row.unit || "—",
    complex: row.complex || "Imported",
    city: row.city || "",
    coords: row.coords || "",
    callings: parseList(row.callings),
    languages: parseList(row.languages),
    gender: row.gender === "M" || row.gender === "F" ? row.gender : "",
    birthday: row.birthday || "",
    notes: row.notes || "",
  });
}

function parseList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(/[;,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function groupFromMembers(members) {
  return groupApartments(members.map(normalizeMember));
}

/**
 * Parse an uploaded ward file. Pass the current directory so specialized
 * report PDFs (budget, ministering, moved, lost, etc.) can upsert into it.
 */
export async function parseDirectoryFile(file, previous = null) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json") || file.type === "application/json") {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.apartments) {
      data.apartments = data.apartments.map((apt) => ({
        ...apt,
        members: (apt.members || []).map(normalizeMember),
      }));
      data.meta = { ...(data.meta || {}), importKind: "directory", reportSources: [file.name] };
      return data;
    }
    if (Array.isArray(data)) {
      const members = data.map(emptyMemberFromRow);
      return {
        ward: {
          name: "Provo YSA 147th Ward",
          shortName: "147th Ward",
          unitNumber: "266485",
          stake: "Provo Utah YSA 10th Stake",
          stakeNumber: "511455",
          source: file.name,
          sourceDate: new Date().toISOString().slice(0, 10),
        },
        meta: {
          lastEditedAt: new Date().toISOString(),
          memberCount: members.length,
          importKind: "directory",
          reportSources: [file.name],
        },
        apartments: groupFromMembers(members),
      };
    }
    throw new Error("JSON must contain apartments[] or an array of members.");
  }

  if (name.endsWith(".csv") || file.type === "text/csv") {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("CSV had no rows.");
    const members = rows.map(emptyMemberFromRow);
    return {
      ward: {
        name: "Provo YSA 147th Ward",
        shortName: "147th Ward",
        unitNumber: "266485",
        stake: "Provo Utah YSA 10th Stake",
        stakeNumber: "511455",
        source: file.name,
        sourceDate: new Date().toISOString().slice(0, 10),
      },
      meta: {
        lastEditedAt: new Date().toISOString(),
        memberCount: members.length,
        importKind: "directory",
        reportSources: [file.name],
      },
      apartments: groupFromMembers(members),
    };
  }

  // PDF — classify and route
  const { lines, text } = await extractPdfContent(file);
  const kind = classifyReport(file.name, text);

  if (kind !== "directory") {
    if (!previous?.apartments?.length) {
      throw new Error(
        `${file.name} is a ${kind} report. Load the ward directory first, then upload this report to update it.`
      );
    }
    return applySpecializedReport(previous, kind, text, lines, file);
  }

  // Subset org directories (EQ/RS/etc.): merge callings into current roster instead of wiping
  if (previous?.apartments?.length && isOrgSubsetDirectory(file.name)) {
    const members = parseMemberLines(lines);
    if (members.length > 0 && members.length < Math.max(30, allMembersFrom(previous).length * 0.4)) {
      return importOrgDirectoryCallings(cloneDirectory(previous), lines, file.name);
    }
  }

  const members = parseMemberLines(lines);
  if (!members.length && previous?.apartments?.length) {
    // Fallback: try organizations-table parse if no roster names found
    if (/Calling Name Sustained/.test(text) || /Organizations/.test(text.slice(0, 200))) {
      return importOrganizationsTable(cloneDirectory(previous), text, file.name);
    }
  }
  if (!members.length) {
    throw new Error(`No members found in ${file.name}.`);
  }
  return directoryPayload(file, members);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return {
      fullName: row.fullName || row.name || row.Name || "",
      preferredName: row.preferredName || row.preferred || row.Nickname || "",
      legalFirst: row.legalFirst || row.firstName || row.First || "",
      lastName: row.lastName || row.Last || "",
      phone: row.phone || row.Phone || "",
      email: row.email || row.Email || "",
      address: row.address || row.Address || "",
      street: row.street || "",
      unit: row.unit || row.Unit || row.Apt || "",
      complex: row.complex || row.Complex || "",
      city: row.city || row.City || "",
      callings: row.callings || row.Calling || "",
      languages: row.languages || row.Languages || "",
      gender: row.gender || row.Gender || "",
      birthday: row.birthday || row.Birthday || row.birthdate || "",
      notes: row.notes || row.Notes || "",
      photoUrl: row.photoUrl || "",
    };
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
