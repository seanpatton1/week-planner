"use strict";
/* ================= Data ================= */
const LS_KEY = "weekPlannerData";
const DATA_FILENAME = "week-planner-data.json";
const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

const SUPA_URL = "https://ckaahrsyjeikfnqdbpbo.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrYWFocnN5amVpa2ZucWRicGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNDA4NDYsImV4cCI6MjA5ODgxNjg0Nn0.Amm6sk-XIezov1qXNHZvwZvnLS3aGydeGt7SaF4Kn4s";
const supa = window.supabase ? window.supabase.createClient(SUPA_URL, SUPA_KEY) : null;
let uid = null;                // signed-in user id
let cloudState = "sync";       // sync | ok | offline
function lsKey() { return uid ? LS_KEY + "_" + uid : LS_KEY; }

const defaultData = () => ({
  version: 1,
  savedAt: null,
  settings: {
    dayStart: 6,
    dayEnd: 23,
    categories: [
      { id: "trade",  name: "Trading",  color: "#c9962a" },
      { id: "work",   name: "Work",     color: "#2f6fed" },
      { id: "family", name: "Family",   color: "#3aa04c" },
      { id: "fit",    name: "Fitness",  color: "#e2593b" },
      { id: "admin",  name: "Admin",    color: "#7a6ff0" },
      { id: "other",  name: "Other",    color: "#5a6b7b" }
    ]
  },
  recurring: [],   // entries that repeat every week: {id, day, hour, duration, title, cat, notes}
  exceptions: {},  // { weekKey: [recurringId] } — weeks where a recurring entry is skipped
  weeks: {}   // { "YYYY-MM-DD (monday)": [ {id, day 0-6, hour, duration, title, cat, notes} ] }
});
function migrate(d) {
  d.recurring = d.recurring || [];
  d.exceptions = d.exceptions || {};
  return d;
}

let data = defaultData();   // real data loads after sign-in (per-user storage)
let curMonday = mondayOf(new Date());
let selDay = jsDayToIdx(new Date().getDay());   // mobile selected day
let editingId = null;
let dirty = false;          // unsynced-to-file changes
let fileHandle = null;      // FileSystemFileHandle (desktop)
let saveTimer = null;

function loadLocal() {
  try {
    const raw = localStorage.getItem(lsKey());
    if (raw) { const d = JSON.parse(raw); if (d && d.weeks && d.settings) return migrate(d); }
  } catch (e) {}
  return defaultData();
}
function persistLocal() {
  data.savedAt = new Date().toISOString();
  localStorage.setItem(lsKey(), JSON.stringify(data));
  dirty = true;
  updateSyncStatus();
  schedulePush();
}

