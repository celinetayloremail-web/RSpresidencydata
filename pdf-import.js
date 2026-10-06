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
  const byName = new Map(
    prevMembers.map((m) => [m.fullName.toLowerCase(), m])
  );

  for (const apt of incoming.apartments) {
    apt.members = apt.members.map((m) => {
      const prev = byName.get(m.fullName.toLowerCase());
      if (!prev) return m;
      return {
        ...m,
        id: prev.id || m.id,
        preferredName: prev.preferredName || m.preferredName,
        photoUrl: prev.photoUrl || m.photoUrl,
        languages: prev.languages?.length ? prev.languages : m.languages,
        flags: { ...m.flags, ...prev.flags },
        ministering: prev.ministering || m.ministering,
        notes: prev.notes || "",
        // Prefer fresh contact fields from PDF, fall back to previous
        phone: m.phone || prev.phone || "",
        email: m.email || prev.email || "",
        callings: m.callings?.length ? m.callings : prev.callings || [],
      };
    });
  }
  return incoming;
}
