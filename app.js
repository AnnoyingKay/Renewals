/* Renewals: a private household app for dates, costs and reminders.
   Data lives in Firebase (same project and sign in as Shelf, Musicbox and SavePoint). */
import * as L from './logic.js';

export const APP_VER = 1;
const FB_VER = '10.14.1';
const COL = { items: 'renewals', cars: 'renewalsCars', history: 'renewalsHistory' };
const CACHE_KEY = 'renewals.cache.v1', SYNC_KEY = 'renewals.lastSync', THEME_KEY = 'renewals.theme';
const THEMES = [['auto', 'Automatic'], ['calm', 'Calm'], ['sand', 'Sand'], ['slate', 'Slate'], ['night', 'Night']];
const FILTERS = [['all', 'All'], ['car', 'Car'], ['subscription', 'Subscriptions']];
const HIST_FILTERS = [['all', 'All'], ['carService', 'Service'], ['carInsurance', 'Insurance'], ['nct', 'NCT'], ['motorTax', 'Motor tax'], ['subscription', 'Subscriptions']];

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => L.todayISO();
const now = () => Date.now();

const S = {
  tab: 'due', view: 'list', filter: 'all', hfilter: 'all',
  user: null, ready: false, denied: false, fbError: '',
  items: [], cars: [], history: [], loaded: { items: false, cars: false, history: false },
  lastSync: 0, syncMsg: '', adv: false
};
try { S.lastSync = +localStorage.getItem(SYNC_KEY) || 0; } catch (e) {}
let form = null, doneForm = null, FB = null, unsubs = [], installEvt = null, rolling = false, rollFailed = 0;

/* ---------- small helpers ---------- */
const carById = id => S.cars.find(c => c.id === id);
const carName = id => { const c = carById(id); return c ? c.name : ''; };
const itemById = id => S.items.find(i => i.id === id);
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}
function num(v) {
  let s = String(v == null ? '' : v).replace(/[€\s]/g, '');
  if (!s) return null;
  s = (s.includes(',') && !s.includes('.')) ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}
/* Kilometres: any commas, dots or spaces are thousand separators. */
function km(v) {
  const s = String(v == null ? '' : v).replace(/[\s,.]/g, '');
  if (!s) return null;
  return /^\d+$/.test(s) ? +s : NaN;
}
const money = L.fmtMoney;
function itemTitle(d) {
  const c = L.catLabel(d.category), car = d.carId ? carName(d.carId) : '';
  return car ? c + ' (' + car + ')' : c;
}
const ICONS = {
  due: '<path d="M4 6h16v14H4z"/><path d="M4 10h16M8 3v4M16 3v4M9 15l2 2 4-4"/>',
  subs: '<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  cars: '<path d="M5 16V12l2-5h10l2 5v4M3 16h18v3H3zM7 19v2M17 19v2"/><circle cx="7.5" cy="13.5" r=".6"/><circle cx="16.5" cy="13.5" r=".6"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'
};
const TABS = [['due', 'Due'], ['subs', 'Subs'], ['cars', 'Cars'], ['history', 'History'], ['settings', 'Settings']];

/* ---------- Firebase ---------- */
async function fbInit() {
  if (FB) return FB;
  let cfg;
  try { cfg = (await import('./firebase-config.js')).default; } catch (e) { S.fbError = 'The Firebase settings file is missing.'; return null; }
  try {
    const base = 'https://www.gstatic.com/firebasejs/' + FB_VER + '/';
    const [A0, Au, F] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
    const app = A0.getApps().length ? A0.getApp() : A0.initializeApp(cfg);
    FB = { A: Au, F, auth: Au.getAuth(app), db: F.getFirestore(app) };
    S.fbError = '';
    FB.A.onAuthStateChanged(FB.auth, u => {
      const prev = S.user && S.user.uid;
      S.user = u; S.ready = true;
      if (u) { if (prev !== u.uid) listen(); }
      else { stopListening(); S.items = []; S.cars = []; S.history = []; S.loaded = { items: false, cars: false, history: false }; try { localStorage.removeItem(CACHE_KEY); } catch (e) {} }
      render();
    });
  } catch (e) { FB = null; S.fbError = 'Could not load the sync service. Check your connection.'; }
  return FB;
}
function stopListening() { unsubs.forEach(u => { try { u(); } catch (e) {} }); unsubs = []; }
function listen() {
  stopListening();
  const { F, db } = FB;
  const watch = (key, q) => unsubs.push(F.onSnapshot(q, snap => {
    /* A snapshot answered only from the empty local copy says nothing yet, so it is ignored. */
    if (snap.metadata.fromCache && !snap.metadata.hasPendingWrites) return;
    S[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    S.loaded[key] = true; S.denied = false;
    if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) markSynced();
    saveCache(); render();
    if (key === 'items') maybeAutoRoll();
  }, err => {
    if (err && err.code === 'permission-denied') { S.denied = true; render(); }
    else { S.syncMsg = 'Could not reach the server.'; paintSync(); }
  }));
  watch('items', F.collection(db, COL.items));
  watch('cars', F.collection(db, COL.cars));
  watch('history', F.query(F.collection(db, COL.history), F.orderBy('doneAt', 'desc'), F.limit(400)));
}
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: S.user && S.user.uid, items: S.items, cars: S.cars, history: S.history.slice(0, 300) })); } catch (e) {}
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c) { S.items = c.items || []; S.cars = c.cars || []; S.history = c.history || []; }
  } catch (e) {}
}
function markSynced() {
  S.lastSync = now(); S.syncMsg = '';
  try { localStorage.setItem(SYNC_KEY, String(S.lastSync)); } catch (e) {}
  paintSync();
}
function syncText() {
  if (S.syncMsg) return S.syncMsg;
  if (!navigator.onLine) return 'Offline. Showing the last saved copy.';
  if (!S.lastSync) return 'Not synced yet.';
  const d = new Date(S.lastSync), t = d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false });
  return 'Last synced ' + (L.todayISO(d) === today() ? 'today ' + t : d.getDate() + ' ' + L.fmtDay(L.todayISO(d)).split(' ')[2] + ', ' + t);
}
function paintSync() { const e = $('#syncStatus'); if (e) e.textContent = syncText(); }
async function syncNow() {
  if (!navigator.onLine) { S.syncMsg = 'Offline. Try again when you are online.'; paintSync(); return; }
  const f = await fbInit(); if (!f || !S.user) { toast('Sign in first.'); return; }
  S.syncMsg = 'Syncing…'; paintSync();
  try {
    await f.F.waitForPendingWrites(f.db);
    await Promise.all(Object.values(COL).map(c => f.F.getDocsFromServer(f.F.collection(f.db, c))));
    markSynced();
  } catch (e) { S.syncMsg = 'Sync failed. Try again in a moment.'; paintSync(); }
}
async function signIn() {
  const f = await fbInit(); if (!f) { toast(S.fbError || 'Sync is not available.'); return; }
  try { await f.A.signInWithPopup(f.auth, new f.A.GoogleAuthProvider()); }
  catch (e) {
    const c = (e && e.code) || '';
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
    toast(c === 'auth/popup-blocked' ? 'The sign in window was blocked. Open Renewals on its own address once and sign in there.' : c === 'auth/network-request-failed' ? 'No connection. Try again when you are online.' : 'Sign in failed (' + (c || 'unknown') + ').');
  }
}
async function signOut() { const f = await fbInit(); if (f) { try { await f.A.signOut(f.auth); } catch (e) {} } }
function canWrite() {
  if (!S.user) { toast('Sign in first.'); return false; }
  if (!navigator.onLine) { toast('You are offline. Try again when you are online.'); return false; }
  return true;
}
const ref = (name, id) => FB.F.doc(FB.db, name, id);
const newId = name => FB.F.doc(FB.F.collection(FB.db, name)).id;

