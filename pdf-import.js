/**
 * Client-side Church Directory PDF text parser.
 * Mirrors scripts/parse_directory_pdf.py enough for roster refreshes.
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

const CALLING_HINTS = [
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

export async function parseDirectoryPdf(file) {
  const pdfjs = await import(
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs"
  );
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const lines = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    // pdf.js often loses newlines; re-split on form patterns using raw items by Y
    const byLine = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      const prev = byLine.get(y) || [];
      prev.push(item.str);
      byLine.set(y, prev);
    }
    const sortedYs = [...byLine.keys()].sort((a, b) => b - a);
    for (const y of sortedYs) {
      const line = byLine.get(y).join(" ").replace(/\s+/g, " ").trim();
      if (isSkip(line) || LETTER_RE.test(line)) continue;
      lines.push(line);
    }
    void pageText;
  }

  const members = parseMemberLines(lines);
  const apartments = groupApartments(members);
  return {
    ward: {
      name: "Provo YSA 147th Ward",
      shortName: "147th Ward",
      unitNumber: "266485",
      stake: "Provo YSA",
      source: file.name,
      sourceDate: new Date().toISOString().slice(0, 10),
      note: "Parsed from Church Directory PDF. For Church use only — confidential.",
    },
    meta: {
      lastEditedBy: "",
      lastEditedAt: new Date().toISOString(),
      memberCount: members.length,
      apartmentCount: apartments.length,
    },
    apartments,
  };
}

export function mergeDirectory(previous, incoming) {
  const prevMembers = previous.apartments.flatMap((a) => a.members);
  const incomingMembers = incoming.apartments.flatMap((a) => a.members);
  const byPrevName = new Map(prevMembers.map((m) => [m.fullName.toLowerCase(), m]));
  const byPrevId = new Map(prevMembers.map((m) => [m.id, m]));

  // Full roster replace when import is large (typical Church Directory PDF/JSON dump)
  const fullReplace = incomingMembers.length >= Math.max(20, prevMembers.length * 0.5);

  const upserted = new Map();

  const mergeOne = (incomingMember, prev) => {
    if (!prev) return normalizeMember(incomingMember);
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
      gender: prev.gender || incomingMember.gender || "",
      birthday: prev.birthday || incomingMember.birthday || "",
      flags: { ...defaultFlags(), ...incomingMember.flags, ...prev.flags },
      ministering: prev.ministering || incomingMember.ministering,
      notes: prev.notes || "",
      covenantPath: {
        ...defaultCovenant(),
        ...incomingMember.covenantPath,
        ...prev.covenantPath,
      },
      moved: prev.moved || incomingMember.moved || { status: "", date: "", notes: "" },
      lostMember: prev.lostMember ?? incomingMember.lostMember ?? false,
      phone: incomingMember.phone || prev.phone || "",
      email: incomingMember.email || prev.email || "",
      callings: incomingMember.callings?.length
        ? incomingMember.callings
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
    // Partial CSV/JSON: keep previous roster and upsert rows
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
      latestConverts: previous.meta?.latestConverts || [],
      budget: previous.meta?.budget || incoming.meta?.budget,
      findingLostNotes: previous.meta?.findingLostNotes || "",
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

export async function parseDirectoryFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json") || file.type === "application/json") {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.apartments) {
      data.apartments = data.apartments.map((apt) => ({
        ...apt,
        members: (apt.members || []).map(normalizeMember),
      }));
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
      },
      apartments: groupFromMembers(members),
    };
  }

  // Default: PDF
  return parseDirectoryPdf(file);
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
    // normalize common header aliases
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
