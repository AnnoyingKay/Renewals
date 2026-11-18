/* Renewals: dates, roll over, urgency, costs, calendar files and the privacy check.
   No browser or Firebase code in here, so it can be tested on its own. */

export const DUE_WINDOW = 60;          // days shown on the main screen
export const KM_SOON = 1500;           // service flagged "soon" this many km before it is due
export const KM_URGENT = 500;
export const LEAD_OPTIONS = [60, 30, 14, 7, 3, 1];

export const CATS = {
  carService:   { label: 'Car service',   car: true,  repeat: { type: 'yearly' },        lead: [60, 30, 7] },
  carInsurance: { label: 'Car insurance', car: true,  repeat: { type: 'yearly' },        lead: [60, 30, 7] },
  nct:          { label: 'NCT',           car: true,  repeat: { type: 'everyN', n: 24 }, lead: [60, 30, 7] },
  motorTax:     { label: 'Motor tax',     car: true,  repeat: { type: 'yearly' },        lead: [60, 30, 7] },
  subscription: { label: 'Subscription',  car: false, repeat: { type: 'monthly' },       lead: [7, 3] }
};
export const catLabel = c => (CATS[c] && CATS[c].label) || 'Other';
export const isCar = c => !!(CATS[c] && CATS[c].car);
export function defaultLead(category, repeat) {
  if (category === 'subscription') return (repeat && repeat.type === 'monthly') ? [7, 3] : [30, 7];
  return [60, 30, 7];
}