/* ---------- files ---------- */
async function saveFile(name, mime, text) {
  const file = new File([text], name, { type: mime });
  const touch = window.matchMedia && matchMedia('(pointer:coarse)').matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function addToCalendar(list, name) {
  if (!list.length) { toast('Nothing to add.'); return; }
  saveFile('renewals-' + L.fileSlug(name) + '.ics', 'text/calendar', L.icsFor(list, carName));
}
async function exportBackup() {
  const f = await fbInit(); if (!f || !S.user) { toast('Sign in first.'); return; }
  try {
    const get = c => (navigator.onLine ? f.F.getDocsFromServer : f.F.getDocs)(f.F.collection(f.db, c)).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));
    const [items, cars, history] = await Promise.all([get(COL.items), get(COL.cars), get(COL.history)]);
    await saveFile('renewals-backup-' + today() + '.json', 'application/json', JSON.stringify({ app: 'Renewals', version: APP_VER, exportedAt: new Date().toISOString(), cars, items, history }, null, 2));
  } catch (e) { toast('Could not read the data for a backup. Try again online.'); }
}

/* ---------- subscriptions bill themselves ---------- */
async function maybeAutoRoll() {
  if (rolling || !S.user || !FB || !navigator.onLine || now() - rollFailed < 60000 || !S.loaded.items) return;
  const t = today(), jobs = S.items.map(i => ({ i, r: L.autoRoll(i, t) })).filter(x => x.r);
  if (!jobs.length) return;
  rolling = true;
  try {
    for (const { i, r } of jobs) {
      const b = FB.F.writeBatch(FB.db);
      r.billed.forEach(d => b.set(ref(COL.history, i.id + '_' + d), histDoc(i, { dueDate: d, doneAt: d, amountPaid: i.amount == null ? null : i.amount, kind: 'auto' })));
      b.update(ref(COL.items, i.id), { dueDate: r.next, updatedAt: now() });
      await b.commit();
    }
  } catch (e) { rollFailed = now(); } finally { rolling = false; }
}
function histDoc(item, x) {
  return { itemId: item.id, title: item.title, category: item.category, carId: item.carId || null, provider: item.provider || '', dueDate: x.dueDate, doneAt: x.doneAt,
    amountPaid: x.amountPaid == null ? null : x.amountPaid, mileage: x.mileage == null ? null : x.mileage, note: x.note || '', kind: x.kind || 'done', addedBy: S.user.uid, createdAt: now() };
}

/* ---------- rendering ---------- */
function render() {
  $('#tabs').innerHTML = TABS.map(([k, n]) => `<button type="button" data-tab="${k}" class="${S.tab === k ? 'on' : ''}" ${S.tab === k ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>${n}</button>`).join('');
  $('#fab').hidden = !(S.user && ['due', 'subs', 'cars'].includes(S.tab));
  $('#fab').setAttribute('aria-label', S.tab === 'cars' ? 'Add car' : S.tab === 'subs' ? 'Add subscription' : 'Add item');
  const gate = gateHTML();
  const body = gate || (S.tab === 'due' ? dueHTML() : S.tab === 'subs' ? subsHTML() : S.tab === 'cars' ? carsHTML() : S.tab === 'history' ? historyHTML() : '');
  if (S.tab === 'settings') $('#main').innerHTML = settingsHTML(); else $('#main').innerHTML = body;
  $('#hello').textContent = helloText();
  const open = !$('#sheet').hidden; if (open) redrawSheet(true);
}
function gateHTML() {
  if (S.tab === 'settings') return '';
  if (S.fbError && !S.user && !S.items.length) return `<div class="empty">${esc(S.fbError)}</div>`;
  if (!S.ready && !S.items.length && !S.cars.length) return '<div class="empty">Loading…</div>';
  if (S.ready && !S.user) return `<div class="sec"><h3 class="big">Sign in</h3><p class="note">Renewals is private to the two of you. Sign in with the same Google account you use for Shelf, Musicbox and SavePoint.</p><div class="setrow"><button class="btn p wide" data-act="signin" type="button">Continue with Google</button></div></div>`;
  if (S.denied) return `<div class="sec"><h3 class="big">This account is not on the household list</h3><p class="note">Signed in as ${esc(S.user && S.user.email || '')}. Use the Google account that is allowed into Musicbox and SavePoint.</p><div class="setrow"><button class="btn" data-act="signout" type="button">Sign out</button></div></div>`;
  if (S.user && !S.loaded.items && !S.items.length) return '<div class="empty">Loading…</div>';
  return '';
}
function helloText() {
  if (!S.user || S.denied) return '';
  const t = today();
  if (S.tab === 'due') {
    const rows = L.dueList(S.items, S.cars, t), over = rows.filter(r => r.level === 3).length, soon = rows.filter(r => r.level === 2).length;
    return over ? over + ' overdue' + (soon ? ', ' + soon + ' due very soon' : '') : soon ? soon + ' due very soon' : rows.length ? 'Nothing urgent' : 'All clear for the next 60 days';
  }
  if (S.tab === 'subs') { const x = L.subTotals(S.items); return x.count ? x.count + ' subscription' + (x.count === 1 ? '' : 's') + ', ' + money(x.month) + ' a month' : ''; }
  if (S.tab === 'cars') return S.cars.length ? S.cars.length + (S.cars.length === 1 ? ' car' : ' cars') : '';
  return '';
}