/* ================= Date helpers ================= */
function jsDayToIdx(jsDay) { return (jsDay + 6) % 7; }        // Mon=0 … Sun=6
function mondayOf(d) {
  const x = new Date(d); x.setHours(0,0,0,0);
  x.setDate(x.getDate() - jsDayToIdx(x.getDay()));
  return x;
}
function wkKey(mon) {
  return mon.getFullYear() + "-" + String(mon.getMonth()+1).padStart(2,"0") + "-" + String(mon.getDate()).padStart(2,"0");
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function fmtShort(d) { return d.getDate() + " " + d.toLocaleString("en-GB",{month:"short"}); }
function hh(h) { return String(h).padStart(2,"0") + ":00"; }
function isSameDate(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

function entries() { return data.weeks[wkKey(curMonday)] || []; }
function recurringForWeek() {
  const ex = data.exceptions[wkKey(curMonday)] || [];
  return data.recurring.filter(r => !ex.includes(r.id));
}
function allWeekEntries() { return entries().concat(recurringForWeek()); }
function isRecurring(id) { return data.recurring.some(r => r.id === id); }
function skipThisWeek(id) {
  const k = wkKey(curMonday);
  (data.exceptions[k] = data.exceptions[k] || []).push(id);
  persistLocal();
}
function detachToThisWeek(rec, changes) {
  // A recurring entry changed for this week only: hide the original here, add a one-off copy
  skipThisWeek(rec.id);
  const copy = { ...rec, ...changes, id: "e" + Date.now() + Math.floor(Math.random()*100000) };
  setEntries(entries().concat(copy));
  return copy;
}
function setEntries(list) {
  if (list.length) data.weeks[wkKey(curMonday)] = list;
  else delete data.weeks[wkKey(curMonday)];
  persistLocal();
}
function catById(id) {
  return data.settings.categories.find(c => c.id === id) || data.settings.categories[data.settings.categories.length-1];
}

/* ================= Rendering ================= */
const grid = document.getElementById("grid");
const gridWrap = document.getElementById("gridWrap");
const dayChips = document.getElementById("dayChips");
const SLOT_H = () => (isMobile() ? 56 : 48);
function isMobile() { return window.innerWidth < 720; }

function render() {
  const today = new Date();
  const mob = isMobile();
  const s = data.settings.dayStart, e = data.settings.dayEnd;
  const hours = []; for (let h = s; h < e; h++) hours.push(h);

  // Week label
  const sun = addDays(curMonday, 6);
  document.getElementById("wkLabel").textContent =
    fmtShort(curMonday) + " – " + fmtShort(sun) + " " + sun.getFullYear();

  // Day chips (mobile)
  dayChips.innerHTML = "";
  if (mob) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(curMonday, d);
      const chip = document.createElement("div");
      chip.className = "chip" + (d === selDay ? " sel" : "") + (isSameDate(date, today) ? " today" : "");
      chip.innerHTML = "<span class='d'>" + DAY_NAMES[d] + "</span>" + date.getDate();
      chip.onclick = () => { selDay = d; render(); };
      dayChips.appendChild(chip);
    }
  }

  const days = mob ? [selDay] : [0,1,2,3,4,5,6];
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = (mob ? "56px" : "64px") + " repeat(" + days.length + ", 1fr)";
  grid.style.gridTemplateRows = "auto 1fr";

  // Header row
  const corner = document.createElement("div");
  corner.className = "head-cell"; corner.style.left = "0"; corner.style.zIndex = "6"; corner.style.position = "sticky";
  grid.appendChild(corner);
  for (const d of days) {
    const date = addDays(curMonday, d);
    const hc = document.createElement("div");
    hc.className = "head-cell day-head" + (isSameDate(date, today) ? " today" : "");
    hc.innerHTML = DAY_NAMES[d] + "<small>" + fmtShort(date) + "</small>";
    if (mob) hc.classList.remove("day-head");   // keep single header visible on mobile
    grid.appendChild(hc);
  }

  // Time column
  const timeCol = document.createElement("div");
  for (const h of hours) {
    const tc = document.createElement("div");
    tc.className = "time-cell"; tc.style.height = SLOT_H() + "px";
    tc.textContent = hh(h);
    timeCol.appendChild(tc);
  }
  grid.appendChild(timeCol);

  // Day columns
  for (const d of days) {
    const date = addDays(curMonday, d);
    const col = document.createElement("div");
    col.className = "day-col" + (isSameDate(date, today) ? " today" : "");
    col.dataset.day = d;
    for (const h of hours) {
      const cell = document.createElement("div");
      cell.className = "hour-cell"; cell.style.height = SLOT_H() + "px";
      cell.onclick = () => cellTapped(d, h);
      col.appendChild(cell);
    }
    // Entries
    const dayEntries = allWeekEntries().filter(en => en.day === d).sort((a,b) => a.hour - b.hour);
    let prevEnd = -1, inset = 0;
    for (const en of dayEntries) {
      inset = (en.hour < prevEnd) ? inset + 10 : 0;
      prevEnd = Math.max(prevEnd, en.hour + en.duration);
      const top = (en.hour - s) * SLOT_H();
      const hgt = Math.min(en.duration, e - en.hour) * SLOT_H();
      if (en.hour + en.duration <= s || en.hour >= e) continue;
      const cat = catById(en.cat);
      const el = document.createElement("div");
      el.className = "entry";
      el.style.top = Math.max(top, 0) + 2 + "px";
      el.style.height = (hgt - 5) + "px";
      el.style.background = cat.color;
      el.style.marginLeft = inset + "px";
      el.innerHTML = "<div class='t'></div><div class='c'></div><div class='n'></div><div class='rz'></div>";
      el.querySelector(".t").textContent = en.title;
      el.querySelector(".c").textContent = hh(en.hour) + "–" + hh(en.hour + en.duration) + " · " + cat.name;
      el.querySelector(".n").textContent = (en.notes ? "📝" : "") + (isRecurring(en.id) ? " ↻" : "");
      if (moveMode && moveMode.id === en.id) el.classList.add("lift");
      attachEntryEvents(el, en);
      col.appendChild(el);
    }
    // Now line
    if (isSameDate(date, today)) {
      const nowH = today.getHours() + today.getMinutes()/60;
      if (nowH >= s && nowH <= e) {
        const line = document.createElement("div");
        line.id = "nowLine";
        line.style.top = ((nowH - s) * SLOT_H()) + "px";
        col.appendChild(line);
      }
    }
    grid.appendChild(col);
  }
}