/* ---------- dates (ISO strings, YYYY-MM-DD, no time zones involved) ---------- */
export const pad = n => String(n).padStart(2, '0');
export const toISO = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
export function parseISO(s) { const [y, m, d] = String(s).split('-').map(Number); return { y, m, d }; }
export const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && (() => { const { y, m, d } = parseISO(s); return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m); })();
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function todayISO(now) { now = now || new Date(); return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate()); }
export function dayNum(iso) { const { y, m, d } = parseISO(iso); return Math.round(Date.UTC(y, m - 1, d) / 86400000); }
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);          // b minus a
export function addDays(iso, n) { const t = new Date((dayNum(iso) + n) * 86400000); return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
/* Adds months and keeps the billing day (anchor) where the month is long enough, so 31 Jan goes to 28 Feb and back to 31 Mar. */
export function addMonths(iso, n, anchor) {
  const { y, m, d } = parseISO(iso), want = anchor || d, idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = idx % 12 + 1;
  return toISO(ny, nm, Math.min(want, daysInMonth(ny, nm)));
}
export function cycleMonths(r) {
  if (!r) return null;
  if (r.type === 'monthly') return 1;
  if (r.type === 'yearly') return 12;
  if (r.type === 'everyN') return Math.max(1, Math.floor(+r.n || 1));
  return null;
}
export function repeatText(r) {
  if (!r || r.type === 'oneOff') return 'One off';
  if (r.type === 'monthly') return 'Monthly';
  if (r.type === 'yearly') return 'Yearly';
  const n = cycleMonths(r);
  return n === 12 ? 'Yearly' : n === 1 ? 'Monthly' : 'Every ' + n + ' months';
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* Written out by hand so every phone shows the same thing: "Sat 21 Nov" */
export function fmtDay(iso, withYear) {
  if (!iso) return '';
  const { y, m, d } = parseISO(iso), wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WD[wd] + ' ' + d + ' ' + MO[m - 1] + (withYear ? ' ' + y : '');
}
const EUR = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
export const fmtMoney = n => (n == null || n === '' || isNaN(n)) ? '' : EUR.format(+n);
export const fmtKm = n => (n == null || isNaN(n)) ? '' : Math.round(+n).toLocaleString('en-IE') + ' km';
export function relText(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1) return 'In ' + days + ' days';
  if (days === -1) return '1 day overdue';
  return Math.abs(days) + ' days overdue';
}

/* ---------- roll over ---------- */
/* The date after "done". Moves on by one cycle, then keeps going until it is not in the past. */
export function nextDue(item, today) {
  const months = cycleMonths(item.repeat);
  if (!months) return null;
  const anchor = item.anchorDay || parseISO(item.dueDate).d;
  let next = addMonths(item.dueDate, months, anchor), guard = 0;
  while (next < today && guard++ < 600) next = addMonths(next, months, anchor);
  return next;
}
/* Subscriptions bill themselves. Every billing date that has passed becomes a history row and the item moves on. */
export function autoRoll(item, today) {
  const months = cycleMonths(item.repeat);
  if (item.category !== 'subscription' || item.status !== 'active' || !months || !isISO(item.dueDate)) return null;
  const anchor = item.anchorDay || parseISO(item.dueDate).d, billed = [];
  let d = item.dueDate, guard = 0;
  while (d < today && guard++ < 240) { billed.push(d); d = addMonths(d, months, anchor); }
  return billed.length ? { billed, next: d } : null;
}

/* ---------- urgency ---------- */
export const LEVELS = ['fine', 'soon', 'urgent', 'overdue'];
export function dateLevel(item, today) {
  const days = daysBetween(today, item.dueDate);
  const leads = (item.leadDays && item.leadDays.length ? item.leadDays : [30, 7]).slice().sort((a, b) => a - b);
  if (days < 0) return 3;
  if (days <= leads[0]) return 2;
  if (days <= (leads.length > 1 ? leads[1] : leads[0])) return 1;
  return 0;
}
export function kmLeft(item, car) {
  if (item.category !== 'carService' || item.dueMileage == null || !car || car.currentMileage == null) return null;
  return item.dueMileage - car.currentMileage;
}
export function kmLevel(left) {
  if (left == null) return 0;
  if (left <= 0) return 3;
  if (left <= KM_URGENT) return 2;
  if (left <= KM_SOON) return 1;
  return 0;
}
/* Everything the screens need to know about one item. */
export function info(item, today, car) {
  const days = daysBetween(today, item.dueDate), left = kmLeft(item, car);
  const dl = dateLevel(item, today), kl = kmLevel(left);
  return { days, kmLeft: left, level: Math.max(dl, kl), byKm: kl > dl };
}
export function dueList(items, cars, today, window) {
  window = window == null ? DUE_WINDOW : window;
  const carOf = id => cars.find(c => c.id === id);
  return items.filter(i => i.status === 'active' && isISO(i.dueDate))
    .map(i => ({ item: i, ...info(i, today, carOf(i.carId)) }))
    .filter(r => r.days <= window || r.level >= 1 && r.byKm)
    .sort((a, b) => ((b.level === 3 && b.byKm) - (a.level === 3 && a.byKm)) || a.item.dueDate.localeCompare(b.item.dueDate) || a.item.title.localeCompare(b.item.title));
}
export function weekGroups(rows) {
  return {
    overdue: rows.filter(r => r.days < 0 || (r.byKm && r.level === 3)),
    week:    rows.filter(r => !(r.days < 0 || (r.byKm && r.level === 3)) && r.days <= 7),
    next:    rows.filter(r => !(r.days < 0 || (r.byKm && r.level === 3)) && r.days > 7 && r.days <= 14),
    flagged: rows.filter(r => r.days > 14 && r.byKm)
  };
}
export function dueTotal(rows, withinDays) {
  return rows.filter(r => r.days <= withinDays).reduce((s, r) => s + (+r.item.amount || 0), 0);
}

/* ---------- costs ---------- */
export function monthlyCost(item) {
  const m = cycleMonths(item.repeat);
  return (m && item.amount != null && !isNaN(item.amount)) ? (+item.amount) / m : 0;
}
export function subTotals(items) {
  const subs = items.filter(i => i.category === 'subscription' && i.status === 'active');
  const month = subs.reduce((s, i) => s + monthlyCost(i), 0);
  const unused = subs.filter(i => i.stillUsing === false).reduce((s, i) => s + monthlyCost(i), 0);
  return { count: subs.length, month, year: month * 12, unusedMonth: unused, unusedYear: unused * 12 };
}

/* ---------- privacy check ----------
   The app never stores policy, card, bank or PPS numbers. Free text that looks like one is refused. */
export function looksSensitive(text) {
  const t = String(text || '');
  if (!t) return false;
  if (/\d{9,}/.test(t)) return true;                                                   // long unbroken digit runs
  if (/\d(?:[ -]?\d){11,}/.test(t)) return true;                                       // grouped digits, 12 or more: card or account numbers
  if (/\b\d{7}\s?[A-Za-z]{1,2}\b/.test(t)) return true;                             // PPS number
  if (/\b[A-Za-z]{2}\d{2}\s?[A-Za-z0-9]{4}(\s?[A-Za-z0-9]{4}){2,7}\b/.test(t)) return true; // IBAN
  return false;
}

/* ---------- calendar file ---------- */
const esc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const enc = new TextEncoder(); let out = '', cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) { out += cur + '\r\n '; cur = ''; bytes = 1; limit = 75; }
    cur += ch; bytes += b;
  }
  return out + cur;
}
const stamp = d => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
const compact = iso => iso.replace(/-/g, '');
/* An all day event on the due date. Each reminder fires at 09:00, that many days before. */
export function alarmTrigger(days) {
  if (days <= 0) return 'PT9H';
  const back = days - 1;                // 09:00 that day = (days) before midnight, plus 9 hours
  return back === 0 ? '-PT15H' : '-P' + back + 'DT15H';
}
export function icsFor(list, carName, now) {
  now = now || new Date();
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Renewals//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const it of list) {
    const car = carName ? carName(it.carId) : '';
    const desc = [catLabel(it.category), it.provider && 'Provider: ' + it.provider, car && 'Car: ' + car,
      it.amount != null && it.amount !== '' && 'Amount: ' + fmtMoney(it.amount),
      it.dueMileage != null && 'Due at ' + fmtKm(it.dueMileage), it.notes].filter(Boolean).join('\n');
    L.push('BEGIN:VEVENT', 'UID:' + it.id + '-' + it.dueDate + '@renewals', 'DTSTAMP:' + stamp(now),
      'DTSTART;VALUE=DATE:' + compact(it.dueDate), 'DTEND;VALUE=DATE:' + compact(addDays(it.dueDate, 1)),
      'SUMMARY:' + esc(it.title), 'DESCRIPTION:' + esc(desc), 'TRANSP:TRANSPARENT');
    const leads = (it.leadDays && it.leadDays.length ? it.leadDays : [7]).slice().sort((a, b) => b - a);
    for (const n of leads) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(it.title + (n > 0 ? ' is due in ' + n + (n === 1 ? ' day' : ' days') : ' is due today')),
        'TRIGGER;RELATED=START:' + alarmTrigger(n), 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
export const fileSlug = s => String(s || 'renewal').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'renewal';

/* ---------- import ----------
   Reads a Renewals backup file. Only known fields are kept, everything is checked, and one bad row stops the whole import. */
const STATUS = ['active', 'done'], REPEATS = ['monthly', 'yearly', 'everyN', 'oneOff'], KINDS = ['done', 'auto'];
export function validateImport(obj, nowMs) {
  const errors = [], out = { items: [], cars: [], history: [] };
  const err = m => { if (errors.length < 5) errors.push(m); };
  if (!obj || typeof obj !== 'object' || obj.app !== 'Renewals') { err('This is not a Renewals file.'); return { ...out, errors }; }
  const list = k => Array.isArray(obj[k]) ? obj[k] : (obj[k] == null ? [] : (err('"' + k + '" should be a list.'), []));
  const items = list('items'), cars = list('cars'), history = list('history');
  if (items.length + cars.length + history.length > 1500) { err('That file is too large.'); return { ...out, errors }; }
  const idOk = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id);
  const str = (v, who, label, max) => {
    if (v == null || v === '') return '';
    if (typeof v !== 'string' || v.length > (max || 300)) { err(who + ': ' + label + ' is not valid.'); return ''; }
    if (looksSensitive(v)) err(who + ': ' + label + ' looks like a number that should not be stored.');
    return v;
  };
  const numOrNull = (v, who, label) => {
    if (v == null || v === '') return null;
    if (typeof v !== 'number' || !isFinite(v) || v < 0) { err(who + ': ' + label + ' is not valid.'); return null; }
    return v;
  };
  const dateOk = (v, who, label) => { if (!isISO(v)) { err(who + ': ' + label + ' is not a date.'); return false; } return true; };
  const stamp = v => (typeof v === 'number' && isFinite(v)) ? v : nowMs;

  for (const c of cars) {
    const who = (c && c.name) || 'car';
    if (!c || !idOk(c.id)) { err('A car has no valid id.'); continue; }
    const name = str(c.name, who, 'name', 80); if (!name) { err('A car has no name.'); continue; }
    out.cars.push({ id: c.id, name, reg: str(c.reg, who, 'registration', 20), currentMileage: numOrNull(c.currentMileage, who, 'mileage'),
      mileageUpdatedAt: typeof c.mileageUpdatedAt === 'number' ? c.mileageUpdatedAt : null, createdAt: stamp(c.createdAt) });
  }
  for (const i of items) {
    const who = (i && i.title) || 'item';
    if (!i || !idOk(i.id)) { err('An item has no valid id.'); continue; }
    if (!CATS[i.category]) { err(who + ': unknown category.'); continue; }
    const title = str(i.title, who, 'title', 120); if (!title) { err('An item has no title.'); continue; }
    if (!dateOk(i.dueDate, who, 'due date')) continue;
    if (!STATUS.includes(i.status)) { err(who + ': status should be active or done.'); continue; }
    const r = i.repeat; if (!r || !REPEATS.includes(r.type)) { err(who + ': repeat is not valid.'); continue; }
    let repeat = { type: r.type };
    if (r.type === 'everyN') { if (!Number.isInteger(r.n) || r.n < 1 || r.n > 120) { err(who + ': repeat months is not valid.'); continue; } repeat.n = r.n; }
    let lead = Array.isArray(i.leadDays) && i.leadDays.length && i.leadDays.length <= 8 && i.leadDays.every(n => Number.isInteger(n) && n >= 0 && n <= 365) ? i.leadDays.slice().sort((a, b) => b - a) : null;
    if (!lead) { err(who + ': reminders are not valid.'); continue; }
    if (i.carId != null && !idOk(i.carId)) { err(who + ': car is not valid.'); continue; }
    out.items.push({ id: i.id, category: i.category, title, provider: str(i.provider, who, 'provider', 120), amount: numOrNull(i.amount, who, 'amount'),
      dueDate: i.dueDate, status: i.status, repeat, anchorDay: (Number.isInteger(i.anchorDay) && i.anchorDay >= 1 && i.anchorDay <= 31) ? i.anchorDay : parseISO(i.dueDate).d,
      leadDays: lead, notes: str(i.notes, who, 'notes', 600), carId: i.carId || null, dueMileage: numOrNull(i.dueMileage, who, 'service mileage'),
      serviceIntervalKm: numOrNull(i.serviceIntervalKm, who, 'service interval'), stillUsing: typeof i.stillUsing === 'boolean' ? i.stillUsing : null,
      createdAt: stamp(i.createdAt), updatedAt: stamp(i.updatedAt) });
  }
  for (const h of history) {
    const who = (h && h.title) || 'history row';
    if (!h || !idOk(h.id) || !idOk(h.itemId)) { err('A history row has no valid id.'); continue; }
    if (!dateOk(h.doneAt, who, 'date done') || !dateOk(h.dueDate, who, 'due date')) continue;
    const title = str(h.title, who, 'title', 120); if (!title) { err('A history row has no title.'); continue; }
    out.history.push({ id: h.id, itemId: h.itemId, title, category: CATS[h.category] ? h.category : 'subscription', carId: h.carId || null, provider: str(h.provider, who, 'provider', 120),
      dueDate: h.dueDate, doneAt: h.doneAt, amountPaid: numOrNull(h.amountPaid, who, 'amount'), mileage: numOrNull(h.mileage, who, 'mileage'),
      note: str(h.note, who, 'note', 300), kind: KINDS.includes(h.kind) ? h.kind : 'done', createdAt: stamp(h.createdAt) });
  }
  return { ...out, errors };
}