function rowHTML(r, o) {
  o = o || {};
  const it = r.item, car = carById(it.carId), lvl = L.LEVELS[r.level];
  const sub = [it.provider, !o.noCar && car && car.name].filter(Boolean).join(' · ');
  let km = '';
  if (r.kmLeft != null) km = r.kmLeft > 0 ? L.fmtKm(r.kmLeft) + ' to go' : L.fmtKm(-r.kmLeft) + ' over';
  const rel = (r.byKm && r.level >= 1) ? (r.level === 3 ? 'Service overdue' : 'Service due soon') : L.relText(r.days);
  return `<button class="row ${lvl}" type="button" data-open="${esc(it.id)}"><span class="bar"></span><span class="mid"><div class="t">${esc(it.title)}</div><div class="s">${esc(sub) || '&nbsp;'}</div>${km && o.km !== false ? `<div class="s">${esc(km)}</div>` : ''}</span><span class="r"><div class="when">${esc(L.fmtDay(it.dueDate))}</div><span class="rel ${lvl}">${esc(rel)}</span>${it.amount != null && it.amount !== '' ? `<div class="amt">${esc(money(it.amount))}</div>` : ''}</span></button>`;
}
function dueHTML() {
  const t = today();
  const all = L.dueList(S.items, S.cars, t);
  const rows = all.filter(r => S.filter === 'all' || (S.filter === 'car' ? L.isCar(r.item.category) : r.item.category === 'subscription'));
  const head = `<div class="seg two" role="group" aria-label="View"><button type="button" data-view="list" class="${S.view === 'list' ? 'on' : ''}">Next 60 days</button><button type="button" data-view="week" class="${S.view === 'week' ? 'on' : ''}">Weekly summary</button></div>
  <div class="chips">${FILTERS.map(([k, n]) => `<button type="button" data-filter="${k}" class="${S.filter === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  if (!S.items.length) return head + `<div class="empty">Nothing tracked yet.<br>Tap + to add a car item or a subscription.</div>`;
  if (S.view === 'week') return head + weekHTML(rows);
  if (!rows.length) return head + '<div class="empty">Nothing due in the next 60 days.</div>';
  return head + rows.map(r => rowHTML(r)).join('');
}
function weekHTML(rows) {
  const g = L.weekGroups(rows), total30 = L.dueTotal(rows, 30);
  const sec = (name, list) => list.length ? `<div class="grp">${name}</div>${list.map(r => rowHTML(r)).join('')}` : '';
  const cal = rows.filter(r => r.days >= 0 && r.days <= 14).map(r => r.item);
  const out = sec('Overdue', g.overdue) + sec('Next 7 days', g.week) + sec('8 to 14 days', g.next) + sec('Due by mileage', g.flagged);
  return `<div class="sec"><div class="stat"><div><b>${rows.filter(r => r.days < 0).length}</b><span>overdue</span></div><div><b>${rows.filter(r => r.days >= 0 && r.days <= 7).length}</b><span>due in 7 days</span></div></div>
    <p class="note" style="margin:10px 0 0">${total30 ? 'Money going out in the next 30 days, including anything overdue: ' + esc(money(total30)) + '.' : 'No amounts due in the next 30 days.'}</p></div>
    ${out || '<div class="empty">Nothing in the next two weeks.</div>'}
    ${cal.length ? '<div class="setrow"><button class="btn wide" type="button" data-act="calweek">Add these to my calendar</button></div>' : ''}`;
}

function subsHTML() {
  const subs = S.items.filter(i => i.category === 'subscription' && i.status === 'active').sort((a, b) => L.monthlyCost(b) - L.monthlyCost(a) || a.title.localeCompare(b.title));
  if (!subs.length) return '<div class="empty">No subscriptions yet.<br>Tap + to add one.</div>';
  const x = L.subTotals(S.items);
  const warn = x.unusedMonth > 0 ? `<div class="warn">Not in use: ${esc(money(x.unusedMonth))} a month, ${esc(money(x.unusedYear))} a year.</div>` : '';
  return `<div class="sec"><div class="stat"><div><b>${esc(money(x.month))}</b><span>a month</span></div><div><b>${esc(money(x.year))}</b><span>a year</span></div></div>${warn}</div>` +
    subs.map(i => {
      const mc = L.monthlyCost(i), unused = i.stillUsing === false;
      return `<div class="row plain"><button type="button" class="mid" data-open="${esc(i.id)}" style="all:unset;flex:1;min-width:0;padding:10px 0 10px 12px;cursor:pointer;display:block"><div class="t">${esc(i.title)}</div><div class="s">${esc([i.provider, L.repeatText(i.repeat)].filter(Boolean).join(' · '))}</div><div class="s">Next bill ${esc(L.fmtDay(i.dueDate))}</div></button>
      <span class="r"><div class="when">${esc(money(i.amount))}</div><div class="amt">${esc(money(mc))} a month</div><button type="button" class="use ${unused ? 'no' : ''}" data-use="${esc(i.id)}" aria-label="Still using ${esc(i.title)}: ${unused ? 'no' : 'yes'}. Tap to change">Still using: ${unused ? 'No' : 'Yes'}</button></span></div>`;
    }).join('');
}

function carsHTML() {
  if (!S.cars.length) return '<div class="empty">No cars yet.<br>Tap + to add one.</div>';
  const t = today();
  return S.cars.slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => {
    const rows = S.items.filter(i => i.carId === c.id && i.status === 'active').map(i => ({ item: i, ...L.info(i, t, c) })).sort((a, b) => a.item.dueDate.localeCompare(b.item.dueDate));
    const odo = c.currentMileage != null ? L.fmtKm(c.currentMileage) + (c.mileageUpdatedAt ? ' <span class="note">updated ' + esc(L.fmtDay(L.todayISO(new Date(c.mileageUpdatedAt)))) + '</span>' : '') : '<span class="note">No mileage yet</span>';
    return `<div class="sec"><h3 class="big">${esc(c.name)}${c.reg ? ' <span class="note">' + esc(c.reg) + '</span>' : ''}</h3>
      <div class="kv"><span>Odometer</span><span>${odo}</span></div>
      <div class="setrow"><button class="btn p" type="button" data-mileage="${esc(c.id)}">Update mileage</button><button class="btn" type="button" data-editcar="${esc(c.id)}">Edit</button><button class="btn" type="button" data-addfor="${esc(c.id)}">Add item</button></div>
      ${rows.length ? rows.map(r => rowHTML(r, { noCar: true })).join('') : '<p class="note">No items for this car yet.</p>'}</div>`;
  }).join('');
}

