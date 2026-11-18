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