/* ================= Move / drag / resize ================= */
let moveMode = null;       // { id, armed } — mobile long-press "tap to place" mode
let justDragged = false;   // swallow the click that follows a mouse drag
const toast = document.getElementById("toast");
function showToast(msg) { toast.textContent = msg; toast.style.display = msg ? "block" : "none"; }
function cancelMoveMode() { moveMode = null; showToast(""); render(); }

function cellTapped(d, h) {
  if (moveMode) { if (moveMode.armed) commitMove(moveMode.id, d, h); return; }
  openEntryModal(null, d, h);
}
function commitMove(id, d, h) {
  const e = data.settings.dayEnd;
  const rec = data.recurring.find(r => r.id === id);
  if (rec) {
    detachToThisWeek(rec, { day: d, hour: Math.min(h, e - rec.duration) });
  } else {
    const list = entries();
    const en = list.find(x => x.id === id);
    if (en) { en.day = d; en.hour = Math.min(h, e - en.duration); setEntries(list); }
  }
  moveMode = null; showToast("");
  render();
}
function commitResize(id, dur) {
  const rec = data.recurring.find(r => r.id === id);
  if (rec) detachToThisWeek(rec, { duration: dur });
  else {
    const list = entries();
    const en = list.find(x => x.id === id);
    if (en) { en.duration = dur; setEntries(list); }
  }
  render();
}

function attachEntryEvents(el, en) {
  let lpTimer = null, startX = 0, startY = 0, dragging = false, resizing = false;
  let hoverCell = null, newDur = en.duration;
  const isTouch = (ev) => ev.pointerType !== "mouse";

  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (justDragged) { justDragged = false; return; }
    if (moveMode) { if (moveMode.armed) cancelMoveMode(); return; }
    openEntryModal(en.id);
  });
  el.addEventListener("contextmenu", ev => ev.preventDefault());

  el.addEventListener("pointerdown", (ev) => {
    startX = ev.clientX; startY = ev.clientY; dragging = false;
    resizing = ev.target.classList.contains("rz") && !isTouch(ev);
    if (isTouch(ev)) {
      if (moveMode) return;
      lpTimer = setTimeout(() => {
        lpTimer = null;
        moveMode = { id: en.id, armed: false };
        el.classList.add("lift");
        showToast("Moving “" + en.title + "” — tap a slot to place it (tap it again to cancel)");
        if (navigator.vibrate) navigator.vibrate(30);
        setTimeout(() => { if (moveMode) moveMode.armed = true; }, 400);
      }, 450);
      return;
    }
    el.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  el.addEventListener("pointermove", (ev) => {
    if (isTouch(ev)) {
      if (lpTimer && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 10) { clearTimeout(lpTimer); lpTimer = null; }
      return;
    }
    if (!el.hasPointerCapture || !el.hasPointerCapture(ev.pointerId)) return;
    if (resizing) {
      const rect = el.getBoundingClientRect();
      newDur = Math.max(1, Math.min(data.settings.dayEnd - en.hour, Math.round((ev.clientY - rect.top) / SLOT_H())));
      el.style.height = (newDur * SLOT_H() - 5) + "px";
      dragging = true;
      return;
    }
    if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
      dragging = true; el.classList.add("dragging");
    }
    if (dragging) {
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = under && under.closest ? under.closest(".hour-cell") : null;
      if (hoverCell && hoverCell !== cell) hoverCell.classList.remove("drop");
      if (cell) cell.classList.add("drop");
      hoverCell = cell;
    }
  });

  el.addEventListener("pointerup", (ev) => {
    if (isTouch(ev)) { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } return; }
    if (resizing && dragging) { justDragged = true; commitResize(en.id, newDur); return; }
    if (dragging) {
      justDragged = true;
      el.classList.remove("dragging");
      if (hoverCell) {
        hoverCell.classList.remove("drop");
        const col = hoverCell.parentElement;
        const idx = Array.prototype.indexOf.call(col.querySelectorAll(".hour-cell"), hoverCell);
        commitMove(en.id, +col.dataset.day, data.settings.dayStart + idx);
      } else render();
    }
  });
  el.addEventListener("pointercancel", () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } });
}