/* ---------- cover page ---------- */
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MO_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function fmtLong(iso) {
  const { y, m, d } = parseISO(iso), wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WD_LONG[wd] + ' ' + d + ' ' + MO_LONG[m - 1];
}
export function greeting(hour, name) {
  const g = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening';
  return g + (name ? ', ' + name : '') + '.';
}
export const firstName = full => { const w = String(full || '').trim().split(/\s+/)[0] || ''; return /^[A-Za-zÀ-ÿ'’]{2,20}$/.test(w) ? w : ''; };
const eur0 = n => '€' + Math.round(n).toLocaleString('en-IE');
/* One dry line for the top of the cover. It changes once a day and never at random on a redraw. */
export function coverLine(o) {
  const L1 = [];
  if (!o.tracked) return 'Nothing tracked yet. Your subscriptions are already tracking you.';
  if (o.subCount > 0) {
    L1.push(
      o.subCount + (o.subCount === 1 ? ' subscription. You own none of it.' : ' subscriptions. You own none of them.'),
      eur0(o.yearly) + ' a year to rent things you will never own.',
      'You pay ' + eur0(o.monthly) + ' a month for access. Ownership was not on the menu.',
      'Entertainment on a lease: ' + '€' + (o.yearly / 365).toFixed(2) + ' a day.',
      'You do not own the films, the music or the games. You do own the direct debit.',
      'Cancelling is free. Remembering to cancel is the expensive part.',
      'Everything here is borrowed, and the lender is very organised about collecting.'
    );
  }
  L1.push('Renewals arrive whether you look or not. So, look.', 'Nothing here renews itself in your favour.');
  const cand = L1.slice();
  if (o.overdue > 0) {
    const l = [o.overdue + ' overdue. It will not sort itself out.', 'Overdue: ' + o.overdue + '. Admin does not age well.', o.overdue + ' overdue. The date has passed, and it noticed.'];
    cand.push(...l, ...l);
  }
  if (o.unusedMonthly > 0) {
    cand.push('€' + o.unusedMonthly.toFixed(2) + ' a month goes to things you said you do not use.');
    if (o.unusedName) cand.push(o.unusedName + ' is marked as not in use, and still bills you. Loyal, at least.', o.unusedName + ': unused, unforgotten, unrefunded.');
  }
  if (!o.overdue && !o.next30) cand.push('Nothing due this month. Suspicious, but welcome.');
  return cand[Math.abs(o.seed | 0) % cand.length];
}
export function seedFor(todayIso, uid) {
  let h = 0; for (const c of String(uid || '')) h = (h * 31 + c.charCodeAt(0)) % 9973;
  return dayNum(todayIso) + h;
}
