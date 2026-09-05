const SAMPLE_PATH = "./data/members.sample.json";
const LIVE_PATH = "./data/members.json";

const els = {
  search: document.getElementById("search"),
  complexFilter: document.getElementById("complex-filter"),
  podList: document.getElementById("pod-list"),
  emptyState: document.getElementById("empty-state"),
  stats: document.getElementById("stats"),
  sampleBanner: document.getElementById("sample-banner"),
  dialog: document.getElementById("member-dialog"),
  dialogBody: document.getElementById("dialog-body"),
  header: document.querySelector(".site-header"),
};

/** @type {{ ward: object, apartments: Array }} */
let directory = { ward: {}, apartments: [] };
let usingSample = true;

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function avatarMarkup(member, className = "avatar") {
  if (member.photoUrl) {
    return `<img class="${className}" src="${escapeAttr(member.photoUrl)}" alt="" loading="lazy" />`;
  }
  return `<div class="${className} initials" aria-hidden="true">${escapeHtml(initials(member.preferredName || member.fullName))}</div>`;
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

async function loadDirectory() {
  try {
    const live = await fetch(LIVE_PATH, { cache: "no-store" });
    if (live.ok) {
      directory = await live.json();
      usingSample = false;
      return;
    }
  } catch {
    /* fall through to sample */
  }

  const sample = await fetch(SAMPLE_PATH, { cache: "no-store" });
  if (!sample.ok) {
    throw new Error("Could not load member data.");
  }
  directory = await sample.json();
  usingSample = true;
}

function populateComplexFilter() {
  const complexes = [...new Set(directory.apartments.map((apt) => apt.complex))].sort();
  els.complexFilter.innerHTML =
    `<option value="">All complexes</option>` +
    complexes.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("");
}

function matchesQuery(apartment, query) {
  if (!query) return true;
  const haystack = [
    apartment.complex,
    apartment.unit,
    apartment.address,
    apartment.city,
    ...apartment.members.flatMap((m) => [m.preferredName, m.fullName, ...(m.callings || [])]),
  ]
    .join(" ")
    .toLowerCase();
  return query.split(/\s+/).every((token) => haystack.includes(token));
}

function filteredApartments() {
  const query = els.search.value.trim().toLowerCase();
  const complex = els.complexFilter.value;
  return directory.apartments.filter((apt) => {
    if (complex && apt.complex !== complex) return false;
    return matchesQuery(apt, query);
  });
}

function renderStats(apartments) {
  const memberCount = apartments.reduce((sum, apt) => sum + apt.members.length, 0);
  const complexCount = new Set(apartments.map((apt) => apt.complex)).size;
  els.stats.innerHTML = `
    <div><strong>${memberCount}</strong>members</div>
    <div><strong>${apartments.length}</strong>apartments</div>
    <div><strong>${complexCount}</strong>complexes</div>
  `;
}

function renderPods() {
  const apartments = filteredApartments();
  renderStats(apartments);
  els.sampleBanner.hidden = !usingSample;
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
      <section class="complex-group" aria-labelledby="complex-${slug(complex)}">
        <h3 class="complex-title" id="complex-${slug(complex)}">${escapeHtml(complex)}</h3>
        <div class="pods">
          ${pods.map(renderPod).join("")}
        </div>
      </section>`
    )
    .join("");
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function renderPod(apartment) {
  const streetLine = `${apartment.address}`;
  return `
    <article class="pod" data-apartment="${escapeAttr(apartment.id)}">
      <h4 class="pod-address">Unit ${escapeHtml(apartment.unit)}</h4>
      <p class="pod-meta">${escapeHtml(streetLine)} · ${escapeHtml(apartment.city)}</p>
      <div class="roommates">
        ${apartment.members.map((member) => renderMemberButton(member, apartment)).join("")}
      </div>
    </article>
  `;
}

function renderMemberButton(member, apartment) {
  const calling = (member.callings && member.callings[0]) || "";
  return `
    <button
      type="button"
      class="member-btn"
      data-member-id="${escapeAttr(member.id)}"
      data-apartment-id="${escapeAttr(apartment.id)}"
      aria-label="${escapeAttr(member.fullName)}"
    >
      ${avatarMarkup(member)}
      <span class="member-name">${escapeHtml(member.preferredName || member.fullName)}</span>
      ${calling ? `<span class="member-calling">${escapeHtml(calling)}</span>` : ""}
    </button>
  `;
}

function openMember(memberId, apartmentId) {
  const apartment = directory.apartments.find((apt) => apt.id === apartmentId);
  const member = apartment?.members.find((m) => m.id === memberId);
  if (!member || !apartment) return;

  const callings = (member.callings || []).filter(Boolean);
  els.dialogBody.innerHTML = `
    ${avatarMarkup(member, "dialog-avatar")}
    <h3>${escapeHtml(member.preferredName || member.fullName)}</h3>
    <p class="dialog-full">${escapeHtml(member.fullName)}</p>
    <dl class="dialog-rows">
      <div>
        <dt>Apartment</dt>
        <dd>${escapeHtml(apartment.complex)} · Unit ${escapeHtml(apartment.unit)}</dd>
      </div>
      <div>
        <dt>Address</dt>
        <dd>${escapeHtml(apartment.address)}<br />${escapeHtml(apartment.city)}</dd>
      </div>
      ${
        callings.length
          ? `<div><dt>Calling</dt><dd>${escapeHtml(callings.join(", "))}</dd></div>`
          : ""
      }
      ${
        member.phone
          ? `<div><dt>Phone</dt><dd><a href="tel:${escapeAttr(member.phone)}">${escapeHtml(member.phone)}</a></dd></div>`
          : ""
      }
      ${
        member.email
          ? `<div><dt>Email</dt><dd><a href="mailto:${escapeAttr(member.email)}">${escapeHtml(member.email)}</a></dd></div>`
          : ""
      }
    </dl>
  `;
  els.dialog.showModal();
}

function bindEvents() {
  els.search.addEventListener("input", renderPods);
  els.complexFilter.addEventListener("change", renderPods);

  els.podList.addEventListener("click", (event) => {
    const button = event.target.closest(".member-btn");
    if (!button) return;
    openMember(button.dataset.memberId, button.dataset.apartmentId);
  });

  window.addEventListener(
    "scroll",
    () => {
      els.header.classList.toggle("is-scrolled", window.scrollY > 12);
    },
    { passive: true }
  );
}

async function init() {
  try {
    await loadDirectory();
    populateComplexFilter();
    bindEvents();
    renderPods();
  } catch (error) {
    els.podList.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

init();
