// Maminti Kucko — Inventory app
// Storage: localStorage. Lookup: Google Books. Scanner: html5-qrcode.

const STORAGE_KEY = "mk_inventory_v1";

// ---------- Storage ----------
function loadInventory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveInventory(inv) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(inv));
}

// ---------- Tabs ----------
const tabs = document.querySelectorAll(".tab");
const panels = {
  add: document.getElementById("panel-add"),
  sell: document.getElementById("panel-sell"),
  inventory: document.getElementById("panel-inventory"),
};
tabs.forEach((t) => {
  t.addEventListener("click", () => {
    tabs.forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    Object.values(panels).forEach((p) => p.classList.remove("active"));
    panels[t.dataset.tab].classList.add("active");
    if (t.dataset.tab === "inventory") renderInventory();
    // Stop any active scanners on tab switch
    stopScanner("add");
    stopScanner("sell");
  });
});

// ---------- Toast ----------
const toastEl = document.getElementById("toast");
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

function showStatus(elId, msg, kind = "info") {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.className = `status ${kind}`;
  el.hidden = false;
}
function clearStatus(elId) {
  document.getElementById(elId).hidden = true;
}

// ---------- Book lookup (Google Books → Open Library fallback) ----------
async function lookupBook(isbn) {
  const cleanIsbn = isbn.replace(/[^0-9Xx]/g, "");
  // Try Google Books first
  try {
    const book = await lookupGoogleBooks(cleanIsbn);
    if (book) return book;
  } catch (e) {
    console.warn("Google Books failed, trying Open Library:", e);
  }
  // Fall back to Open Library
  try {
    const book = await lookupOpenLibrary(cleanIsbn);
    if (book) return book;
  } catch (e) {
    console.warn("Open Library failed:", e);
    throw e;
  }
  return null;
}