/* ================= Entry modal ================= */
const entryOverlay = document.getElementById("entryOverlay");
let modalCat = null;

function fillSelect(sel, opts, val) {
  sel.innerHTML = "";
  for (const [v, label] of opts) {
    const o = document.createElement("option");
    o.value = v; o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = String(val);
}

function openEntryModal(id, day, hour) {
  editingId = id;
  const s = data.settings.dayStart, e = data.settings.dayEnd;
  const en = id ? (entries().find(x => x.id === id) || data.recurring.find(x => x.id === id)) : null;
  const rec = !!(en && isRecurring(en.id));
  document.getElementById("entryTitle").textContent = en ? "Edit entry" : "Add to plan";
  document.getElementById("eDelete").style.display = en ? "" : "none";
  document.getElementById("eDelete").textContent = rec ? "Delete all weeks" : "Delete";
  document.getElementById("eSkip").style.display = rec ? "" : "none";
  document.getElementById("eTitle").value = en ? en.title : "";
  document.getElementById("eNotes").value = (en && en.notes) ? en.notes : "";
  document.getElementById("eRepeat").checked = rec;

  const hourOpts = []; for (let h = s; h < e; h++) hourOpts.push([h, hh(h)]);
  fillSelect(document.getElementById("eHour"), hourOpts, en ? en.hour : hour);
  const durOpts = []; for (let dur = 1; dur <= 8; dur++) durOpts.push([dur, dur + (dur === 1 ? " hour" : " hours")]);
  fillSelect(document.getElementById("eDur"), durOpts, en ? en.duration : 1);
  const dayOpts = DAY_NAMES.map((n, i) => [i, n + " " + fmtShort(addDays(curMonday, i))]);
  fillSelect(document.getElementById("eDay"), dayOpts, en ? en.day : day);

  modalCat = en ? en.cat : data.settings.categories[0].id;
  renderSwatches();
  entryOverlay.classList.add("open");
  setTimeout(() => document.getElementById("eTitle").focus(), 50);
}
function renderSwatches() {
  const box = document.getElementById("eCats");
  box.innerHTML = "";
  for (const c of data.settings.categories) {
    const sw = document.createElement("div");
    sw.className = "swatch" + (c.id === modalCat ? " sel" : "");
    sw.style.background = c.color;
    sw.title = c.name;
    sw.textContent = c.name.slice(0, 4);
    sw.onclick = () => { modalCat = c.id; renderSwatches(); };
    box.appendChild(sw);
  }
}
document.getElementById("eSave").onclick = () => {
  const title = document.getElementById("eTitle").value.trim();
  if (!title) { document.getElementById("eTitle").focus(); return; }
  const en = {
    id: editingId || ("e" + Date.now() + Math.floor(Math.random()*1000)),
    day: +document.getElementById("eDay").value,
    hour: +document.getElementById("eHour").value,
    duration: +document.getElementById("eDur").value,
    title, cat: modalCat,
    notes: document.getElementById("eNotes").value.trim()
  };
  const repeat = document.getElementById("eRepeat").checked;
  // Remove any previous version from both stores, then put it where it now belongs
  data.recurring = data.recurring.filter(r => r.id !== en.id);
  const list = entries().filter(x => x.id !== en.id);
  if (repeat) data.recurring.push(en);
  else list.push(en);
  setEntries(list);
  closeModals(); render();
};
document.getElementById("eDelete").onclick = () => {
  data.recurring = data.recurring.filter(r => r.id !== editingId);
  setEntries(entries().filter(x => x.id !== editingId));
  closeModals(); render();
};
document.getElementById("eSkip").onclick = () => {
  skipThisWeek(editingId);
  closeModals(); render();
};
document.getElementById("eCancel").onclick = closeModals;

/* ================= Settings modal ================= */
const setOverlay = document.getElementById("setOverlay");
document.getElementById("mSettings").onclick = () => {
  closeMenu();
  const startOpts = []; for (let h = 0; h <= 12; h++) startOpts.push([h, hh(h)]);
  fillSelect(document.getElementById("sStart"), startOpts, data.settings.dayStart);
  const endOpts = []; for (let h = 13; h <= 24; h++) endOpts.push([h, h === 24 ? "24:00" : hh(h)]);
  fillSelect(document.getElementById("sEnd"), endOpts, data.settings.dayEnd);
  const box = document.getElementById("sCats");
  box.innerHTML = "";
  for (const c of data.settings.categories) addCatRow(box, c);
  setOverlay.classList.add("open");
};
function addCatRow(box, c) {
  const row = document.createElement("div");
  row.className = "cat-row";
  row.dataset.cid = c.id;
  const color = document.createElement("input"); color.type = "color"; color.value = c.color;
  const name = document.createElement("input"); name.type = "text"; name.value = c.name; name.placeholder = "Category name";
  const del = document.createElement("button"); del.textContent = "✕";
  del.onclick = () => { if (box.children.length > 1) row.remove(); };
  row.append(color, name, del);
  box.appendChild(row);
}
document.getElementById("sAddCat").onclick = () => {
  addCatRow(document.getElementById("sCats"), { id: "c" + Date.now(), name: "", color: "#888888" });
};
document.getElementById("sSave").onclick = () => {
  const cats = [];
  for (const row of document.getElementById("sCats").children) {
    const name = row.querySelector("input[type=text]").value.trim();
    if (!name) continue;
    cats.push({ id: row.dataset.cid, name, color: row.querySelector("input[type=color]").value });
  }
  if (cats.length) data.settings.categories = cats;
  data.settings.dayStart = +document.getElementById("sStart").value;
  data.settings.dayEnd = Math.max(+document.getElementById("sEnd").value, data.settings.dayStart + 1);
  persistLocal();
  closeModals(); render();
};
document.getElementById("sCancel").onclick = closeModals;

const statOverlay = document.getElementById("statOverlay");
function closeModals() {
  entryOverlay.classList.remove("open");
  setOverlay.classList.remove("open");
  statOverlay.classList.remove("open");
  editingId = null;
}
[entryOverlay, setOverlay, statOverlay].forEach(ov => ov.addEventListener("click", ev => { if (ev.target === ov) closeModals(); }));

/* ================= Week stats ================= */
document.getElementById("mStats").onclick = () => {
  closeMenu();
  const totals = {};
  let sum = 0;
  for (const en of allWeekEntries()) { totals[en.cat] = (totals[en.cat] || 0) + en.duration; sum += en.duration; }
  const body = document.getElementById("statBody");
  body.innerHTML = "";
  const cats = data.settings.categories.filter(c => totals[c.id]);
  const max = Math.max(1, ...cats.map(c => totals[c.id]));
  if (!cats.length) {
    const p = document.createElement("p");
    p.style.cssText = "color:var(--muted);font-size:14px";
    p.textContent = "Nothing planned this week yet.";
    body.appendChild(p);
  }
  for (const c of cats) {
    const row = document.createElement("div"); row.style.marginBottom = "12px";
    const top = document.createElement("div");
    top.style.cssText = "display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px";
    const nm = document.createElement("span"); nm.textContent = c.name;
    const val = document.createElement("b"); val.textContent = totals[c.id] + (totals[c.id] === 1 ? " hr" : " hrs");
    top.append(nm, val);
    const track = document.createElement("div");
    track.style.cssText = "height:10px;border-radius:5px;background:var(--border);overflow:hidden";
    const bar = document.createElement("div");
    bar.style.cssText = "height:100%;border-radius:5px;width:" + (totals[c.id] / max * 100) + "%;background:" + c.color;
    track.appendChild(bar);
    row.append(top, track);
    body.appendChild(row);
  }
  if (cats.length) {
    const tot = document.createElement("p");
    tot.style.cssText = "font-size:13px;color:var(--muted);margin-top:10px";
    const freeH = 7 * (data.settings.dayEnd - data.settings.dayStart) - sum;
    tot.textContent = "Total planned: " + sum + " hrs · unplanned: " + freeH + " hrs";
    body.appendChild(tot);
  }
  statOverlay.classList.add("open");
};
document.getElementById("statClose").onclick = closeModals;

/* ================= Menu ================= */
const menu = document.getElementById("menu");
document.getElementById("btnMenu").onclick = (ev) => { ev.stopPropagation(); menu.classList.toggle("open"); };
document.body.addEventListener("click", () => closeMenu());
menu.addEventListener("click", ev => ev.stopPropagation());
function closeMenu() { menu.classList.remove("open"); }

document.getElementById("mCopyPrev").onclick = () => {
  closeMenu();
  const prevKey = wkKey(addDays(curMonday, -7));
  const prev = data.weeks[prevKey];
  if (!prev || !prev.length) { alert("Last week has no entries to copy."); return; }
  if (entries().length && !confirm("This week already has entries. Add last week's on top of them?")) return;
  const copies = prev.map(en => ({ ...en, id: "e" + Date.now() + Math.floor(Math.random()*100000) + en.day + "" + en.hour }));
  setEntries(entries().concat(copies));
  render();
};
document.getElementById("mClearWeek").onclick = () => {
  closeMenu();
  if (!entries().length) return;
  if (confirm("Delete all entries for this week?")) { setEntries([]); render(); }
};

/* ================= Week nav ================= */
document.getElementById("btnPrev").onclick = () => { curMonday = addDays(curMonday, -7); render(); };
document.getElementById("btnNext").onclick = () => { curMonday = addDays(curMonday, 7); render(); };
document.getElementById("btnToday").onclick = () => {
  curMonday = mondayOf(new Date());
  selDay = jsDayToIdx(new Date().getDay());
  render();
};

/* ================= File sync (OneDrive JSON) ================= */
const hasFS = "showSaveFilePicker" in window;
const statusEl = document.getElementById("syncStatus");

function updateSyncStatus(msg) {
  if (msg) { statusEl.textContent = msg; statusEl.classList.remove("dirty"); return; }
  if (!uid) { statusEl.textContent = ""; statusEl.classList.remove("dirty"); return; }
  if (cloudState === "offline") {
    statusEl.textContent = "Offline — saved on this device"; statusEl.classList.add("dirty");
  } else if (dirty || cloudState === "sync") {
    statusEl.textContent = "Syncing…"; statusEl.classList.add("dirty");
  } else {
    statusEl.textContent = "✓ Synced"; statusEl.classList.remove("dirty");
  }
}

/* Persist the file handle across sessions via IndexedDB (desktop Chrome/Edge). */
function idb() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open("weekPlannerFS", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("h");
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function storeHandle(h) {
  try { const db = await idb(); const tx = db.transaction("h", "readwrite"); tx.objectStore("h").put(h, "file"); } catch (e) {}
}
async function restoreHandle() {
  try {
    const db = await idb();
    const h = await new Promise((res) => {
      const rq = db.transaction("h").objectStore("h").get("file");
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
    });
    if (h && (await h.queryPermission({ mode: "readwrite" })) === "granted") { fileHandle = h; dirty = false; }
    else if (h) fileHandle = h;   // will re-request permission on first save
  } catch (e) {}
  updateSyncStatus();
}

async function saveToFile(auto) {
  const json = JSON.stringify(data, null, 1);
  if (hasFS) {
    try {
      if (!fileHandle) {
        if (auto) return;
        fileHandle = await window.showSaveFilePicker({
          suggestedName: DATA_FILENAME,
          types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
        });
        await storeHandle(fileHandle);
      }
      if ((await fileHandle.queryPermission({ mode: "readwrite" })) !== "granted") {
        if (auto) { updateSyncStatus(); return; }
        if ((await fileHandle.requestPermission({ mode: "readwrite" })) !== "granted") return;
      }
      const w = await fileHandle.createWritable();
      await w.write(json); await w.close();
      dirty = false;
      updateSyncStatus("✓ Synced " + new Date().toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit"}));
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
      // fall through to download
    }
  }
  if (auto) return;
  // Fallback (phones): download the JSON, then save it into OneDrive/WeekPlanner replacing the old one.
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = DATA_FILENAME; a.click();
  URL.revokeObjectURL(a.href);
  dirty = false;
  updateSyncStatus("Downloaded — save it to OneDrive/WeekPlanner");
}

async function loadFromFile() {
  if (hasFS) {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
      });
      fileHandle = h; await storeHandle(h);
      const file = await h.getFile();
      applyLoaded(await file.text());
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  document.getElementById("filePick").click();
}
document.getElementById("filePick").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  if (f) applyLoaded(await f.text());
  ev.target.value = "";
});