function historyHTML() {
  const list = S.history.filter(h => S.hfilter === 'all' || h.category === S.hfilter).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const chips = `<div class="chips">${HIST_FILTERS.map(([k, n]) => `<button type="button" data-hfilter="${k}" class="${S.hfilter === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  let out = chips;
  if (!list.length) out += '<div class="empty">Nothing in the history yet.<br>Payments appear here when you tap Done, and subscriptions add themselves.</div>';
  else {
    const years = [...new Set(list.map(h => (h.doneAt || '').slice(0, 4)))];
    out += years.map(y => {
      const ys = list.filter(h => (h.doneAt || '').slice(0, 4) === y), tot = ys.reduce((s, h) => s + (+h.amountPaid || 0), 0);
      return `<div class="grp">${esc(y)}${tot ? ' · ' + esc(money(tot)) : ''}</div>` + ys.map(h => `<div class="row plain"><span class="mid"><div class="t">${esc(h.title)}</div><div class="s">${esc(L.fmtDay(h.doneAt, true))}${h.kind === 'auto' ? ' · billed' : ''}${h.mileage != null ? ' · ' + esc(L.fmtKm(h.mileage)) : ''}${h.note ? ' · ' + esc(h.note) : ''}</div></span><span class="r"><div class="when">${h.amountPaid != null ? esc(money(h.amountPaid)) : ''}</div></span></div>`).join('');
    }).join('');
  }
  const ended = S.items.filter(i => i.status === 'done').sort((a, b) => a.title.localeCompare(b.title));
  if (ended.length) out += `<div class="grp">Ended items</div>` + ended.map(i => `<div class="row plain"><span class="mid"><div class="t">${esc(i.title)}</div><div class="s">${esc(L.catLabel(i.category))}${i.provider ? ' · ' + esc(i.provider) : ''}</div></span><span class="r"><button class="btn" type="button" data-reopen="${esc(i.id)}">Reopen</button></span></div>`).join('');
  return out;
}