async function lookupGoogleBooks(isbn) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Books HTTP ${res.status}`);
  const data = await res.json();
  if (!data.items || data.items.length === 0) return null;
  const v = data.items[0].volumeInfo || {};
  const cover =
    (v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) ||
    "";
  return {
    isbn,
    title: v.title || "Ismeretlen cím",
    authors: (v.authors || []).join(", "),
    publisher: v.publisher || "",
    publishedDate: v.publishedDate || "",
    cover: cover.replace("http://", "https://"),
    source: "google",
  };
}

async function lookupOpenLibrary(isbn) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open Library HTTP ${res.status}`);
  const data = await res.json();
  const entry = data[`ISBN:${isbn}`];
  if (!entry) return null;
  return {
    isbn,
    title: entry.title || "Ismeretlen cím",
    authors: (entry.authors || []).map((a) => a.name).join(", "),
    publisher: (entry.publishers || []).map((p) => p.name).join(", "),
    publishedDate: entry.publish_date || "",
    cover:
      (entry.cover && (entry.cover.medium || entry.cover.small || entry.cover.large)) ||
      `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
    source: "openlibrary",
  };
}

// ---------- Scanner ----------
const scanners = { add: null, sell: null };

async function startScanner(which, onDecoded) {
  const readerId = `${which}-reader`;
  const scannerEl = document.getElementById(`${which}-scanner`);

  // Pre-flight checks with visible errors
  if (typeof Html5Qrcode === "undefined") {
    showStatus(`${which}-status`, "A vonalkód-olvasó könyvtár nem töltődött be. Ellenőrizd az internetkapcsolatot, majd frissíts.", "error");
    return;
  }
  if (!window.isSecureContext) {
    showStatus(`${which}-status`, "A kamera csak HTTPS-en (vagy localhost-on) érhető el. Nyisd meg az oldalt HTTPS URL-en.", "error");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showStatus(`${which}-status`, "Ez a böngésző nem támogatja a kamerát.", "error");
    return;
  }

  scannerEl.hidden = false;

  if (scanners[which]) {
    await stopScanner(which);
    scannerEl.hidden = false;
  }

  let scanner;
  try {
    scanner = new Html5Qrcode(readerId, /* verbose */ false);
  } catch (e) {
    showStatus(`${which}-status`, "Nem sikerült létrehozni az olvasót: " + (e.message || e), "error");
    scannerEl.hidden = true;
    return;
  }
  scanners[which] = scanner;

  // Responsive scan box — wide rectangle, ~80% of the smaller side
  const qrboxFn = (w, h) => {
    const minSide = Math.min(w, h);
    const boxW = Math.floor(Math.min(w * 0.9, 400));
    const boxH = Math.floor(Math.min(minSide * 0.55, 180));
    return { width: boxW, height: boxH };
  };

  const config = {
    fps: 15,
    qrbox: qrboxFn,
    aspectRatio: 1.777,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  };

  showStatus(`${which}-status`, "Olvasás folyamatban… tartsd a vonalkódot a keretbe.", "info");

  try {
    await scanner.start(
      { facingMode: "environment" },
      config,
      (decoded) => {
        clearStatus(`${which}-status`);
        stopScanner(which).then(() => onDecoded(decoded));
      },
      () => { /* per-frame "not found" — ignore */ }
    );
  } catch (e) {
    const msg = e && (e.message || e.name || String(e));
    // Try fallback: any camera (laptops often have only "user")
    try {
      await scanner.start(
        true, // use any camera
        config,
        (decoded) => {
          clearStatus(`${which}-status`);
          stopScanner(which).then(() => onDecoded(decoded));
        },
        () => {}
      );
    } catch (e2) {
      showStatus(`${which}-status`, "Nem sikerült a kamerát megnyitni: " + (e2.message || msg), "error");
      scannerEl.hidden = true;
      scanners[which] = null;
    }
  }
}

async function scanFile(which, file, onDecoded) {
  showStatus(`${which}-status`, "Kép elemzése…", "info");
  try {
    const tmp = new Html5Qrcode(`${which}-reader`, false);
    const result = await tmp.scanFile(file, /* showImage */ false);
    try { await tmp.clear(); } catch {}
    clearStatus(`${which}-status`);
    onDecoded(result);
  } catch (e) {
    showStatus(`${which}-status`, "Nem találtam vonalkódot a képen. Próbálj élesebb / közelebbi képet.", "error");
  }
}

async function stopScanner(which) {
  const scanner = scanners[which];
  if (!scanner) return;
  try {
    if (scanner.isScanning) await scanner.stop();
    await scanner.clear();
  } catch {}
  scanners[which] = null;
  document.getElementById(`${which}-scanner`).hidden = true;
}

// ---------- ADD flow ----------
const addEls = {
  scanBtn: document.getElementById("add-scan-btn"),
  cancel: document.getElementById("add-cancel"),
  manualInput: document.getElementById("add-isbn-manual"),
  manualGo: document.getElementById("add-isbn-go"),
  result: document.getElementById("add-result"),
  cover: document.getElementById("add-cover"),
  title: document.getElementById("add-title"),
  authors: document.getElementById("add-authors"),
  isbn: document.getElementById("add-isbn"),
  qty: document.getElementById("add-qty"),
  plus: document.getElementById("add-plus"),
  minus: document.getElementById("add-minus"),
  price: document.getElementById("add-price"),
  vatBox: document.getElementById("add-vat"),
  vatNet: document.getElementById("vat-net"),
  vatAmount: document.getElementById("vat-amount"),
  vatGross: document.getElementById("vat-gross"),
  save: document.getElementById("add-save"),
};

const VAT_RATE = 0.05; // Hungarian books: 5% ÁFA
const HUF = (n) =>
  Math.round(n).toLocaleString("hu-HU", { maximumFractionDigits: 0 }) + " Ft";

function updateVatBreakdown() {
  const gross = parseFloat(addEls.price.value);
  if (!gross || gross <= 0) {
    addEls.vatBox.hidden = true;
    return;
  }
  const net = gross / (1 + VAT_RATE);
  const vat = gross - net;
  addEls.vatNet.textContent = HUF(net);
  addEls.vatAmount.textContent = HUF(vat);
  addEls.vatGross.textContent = HUF(gross);
  addEls.vatBox.hidden = false;
}
addEls.price.addEventListener("input", updateVatBreakdown);

let pendingAddBook = null;

addEls.scanBtn.addEventListener("click", () => {
  clearStatus("add-status");
  startScanner("add", handleAddIsbn).catch((e) =>
    showStatus("add-status", "Hiba: " + (e.message || e), "error")
  );
});
addEls.cancel.addEventListener("click", () => stopScanner("add"));

document.getElementById("add-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  await scanFile("add", file, handleAddIsbn);
  e.target.value = "";
});
addEls.manualGo.addEventListener("click", () => {
  const isbn = addEls.manualInput.value.trim();
  if (isbn) handleAddIsbn(isbn);
});
addEls.manualInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addEls.manualGo.click();
});

addEls.plus.addEventListener("click", () => {
  addEls.qty.value = Math.max(1, parseInt(addEls.qty.value || "1", 10) + 1);
});
addEls.minus.addEventListener("click", () => {
  addEls.qty.value = Math.max(1, parseInt(addEls.qty.value || "1", 10) - 1);
});

addEls.save.addEventListener("click", () => {
  if (!pendingAddBook) return;
  const qty = Math.max(1, parseInt(addEls.qty.value || "1", 10));
  const priceRaw = parseFloat(addEls.price.value);
  const priceGross = priceRaw > 0 ? Math.round(priceRaw) : null;

  const inv = loadInventory();
  const existing = inv[pendingAddBook.isbn];
  if (existing) {
    const newQty = existing.qty + qty;
    Object.assign(existing, pendingAddBook, { qty: newQty });
    if (priceGross != null) existing.priceGross = priceGross;
  } else {
    inv[pendingAddBook.isbn] = {
      ...pendingAddBook,
      qty,
      priceGross,
      addedAt: Date.now(),
    };
  }
  saveInventory(inv);

  const saved = inv[pendingAddBook.isbn];
  const priceMsg = saved.priceGross ? ` · ${HUF(saved.priceGross)}` : "";
  toast(`+${qty} db hozzáadva`);
  showStatus(
    "add-status",
    `${pendingAddBook.title} – készleten: ${saved.qty} db${priceMsg}`,
    "success"
  );
  addEls.result.hidden = true;
  pendingAddBook = null;
  addEls.manualInput.value = "";
  addEls.qty.value = 1;
  addEls.price.value = "";
  addEls.vatBox.hidden = true;
});

async function handleAddIsbn(isbn) {
  clearStatus("add-status");
  showStatus("add-status", `Keresés: ${isbn}…`, "info");
  try {
    const book = await lookupBook(isbn);
    if (!book) {
      // Allow manual entry — pre-fill with isbn only
      pendingAddBook = {
        isbn: isbn.replace(/[^0-9Xx]/g, ""),
        title: "Ismeretlen könyv",
        authors: "",
        cover: "",
      };
      showStatus("add-status", "Nem találtam online — kézzel is hozzáadhatod.", "info");
    } else {
      pendingAddBook = book;
      clearStatus("add-status");
    }
    addEls.cover.src = pendingAddBook.cover || transparentPixel();
    addEls.title.textContent = pendingAddBook.title;
    addEls.authors.textContent = pendingAddBook.authors || "—";
    addEls.isbn.textContent = "ISBN: " + pendingAddBook.isbn;
    addEls.qty.value = 1;

    const existing = loadInventory()[pendingAddBook.isbn];
    addEls.price.value = existing && existing.priceGross ? existing.priceGross : "";
    updateVatBreakdown();

    addEls.result.hidden = false;
  } catch (e) {
    showStatus("add-status", "Hiba a kereséskor: " + (e.message || e), "error");
  }
}

// ---------- SELL flow ----------
const sellEls = {
  scanBtn: document.getElementById("sell-scan-btn"),
  cancel: document.getElementById("sell-cancel"),
  manualInput: document.getElementById("sell-isbn-manual"),
  manualGo: document.getElementById("sell-isbn-go"),
};

sellEls.scanBtn.addEventListener("click", () => {
  clearStatus("sell-status");
  startScanner("sell", handleSellIsbn).catch((e) =>
    showStatus("sell-status", "Hiba: " + (e.message || e), "error")
  );
});
sellEls.cancel.addEventListener("click", () => stopScanner("sell"));

document.getElementById("sell-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  await scanFile("sell", file, handleSellIsbn);
  e.target.value = "";
});
sellEls.manualGo.addEventListener("click", () => {
  const isbn = sellEls.manualInput.value.trim();
  if (isbn) handleSellIsbn(isbn);
});
sellEls.manualInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sellEls.manualGo.click();
});

async function handleSellIsbn(rawIsbn) {
  const isbn = rawIsbn.replace(/[^0-9Xx]/g, "");
  const inv = loadInventory();
  const book = inv[isbn];
  if (!book) {
    showStatus("sell-status", `Nincs ilyen könyv a készletben (ISBN: ${isbn})`, "error");
    return;
  }
  if (book.qty <= 0) {
    showStatus("sell-status", `${book.title} – elfogyott (0 db)`, "error");
    return;
  }
  book.qty -= 1;
  saveInventory(inv);
  toast(`Eladva: ${book.title}`);
  showStatus(
    "sell-status",
    `✓ ${book.title} eladva. Maradt: ${book.qty} db`,
    "success"
  );
  sellEls.manualInput.value = "";
}

// ---------- INVENTORY view ----------
const invSearchEl = document.getElementById("inv-search");
const invListEl = document.getElementById("inv-list");
const invSummaryEl = document.getElementById("inv-summary");
const invExportBtn = document.getElementById("inv-export");

invSearchEl.addEventListener("input", renderInventory);
invExportBtn.addEventListener("click", exportInventory);

function renderInventory() {
  const inv = loadInventory();
  const items = Object.values(inv);
  const q = invSearchEl.value.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (b) =>
          (b.title || "").toLowerCase().includes(q) ||
          (b.authors || "").toLowerCase().includes(q) ||
          (b.isbn || "").includes(q)
      )
    : items;

  filtered.sort((a, b) => (a.title || "").localeCompare(b.title || "", "hu"));

  const totalTitles = items.length;
  const totalQty = items.reduce((s, b) => s + (b.qty || 0), 0);
  invSummaryEl.innerHTML = `<span>${totalTitles} cím</span><span>${totalQty} db összesen</span>`;

  invListEl.innerHTML = "";
  if (filtered.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = q ? "Nincs találat." : "Üres a készlet.";
    invListEl.appendChild(li);
    return;
  }

  for (const b of filtered) {
    const li = document.createElement("li");
    li.className = "inv-item";
    const priceLine = b.priceGross
      ? `<div class="i">${HUF(b.priceGross)} (br.)</div>`
      : "";
    li.innerHTML = `
      <img src="${b.cover || transparentPixel()}" alt="" onerror="this.src='${transparentPixel()}'" />
      <div class="info">
        <div class="t">${escapeHtml(b.title)}</div>
        <div class="a">${escapeHtml(b.authors || "—")}</div>
        <div class="i">${escapeHtml(b.isbn)}</div>
        ${priceLine}
      </div>
      <div class="qty-badge ${b.qty <= 0 ? "zero" : ""}">${b.qty}</div>
    `;
    invListEl.appendChild(li);
  }
}

function exportInventory() {
  const inv = loadInventory();
  const rows = [["ISBN", "Cím", "Szerző", "Darab", "Bruttó (Ft)", "Nettó (Ft)", "ÁFA 5% (Ft)"]];
  for (const b of Object.values(inv)) {
    const gross = b.priceGross || "";
    const net = gross ? Math.round(gross / (1 + VAT_RATE)) : "";
    const vat = gross ? gross - net : "";
    rows.push([b.isbn, b.title, b.authors || "", b.qty, gross, net, vat]);
  }
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `maminti-keszlet-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function transparentPixel() {
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 84"><rect width="60" height="84" fill="#FFF6E8"/><text x="30" y="48" text-anchor="middle" font-size="32" fill="#C7E0B5">📖</text></svg>`
  );
}

// Initial render
renderInventory();