function applyLoaded(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { alert("That file isn't a valid planner file."); return; }
  if (!d || !d.weeks || !d.settings) { alert("That file isn't a valid planner file."); return; }
  if (data.savedAt && d.savedAt && d.savedAt < data.savedAt) {
    if (!confirm("The file is OLDER than what's on this device.\nLoad it anyway and overwrite this device's plan?")) return;
  }
  data = migrate(d);
  localStorage.setItem(lsKey(), JSON.stringify(data));
  updateSyncStatus("✓ Loaded from file");
  render();
  schedulePush();
}

document.getElementById("mLoad").onclick = () => { closeMenu(); loadFromFile(); };
document.getElementById("mSave").onclick = () => { closeMenu(); saveToFile(false); };

/* ================= Boot ================= */
window.addEventListener("resize", (() => {
  let t; return () => { clearTimeout(t); t = setTimeout(render, 150); };
})());
setInterval(() => {   // keep the "now" line moving
  const line = document.getElementById("nowLine");
  if (line || isSameDate(new Date(), addDays(curMonday, selDay)) || !isMobile()) render();
}, 60000);

/* ================= Cloud sync ================= */
let pushTimer = null;
function schedulePush() {
  if (!uid || !supa) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushCloud, 1000);
}
async function pushCloud() {
  if (!uid || !supa) return;
  pushTimer = null;
  try {
    const { error } = await supa.from("planner").upsert({ user_id: uid, data, updated_at: new Date().toISOString() });
    if (error) throw error;
    dirty = false; cloudState = "ok";
  } catch (e) { cloudState = "offline"; }
  updateSyncStatus();
}
async function initialCloudSync() {
  cloudState = "sync"; updateSyncStatus();
  try {
    const { data: row, error } = await supa.from("planner").select("data").maybeSingle();
    if (error) throw error;
    if (row && row.data) {
      const remote = migrate(row.data);
      if (!data.savedAt || (remote.savedAt && remote.savedAt > data.savedAt)) {
        data = remote;
        localStorage.setItem(lsKey(), JSON.stringify(data));
        render();
      } else if (remote.savedAt !== data.savedAt) {
        schedulePush();
      }
    } else {
      // First sign-in for this account: adopt any pre-account data saved on this device
      if (!Object.keys(data.weeks).length && !data.recurring.length) {
        try {
          const legacy = localStorage.getItem(LS_KEY);
          if (legacy) {
            const d = JSON.parse(legacy);
            if (d && d.weeks && d.settings) {
              data = migrate(d);
              localStorage.setItem(lsKey(), JSON.stringify(data));
              render();
            }
          }
        } catch (e) {}
      }
      schedulePush();
    }
    cloudState = "ok";
    if (!pushTimer) dirty = false;
  } catch (e) { cloudState = "offline"; }
  updateSyncStatus();
}
function subscribeRealtime() {
  supa.channel("planner-sync")
    .on("postgres_changes",
        { event: "*", schema: "public", table: "planner", filter: "user_id=eq." + uid },
        (payload) => {
          const row = payload.new;
          if (!row || !row.data) return;
          const remote = migrate(typeof row.data === "string" ? JSON.parse(row.data) : row.data);
          if (remote.savedAt && (!data.savedAt || remote.savedAt > data.savedAt)) {
            data = remote;
            localStorage.setItem(lsKey(), JSON.stringify(data));
            dirty = false; cloudState = "ok";
            render(); updateSyncStatus();
          }
        })
    .subscribe();
}
window.addEventListener("online", () => { if (uid && dirty) pushCloud(); });

