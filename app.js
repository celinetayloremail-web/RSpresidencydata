import { mergeDirectory, parseDirectoryFile } from "./pdf-import.js";

const STORAGE_KEY = "ward147-directory-state-v3";
const NAME_KEY = "ward147-leader-name-v1";
const PASS_HASH =
  "dda9f750c8f6b1e33cbb22a3fd2970f236853237044c30d17a6f9d0174994042";

const els = {
  gate: document.getElementById("gate"),
  app: document.getElementById("app"),
  gateForm: document.getElementById("gate-form"),
  leaderName: document.getElementById("leader-name"),
  leaderPassword: document.getElementById("leader-password"),
  togglePassword: document.getElementById("toggle-password"),
  gateError: document.getElementById("gate-error"),
  enterDirectory: document.getElementById("enter-directory"),
  search: document.getElementById("search"),
  complexFilter: document.getElementById("complex-filter"),
  flagFilter: document.getElementById("flag-filter"),
  podList: document.getElementById("pod-list"),
  emptyState: document.getElementById("empty-state"),
  stats: document.getElementById("stats"),
  lastEdited: document.getElementById("last-edited"),
  dialog: document.getElementById("member-dialog"),
  dialogBody: document.getElementById("dialog-body"),
  dialogClose: document.getElementById("dialog-close"),
  signOut: document.getElementById("sign-out"),
  dataUpload: document.getElementById("data-upload"),
  importStatus: document.getElementById("import-status"),
  ministeringSisters: document.getElementById("ministering-sisters"),
  ministeringBrothers: document.getElementById("ministering-brothers"),
  birthdayList: document.getElementById("birthday-list"),
  birthdayToday: document.getElementById("birthday-today"),
  covenantList: document.getElementById("covenant-list"),
  latestConvertsInput: document.getElementById("latest-converts-input"),
  saveConverts: document.getElementById("save-converts"),
  movedInList: document.getElementById("moved-in-list"),
  movedOutList: document.getElementById("moved-out-list"),
  lostList: document.getElementById("lost-list"),
  lostNotes: document.getElementById("lost-notes"),
  nonOldMillList: document.getElementById("non-old-mill-list"),
  budgetTable: document.getElementById("budget-table"),
  budgetNotes: document.getElementById("budget-notes"),
  gameDeck: document.getElementById("game-deck"),
  gameStart: document.getElementById("game-start"),
  gameNext: document.getElementById("game-next"),
  gameCard: document.getElementById("game-card"),
  gameFront: document.getElementById("game-front"),
  gameBack: document.getElementById("game-back"),
  gameProgress: document.getElementById("game-progress"),
};

let directory = null;
let directoryReady = false;
let isUnlocked = false;
let currentLeader = "";
let saveTimer = null;
let activeMemberId = null;
let gameDeck = [];
let gameIndex = 0;

/** @type {(message: string) => string} */
function sha256Fallback(message) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const utf8 = new TextEncoder().encode(message);
  const bitLen = utf8.length * 8;
  const withOne = new Uint8Array((utf8.length + 9 + 63) & ~63);
  withOne.set(utf8);
  withOne[utf8.length] = 0x80;
  const view = new DataView(withOne.buffer);
  view.setUint32(withOne.length - 4, bitLen, false);
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < withOne.length; i += 64) {
    for (let j = 0; j < 16; j += 1) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j += 1) {
      const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j += 1) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[j] + w[j]) >>> 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((n) => n.toString(16).padStart(8, "0")).join("");
}

