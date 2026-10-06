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
  gateError: document.getElementById("gate-error"),
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
let currentLeader = "";
let saveTimer = null;
let activeMemberId = null;

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

async function loadBaseline() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      directory = JSON.parse(saved);
      return;
    } catch {
      /* fall through */
    }
  }
  const res = await fetch("./data/members.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load ward roster.");
  directory = await res.json();
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
  els.gate.hidden = true;
  els.app.hidden = false;
  populateFilters();
  updateLastEdited();
  renderPods();
}

function bindEvents() {
  els.gateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.gateError.hidden = true;
    const hash = await sha256(els.leaderPassword.value);
    if (hash !== PASS_HASH) {
      els.gateError.hidden = false;
      return;
    }
    currentLeader = els.leaderName.value.trim();
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ name: currentLeader, at: Date.now() })
    );
    enterApp();
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
  els.gateError.hidden = false;
  els.gateError.textContent = err.message || "Failed to start directory.";
});
