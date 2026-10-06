import { mergeDirectory, parseDirectoryPdf } from "./pdf-import.js";

const STORAGE_KEY = "ward147-directory-state-v1";
const SESSION_KEY = "ward147-leader-session-v1";
/** SHA-256 of the ward leader password */
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
  pdfUpload: document.getElementById("pdf-upload"),
  importStatus: document.getElementById("import-status"),
  ministeringSisters: document.getElementById("ministering-sisters"),
  ministeringBrothers: document.getElementById("ministering-brothers"),
};

/** @type {any} */
let directory = null;
let directoryReady = false;
let currentLeader = "";
let saveTimer = null;
let activeMemberId = null;

/** Works even when crypto.subtle is unavailable (e.g. some local file contexts). */
function sha256Fallback(message) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const utf8 = new TextEncoder().encode(message);
  const bitLen = utf8.length * 8;
  const withOne = new Uint8Array(((utf8.length + 9 + 63) & ~63));
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

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let i = 0; i < withOne.length; i += 64) {
    for (let j = 0; j < 16; j += 1) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j += 1) {
      const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let j = 0; j < 64; j += 1) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[j] + w[j]) >>> 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((n) => n.toString(16).padStart(8, "0"))
    .join("");
}

async function sha256(text) {
  try {
    if (globalThis.crypto?.subtle) {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    /* use fallback */
  }
  return sha256Fallback(text);
}

function showGateError(message) {
  els.gateError.hidden = false;
  els.gateError.textContent = message;
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

function allMembers() {
  return directory?.apartments?.flatMap((a) =>
    a.members.map((m) => ({ ...m, _apartmentId: a.id, _apartment: a }))
  ) || [];
}

function findMember(id) {
  for (const apt of directory.apartments) {
    const member = apt.members.find((m) => m.id === id);
    if (member) return { member, apartment: apt };
  }
  return null;
}

function avatarMarkup(member, className = "avatar") {
  if (member.photoUrl) {
    return `<img class="${className}" src="${escapeAttr(member.photoUrl)}" alt="" />`;
  }
  return `<div class="${className} initials" aria-hidden="true">${escapeHtml(
    initials(member.preferredName || member.fullName)
  )}</div>`;
}

function symbolMarkup(member) {
  const bits = [];
  if (member.flags?.returnedMissionary) bits.push(`<span class="sym sym-rm" title="Returned Missionary">RM</span>`);
  if (member.languages?.length) bits.push(`<span class="sym sym-lang" title="${escapeAttr(member.languages.join(", "))}">文</span>`);
  if (member.callings?.length) bits.push(`<span class="sym sym-calling" title="${escapeAttr(member.callings.join(", "))}">★</span>`);
  if (member.flags?.superSolid) bits.push(`<span class="sym sym-solid" title="Super-Solid">●</span>`);
  if (member.flags?.inactive) bits.push(`<span class="sym sym-inactive" title="Inactive">○</span>`);
  if (member.flags?.doNotContact) bits.push(`<span class="sym sym-dnc" title="Do Not Contact">⊘</span>`);
  return bits.length ? `<span class="member-syms">${bits.join("")}</span>` : "";
}

function formatStamp(iso, by) {
  if (!iso) return "Not yet edited in this browser";
  const d = new Date(iso);
  const when = d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return by ? `Last updated by ${by} · ${when}` : `Last updated · ${when}`;
}

function updateLastEdited() {
  els.lastEdited.textContent = formatStamp(
    directory?.meta?.lastEditedAt,
    directory?.meta?.lastEditedBy
  );
}

function persist(immediate = false) {
  const write = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(directory));
  };
  if (immediate) {
    write();
    return;
  }
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

function populateFilters() {
  const complexes = [...new Set(directory.apartments.map((a) => a.complex))].sort();
  els.complexFilter.innerHTML =
    `<option value="">All complexes</option>` +
    complexes
      .map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`)
      .join("");
}

function memberMatches(member, apartment, query, flag) {
  if (flag === "calling" && !(member.callings?.length)) return false;
  if (flag === "languages" && !(member.languages?.length)) return false;
  if (flag && ["returnedMissionary", "inactive", "doNotContact", "superSolid"].includes(flag)) {
    if (!member.flags?.[flag]) return false;
  }
  if (!query) return true;
  const hay = [
    member.preferredName,
    member.fullName,
    member.legalFirst,
    member.lastName,
    member.phone,
    member.email,
    member.notes,
    apartment.complex,
    apartment.unit,
    apartment.address,
    apartment.city,
    ...(member.callings || []),
    ...(member.languages || []),
  ]
    .join(" ")
    .toLowerCase();
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
    <div><strong>${complexes}</strong>complexes</div>
  `;
}

function renderPods() {
  const apartments = filteredApartments();
  renderStats(apartments);
  els.emptyState.hidden = apartments.length > 0;
  if (!apartments.length) {
    els.podList.innerHTML = "";
    renderMinistering();
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

  renderMinistering();
}

function memberOptionList(selectedIds = []) {
  const selected = new Set(selectedIds);
  return allMembers()
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
  const langs = (member.languages || []).join(", ");
  els.dialogBody.innerHTML = `
    ${avatarMarkup(member, "dialog-avatar")}
    <div class="dialog-grid">
      <label class="field">
        <span>Preferred first name / nickname</span>
        <input data-field="preferredName" value="${escapeAttr(member.preferredName || "")}" />
      </label>
      <div class="field">
        <span>Legal name</span>
        <div>${escapeHtml(member.fullName)}</div>
      </div>
      <label class="field">
        <span>Phone</span>
        <input data-field="phone" value="${escapeAttr(member.phone || "")}" />
      </label>
      <label class="field">
        <span>Email</span>
        <input data-field="email" type="email" value="${escapeAttr(member.email || "")}" />
      </label>
      <div class="field">
        <span>Address</span>
        <div>${escapeHtml(apartment.address || member.address || "—")}${
          apartment.city ? `<br>${escapeHtml(apartment.city)}` : ""
        }${apartment.unit && apartment.unit !== "—" ? `<br>Unit ${escapeHtml(apartment.unit)}` : ""}</div>
      </div>
      <label class="field">
        <span>Callings (comma-separated)</span>
        <input data-field="callings" value="${escapeAttr((member.callings || []).join(", "))}" />
      </label>
      <label class="field">
        <span>Languages spoken (comma-separated)</span>
        <input data-field="languages" value="${escapeAttr(langs)}" placeholder="Spanish, Portuguese…" />
      </label>
      <div class="field">
        <span>Status symbols</span>
        <div class="flag-grid">
          <label><input type="checkbox" data-flag="returnedMissionary" ${member.flags?.returnedMissionary ? "checked" : ""}/> Returned Missionary</label>
          <label><input type="checkbox" data-flag="superSolid" ${member.flags?.superSolid ? "checked" : ""}/> Super-Solid</label>
          <label><input type="checkbox" data-flag="inactive" ${member.flags?.inactive ? "checked" : ""}/> Inactive</label>
          <label><input type="checkbox" data-flag="doNotContact" ${member.flags?.doNotContact ? "checked" : ""}/> Do Not Contact</label>
        </div>
      </div>
      <label class="field">
        <span>Ministering role</span>
        <select data-field="ministeringRole">
          <option value="" ${!member.ministering?.role ? "selected" : ""}>Unassigned</option>
          <option value="sister" ${member.ministering?.role === "sister" ? "selected" : ""}>Ministering Sister</option>
          <option value="brother" ${member.ministering?.role === "brother" ? "selected" : ""}>Ministering Brother</option>
        </select>
      </label>
      <label class="field">
        <span>Ministering companion(s)</span>
        <select data-multi="companions" multiple size="5">${memberOptionList(member.ministering?.companions || [])}</select>
      </label>
      <label class="field">
        <span>Ministering to</span>
        <select data-multi="ministeringTo" multiple size="5">${memberOptionList(member.ministering?.ministeringTo || [])}</select>
      </label>
      <label class="field">
        <span>Profile photo</span>
        <input data-photo type="file" accept="image/*" />
        <button type="button" class="btn btn-ghost btn-small" data-clear-photo ${member.photoUrl ? "" : "hidden"}>Remove photo</button>
      </label>
      <label class="field">
        <span>Leader notes (autosave)</span>
        <textarea data-field="notes" placeholder="Private leader notes about this member…">${escapeHtml(member.notes || "")}</textarea>
      </label>
      <p class="save-hint" data-save-hint></p>
    </div>
  `;
  els.dialog.showModal();
}

function selectedValues(selectEl) {
  return [...selectEl.selectedOptions].map((o) => o.value);
}

function nameById(id) {
  return allMembers().find((m) => m.id === id);
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
      member[field] = target.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
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
  }
  if (target.matches("[data-multi]")) {
    member.ministering = member.ministering || { role: "", companions: [], ministeringTo: [] };
    member.ministering[target.getAttribute("data-multi")] = selectedValues(target);
  }

  touchEdit();
  flashSaved();
  renderPods();
}

async function handlePhoto(file) {
  const found = findMember(activeMemberId);
  if (!found || !file) return;
  const dataUrl = await resizeImage(file, 180);
  found.member.photoUrl = dataUrl;
  touchEdit();
  flashSaved();
  openMember(activeMemberId);
  renderPods();
}

function resizeImage(file, maxSize) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
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
      </article>`;
    if (m.ministering.role === "sister") sisters.push(card);
    if (m.ministering.role === "brother") brothers.push(card);
  }
  els.ministeringSisters.innerHTML = sisters.length
    ? sisters.join("")
    : `<p class="empty-state">No sister companionships recorded yet.</p>`;
  els.ministeringBrothers.innerHTML = brothers.length
    ? brothers.join("")
    : `<p class="empty-state">No brother companionships recorded yet.</p>`;
}

async function handlePdfUpload(file) {
  if (!file) return;
  els.importStatus.textContent = "Parsing PDF…";
  try {
    const incoming = await parseDirectoryPdf(file);
    if (!incoming.apartments?.length) {
      throw new Error("No members found in that PDF.");
    }
    directory = mergeDirectory(directory, incoming);
    directory.meta.lastEditedBy = currentLeader;
    directory.meta.lastEditedAt = new Date().toISOString();
    persist(true);
    populateFilters();
    updateLastEdited();
    renderPods();
    els.importStatus.textContent = `Imported ${directory.meta.memberCount} members from ${file.name}.`;
  } catch (err) {
    console.error(err);
    els.importStatus.textContent = `Import failed: ${err.message || err}`;
  }
}

function enterApp() {
  if (!directoryReady || !directory?.apartments) {
    throw new Error("Directory data is still loading. Try again in a moment.");
  }
  els.gate.hidden = true;
  els.app.hidden = false;
  populateFilters();
  updateLastEdited();
  renderPods();
}

function bindEvents() {
  els.togglePassword?.addEventListener("click", () => {
    const showing = els.leaderPassword.type === "text";
    els.leaderPassword.type = showing ? "password" : "text";
    els.togglePassword.textContent = showing ? "Show" : "Hide";
    els.togglePassword.setAttribute("aria-pressed", showing ? "false" : "true");
    els.togglePassword.setAttribute(
      "aria-label",
      showing ? "Show password" : "Hide password"
    );
    els.leaderPassword.focus();
  });

  els.gateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.gateError.hidden = true;
    els.enterDirectory.disabled = true;
    els.enterDirectory.textContent = "Checking…";
    try {
      if (!directoryReady) {
        await loadBaseline();
      }
      const hash = await sha256(els.leaderPassword.value);
      if (hash !== PASS_HASH) {
        showGateError("Incorrect password.");
        return;
      }
      currentLeader = els.leaderName.value.trim();
      if (!currentLeader) {
        showGateError("Please enter your name.");
        return;
      }
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ name: currentLeader, at: Date.now() })
      );
      enterApp();
    } catch (err) {
      console.error(err);
      showGateError(err.message || "Could not open the directory.");
    } finally {
      els.enterDirectory.disabled = false;
      els.enterDirectory.textContent = "Enter directory";
    }
  });

  els.signOut.addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  });

  els.search.addEventListener("input", renderPods);
  els.complexFilter.addEventListener("change", renderPods);
  els.flagFilter.addEventListener("change", renderPods);

  els.podList.addEventListener("click", (event) => {
    const btn = event.target.closest(".member-btn");
    if (!btn) return;
    openMember(btn.dataset.memberId);
  });

  els.dialogClose.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) els.dialog.close();
  });

  els.dialogBody.addEventListener("input", (event) => {
    if (event.target.matches("[data-field], [data-flag], [data-multi]")) {
      applyMemberEdits(event.target);
    }
  });
  els.dialogBody.addEventListener("change", (event) => {
    if (event.target.matches("[data-field], [data-flag], [data-multi]")) {
      applyMemberEdits(event.target);
    }
    if (event.target.matches("[data-photo]")) {
      const file = event.target.files?.[0];
      handlePhoto(file);
    }
  });
  els.dialogBody.addEventListener("click", (event) => {
    if (event.target.matches("[data-clear-photo]")) {
      const found = findMember(activeMemberId);
      if (!found) return;
      found.member.photoUrl = "";
      touchEdit();
      openMember(activeMemberId);
      renderPods();
    }
  });

  els.pdfUpload.addEventListener("change", () => {
    const file = els.pdfUpload.files?.[0];
    handlePdfUpload(file);
  });
}

async function loadBaseline() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      directory = JSON.parse(saved);
      directoryReady = true;
      return;
    } catch {
      /* fall through */
    }
  }
  const res = await fetch("./data/members.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load ward roster.");
  directory = await res.json();
  directoryReady = true;
}

async function init() {
  bindEvents();
  await loadBaseline();

  const sessionRaw = sessionStorage.getItem(SESSION_KEY);
  if (sessionRaw) {
    try {
      const session = JSON.parse(sessionRaw);
      currentLeader = session.name || "";
      els.leaderName.value = currentLeader;
      enterApp();
      return;
    } catch {
      /* show gate */
    }
  }
}

init().catch((err) => {
  console.error(err);
  showGateError(err.message || "Failed to start directory.");
});