async function sha256(text) {
  try {
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch { /* fallback */ }
  return sha256Fallback(text);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
function showGateError(message) {
  els.gateError.hidden = false;
  els.gateError.textContent = message;
}

function allMembers() {
  return (
    directory?.apartments?.flatMap((a) =>
      a.members.map((m) => ({ ...m, _apartmentId: a.id, _apartment: a }))
    ) || []
  );
}
function findMember(id) {
  for (const apt of directory.apartments) {
    const member = apt.members.find((m) => m.id === id);
    if (member) return { member, apartment: apt };
  }
  return null;
}
function nameById(id) {
  return allMembers().find((m) => m.id === id);
}

function calcAge(birthday) {
  if (!birthday) return null;
  const d = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

function formatBirthday(birthday) {
  if (!birthday) return "—";
  const d = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(d.getTime())) return birthday;
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function photoSourceLabel(member) {
  if (!member.photoUrl) return "No photo yet — upload on this profile (social search is not used)";
  if (member.photoSource === "leader-upload" || member.photoUrl.startsWith("data:")) {
    return "Photo source: Leader upload";
  }
  if (member.photoSource === "ward-directory") return "Photo source: Ward directory";
  return "Photo source: Ward directory";
}

function avatarMarkup(member, className = "avatar") {
  if (member.photoUrl) {
    return `<img class="${className}" src="${escapeAttr(member.photoUrl)}" alt="" loading="lazy" />`;
  }
  return `<div class="${className} initials" aria-hidden="true">${escapeHtml(
    initials(member.preferredName || member.fullName)
  )}</div>`;
}

function symbolMarkup(member) {
  const bits = [];
  if (member.flags?.returnedMissionary) bits.push(`<span class="sym sym-rm" title="Return Missionary">RM</span>`);
  if (member.languages?.length) bits.push(`<span class="sym sym-lang" title="Speaks Extra Language(s)">💬</span>`);
  if (member.callings?.length) bits.push(`<span class="sym sym-calling" title="Has A Calling">★</span>`);
  if (member.flags?.solid) bits.push(`<span class="sym sym-solid" title="Solid">●</span>`);
  if (member.flags?.endowed) bits.push(`<span class="sym sym-endowed" title="Endowed">◼</span>`);
  else bits.push(`<span class="sym sym-not-endowed" title="Not Endowed">◻</span>`);
  if (member.flags?.inactive) bits.push(`<span class="sym sym-inactive" title="Inactive">○</span>`);
  if (member.flags?.doNotContact) bits.push(`<span class="sym sym-dnc" title="Do Not Contact">⊘</span>`);
  return bits.length ? `<span class="member-syms">${bits.join("")}</span>` : "";
}

function persist(immediate = false) {
  const write = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(directory));
  if (immediate) return write();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(write, 280);
}

function touchEdit() {
  directory.meta = directory.meta || {};
  directory.meta.lastEditedBy = currentLeader || directory.meta.lastEditedBy || "Leader";
  directory.meta.lastEditedAt = new Date().toISOString();
  directory.meta.memberCount = allMembers().length;
  directory.meta.apartmentCount = directory.apartments.length;
  updateLastEdited();
  persist();
}

function updateLastEdited() {
  const iso = directory?.meta?.lastEditedAt;
  const by = directory?.meta?.lastEditedBy;
  if (!iso) {
    els.lastEdited.textContent = "Not yet edited in this browser";
    return;
  }
  const when = new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  els.lastEdited.textContent = by ? `Last updated by ${by} · ${when}` : `Last updated · ${when}`;
}

function enterApp() {
  if (!directoryReady || !directory?.apartments) {
    throw new Error("Directory data is still loading. Try again in a moment.");
  }
  isUnlocked = true;
  document.body.classList.add("is-unlocked");
  els.gate.hidden = true;
  els.app.hidden = false;
  populateFilters();
  updateLastEdited();
  renderAll();
}

function lockApp() {
  isUnlocked = false;
  document.body.classList.remove("is-unlocked");
  els.app.hidden = true;
  els.gate.hidden = false;
  els.podList.innerHTML = "";
  els.dialogBody.innerHTML = "";
  if (els.dialog.open) els.dialog.close();
  directory = null;
  directoryReady = false;
}

function mergeLocalEdits(baseline, saved) {
  if (!saved?.apartments) return baseline;
  const prev = new Map(saved.apartments.flatMap((a) => a.members.map((m) => [m.id, m])));
  for (const apt of baseline.apartments) {
    for (const m of apt.members) {
      const old = prev.get(m.id);
      if (!old) continue;
      if (old.preferredName) m.preferredName = old.preferredName;
      if (old.notes) m.notes = old.notes;
      if (old.languages?.length) m.languages = old.languages;
      if (old.gender) m.gender = old.gender;
      if (old.birthday) m.birthday = old.birthday;
      if (old.flags) m.flags = { ...m.flags, ...old.flags };
      if (old.ministering) m.ministering = old.ministering;
      if (old.covenantPath) m.covenantPath = { ...m.covenantPath, ...old.covenantPath };
      if (old.moved) m.moved = old.moved;
      m.lostMember = old.lostMember ?? m.lostMember;
      if (old.photoUrl?.startsWith("data:")) {
        m.photoUrl = old.photoUrl;
        m.photoSource = "leader-upload";
      }
    }
  }
  baseline.meta = {
    ...baseline.meta,
    latestConverts: saved.meta?.latestConverts || baseline.meta?.latestConverts || [],
    budget: saved.meta?.budget || baseline.meta?.budget,
    findingLostNotes: saved.meta?.findingLostNotes || baseline.meta?.findingLostNotes || "",
    lostMembers: saved.meta?.lostMembers || baseline.meta?.lostMembers || [],
    movedOutRecords: saved.meta?.movedOutRecords || baseline.meta?.movedOutRecords || [],
    quarterlyConvertStats: saved.meta?.quarterlyConvertStats || baseline.meta?.quarterlyConvertStats,
    servingMissionaries: saved.meta?.servingMissionaries || baseline.meta?.servingMissionaries,
    reportSources: saved.meta?.reportSources || baseline.meta?.reportSources || [],
    lastEditedBy: saved.meta?.lastEditedBy || baseline.meta?.lastEditedBy,
    lastEditedAt: saved.meta?.lastEditedAt || baseline.meta?.lastEditedAt,
  };
  return baseline;
}

async function loadBaseline() {
  const res = await fetch("./data/members.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load ward roster.");
  let baseline = await res.json();
  const savedRaw = localStorage.getItem(STORAGE_KEY);
  if (savedRaw) {
    try {
      baseline = mergeLocalEdits(baseline, JSON.parse(savedRaw));
    } catch { /* ignore */ }
  }
  directory = baseline;
  directoryReady = true;
}

function populateFilters() {
  const complexes = [...new Set(directory.apartments.map((a) => a.complex))].sort();
  els.complexFilter.innerHTML =
    `<option value="">All complexes</option>` +
    complexes.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
}

function memberMatches(member, apartment, query, flag) {
  if (flag === "calling" && !member.callings?.length) return false;
  if (flag === "languages" && !member.languages?.length) return false;
  if (flag === "endowed" && !member.flags?.endowed) return false;
  if (flag === "notEndowed" && member.flags?.endowed) return false;
  if (flag === "genderF" && member.gender !== "F") return false;
  if (flag === "genderM" && member.gender !== "M") return false;
  if (flag && ["returnedMissionary", "inactive", "doNotContact", "solid"].includes(flag)) {
    if (!member.flags?.[flag]) return false;
  }
  if (!query) return true;
  const hay = [
    member.preferredName, member.fullName, member.legalFirst, member.lastName,
    member.phone, member.email, member.notes, member.gender, member.birthday,
    apartment.complex, apartment.unit, apartment.address, apartment.city,
    ...(member.callings || []), ...(member.languages || []),
  ].join(" ").toLowerCase();
  return query.split(/\s+/).every((t) => hay.includes(t));
}

function filteredApartments() {
  const query = els.search.value.trim().toLowerCase();
  const complex = els.complexFilter.value;
  const flag = els.flagFilter.value;
  return directory.apartments
    .map((apt) => {
      if (complex && apt.complex !== complex) return null;
      const members = apt.members.filter((m) => memberMatches(m, apt, query, flag));
      if (!members.length) return null;
      return { ...apt, members };
    })
    .filter(Boolean);
}

function renderStats(apartments) {
  const members = apartments.reduce((n, a) => n + a.members.length, 0);
  const complexes = new Set(apartments.map((a) => a.complex)).size;
  els.stats.innerHTML = `
    <div><strong>${members}</strong>members</div>
    <div><strong>${apartments.length}</strong>apartments</div>
    <div><strong>${complexes}</strong>complexes</div>`;
}

function renderPods() {
  const apartments = filteredApartments();
  renderStats(apartments);
  els.emptyState.hidden = apartments.length > 0;
  if (!apartments.length) {
    els.podList.innerHTML = "";
    return;
  }
  const byComplex = new Map();
  for (const apt of apartments) {
    if (!byComplex.has(apt.complex)) byComplex.set(apt.complex, []);
    byComplex.get(apt.complex).push(apt);
  }
  els.podList.innerHTML = [...byComplex.entries()]
    .map(
      ([complex, pods]) => `
      <section class="complex-group">
        <h3 class="complex-title">${escapeHtml(complex)}</h3>
        <div class="pods">
          ${pods
            .map(
              (apartment) => `
            <article class="pod">
              <h4 class="pod-address">Unit ${escapeHtml(apartment.unit)}</h4>
              <p class="pod-meta">${escapeHtml(apartment.address || "")}${
                apartment.city ? ` · ${escapeHtml(apartment.city)}` : ""
              }</p>
              <div class="roommates">
                ${apartment.members
                  .map(
                    (member) => `
                  <button type="button" class="member-btn" data-member-id="${escapeAttr(member.id)}" aria-label="${escapeAttr(member.fullName)}">
                    ${avatarMarkup(member)}
                    <span class="member-name">${escapeHtml(member.preferredName || member.fullName)}</span>
                    <span class="member-gender">${member.gender ? `Gender: ${escapeHtml(member.gender)}` : ""}</span>
                    ${symbolMarkup(member)}
                  </button>`
                  )
                  .join("")}
              </div>
            </article>`
            )
            .join("")}
        </div>
      </section>`
    )
    .join("");
}

function memberOptionList(selectedIds = [], genderFilter = null) {
  const selected = new Set(selectedIds);
  return allMembers()
    .filter((m) => !genderFilter || m.gender === genderFilter)
    .slice()
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map(
      (m) =>
        `<option value="${escapeAttr(m.id)}" ${selected.has(m.id) ? "selected" : ""}>${escapeHtml(
          m.preferredName || m.fullName
        )} (${escapeHtml(m.lastName)})</option>`
    )
    .join("");
}

function openMember(memberId) {
  const found = findMember(memberId);
  if (!found) return;
  activeMemberId = memberId;
  const { member, apartment } = found;
  const age = calcAge(member.birthday);
  const companions = (member.ministering?.companions || [])
    .map((id) => nameById(id))
    .filter(Boolean);
  const ministeringTo = (member.ministering?.ministeringTo || [])
    .map((id) => nameById(id))
    .filter(Boolean);

  els.dialogBody.innerHTML = `
    ${avatarMarkup(member, "dialog-avatar")}
    <p class="photo-source">${escapeHtml(photoSourceLabel(member))}</p>
    <div class="dialog-grid">
      <label class="field"><span>Preferred first name / nickname</span>
        <input data-field="preferredName" value="${escapeAttr(member.preferredName || "")}" /></label>
      <div class="field"><span>Legal name</span><div>${escapeHtml(member.fullName)}</div></div>
      <label class="field"><span>Gender</span>
        <select data-field="gender">
          <option value="" ${!member.gender ? "selected" : ""}>Unknown</option>
          <option value="F" ${member.gender === "F" ? "selected" : ""}>Gender: F</option>
          <option value="M" ${member.gender === "M" ? "selected" : ""}>Gender: M</option>
        </select></label>
      <label class="field"><span>Birthday</span>
        <input data-field="birthday" type="date" value="${escapeAttr(member.birthday || "")}" /></label>
      <div class="field"><span>Age</span><div>${age == null ? "Add a birthday to calculate age" : escapeHtml(String(age))}</div></div>
      <label class="field"><span>Phone</span>
        <input data-field="phone" value="${escapeAttr(member.phone || "")}" /></label>
      <label class="field"><span>Email</span>
        <input data-field="email" type="email" value="${escapeAttr(member.email || "")}" /></label>
      <div class="field"><span>Address</span>
        <div>${escapeHtml(apartment.address || member.address || "—")}${
          apartment.city ? `<br>${escapeHtml(apartment.city)}` : ""
        }${apartment.unit && apartment.unit !== "—" ? `<br>Unit ${escapeHtml(apartment.unit)}` : ""}</div></div>
      <label class="field"><span>Callings (comma-separated)</span>
        <input data-field="callings" value="${escapeAttr((member.callings || []).join(", "))}" /></label>
      <label class="field"><span>Extra languages (comma-separated)</span>
        <input data-field="languages" value="${escapeAttr((member.languages || []).join(", "))}" placeholder="Spanish, Portuguese…" /></label>
      <div class="field"><span>Status symbols</span>
        <div class="flag-grid">
          <label><input type="checkbox" data-flag="returnedMissionary" ${member.flags?.returnedMissionary ? "checked" : ""}/> Return Missionary</label>
          <label><input type="checkbox" data-flag="solid" ${member.flags?.solid ? "checked" : ""}/> Solid</label>
          <label><input type="checkbox" data-flag="endowed" ${member.flags?.endowed ? "checked" : ""}/> Endowed</label>
          <label><input type="checkbox" data-flag="inactive" ${member.flags?.inactive ? "checked" : ""}/> Inactive</label>
          <label><input type="checkbox" data-flag="doNotContact" ${member.flags?.doNotContact ? "checked" : ""}/> Do Not Contact</label>
          <label><input type="checkbox" data-bool="lostMember" ${member.lostMember ? "checked" : ""}/> Lost member follow-up</label>
        </div>
      </div>
      <div class="field"><span>Covenant path</span>
        <div class="flag-grid">
          <label><input type="checkbox" data-covenant="baptized" ${member.covenantPath?.baptized ? "checked" : ""}/> Baptized</label>
          <label><input type="checkbox" data-covenant="confirmed" ${member.covenantPath?.confirmed ? "checked" : ""}/> Confirmed</label>
          <label><input type="checkbox" data-covenant="latestConvert" ${member.covenantPath?.latestConvert ? "checked" : ""}/> Latest convert</label>
        </div>
      </div>
      <label class="field"><span>Move status</span>
        <select data-moved="status">
          <option value="" ${!member.moved?.status ? "selected" : ""}>Current</option>
          <option value="in" ${member.moved?.status === "in" ? "selected" : ""}>Moved In</option>
          <option value="out" ${member.moved?.status === "out" ? "selected" : ""}>Moved Out</option>
        </select></label>
      <label class="field"><span>Move date</span>
        <input data-moved="date" type="date" value="${escapeAttr(member.moved?.date || "")}" /></label>
      <label class="field"><span>Ministering role</span>
        <select data-field="ministeringRole">
          <option value="" ${!member.ministering?.role ? "selected" : ""}>Unassigned</option>
          <option value="sister" ${member.ministering?.role === "sister" ? "selected" : ""}>Ministering Sister</option>
          <option value="brother" ${member.ministering?.role === "brother" ? "selected" : ""}>Ministering Brother</option>
        </select></label>
      <label class="field"><span>Ministering companion(s)</span>
        <select data-multi="companions" multiple size="5">${memberOptionList(member.ministering?.companions || [])}</select></label>
      <label class="field"><span>Ministering to</span>
        <select data-multi="ministeringTo" multiple size="5">${memberOptionList(member.ministering?.ministeringTo || [])}</select></label>
      <div class="field"><span>Linked ministering</span>
        <div class="linked-box">
          <p><strong>Companions:</strong> ${
            companions.length
              ? companions.map((c) => `<button type="button" class="linkish" data-open-member="${escapeAttr(c.id)}">${escapeHtml(c.preferredName || c.fullName)}</button>`).join(", ")
              : "None yet"
          }</p>
          <p><strong>Ministering to:</strong> ${
            ministeringTo.length
              ? ministeringTo.map((c) => `<button type="button" class="linkish" data-open-member="${escapeAttr(c.id)}">${escapeHtml(c.preferredName || c.fullName)}</button>`).join(", ")
              : "None yet"
          }</p>
        </div>
      </div>
      <label class="field"><span>Profile photo</span>
        <input data-photo type="file" accept="image/*" />
        <button type="button" class="btn btn-ghost btn-small" data-clear-photo ${member.photoUrl ? "" : "hidden"}>Remove photo</button>
      </label>
      <label class="field"><span>Leader notes (autosave)</span>
        <textarea data-field="notes" placeholder="Private leader notes…">${escapeHtml(member.notes || "")}</textarea></label>
      <p class="save-hint" data-save-hint></p>
    </div>`;
  els.dialog.showModal();
}

function selectedValues(selectEl) {
  return [...selectEl.selectedOptions].map((o) => o.value);
}

function flashSaved() {
  const hint = els.dialogBody.querySelector("[data-save-hint]");
  if (!hint) return;
  hint.textContent = "Saved";
  setTimeout(() => {
    if (hint.textContent === "Saved") hint.textContent = "";
  }, 1200);
}

function applyMemberEdits(target) {
  const found = findMember(activeMemberId);
  if (!found) return;
  const { member } = found;
  if (target.matches("[data-field]")) {
    const field = target.getAttribute("data-field");
    if (field === "callings" || field === "languages") {
      member[field] = target.value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (field === "ministeringRole") {
      member.ministering = member.ministering || { role: "", companions: [], ministeringTo: [] };
      member.ministering.role = target.value;
    } else {
      member[field] = target.value;
    }
  }
  if (target.matches("[data-flag]")) {
    member.flags = member.flags || {};
    member.flags[target.getAttribute("data-flag")] = target.checked;
    if (target.getAttribute("data-flag") === "endowed") {
      member.covenantPath = member.covenantPath || {};
      member.covenantPath.endowed = target.checked;
    }
  }
  if (target.matches("[data-bool]")) {
    member[target.getAttribute("data-bool")] = target.checked;
  }
  if (target.matches("[data-covenant]")) {
    member.covenantPath = member.covenantPath || {};
    member.covenantPath[target.getAttribute("data-covenant")] = target.checked;
  }
  if (target.matches("[data-moved]")) {
    member.moved = member.moved || { status: "", date: "", notes: "" };
    member.moved[target.getAttribute("data-moved")] = target.value;
  }
  if (target.matches("[data-multi]")) {
    member.ministering = member.ministering || { role: "", companions: [], ministeringTo: [] };
    member.ministering[target.getAttribute("data-multi")] = selectedValues(target);
  }
  touchEdit();
  flashSaved();
  renderAll();
}

async function handlePhoto(file) {
  const found = findMember(activeMemberId);
  if (!found || !file) return;
  found.member.photoUrl = await resizeImage(file, 180);
  found.member.photoSource = "leader-upload";
  touchEdit();
  openMember(activeMemberId);
  renderAll();
}

function resizeImage(file, maxSize) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function renderMinistering() {
  const sisters = [];
  const brothers = [];
  for (const m of allMembers()) {
    if (!m.ministering?.role) continue;
    const companions = (m.ministering.companions || [])
      .map((id) => nameById(id)?.preferredName || nameById(id)?.fullName)
      .filter(Boolean);
    const assigned = (m.ministering.ministeringTo || [])
      .map((id) => nameById(id)?.preferredName || nameById(id)?.fullName)
      .filter(Boolean);
    const card = `
      <article class="ministering-card">
        <strong>${escapeHtml(m.preferredName || m.fullName)}${
          companions.length ? ` & ${escapeHtml(companions.join(", "))}` : ""
        }</strong>
        <span>→ ${assigned.length ? escapeHtml(assigned.join(", ")) : "No assignment yet"}</span>
        <button type="button" class="linkish" data-open-member="${escapeAttr(m.id)}">Open profile</button>
      </article>`;
    if (m.ministering.role === "sister") sisters.push(card);
    if (m.ministering.role === "brother") brothers.push(card);
  }
  els.ministeringSisters.innerHTML = sisters.length ? sisters.join("") : `<p class="empty-state">No sister companionships recorded yet.</p>`;
  els.ministeringBrothers.innerHTML = brothers.length ? brothers.join("") : `<p class="empty-state">No brother companionships recorded yet.</p>`;
}

function nextBirthdaySortKey(birthday) {
  if (!birthday) return Number.POSITIVE_INFINITY;
  const d = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(d.getTime())) return Number.POSITIVE_INFINITY;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
  return next.getTime();
}

function renderBirthdays() {
  const now = new Date();
  els.birthdayToday.textContent = `Today · ${now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;
  const withBdays = allMembers()
    .filter((m) => m.birthday)
    .sort((a, b) => nextBirthdaySortKey(a.birthday) - nextBirthdaySortKey(b.birthday));
  if (!withBdays.length) {
    els.birthdayList.innerHTML = `<p class="empty-state">Add birthdays on member profiles to populate this list.</p>`;
    return;
  }
  els.birthdayList.innerHTML = withBdays
    .map((m) => {
      const cls = m.gender === "F" ? "bday-sister" : m.gender === "M" ? "bday-elder" : "bday-unknown";
      const age = calcAge(m.birthday);
      return `<button type="button" class="bday-card ${cls}" data-open-member="${escapeAttr(m.id)}">
        <strong>${escapeHtml(m.preferredName || m.fullName)}</strong>
        <span>${escapeHtml(formatBirthday(m.birthday))}${age != null ? ` · turning ${age + 1}` : ""}</span>
        <span>${m.gender ? `Gender: ${escapeHtml(m.gender)}` : "Gender unset"}</span>
      </button>`;
    })
    .join("");
}

function renderSimpleMemberList(target, predicate, emptyText) {
  const items = allMembers().filter(predicate);
  if (!items.length) {
    target.innerHTML = `<p class="empty-state">${escapeHtml(emptyText)}</p>`;
    return;
  }
  target.innerHTML = items
    .map(
      (m) => `<button type="button" class="simple-row" data-open-member="${escapeAttr(m.id)}">
        ${avatarMarkup(m, "avatar tiny")}
        <span><strong>${escapeHtml(m.preferredName || m.fullName)}</strong>
        <em>${escapeHtml((m.callings || [])[0] || m.address || "")}</em></span>
      </button>`
    )
    .join("");
}

function renderCovenant() {
  renderSimpleMemberList(
    els.covenantList,
    (m) =>
      m.covenantPath?.baptized ||
      m.covenantPath?.confirmed ||
      m.flags?.endowed ||
      m.covenantPath?.latestConvert,
    "Mark covenant path progress on member profiles."
  );
  els.latestConvertsInput.value = (directory.meta?.latestConverts || []).join("\n");
}

function renderBudget() {
  const budget = directory.meta?.budget || { categories: [], notes: "" };
  directory.meta.budget = budget;
  if (!budget.categories?.length) {
    budget.categories = [
      { name: "Activities", planned: 0, spent: 0 },
      { name: "Relief Society", planned: 0, spent: 0 },
      { name: "Elders Quorum", planned: 0, spent: 0 },
      { name: "Missionary", planned: 0, spent: 0 },
      { name: "Other", planned: 0, spent: 0 },
    ];
  }
  els.budgetTable.innerHTML = `
    <div class="budget-head"><span>Category</span><span>Planned</span><span>Spent</span></div>
    ${budget.categories
      .map(
        (c, i) => `<div class="budget-row">
        <input data-budget-name="${i}" value="${escapeAttr(c.name)}" />
        <input data-budget-planned="${i}" type="number" min="0" step="1" value="${escapeAttr(c.planned)}" />
        <input data-budget-spent="${i}" type="number" min="0" step="1" value="${escapeAttr(c.spent)}" />
      </div>`
      )
      .join("")}`;
  els.budgetNotes.value = budget.notes || "";
}

function buildGameDeck(mode) {
  let list = allMembers();
  if (mode === "rs") list = list.filter((m) => m.gender === "F" || (m.callings || []).some((c) => /relief society/i.test(c)));
  if (mode === "eq") list = list.filter((m) => m.gender === "M" || (m.callings || []).some((c) => /elders quorum|bishop/i.test(c)));
  if (mode === "withPhotos") list = list.filter((m) => m.photoUrl);
  if (mode === "oldMill") list = list.filter((m) => m.livesAtOldMill);
  if (mode === "nonOldMill") list = list.filter((m) => !m.livesAtOldMill);
  // shuffle
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function showGameCard() {
  els.gameCard.classList.remove("flipped");
  if (!gameDeck.length) {
    els.gameFront.innerHTML = "No members in this deck.";
    els.gameBack.innerHTML = "";
    els.gameProgress.textContent = "";
    return;
  }
  const m = gameDeck[gameIndex];
  els.gameFront.innerHTML = `${avatarMarkup(m, "avatar game-avatar")}<p>Tap to reveal</p>`;
  els.gameBack.innerHTML = `<strong>${escapeHtml(m.preferredName || m.fullName)}</strong>
    <p>${escapeHtml(m.fullName)}</p>
    <p>${escapeHtml((m.callings || []).join(" · ") || "No calling listed")}</p>
    <p>${m.gender ? `Gender: ${escapeHtml(m.gender)}` : ""}</p>`;
  els.gameProgress.textContent = `Card ${gameIndex + 1} of ${gameDeck.length}`;
}

function renderMovedOut() {
  const rosterOut = allMembers().filter((m) => m.moved?.status === "out");
  const metaRows = directory.meta?.movedOutRecords || [];
  if (!rosterOut.length && !metaRows.length) {
    els.movedOutList.innerHTML = `<p class="empty-state">No moved-out members marked yet.</p>`;
    return;
  }
  const rosterHtml = rosterOut
    .map(
      (m) => `<button type="button" class="simple-row" data-open-member="${escapeAttr(m.id)}">
        ${avatarMarkup(m, "avatar tiny")}
        <span><strong>${escapeHtml(m.preferredName || m.fullName)}</strong>
        <em>${escapeHtml(m.moved?.date || "")}${m.moved?.notes ? ` · ${escapeHtml(m.moved.notes)}` : ""}</em></span>
      </button>`
    )
    .join("");
  const seen = new Set(rosterOut.map((m) => m.fullName.toLowerCase()));
  const metaHtml = metaRows
    .filter((r) => !seen.has(String(r.name || "").toLowerCase()) && !seen.has(
      (() => {
        const parts = String(r.name || "").split(",");
        if (parts.length < 2) return "";
        return `${parts[1].trim()} ${parts[0].trim()}`.toLowerCase();
      })()
    ))
    .map(
      (r) => `<div class="simple-row meta-row">
        <span><strong>${escapeHtml(r.name)}</strong>
        <em>${escapeHtml(r.date || "")}${r.newUnit ? ` · ${escapeHtml(r.newUnit)}` : ""}</em></span>
      </div>`
    )
    .join("");
  els.movedOutList.innerHTML = rosterHtml + metaHtml;
}

function renderLostMembers() {
  const flagged = allMembers().filter((m) => m.lostMember);
  const metaRows = directory.meta?.lostMembers || [];
  if (!flagged.length && !metaRows.length) {
    els.lostList.innerHTML = `<p class="empty-state">No lost-member follow-ups flagged yet.</p>`;
    return;
  }
  const flaggedHtml = flagged
    .map(
      (m) => `<button type="button" class="simple-row" data-open-member="${escapeAttr(m.id)}">
        ${avatarMarkup(m, "avatar tiny")}
        <span><strong>${escapeHtml(m.preferredName || m.fullName)}</strong>
        <em>${escapeHtml(m.phone || m.email || "Follow up")}</em></span>
      </button>`
    )
    .join("");
  const seen = new Set(flagged.map((m) => m.fullName.toLowerCase()));
  const metaHtml = metaRows
    .filter((r) => {
      const name = String(r.name || "").toLowerCase();
      if (seen.has(name)) return false;
      const parts = String(r.name || "").split(",");
      if (parts.length >= 2) {
        const flipped = `${parts[1].trim()} ${parts[0].trim()}`.toLowerCase();
        if (seen.has(flipped)) return false;
      }
      return true;
    })
    .map(
      (r) => `<div class="simple-row meta-row">
        <span><strong>${escapeHtml(r.name)}</strong>
        <em>${escapeHtml([r.phone, r.email, r.dateAdded].filter(Boolean).join(" · "))}</em></span>
      </div>`
    )
    .join("");
  els.lostList.innerHTML = flaggedHtml + metaHtml;
}

function renderAll() {
  renderPods();
  renderMinistering();
  renderBirthdays();
  renderCovenant();
  renderSimpleMemberList(els.movedInList, (m) => m.moved?.status === "in", "No moved-in members marked yet.");
  renderMovedOut();
  renderLostMembers();
  renderSimpleMemberList(els.nonOldMillList, (m) => !m.livesAtOldMill, "Everyone appears to live at Old Mill.");
  els.lostNotes.value = directory.meta?.findingLostNotes || "";
  renderBudget();
}

function importSummary(file, incoming) {
  const kind = incoming.meta?.importKind || "directory";
  const total = allMembers().length;
  if (kind === "report") {
    const bits = [];
    if (incoming.meta?.budget && /budget/i.test(file.name)) bits.push("budget");
    else if (incoming.meta?.budgetImport || /budget/i.test(file.name)) bits.push("budget");
    if (incoming.meta?.birthdayImportCount) bits.push(`${incoming.meta.birthdayImportCount} birthdays`);
    if (incoming.meta?.ministeringImportCount) bits.push(`${incoming.meta.ministeringImportCount} ministering`);
    if (incoming.meta?.movedInImportCount) bits.push(`${incoming.meta.movedInImportCount} moved in`);
    if (incoming.meta?.movedOutImportCount != null && /moved\s*out/i.test(file.name)) {
      bits.push(`${incoming.meta.movedOutRecords?.length || 0} moved out`);
    }
    if (/lost/i.test(file.name) && incoming.meta?.lostMembers?.length) {
      bits.push(`${incoming.meta.lostMembers.length} lost`);
    }
    if (/covenant/i.test(file.name) && incoming.meta?.latestConverts?.length) {
      bits.push(`${incoming.meta.latestConverts.length} converts`);
    }
    if (/quarterly/i.test(file.name) && incoming.meta?.quarterlyConvertStats) bits.push("quarterly stats");
    if (/serving\s*missionar/i.test(file.name) && incoming.meta?.servingMissionaries) {
      bits.push("serving missionaries");
    }
    if (/assigned\s*missionar/i.test(file.name) && incoming.meta?.assignedMissionaryImportCount) {
      bits.push(`${incoming.meta.assignedMissionaryImportCount} assigned missionaries`);
    }
    if (incoming.meta?.organizationsImportCount) bits.push(`${incoming.meta.organizationsImportCount} callings`);
    if (incoming.meta?.callingsImportCount) bits.push(`${incoming.meta.callingsImportCount} callings`);
    // Fallback: note report merge without listing inherited meta
    if (!bits.length) bits.push("report fields");
    return `Merged ${file.name} (${bits.join(", ")}) · ${total} members`;
  }
  return `Updated directory from ${file.name} · ${total} members total`;
}

async function handleDataUpload(file) {
  if (!file) return;
  els.importStatus.textContent = `Importing ${file.name}…`;
  try {
    const incoming = await parseDirectoryFile(file, directory);
    if (!incoming.apartments?.length) {
      throw new Error("No directory data found in that file.");
    }
    directory = mergeDirectory(directory, incoming);
    directory.meta.lastEditedBy = currentLeader;
    directory.meta.lastEditedAt = new Date().toISOString();
    persist(true);
    populateFilters();
    updateLastEdited();
    renderAll();
    els.importStatus.textContent = importSummary(file, incoming);
  } catch (err) {
    console.error(err);
    els.importStatus.textContent = `Import failed: ${err.message || err}`;
  }
}

async function handleDataUploads(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  const results = [];
  for (const file of files) {
    els.importStatus.textContent = `Importing ${file.name} (${results.length + 1}/${files.length})…`;
    try {
      const incoming = await parseDirectoryFile(file, directory);
      if (!incoming.apartments?.length) throw new Error("No directory data found.");
      directory = mergeDirectory(directory, incoming);
      directory.meta.lastEditedBy = currentLeader;
      directory.meta.lastEditedAt = new Date().toISOString();
      results.push(importSummary(file, incoming));
    } catch (err) {
      console.error(err);
      results.push(`${file.name}: failed — ${err.message || err}`);
    }
  }
  persist(true);
  populateFilters();
  updateLastEdited();
  renderAll();
  els.importStatus.textContent = results.join(" · ");
}

function bindEvents() {
  els.togglePassword?.addEventListener("click", () => {
    const showing = els.leaderPassword.type === "text";
    els.leaderPassword.type = showing ? "password" : "text";
    els.togglePassword.textContent = showing ? "Show" : "Hide";
    els.togglePassword.setAttribute("aria-pressed", showing ? "false" : "true");
    els.togglePassword.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });

  els.gateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.gateError.hidden = true;
    els.enterDirectory.disabled = true;
    els.enterDirectory.textContent = "Checking…";
    try {
      currentLeader = els.leaderName.value.trim();
      if (!currentLeader) {
        showGateError("Please enter your name.");
        return;
      }
      const hash = await sha256(els.leaderPassword.value);
      if (hash !== PASS_HASH) {
        showGateError("Incorrect password.");
        els.leaderPassword.value = "";
        els.leaderPassword.focus();
        return;
      }
      await loadBaseline();
      localStorage.setItem(NAME_KEY, currentLeader);
      enterApp();
    } catch (err) {
      console.error(err);
      lockApp();
      showGateError(err.message || "Could not open the directory.");
    } finally {
      els.enterDirectory.disabled = false;
      els.enterDirectory.textContent = "Enter directory";
    }
  });

  els.signOut.addEventListener("click", () => {
    lockApp();
    els.leaderPassword.value = "";
    els.gateError.hidden = true;
  });

  els.search.addEventListener("input", () => isUnlocked && renderPods());
  els.complexFilter.addEventListener("change", () => isUnlocked && renderPods());
  els.flagFilter.addEventListener("change", () => isUnlocked && renderPods());

  document.addEventListener("click", (event) => {
    if (!isUnlocked) return;
    const openBtn = event.target.closest("[data-open-member]");
    if (openBtn) {
      openMember(openBtn.getAttribute("data-open-member"));
      return;
    }
    const memberBtn = event.target.closest(".member-btn");
    if (memberBtn) openMember(memberBtn.dataset.memberId);
  });

  els.dialogClose.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) els.dialog.close();
  });

  els.dialogBody.addEventListener("input", (event) => {
    if (!isUnlocked) return;
    if (event.target.matches("[data-field], [data-flag], [data-bool], [data-covenant], [data-moved], [data-multi]")) {
      applyMemberEdits(event.target);
    }
  });
  els.dialogBody.addEventListener("change", (event) => {
    if (!isUnlocked) return;
    if (event.target.matches("[data-field], [data-flag], [data-bool], [data-covenant], [data-moved], [data-multi]")) {
      applyMemberEdits(event.target);
    }
    if (event.target.matches("[data-photo]")) handlePhoto(event.target.files?.[0]);
  });
  els.dialogBody.addEventListener("click", (event) => {
    if (!isUnlocked) return;
    if (event.target.matches("[data-clear-photo]")) {
      const found = findMember(activeMemberId);
      if (!found) return;
      found.member.photoUrl = "";
      found.member.photoSource = "missing";
      touchEdit();
      openMember(activeMemberId);
      renderAll();
    }
  });

  els.dataUpload?.addEventListener("change", () => {
    if (!isUnlocked) return;
    handleDataUploads(els.dataUpload.files);
    els.dataUpload.value = "";
  });

  els.saveConverts?.addEventListener("click", () => {
    directory.meta.latestConverts = els.latestConvertsInput.value
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    // also mark matching members
    const set = new Set(directory.meta.latestConverts.map((n) => n.toLowerCase()));
    for (const m of allMembers()) {
      m.covenantPath = m.covenantPath || {};
      m.covenantPath.latestConvert = set.has(m.fullName.toLowerCase()) || set.has((m.preferredName || "").toLowerCase());
    }
    touchEdit();
    renderCovenant();
  });

  els.lostNotes?.addEventListener("input", () => {
    directory.meta.findingLostNotes = els.lostNotes.value;
    touchEdit();
  });

  els.budgetNotes?.addEventListener("input", () => {
    directory.meta.budget = directory.meta.budget || { categories: [], notes: "" };
    directory.meta.budget.notes = els.budgetNotes.value;
    touchEdit();
  });
  els.budgetTable?.addEventListener("input", (event) => {
    const budget = directory.meta.budget;
    const nameIdx = event.target.getAttribute("data-budget-name");
    const plannedIdx = event.target.getAttribute("data-budget-planned");
    const spentIdx = event.target.getAttribute("data-budget-spent");
    if (nameIdx != null) budget.categories[Number(nameIdx)].name = event.target.value;
    if (plannedIdx != null) budget.categories[Number(plannedIdx)].planned = Number(event.target.value || 0);
    if (spentIdx != null) budget.categories[Number(spentIdx)].spent = Number(event.target.value || 0);
    touchEdit();
  });

  els.gameStart?.addEventListener("click", () => {
    gameDeck = buildGameDeck(els.gameDeck.value);
    gameIndex = 0;
    showGameCard();
  });
  els.gameNext?.addEventListener("click", () => {
    if (!gameDeck.length) return;
    gameIndex = (gameIndex + 1) % gameDeck.length;
    showGameCard();
  });
  els.gameCard?.addEventListener("click", () => {
    els.gameCard.classList.toggle("flipped");
  });
}

function init() {
  bindEvents();
  const remembered = localStorage.getItem(NAME_KEY);
  if (remembered) els.leaderName.value = remembered;
  lockApp();
}

init();