/* ================= Auth + boot ================= */
const authScreen = document.getElementById("authScreen");
let authMode = "signin";
document.getElementById("aToggle").onclick = () => {
  authMode = authMode === "signin" ? "signup" : "signin";
  document.getElementById("aGo").textContent = authMode === "signin" ? "Sign in" : "Create account";
  document.getElementById("aToggle").textContent = authMode === "signin"
    ? "New here? Create an account" : "Already have an account? Sign in";
  document.getElementById("authSub").textContent = authMode === "signin"
    ? "Sign in to your planner" : "Your own planner — separate from anyone else's";
  document.getElementById("authErr").textContent = "";
};
document.getElementById("aGo").onclick = async () => {
  const email = document.getElementById("aEmail").value.trim();
  const pass = document.getElementById("aPass").value;
  const err = document.getElementById("authErr");
  if (!email || pass.length < 6) { err.textContent = "Enter your email and a password of 6+ characters."; return; }
  err.textContent = "";
  const btn = document.getElementById("aGo");
  btn.disabled = true;
  const { error } = authMode === "signup"
    ? await supa.auth.signUp({ email, password: pass })
    : await supa.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false;
  if (error) err.textContent = error.message;
};
document.getElementById("aPass").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") document.getElementById("aGo").click();
});
document.getElementById("mSignOut").onclick = async () => {
  closeMenu();
  if (confirm("Sign out of the planner on this device?")) await supa.auth.signOut();
};

function startApp(session) {
  uid = session.user.id;
  authScreen.classList.remove("open");
  data = loadLocal();
  render();
  gridWrap.scrollTop = Math.max(0, (8 - data.settings.dayStart) * SLOT_H() - 10);
  initialCloudSync();
  subscribeRealtime();
}
async function boot() {
  restoreHandle();
  if (!supa) {   // client library unreachable (first load offline) — run on this device only
    data = loadLocal(); render();
    return;
  }
  const { data: { session } } = await supa.auth.getSession();
  if (session) startApp(session);
  else { render(); authScreen.classList.add("open"); }
  supa.auth.onAuthStateChange((ev, sess) => {
    if (sess && !uid) startApp(sess);
    if (ev === "SIGNED_OUT") { uid = null; location.reload(); }
  });
}
boot();

/* ================= PWA ================= */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js");
}
let installPrompt = null;
const mInstall = document.getElementById("mInstall");
window.addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault();
  installPrompt = ev;
  mInstall.style.display = "";
});
mInstall.onclick = async () => {
  closeMenu();
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  mInstall.style.display = "none";
};
window.addEventListener("appinstalled", () => { mInstall.style.display = "none"; });