function settingsHTML() {
  const theme = localStorage.getItem(THEME_KEY) || 'auto';
  const sync = !S.ready ? '<p class="note">Checking…</p>' : S.fbError && !S.user ? `<p class="note">${esc(S.fbError)}</p>` : !S.user
    ? `<p class="note">Sign in with the same Google account as the other apps.</p><div class="setrow"><button class="btn p" type="button" data-act="signin">Continue with Google</button></div>`
    : `<p class="note">Signed in as ${esc(S.user.email || '')}.<br><span id="syncStatus">${esc(syncText())}</span></p>
       <div class="setrow"><button class="btn p" type="button" data-act="syncnow">Sync now</button><button class="btn" type="button" data-act="export">Export backup</button><button class="btn" type="button" data-act="signout">Sign out</button></div>`;
  return `<div class="sec"><h3>Renewals version ${APP_VER}</h3></div>
  <div class="sec"><h3>Profile</h3><div class="lbl">Theme</div><div class="chips" style="flex-wrap:wrap">${THEMES.map(([k, n]) => `<button type="button" data-theme="${k}" class="${theme === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    ${installEvt ? '<div class="setrow"><button class="btn" type="button" data-act="install">Install app</button></div>' : ''}</div>
  <div class="sec"><h3>Sync</h3>${sync}</div>
  <details class="sec adv"${S.adv ? ' open' : ''}><summary><h3>Advanced</h3></summary>
    <p class="note">Renewals shares the Firebase project and sign in used by Shelf, Musicbox and SavePoint. Access is limited to the two household accounts.</p>
    <p class="note">Firebase project<br><code>shelf-b5282</code></p>
    <p class="note">Account ID<br><code>${S.user ? esc(S.user.uid) : 'Shown when you sign in.'}</code></p></details>`;
}

/* ---------- sheets ---------- */
function openSheet(html) { const s = $('#sheet'); s.innerHTML = html; s.hidden = false; s.scrollTop = 0; }
function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; form = null; doneForm = null; S.sheet = null; }
function redrawSheet(keep) {
  const s = $('#sheet'), sc = s.scrollTop, k = S.sheet;
  if (!k) return;
  if (k.type === 'detail') { const it = itemById(k.id); if (!it) { closeSheet(); return; } s.innerHTML = detailHTML(it); }
  else if (k.type === 'item') s.innerHTML = itemFormHTML();
  else if (k.type === 'done') s.innerHTML = doneHTML();
  else if (k.type === 'car') s.innerHTML = carFormHTML();
  else if (k.type === 'mileage') s.innerHTML = mileageHTML();
  if (keep) s.scrollTop = sc;
}
function field(label, inner, note) { return `<div class="f"><label>${label}</label>${inner}${note ? `<div class="note">${note}</div>` : ''}</div>`; }

/* detail */
function detailHTML(it) {
  const t = today(), car = carById(it.carId), i = L.info(it, t, car), hist = S.history.filter(h => h.itemId === it.id).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const last = hist[0];
  const kv = (k, v) => v ? `<div class="kv"><span>${k}</span><span>${v}</span></div>` : '';
  const kmTxt = i.kmLeft != null ? (i.kmLeft > 0 ? esc(L.fmtKm(i.kmLeft)) + ' to go' : esc(L.fmtKm(-i.kmLeft)) + ' over') : '';
  return `<div class="bar-top"><button class="btn" type="button" data-act="close">Close</button><h2>${esc(it.title)}</h2><button class="btn" type="button" data-act="edit">Edit</button></div>
  <div class="form"><div class="sec">
    ${kv('Status', `<span class="rel ${L.LEVELS[i.level]}">${esc(it.status === 'done' ? 'Ended' : (i.byKm && i.level >= 1 ? 'Service due by mileage' : L.relText(i.days)))}</span>`)}
    ${kv('Due', esc(L.fmtDay(it.dueDate, true)))}
    ${kv('Category', esc(L.catLabel(it.category)))}${kv('Car', esc(car ? car.name + (car.reg ? ' (' + car.reg + ')' : '') : ''))}
    ${kv('Provider', esc(it.provider))}${kv('Amount', esc(money(it.amount)))}${kv('Repeats', esc(L.repeatText(it.repeat)))}
    ${kv('Service due at', it.dueMileage != null ? esc(L.fmtKm(it.dueMileage)) + (kmTxt ? '<br><span class="note">' + kmTxt + '</span>' : '') : '')}
    ${kv('Odometer', car && car.currentMileage != null ? esc(L.fmtKm(car.currentMileage)) : '')}
    ${kv('Reminders', esc((it.leadDays || []).slice().sort((a, b) => b - a).join(', ') + ' days before'))}
    ${it.category === 'subscription' ? kv('Still using', it.stillUsing === false ? 'No' : 'Yes') : ''}
    ${kv('Notes', esc(it.notes))}
    ${kv('Last paid', last ? esc((last.amountPaid != null ? money(last.amountPaid) + ' on ' : '') + L.fmtDay(last.doneAt, true)) : '')}
  </div>
  ${it.status === 'active' ? `<div class="setrow"><button class="btn p wide" type="button" data-act="done">${it.repeat && it.repeat.type !== 'oneOff' ? 'Done, roll to next' : 'Done'}</button></div>` : '<div class="setrow"><button class="btn p wide" type="button" data-reopen="' + esc(it.id) + '">Reopen</button></div>'}
  <div class="setrow"><button class="btn wide" type="button" data-act="cal">Add to calendar</button></div>
  ${hist.length > 1 ? `<div class="sec"><h3>Earlier</h3>${hist.slice(1, 6).map(h => `<div class="kv"><span>${esc(L.fmtDay(h.doneAt, true))}</span><span>${esc(money(h.amountPaid))}</span></div>`).join('')}</div>` : ''}
  ${it.status === 'active' && it.repeat && it.repeat.type !== 'oneOff' ? '<div class="setrow"><button class="btn d" type="button" data-act="stop">Stop tracking</button></div>' : ''}</div>`;
}
function openDetail(id) { S.sheet = { type: 'detail', id }; openSheet(detailHTML(itemById(id))); }

/* item form */
function newItemForm(pre) {
  pre = pre || {};
  const cat = pre.category || 'carService', cfg = L.CATS[cat], carId = pre.carId || (L.isCar(cat) && S.cars.length === 1 ? S.cars[0].id : '');
  return { id: null, isNew: true, err: '', d: { category: cat, title: '', titleTouched: false, carId, provider: '', amount: '', dueDate: '', repeatType: cfg.repeat.type, repeatN: cfg.repeat.n || 12,
    leadDays: L.defaultLead(cat, cfg.repeat), dueMileage: '', serviceIntervalKm: '', stillUsing: true, notes: '' } };
}
function editItemForm(it) {
  const r = it.repeat || { type: 'oneOff' };
  return { id: it.id, isNew: false, err: '', d: { category: it.category, title: it.title, titleTouched: true, carId: it.carId || '', provider: it.provider || '', amount: it.amount == null ? '' : String(it.amount),
    dueDate: it.dueDate, repeatType: r.type, repeatN: r.n || 12, leadDays: (it.leadDays || []).slice(), dueMileage: it.dueMileage == null ? '' : String(it.dueMileage),
    serviceIntervalKm: it.serviceIntervalKm == null ? '' : String(it.serviceIntervalKm), stillUsing: it.stillUsing !== false, notes: it.notes || '', anchorDay: it.anchorDay } };
}
function openItemForm(f) { form = f; S.sheet = { type: 'item' }; openSheet(itemFormHTML()); }
function itemFormHTML() {
  const d = form.d, car = L.isCar(d.category), sub = d.category === 'subscription';
  const cats = Object.entries(L.CATS).map(([k, c]) => `<button type="button" data-cat="${k}" class="${d.category === k ? 'on' : ''}">${c.label}</button>`).join('');
  const carSel = car ? (S.cars.length ? field('Car', `<select data-f="carId"><option value="">Choose a car</option>${S.cars.map(c => `<option value="${esc(c.id)}" ${d.carId === c.id ? 'selected' : ''}>${esc(c.name)}${c.reg ? ' (' + esc(c.reg) + ')' : ''}</option>`).join('')}</select>`)
    : `<div class="warn">Add a car first. Close this and tap + on the Cars tab.</div>`) : '';
  const rep = [['yearly', 'Yearly'], ['monthly', 'Monthly'], ['everyN', 'Every N months'], ['oneOff', 'One off']];
  return `<div class="bar-top"><button class="btn" type="button" data-act="close">Cancel</button><h2>${form.isNew ? 'Add item' : 'Edit item'}</h2><button class="btn p" type="button" data-act="saveitem">Save</button></div>
  <div class="form">
  <div class="f"><span class="lbl">Type</span><div class="seg">${cats}</div></div>
  ${carSel}
  ${field('Name', `<input data-f="title" value="${esc(d.title)}" placeholder="${esc(itemTitle(d))}" autocomplete="off">`)}
  ${field(car ? 'Provider (garage, insurer, test centre)' : 'Provider', `<input data-f="provider" value="${esc(d.provider)}" autocomplete="off">`)}
  <div class="g2">${field('Amount (€)', `<input data-f="amount" value="${esc(d.amount)}" inputmode="decimal" placeholder="0.00">`)}${field(sub ? 'Next billing date' : 'Due date', `<input type="date" data-f="dueDate" value="${esc(d.dueDate)}">`)}</div>
  ${field('Repeats', `<select data-f="repeatType">${rep.map(([k, n]) => `<option value="${k}" ${d.repeatType === k ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}
  ${d.repeatType === 'everyN' ? field('Number of months', `<input data-f="repeatN" value="${esc(d.repeatN)}" inputmode="numeric">`, 'For example 24 for an NCT every two years.') : ''}
  ${d.category === 'carService' ? `<div class="g2">${field('Service due at (km)', `<input data-f="dueMileage" value="${esc(d.dueMileage)}" inputmode="numeric" placeholder="optional">`)}${field('Service every (km)', `<input data-f="serviceIntervalKm" value="${esc(d.serviceIntervalKm)}" inputmode="numeric" placeholder="optional">`)}</div>
    <p class="note">The service is flagged as soon as the date or the mileage is close, whichever comes first.</p>` : ''}
  ${sub ? `<div class="f"><span class="lbl">Still using it?</span><div class="seg two"><button type="button" data-use-set="1" class="${d.stillUsing ? 'on' : ''}">Yes</button><button type="button" data-use-set="0" class="${d.stillUsing ? '' : 'on'}">No</button></div></div>` : ''}
  <div class="f"><span class="lbl">Remind me before</span><div class="chips" style="flex-wrap:wrap">${L.LEAD_OPTIONS.map(n => `<button type="button" data-lead="${n}" class="${d.leadDays.includes(n) ? 'on' : ''}">${n} ${n === 1 ? 'day' : 'days'}</button>`).join('')}</div>
    <div class="note">These become alarms in the calendar file. Use Add to calendar on the item to get them on your phone.</div></div>
  ${field('Notes', `<textarea data-f="notes">${esc(d.notes)}</textarea>`, 'Do not enter policy, card, bank or PPS numbers. They are not stored.')}
  ${form.err ? `<div class="err">${esc(form.err)}</div>` : ''}
  ${form.isNew ? '' : '<div class="setrow"><button class="btn d" type="button" data-act="deleteitem">Delete this item</button></div>'}
  </div>`;
}
function readForm() {
  const d = form.d;
  const amount = num(d.amount), dueKm = km(d.dueMileage), step = km(d.serviceIntervalKm), n = Math.floor(num(d.repeatN) || 0);
  const fail = m => { form.err = m; return null; };
  if (!L.isISO(d.dueDate)) return fail('Choose a due date.');
  if (isNaN(amount) || (amount != null && amount < 0)) return fail('The amount does not look right.');
  if (L.isCar(d.category) && !d.carId) return fail('Choose a car, or add one on the Cars tab first.');
  if (d.repeatType === 'everyN' && !(n >= 1 && n <= 120)) return fail('Enter a number of months between 1 and 120.');
  if (!d.leadDays.length) return fail('Pick at least one reminder.');
  if (isNaN(dueKm) || isNaN(step)) return fail('The mileage does not look right.');
  const title = (d.title || '').trim() || itemTitle(d);
  if ([title, d.provider, d.notes].some(L.looksSensitive)) return fail('That looks like a policy, card, bank or PPS number. Those are not stored. Please remove it.');
  const repeat = d.repeatType === 'everyN' ? { type: 'everyN', n } : { type: d.repeatType };
  const out = { category: d.category, title, provider: (d.provider || '').trim(), amount, dueDate: d.dueDate, repeat, anchorDay: L.parseISO(d.dueDate).d,
    leadDays: d.leadDays.slice().sort((a, b) => b - a), notes: (d.notes || '').trim(), carId: L.isCar(d.category) ? d.carId : null,
    dueMileage: d.category === 'carService' ? dueKm : null, serviceIntervalKm: d.category === 'carService' ? step : null, stillUsing: d.category === 'subscription' ? !!d.stillUsing : null };
  if (!form.isNew) { const was = itemById(form.id); if (was && was.dueDate === d.dueDate && was.anchorDay) out.anchorDay = was.anchorDay; }
  return out;
}
async function saveItem() {
  if (!canWrite()) return;
  await fbInit();
  form.err = '';
  const data = readForm();
  if (!data) { redrawSheet(true); return; }
  try {
    if (form.isNew) await FB.F.setDoc(ref(COL.items, newId(COL.items)), { ...data, status: 'active', addedBy: S.user.uid, createdAt: now(), updatedAt: now() });
    else await FB.F.updateDoc(ref(COL.items, form.id), { ...data, updatedAt: now() });
    const id = form.id; closeSheet(); toast('Saved.');
    if (id && itemById(id)) openDetail(id);
  } catch (e) { form.err = 'Could not save. Try again.'; redrawSheet(true); }
}

/* done */
/* A service counts from the day it was done. Everything else keeps to its own cycle, so renewing early does not shift the date. */
function defaultNext(it, doneOn) {
  if (it.category === 'carService') return L.nextDue({ ...it, dueDate: doneOn, anchorDay: L.parseISO(doneOn).d }, today());
  return L.nextDue(it, today());
}
function openDone(id) {
  const it = itemById(id), car = carById(it.carId), t = today();
  const repeating = it.repeat && it.repeat.type !== 'oneOff';
  const next = repeating ? defaultNext(it, t) : null;
  doneForm = { id, paid: it.amount == null ? '' : String(it.amount), doneOn: t, next, defNext: next, nextTouched: false, odo: car && car.currentMileage != null ? String(car.currentMileage) : '',
    nextKm: '', note: '', err: '' };
  S.sheet = { type: 'done' }; openSheet(doneHTML());
}
function doneHTML() {
  const f = doneForm, it = itemById(f.id), svc = it.category === 'carService', repeating = it.repeat && it.repeat.type !== 'oneOff';
  const sug = (svc && km(f.odo) != null && !isNaN(km(f.odo)) && it.serviceIntervalKm) ? Math.round(km(f.odo) + it.serviceIntervalKm) : '';
  return `<div class="bar-top"><button class="btn" type="button" data-act="close">Cancel</button><h2>Done</h2><button class="btn p" type="button" data-act="savedone">Save</button></div>
  <div class="form"><p class="note" style="margin-top:0">${esc(it.title)}, due ${esc(L.fmtDay(it.dueDate, true))}</p>
  <div class="g2">${field('Paid (€)', `<input data-d="paid" value="${esc(f.paid)}" inputmode="decimal">`)}${field('Date done', `<input type="date" data-d="doneOn" value="${esc(f.doneOn)}">`)}</div>
  ${repeating ? field('Next due date', `<input type="date" data-d="next" value="${esc(f.next || '')}">`, (it.category === 'carService' ? 'Counted from the day the service was done. Change it if needed.' : 'Filled in from the repeat. Change it if the new date is different.')) : '<p class="note">This is a one off, so it will be marked as done.</p>'}
  ${svc ? `<div class="g2">${field('Odometer now (km)', `<input data-d="odo" value="${esc(f.odo)}" inputmode="numeric" placeholder="optional">`)}${repeating ? field('Next service at (km)', `<input data-d="nextKm" value="${esc(f.nextKm)}" inputmode="numeric" placeholder="${esc(sug)}">`, sug ? 'Left blank, it uses ' + esc(L.fmtKm(sug)) + '.' : '') : ''}</div>` : ''}
  ${field('Note', `<input data-d="note" value="${esc(f.note)}" autocomplete="off">`)}
  ${f.err ? `<div class="err">${esc(f.err)}</div>` : ''}</div>`;
}
async function saveDone() {
  if (!canWrite()) return;
  await fbInit();
  const f = doneForm, it = itemById(f.id), car = carById(it.carId), repeating = it.repeat && it.repeat.type !== 'oneOff', svc = it.category === 'carService';
  const paid = num(f.paid), odo = km(f.odo), nk = km(f.nextKm);
  const fail = m => { f.err = m; redrawSheet(true); };
  if (!L.isISO(f.doneOn)) return fail('Choose the date it was done.');
  if (isNaN(paid) || (paid != null && paid < 0)) return fail('The amount does not look right.');
  if (repeating && !L.isISO(f.next)) return fail('Choose the next due date.');
  if (isNaN(odo) || isNaN(nk)) return fail('The mileage does not look right.');
  if (L.looksSensitive(f.note)) return fail('That looks like a policy, card, bank or PPS number. Those are not stored. Please remove it.');
  try {
    const b = FB.F.writeBatch(FB.db), t = now();
    b.set(ref(COL.history, it.id + '_' + it.dueDate), histDoc(it, { dueDate: it.dueDate, doneAt: f.doneOn, amountPaid: paid, mileage: svc ? odo : null, note: (f.note || '').trim(), kind: 'done' }));
    const up = { updatedAt: t };
    if (paid != null) up.amount = paid;
    if (repeating) {
      up.dueDate = f.next; if (it.category !== 'subscription' || f.next !== f.defNext) up.anchorDay = L.parseISO(f.next).d;
      if (svc) { const base = nk != null ? nk : (odo != null && it.serviceIntervalKm ? odo + it.serviceIntervalKm : null); up.dueMileage = base != null ? Math.round(base) : null; }
    } else up.status = 'done';
    b.update(ref(COL.items, it.id), up);
    if (svc && odo != null && car && (car.currentMileage == null || odo !== car.currentMileage)) b.update(ref(COL.cars, car.id), { currentMileage: odo, mileageUpdatedAt: t });
    await b.commit();
    closeSheet(); toast(repeating ? 'Done. Next due ' + L.fmtDay(f.next, true) + '.' : 'Done.');
  } catch (e) { fail('Could not save. Try again.'); }
}

/* cars */
let carDraft = null;
function openCarForm(id) {
  const c = id ? carById(id) : null;
  carDraft = { id: id || null, name: c ? c.name : '', reg: c ? c.reg || '' : '', mileage: c && c.currentMileage != null ? String(c.currentMileage) : '', err: '' };
  S.sheet = { type: 'car' }; openSheet(carFormHTML());
}
function carFormHTML() {
  const c = carDraft;
  return `<div class="bar-top"><button class="btn" type="button" data-act="close">Cancel</button><h2>${c.id ? 'Edit car' : 'Add car'}</h2><button class="btn p" type="button" data-act="savecar">Save</button></div>
  <div class="form">${field('Name', `<input data-c="name" value="${esc(c.name)}" placeholder="For example Golf" autocomplete="off">`)}
  ${field('Registration', `<input data-c="reg" value="${esc(c.reg)}" placeholder="For example 191-D-12345" autocomplete="off" autocapitalize="characters">`, 'Registration number only. No policy or other numbers.')}
  ${field('Odometer now (km)', `<input data-c="mileage" value="${esc(c.mileage)}" inputmode="numeric" placeholder="optional">`)}
  ${c.err ? `<div class="err">${esc(c.err)}</div>` : ''}
  ${c.id ? '<div class="setrow"><button class="btn d" type="button" data-act="deletecar">Delete this car</button></div>' : ''}</div>`;
}
async function saveCar() {
  if (!canWrite()) return;
  await fbInit();
  const c = carDraft, name = (c.name || '').trim(), odo = km(c.mileage);
  const fail = m => { c.err = m; redrawSheet(true); };
  if (!name) return fail('Give the car a name.');
  if (isNaN(odo)) return fail('The mileage does not look right.');
  if ([name].some(L.looksSensitive)) return fail('That looks like a number that should not be stored.');
  const data = { name, reg: (c.reg || '').trim().toUpperCase(), currentMileage: odo };
  try {
    if (c.id) { const was = carById(c.id); if (was && was.currentMileage !== odo) data.mileageUpdatedAt = now(); await FB.F.updateDoc(ref(COL.cars, c.id), data); }
    else await FB.F.setDoc(ref(COL.cars, newId(COL.cars)), { ...data, mileageUpdatedAt: odo != null ? now() : null, addedBy: S.user.uid, createdAt: now() });
    closeSheet(); toast('Saved.');
  } catch (e) { fail('Could not save. Try again.'); }
}
async function deleteCar() {
  const c = carDraft;
  if (S.items.some(i => i.carId === c.id)) { c.err = 'This car still has items. Delete or move them first.'; redrawSheet(true); return; }
  if (!canWrite() || !confirm('Delete this car?')) return;
  try { await FB.F.deleteDoc(ref(COL.cars, c.id)); closeSheet(); toast('Deleted.'); } catch (e) { c.err = 'Could not delete. Try again.'; redrawSheet(true); }
}
let mileDraft = null;
function openMileage(id) { const c = carById(id); mileDraft = { id, v: c.currentMileage != null ? String(c.currentMileage) : '', err: '' }; S.sheet = { type: 'mileage' }; openSheet(mileageHTML()); }
function mileageHTML() {
  const c = carById(mileDraft.id);
  return `<div class="bar-top"><button class="btn" type="button" data-act="close">Cancel</button><h2>${esc(c.name)}</h2><button class="btn p" type="button" data-act="savemileage">Save</button></div>
  <div class="form">${field('Odometer now (km)', `<input data-m="v" value="${esc(mileDraft.v)}" inputmode="numeric" autofocus>`)}${mileDraft.err ? `<div class="err">${esc(mileDraft.err)}</div>` : ''}</div>`;
}
async function saveMileage() {
  if (!canWrite()) return;
  await fbInit();
  const odo = km(mileDraft.v);
  if (odo == null || isNaN(odo)) { mileDraft.err = 'Enter the odometer reading.'; redrawSheet(true); return; }
  try { await FB.F.updateDoc(ref(COL.cars, mileDraft.id), { currentMileage: odo, mileageUpdatedAt: now() }); closeSheet(); toast('Mileage updated.'); }
  catch (e) { mileDraft.err = 'Could not save. Try again.'; redrawSheet(true); }
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('button,summary'); if (!t) return;
  const D = t.dataset;
  if (D.tab) { S.tab = D.tab; render(); window.scrollTo(0, 0); return; }
  if (D.view) { S.view = D.view; render(); return; }
  if (D.filter) { S.filter = D.filter; render(); return; }
  if (D.hfilter) { S.hfilter = D.hfilter; render(); return; }
  if (D.theme) { try { localStorage.setItem(THEME_KEY, D.theme); } catch (x) {} document.documentElement.dataset.theme = D.theme; render(); return; }
  if (D.open) { openDetail(D.open); return; }
  if (D.use) { if (!canWrite()) return; await fbInit(); const it = itemById(D.use); try { await FB.F.updateDoc(ref(COL.items, it.id), { stillUsing: it.stillUsing === false, updatedAt: now() }); } catch (x) { toast('Could not save.'); } return; }
  if (D.mileage) { openMileage(D.mileage); return; }
  if (D.editcar) { openCarForm(D.editcar); return; }
  if (D.addfor) { await fbInit(); openItemForm(newItemForm({ carId: D.addfor })); return; }
  if (D.reopen) { if (!canWrite()) return; await fbInit(); try { await FB.F.updateDoc(ref(COL.items, D.reopen), { status: 'active', updatedAt: now() }); if (S.sheet) closeSheet(); toast('Reopened.'); } catch (x) { toast('Could not save.'); } return; }
  if (D.cat && form) { const d = form.d, cfg = L.CATS[D.cat]; d.category = D.cat;
    if (form.isNew) { d.repeatType = cfg.repeat.type; d.repeatN = cfg.repeat.n || 12; d.leadDays = L.defaultLead(D.cat, cfg.repeat); }
    if (!L.isCar(D.cat)) d.carId = ''; else if (!d.carId && S.cars.length === 1) d.carId = S.cars[0].id;
    redrawSheet(true); return; }
  if (D.lead && form) { const n = +D.lead, a = form.d.leadDays, i = a.indexOf(n); if (i > -1) a.splice(i, 1); else a.push(n); redrawSheet(true); return; }
  if (D.useSet !== undefined && form) { form.d.stillUsing = D.useSet === '1'; redrawSheet(true); return; }
  if (t.tagName === 'SUMMARY') { setTimeout(() => { S.adv = !!(t.parentElement && t.parentElement.open); }); return; }
  const a = D.act; if (!a) return;
  if (a === 'signin') return signIn();
  if (a === 'signout') return signOut();
  if (a === 'syncnow') return syncNow();
  if (a === 'export') return exportBackup();
  if (a === 'install') { if (installEvt) { installEvt.prompt(); installEvt = null; render(); } return; }
  if (a === 'close') return closeSheet();
  if (a === 'calweek') { const rows = L.dueList(S.items, S.cars, today()).filter(r => r.days >= 0 && r.days <= 14 && (S.filter === 'all' || (S.filter === 'car' ? L.isCar(r.item.category) : r.item.category === 'subscription'))); return addToCalendar(rows.map(r => r.item), 'next-two-weeks'); }
  if (a === 'cal') { const it = itemById(S.sheet.id); return addToCalendar([it], it.title); }
  if (a === 'edit') { await fbInit(); return openItemForm(editItemForm(itemById(S.sheet.id))); }
  if (a === 'done') return openDone(S.sheet.id);
  if (a === 'saveitem') return saveItem();
  if (a === 'savedone') return saveDone();
  if (a === 'savecar') return saveCar();
  if (a === 'deletecar') return deleteCar();
  if (a === 'savemileage') return saveMileage();
  if (a === 'stop') { if (!canWrite() || !confirm('Stop tracking this? It moves to Ended items on the History tab, with its history kept.')) return; await fbInit(); try { await FB.F.updateDoc(ref(COL.items, S.sheet.id), { status: 'done', updatedAt: now() }); closeSheet(); toast('Stopped tracking.'); } catch (x) { toast('Could not save.'); } return; }
  if (a === 'deleteitem') { if (!canWrite() || !confirm('Delete this item? Its history stays.')) return; await fbInit(); try { await FB.F.deleteDoc(ref(COL.items, form.id)); closeSheet(); toast('Deleted.'); } catch (x) { toast('Could not delete.'); } return; }
});
$('#fab').addEventListener('click', async () => {
  await fbInit();
  if (S.tab === 'cars') openCarForm(null);
  else openItemForm(newItemForm(S.tab === 'subs' ? { category: 'subscription' } : {}));
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f && form) {
    form.d[t.dataset.f] = t.value;
    if (t.dataset.f === 'title') form.d.titleTouched = true;
    if (t.dataset.f === 'repeatType' || t.dataset.f === 'carId') { if (t.dataset.f === 'repeatType') redrawSheet(true); else $('#sheet input[data-f=title]').placeholder = itemTitle(form.d); }
  } else if (t.dataset.d && doneForm) { doneForm[t.dataset.d] = t.value;
    if (t.dataset.d === 'next') doneForm.nextTouched = true;
    if (t.dataset.d === 'doneOn' && !doneForm.nextTouched && L.isISO(t.value)) { const it0 = itemById(doneForm.id), n = it0 && it0.repeat && it0.repeat.type !== 'oneOff' ? defaultNext(it0, t.value) : null; if (n) { doneForm.next = n; doneForm.defNext = n; const ne = $('#sheet input[data-d=next]'); if (ne) ne.value = n; } } if (t.dataset.d === 'odo') { const e2 = $('#sheet input[data-d=nextKm]'); const it = itemById(doneForm.id); if (e2 && it && it.serviceIntervalKm && km(t.value) != null && !isNaN(km(t.value))) e2.placeholder = Math.round(km(t.value) + it.serviceIntervalKm); } }
  else if (t.dataset.c && carDraft) carDraft[t.dataset.c] = t.value;
  else if (t.dataset.m && mileDraft) mileDraft[t.dataset.m] = t.value;
});
document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.f === 'repeatType' && form) { form.d.repeatType = e.target.value; redrawSheet(true); } });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (S.tab === 'settings') render(); });
window.addEventListener('online', () => { paintSync(); maybeAutoRoll(); });
window.addEventListener('offline', paintSync);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); maybeAutoRoll(); } });

/* ---------- start ---------- */
loadCache();
render();
fbInit().then(() => render());
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
