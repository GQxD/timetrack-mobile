'use strict';

// ============================================================
// Règles de calcul : identiques à l'app PC (Time.py)
// ============================================================
const DAILY_TARGET_MINUTES = 464; // 7h44
const NIGHT_COEFFICIENT = 1.5;
const NIGHT_START_HOUR = 21;
const NIGHT_END_HOUR = 6;
const SATURDAY_COEFFICIENT = 1.0;
const SUNDAY_COEFFICIENT = 2.0;
// Journée badgée d'une seule traite (sans débadger) : pause déduite automatiquement au départ
const AUTO_PAUSE_MINUTES = 45;
const AUTO_PAUSE_MIN_DAY = 6 * 60; // seulement si la plage dépasse 6 h

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const localStamp = (d = new Date()) => `${isoDate(d)}T${hhmm(d)}:${pad(d.getSeconds())}`;
const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function minutesToTime(minutes) {
  if (minutes < 0) return '-' + minutesToTime(-minutes);
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

function parseTime(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})(?:[h:](\d{0,2}))?$/);
  if (!m) return null;
  const hours = parseInt(m[1], 10) % 24;
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  if (minutes >= 60) return null;
  return { hours, minutes };
}

/** "7h30" / "07:30" → "07:30" (format des champs <input type=time>) */
function toInputTime(str) {
  const t = parseTime(str);
  return t ? `${pad(t.hours)}:${pad(t.minutes)}` : '';
}

function parseDuration(str) {
  const text = String(str || '').trim().replace(',', '.');
  if (!text) return null;
  if (text.includes(':') || text.includes('h')) {
    const t = text.match(/^(\d+)[h:](\d{0,2})$/);
    if (!t || (t[2] && parseInt(t[2], 10) >= 60)) return NaN;
    return parseInt(t[1], 10) * 60 + (t[2] ? parseInt(t[2], 10) : 0);
  }
  const hours = parseFloat(text);
  return isNaN(hours) || hours < 0 ? NaN : Math.round(hours * 60);
}

function calculatePeriod(periodStr) {
  if (!periodStr || !periodStr.includes('-')) return { total: 0, night: 0 };
  const parts = periodStr.split('-');
  if (parts.length !== 2) return { total: 0, night: 0 };
  const start = parseTime(parts[0]);
  const end = parseTime(parts[1]);
  if (!start || !end) return { total: 0, night: 0 };
  const startMin = start.hours * 60 + start.minutes;
  let endMin = end.hours * 60 + end.minutes;
  if (endMin <= startMin) endMin += 24 * 60;
  const total = endMin - startMin;
  let night = 0;
  for (let i = 0; i < total; i++) {
    const hour = Math.floor(((startMin + i) % 1440) / 60);
    if (hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR) night++;
  }
  return { total, night };
}

function dayCoefficient(dateStr) {
  const wd = parseIso(dateStr).getDay();
  if (wd === 0) return SUNDAY_COEFFICIENT;
  if (wd === 6) return SATURDAY_COEFFICIENT;
  return 1;
}

const isWeekend = (dateStr) => [0, 6].includes(parseIso(dateStr).getDay());

/** Pause appliquée quand aucune n'est renseignée : 45 min si la journée dépasse 6 h (sauf « 0 » saisi). */
function defaultPause(entry, worked) {
  return entry.no_pause || worked <= AUTO_PAUSE_MIN_DAY ? 0 : AUTO_PAUSE_MINUTES;
}

function calculateDayTotal(entry) {
  const dateStr = entry.date || '';
  let total = 0;
  let night = 0;
  if (entry.manual_hours) {
    total = entry.manual_hours;
  } else if (Array.isArray(entry.segments) && entry.segments.length) {
    // Plages badgées : seules les plages fermées comptent ; la coupure entre deux plages n'est pas travaillée
    const closed = entry.segments.filter((seg) => seg.end);
    for (const seg of closed) {
      const p = calculatePeriod(`${seg.start}-${seg.end}`);
      total += p.total;
      night += p.night;
    }
    let pause = parseInt(entry.pause_minutes, 10) || 0;
    if (!pause && closed.length === 1 && entry.segments.length === 1) pause = defaultPause(entry, total);
    total = Math.max(0, total - pause);
    night = Math.min(night, total);
  } else if (entry.arrival) {
    const span = calculatePeriod(`${entry.arrival}-${entry.departure || ''}`);
    const pause = (parseInt(entry.break_minutes, 10) || 0) || defaultPause(entry, span.total);
    total = Math.max(0, span.total - pause);
    night = Math.min(span.night, total);
  } else {
    const slots = ['morning', 'afternoon', 'night'].map((k) => entry[k]).filter(Boolean);
    for (const slot of slots) {
      const p = calculatePeriod(slot);
      total += p.total;
      night += p.night;
    }
    if (slots.length && total) {
      // Créneaux sans trou (pas de coupure repas) : pause par défaut
      const span = calculatePeriod(`${slots[0].split('-')[0]}-${slots[slots.length - 1].split('-').pop()}`).total;
      if (span <= total) {
        total = Math.max(0, total - defaultPause(entry, total));
        night = Math.min(night, total);
      }
    }
  }
  let overtime;
  if (isWeekend(dateStr)) {
    const coef = dayCoefficient(dateStr);
    overtime = (total - night) * coef + night * Math.max(coef, NIGHT_COEFFICIENT);
  } else {
    overtime = Math.max(0, total - DAILY_TARGET_MINUTES) + night * (NIGHT_COEFFICIENT - 1);
  }
  return { total, night, overtime: Math.round(overtime) };
}

// ============================================================
// Stockage local (par année, même format que les fichiers du PC)
// ============================================================
const storeKey = (year) => `ttp-data-${year}`;

function loadYear(year) {
  try {
    const raw = localStorage.getItem(storeKey(year));
    if (raw) {
      const data = JSON.parse(raw);
      return {
        entries: Array.isArray(data.entries) ? data.entries : [],
        overtime_taken: Array.isArray(data.overtime_taken) ? data.overtime_taken : [],
        initial_overtime_minutes: parseInt(data.initial_overtime_minutes, 10) || 0,
      };
    }
  } catch (e) { /* données illisibles : on repart de zéro */ }
  return { entries: [], overtime_taken: [], initial_overtime_minutes: 0 };
}

function saveYear(year, data) {
  data.entries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  try {
    localStorage.setItem(storeKey(year), JSON.stringify(data));
  } catch (e) {
    toast("⚠️ Impossible d'enregistrer sur le téléphone");
  }
}

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('ttp-prefs')) || {}; } catch (e) { return {}; }
}
function savePrefs(prefs) {
  try { localStorage.setItem('ttp-prefs', JSON.stringify(prefs)); } catch (e) { /* ignoré */ }
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem('ttp-session')); } catch (e) { return null; }
}
function saveSession(session) {
  try {
    if (session) localStorage.setItem('ttp-session', JSON.stringify(session));
    else localStorage.removeItem('ttp-session');
  } catch (e) { /* ignoré */ }
}

function entriesOn(data, dateStr) {
  return data.entries.filter((e) => e.date === dateStr);
}

function balanceOf(data) {
  const earned = data.entries.reduce((sum, e) => sum + calculateDayTotal(e).overtime, 0);
  const taken = data.overtime_taken.reduce((sum, r) => sum + (r.minutes || 0), 0);
  return data.initial_overtime_minutes + earned - taken;
}

function allProjects() {
  const projects = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith('ttp-data-')) continue;
    const year = key.slice('ttp-data-'.length);
    loadYear(year).entries.forEach((e) => e.project && projects.add(e.project));
  }
  return [...projects].sort();
}

// ============================================================
// Badgeuse
// ============================================================
const state = {
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  editingDate: null,
};

/** Jour badgé en cours : celui d'une session ouverte (même après minuit) ou aujourd'hui. */
function badgeDate() {
  const session = loadSession();
  return session && session.date ? session.date : isoDate(new Date());
}

function badgeEntry(create = false) {
  const date = badgeDate();
  const year = date.slice(0, 4);
  const data = loadYear(year);
  let entry = entriesOn(data, date)[0];
  if (!entry && create) {
    const prefs = loadPrefs();
    entry = { date, project: prefs.project || '', location: prefs.location || '', validated: false };
    data.entries.push(entry);
  }
  return { date, year, data, entry };
}

/** Datetime réel d'une heure "HH:MM" du jour badgé (une heure "avant" la précédente tombe le lendemain). */
function timeOnDate(dateStr, timeStr, after) {
  const t = parseTime(timeStr);
  const d = parseIso(dateStr);
  d.setHours(t.hours, t.minutes, 0, 0);
  if (after && d < after) d.setDate(d.getDate() + 1);
  return d;
}

/** Durée entre deux heures "HH:MM" (0 si identiques, passage de minuit géré). */
function gapMinutes(from, to) {
  if (toInputTime(from) === toInputTime(to)) return 0;
  return calculatePeriod(`${from}-${to}`).total;
}

/** Plages d'une saisie, quel que soit son format (badgeuse, créneaux du PC, arrivée/départ). */
function entrySegments(entry) {
  if (!entry || entry.manual_hours) return [];
  if (Array.isArray(entry.segments)) return entry.segments.map((seg) => ({ ...seg }));
  const slots = ['morning', 'afternoon', 'night'].map((k) => entry[k]).filter((x) => x && x.includes('-'));
  if (slots.length) {
    return slots.map((x) => { const [start, end] = x.split('-'); return { start: toInputTime(start), end: toInputTime(end) }; });
  }
  if (entry.arrival) return [{ start: toInputTime(entry.arrival), end: toInputTime(entry.departure) }];
  return [];
}

/** Pause à déduire en plus des coupures (cas d'une saisie arrivée/départ du PC). */
function entryPause(entry) {
  if (!entry) return 0;
  if (Array.isArray(entry.segments)) return parseInt(entry.pause_minutes, 10) || 0;
  if (entry.arrival) return parseInt(entry.break_minutes, 10) || 0;
  return 0;
}

/**
 * Écrit les plages dans la saisie, avec les champs arrivée / départ / pause
 * déduits pour l'app PC (pause = coupures entre plages + pause à déduire).
 */
function setSegments(entry, segments, pauseMinutes) {
  ['manual_hours', 'arrival', 'departure', 'break_minutes', 'segments', 'pause_minutes'].forEach((k) => delete entry[k]);
  Object.assign(entry, { morning: '', afternoon: '', night: '' });
  if (!segments.length) return;
  const gaps = segments.slice(1).reduce((sum, seg, i) => sum + (segments[i].end ? gapMinutes(segments[i].end, seg.start) : 0), 0);
  entry.segments = segments;
  entry.pause_minutes = pauseMinutes || 0;
  entry.arrival = segments[0].start;
  entry.departure = segments[segments.length - 1].end || '';
  entry.break_minutes = gaps + (pauseMinutes || 0);
}

function badgeStatus() {
  const { date, entry } = badgeEntry();
  if (entry && entry.manual_hours) return { state: 'manual', date, entry, segments: [] };
  const segments = entrySegments(entry);
  if (!segments.length) return { state: 'none', date, entry, segments };
  const open = !segments[segments.length - 1].end;
  return { state: open ? 'working' : 'out', date, entry, segments };
}

function workedMinutesNow(status) {
  if (status.state === 'manual') return status.entry.manual_hours;
  let minutes = calculateDayTotal(status.entry || {}).total;
  if (status.state === 'working') {
    const segs = status.segments;
    // Instant réel de début de la plage ouverte (en tenant compte des plages précédentes après minuit)
    let cursor = timeOnDate(status.date, segs[0].start);
    for (let i = 1; i < segs.length; i++) cursor = timeOnDate(status.date, segs[i].start, cursor);
    minutes += Math.max(0, Math.floor((Date.now() - cursor) / 60000));
  }
  return Math.max(0, minutes);
}

/** Badger : ouvre une nouvelle plage (arrivée ou reprise). */
function badgeIn() {
  const { year, data, entry, date } = badgeEntry(true);
  const prefs = currentPrefs();
  const segments = entrySegments(entry);
  let pause = entryPause(entry);
  if (entry.auto_pause) {
    // Reprise après un départ : la coupure remplace la pause automatique
    pause = Math.max(0, pause - AUTO_PAUSE_MINUTES);
    delete entry.auto_pause;
  }
  const now = hhmm(new Date());
  segments.push({ start: now, end: '' });
  setSegments(entry, segments, pause);
  if (prefs.project) entry.project = prefs.project;
  if (prefs.location) entry.location = prefs.location;
  entry.modified_at = localStamp();
  saveYear(year, data);
  saveSession({ date });
  toast(segments.length > 1 ? `▶️ Reprise badgée à ${now}` : `✅ Arrivée badgée à ${now}`);
  render();
}

/** Débadger : ferme la plage en cours (pause, coupure ou fin de journée). */
function badgeOut() {
  const { year, data, entry } = badgeEntry();
  const segments = entrySegments(entry);
  const last = segments[segments.length - 1];
  if (!last || last.end) return;
  last.end = hhmm(new Date());
  let pause = entryPause(entry);
  // Pas débadgé de la journée : 45 min de pause déduites (modifiable via « Corriger la journée »)
  if (segments.length === 1 && !pause && gapMinutes(last.start, last.end) > AUTO_PAUSE_MIN_DAY) {
    pause = AUTO_PAUSE_MINUTES;
    entry.auto_pause = true;
  }
  setSegments(entry, segments, pause);
  entry.modified_at = localStamp();
  saveYear(year, data);
  saveSession(null);
  toast(`👋 Départ badgé à ${last.end} • ${minutesToTime(calculateDayTotal(entry).total)} aujourd'hui`);
  render();
}

function currentPrefs() {
  const prefs = { project: $('#project').value.trim(), location: $('#location').value.trim() };
  savePrefs(prefs);
  return prefs;
}

// ============================================================
// Affichage
// ============================================================
const $ = (sel) => document.querySelector(sel);

function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderBadge() {
  const status = badgeStatus();
  const d = parseIso(status.date);
  $('#today-date').textContent = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  const card = $('#status-card');
  card.className = `status-card ${status.state === 'out' ? 'paused' : status.state === 'manual' ? 'done' : status.state}`;
  const labels = {
    none: 'Pas encore badgé', working: '🟢 Au travail', out: '⏸️ Débadgé', manual: '✏️ Saisie manuelle',
  };
  $('#status-label').textContent = labels[status.state];
  const worked = workedMinutesNow(status);
  $('#status-timer').textContent = minutesToTime(worked);

  let sub = '';
  if (status.state === 'working' || status.state === 'out') {
    const remaining = DAILY_TARGET_MINUTES - worked;
    sub = isWeekend(status.date) ? 'Week-end : tout va au solde'
      : remaining > 0 ? `Encore ${minutesToTime(remaining)} pour faire 7h44` : `+${minutesToTime(-remaining)} au-delà de 7h44`;
  }
  $('#status-sub').textContent = sub;

  const actions = $('#badge-actions');
  actions.innerHTML = '';
  actions.className = 'badge-actions';
  if (status.state === 'none') {
    actions.append(button('Badger l\'arrivée', 'success big', badgeIn));
  } else if (status.state === 'working') {
    actions.append(button('Badger le départ', 'danger big', badgeOut));
  } else if (status.state === 'out') {
    actions.append(button('▶️ Badger une reprise', 'success big', badgeIn));
  }

  // Liste des plages avec les coupures
  const list = $('#t-segments');
  list.innerHTML = '';
  if (status.state === 'manual') {
    list.innerHTML = `<li><span>Total manuel</span><strong>${minutesToTime(status.entry.manual_hours)}</strong></li>`;
  } else if (!status.segments.length) {
    list.innerHTML = '<li class="muted">Aucune plage badgée</li>';
  }
  status.segments.forEach((seg, i) => {
    if (i > 0 && status.segments[i - 1].end) {
      const gap = document.createElement('li');
      gap.className = 'gap';
      gap.textContent = `coupure ${minutesToTime(gapMinutes(status.segments[i - 1].end, seg.start))}`;
      list.append(gap);
    }
    const li = document.createElement('li');
    const duration = seg.end ? minutesToTime(gapMinutes(seg.start, seg.end)) : 'en cours…';
    li.className = seg.end ? '' : 'open';
    li.innerHTML = `<span>${seg.start} → ${seg.end || '…'}</span><strong>${duration}</strong>`;
    list.append(li);
  });
  const pause = status.entry ? entryPause(status.entry) : 0;
  if (pause && status.segments.length) {
    const li = document.createElement('li');
    li.innerHTML = `<span>Pause déduite</span><strong>-${minutesToTime(pause)}</strong>`;
    list.append(li);
  }
  const calc = calculateDayTotal(status.entry || {});
  $('#t-total').textContent = status.entry && calc.total
    ? `Total ${minutesToTime(calc.total)} • +${minutesToTime(calc.overtime)} au solde` : '';
}

function renderBalance() {
  const data = loadYear(state.viewYear);
  $('#balance').textContent = `Solde ${state.viewYear} : ${minutesToTime(balanceOf(data))}`;
}

function renderCalendar() {
  const year = state.viewYear;
  const month = state.viewMonth;
  const data = loadYear(year);
  $('#month-title').textContent = `${MONTHS[month]} ${year}`;
  const grid = $('#cal-grid');
  grid.innerHTML = '';

  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // lundi = 0
  for (let i = 0; i < offset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day empty';
    grid.append(empty);
  }

  const today = isoDate(new Date());
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let monthTotal = 0;
  let monthCredit = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
    const work = entriesOn(data, dateStr);
    const repos = data.overtime_taken.filter((r) => r.date === dateStr);
    const cell = document.createElement('button');
    cell.className = 'cal-day';
    if (isWeekend(dateStr)) cell.classList.add('weekend');
    if (dateStr === today) cell.classList.add('today');

    let html = `<span class="num">${day}</span>`;
    const total = work.reduce((s, e) => s + calculateDayTotal(e).total, 0);
    const credit = work.reduce((s, e) => s + calculateDayTotal(e).overtime, 0);
    monthTotal += total;
    monthCredit += credit;
    if (work.length && total > 0) {
      cell.classList.add(repos.length ? 'both' : 'work');
      html += `<span>${minutesToTime(total)}</span>`;
      if (credit) html += `<span class="plus">+${minutesToTime(credit)}</span>`;
    } else if (work.length) {
      cell.classList.add('work');
      html += '<span>en cours</span>';
    } else if (repos.length) {
      cell.classList.add('repos');
      html += `<span>RC</span><span>${minutesToTime(repos.reduce((s, r) => s + (r.minutes || 0), 0))}</span>`;
    }
    cell.innerHTML = html;
    cell.addEventListener('click', () => openDay(dateStr));
    grid.append(cell);
  }
  $('#month-summary').textContent = `Ce mois : ${minutesToTime(monthTotal)} travaillées • +${minutesToTime(monthCredit)} au solde`;
}

function renderProjects() {
  const list = $('#projects-list');
  list.innerHTML = '';
  allProjects().forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p;
    list.append(opt);
  });
}

function render() {
  renderBadge();
  renderBalance();
  renderCalendar();
  $('#export-year').textContent = state.viewYear;
}

// ============================================================
// Édition d'un jour
// ============================================================
function segmentRow(seg = { start: '', end: '' }) {
  const row = document.createElement('div');
  row.className = 'seg-row';
  row.innerHTML = '<input type="time" class="seg-start"><input type="time" class="seg-end"><button type="button" aria-label="Supprimer la plage">✕</button>';
  row.querySelector('.seg-start').value = toInputTime(seg.start);
  row.querySelector('.seg-end').value = toInputTime(seg.end);
  row.querySelectorAll('input').forEach((i) => i.addEventListener('input', updateDayResult));
  row.querySelector('button').addEventListener('click', () => { row.remove(); updateDayResult(); });
  $('#d-segments').append(row);
}

function openDay(dateStr) {
  state.editingDate = dateStr;
  const data = loadYear(dateStr.slice(0, 4));
  const list = entriesOn(data, dateStr);
  const entry = list[0] || {};
  const prefs = loadPrefs();
  const d = parseIso(dateStr);
  $('#day-title').textContent = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` +
    (list.length > 1 ? ` (+${list.length - 1} autre saisie)` : '');

  $('#d-segments').innerHTML = '';
  const segments = entrySegments(entry);
  (segments.length ? segments : [{ start: '', end: '' }]).forEach((seg) => segmentRow(seg));
  $('#d-pause').value = entryPause(entry) || (entry.no_pause ? '0' : '');
  $('#d-manual').value = entry.manual_hours ? minutesToTime(entry.manual_hours) : '';
  $('#d-project').value = entry.project || prefs.project || '';
  $('#d-location').value = entry.location || prefs.location || '';

  const repos = data.overtime_taken.filter((r) => r.date === dateStr);
  $('#d-repos').textContent = repos.length
    ? `⏰ Repos posé : ${minutesToTime(repos.reduce((s, r) => s + (r.minutes || 0), 0))} (à gérer sur le PC)` : '';
  $('#d-delete').style.visibility = list.length ? 'visible' : 'hidden';
  updateDayResult();
  $('#day-dialog').showModal();
}

function readDayForm() {
  const manual = $('#d-manual').value.trim();
  if (manual) {
    const minutes = parseDuration(manual);
    if (isNaN(minutes) || minutes === null) return { error: 'Total manuel invalide (ex : 8:30)' };
    return { data: { manual_hours: minutes } };
  }
  const segments = [];
  const rows = [...document.querySelectorAll('#d-segments .seg-row')];
  for (const [i, row] of rows.entries()) {
    const start = row.querySelector('.seg-start').value;
    const end = row.querySelector('.seg-end').value;
    if (!start && !end) continue;
    if (!start) return { error: `Plage ${i + 1} : arrivée manquante` };
    if (!end && i < rows.length - 1) return { error: `Plage ${i + 1} : départ manquant` };
    if (end && start === end) return { error: `Plage ${i + 1} : arrivée = départ` };
    segments.push({ start, end });
  }
  if (!segments.length) return { data: null };
  const pauseText = $('#d-pause').value.trim();
  const pause = parseInt(pauseText, 10) || 0;
  const data = { segments, pause_minutes: pause };
  if (pauseText !== '' && pause === 0) data.no_pause = true;
  const closed = segments.filter((seg) => seg.end);
  if (closed.length && calculateDayTotal({ date: state.editingDate, ...data }).total <= 0) {
    return { error: 'La pause est plus longue que les plages' };
  }
  return { data };
}

function updateDayResult() {
  const el = $('#d-result');
  const { data, error } = readDayForm();
  el.classList.toggle('error', Boolean(error));
  if (error) { el.textContent = `⚠️ ${error}`; return; }
  if (!data) { el.textContent = ''; return; }
  const calc = calculateDayTotal({ date: state.editingDate, ...data });
  const open = data.segments && !data.segments[data.segments.length - 1].end;
  el.textContent = `${minutesToTime(calc.total)} travaillées` +
    (calc.overtime ? ` → +${minutesToTime(calc.overtime)} au solde` : '') +
    (calc.night ? ` (nuit ${minutesToTime(calc.night)})` : '') + (open ? ' • plage en cours' : '');
}

function saveDay(event) {
  event.preventDefault();
  const dateStr = state.editingDate;
  const { data: form, error } = readDayForm();
  if (error) { updateDayResult(); return; }
  if (!form) { deleteDay(); return; }

  const year = dateStr.slice(0, 4);
  const data = loadYear(year);
  let entry = entriesOn(data, dateStr)[0];
  if (!entry) {
    entry = { date: dateStr, validated: false };
    data.entries.push(entry);
  }
  delete entry.auto_pause;
  delete entry.no_pause;
  if (form.manual_hours) {
    setSegments(entry, [], 0);
    entry.manual_hours = form.manual_hours;
  } else {
    setSegments(entry, form.segments, form.pause_minutes);
    if (form.no_pause) entry.no_pause = true;
  }
  Object.assign(entry, {
    project: $('#d-project').value.trim(),
    location: $('#d-location').value.trim(),
    modified_at: localStamp(),
  });
  saveYear(year, data);

  // Une plage laissée ouverte reste « en cours » dans la badgeuse
  const open = form.segments && !form.segments[form.segments.length - 1].end;
  const session = loadSession();
  if (open) saveSession({ date: dateStr });
  else if (session && session.date === dateStr) saveSession(null);

  $('#day-dialog').close();
  renderProjects();
  render();
  toast('✅ Journée enregistrée');
}

function deleteDay() {
  const dateStr = state.editingDate;
  if (!confirm('Effacer les heures de ce jour ?')) return;
  const year = dateStr.slice(0, 4);
  const data = loadYear(year);
  data.entries = data.entries.filter((e) => e.date !== dateStr);
  saveYear(year, data);
  const session = loadSession();
  if (session && session.date === dateStr) saveSession(null);
  $('#day-dialog').close();
  render();
  toast('🗑️ Journée effacée');
}

// ============================================================
// Échange de fichiers avec le PC
// ============================================================
async function exportData() {
  const year = state.viewYear;
  const data = loadYear(year);
  const payload = { app: 'TimeTrack Pro mobile', year, exported_at: localStamp(), ...data };
  const name = `timetrack-${year}-telephone.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      toast('📤 Fichier partagé');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('📤 Fichier téléchargé');
}

const newest = (list) => list.reduce((max, e) => (e.modified_at && e.modified_at > max ? e.modified_at : max), '');

/** Le PC fait foi (solde initial, repos, historique) ; une journée plus récente sur le téléphone est conservée. */
function mergeFromPc(local, incoming) {
  const merged = {
    entries: [...incoming.entries],
    overtime_taken: incoming.overtime_taken,
    initial_overtime_minutes: incoming.initial_overtime_minutes,
  };
  let kept = 0;
  const localDates = [...new Set(local.entries.map((e) => e.date))];
  for (const date of localDates) {
    const localList = local.entries.filter((e) => e.date === date);
    const incomingList = incoming.entries.filter((e) => e.date === date);
    const localNewest = newest(localList);
    if (!localNewest) continue; // saisie venue du PC : le fichier du PC fait foi
    if (!incomingList.length || localNewest > newest(incomingList)) {
      merged.entries = merged.entries.filter((e) => e.date !== date).concat(localList);
      kept++;
    }
  }
  return { merged, kept };
}

async function importData(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (e) {
    toast('⚠️ Fichier illisible');
    return;
  }
  const entries = Array.isArray(raw) ? raw : raw.entries;
  if (!Array.isArray(entries)) { toast("⚠️ Ce n'est pas un fichier TimeTrack"); return; }
  const year = String(raw.year || (entries[0] && entries[0].date || '').slice(0, 4) || state.viewYear);
  const incoming = {
    entries,
    overtime_taken: Array.isArray(raw.overtime_taken) ? raw.overtime_taken : [],
    initial_overtime_minutes: parseInt(raw.initial_overtime_minutes, 10) || 0,
  };
  const local = loadYear(year);
  const { merged, kept } = mergeFromPc(local, incoming);
  if (!confirm(`Importer ${incoming.entries.length} journée(s) et ${incoming.overtime_taken.length} repos pour ${year} ?` +
    (kept ? `\n${kept} journée(s) plus récente(s) du téléphone seront conservées.` : ''))) return;
  saveYear(year, merged);
  state.viewYear = parseInt(year, 10);
  renderProjects();
  render();
  toast(`📥 ${year} importé • solde ${minutesToTime(balanceOf(merged))}`);
}

// ============================================================
// Divers
// ============================================================
let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo(0, 0);
}

function changeMonth(delta) {
  state.viewMonth += delta;
  if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
  if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
  render();
}

function init() {
  const prefs = loadPrefs();
  $('#project').value = prefs.project || '';
  $('#location').value = prefs.location || '';
  $('#project').addEventListener('change', currentPrefs);
  $('#location').addEventListener('change', currentPrefs);

  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#prev-month').addEventListener('click', () => changeMonth(-1));
  $('#next-month').addEventListener('click', () => changeMonth(1));
  $('#edit-today').addEventListener('click', () => openDay(badgeDate()));

  // Balayage gauche/droite sur le calendrier
  let touchX = null;
  $('#cal-grid').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('#cal-grid').addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 60) changeMonth(dx < 0 ? 1 : -1);
    touchX = null;
  });

  $('#day-form').addEventListener('submit', saveDay);
  $('#d-cancel').addEventListener('click', () => $('#day-dialog').close());
  $('#d-delete').addEventListener('click', deleteDay);
  ['#d-pause', '#d-manual'].forEach((s) => $(s).addEventListener('input', updateDayResult));
  $('#d-add-segment').addEventListener('click', () => {
    const rows = document.querySelectorAll('#d-segments .seg-row');
    const last = rows[rows.length - 1];
    if (last && !last.querySelector('.seg-end').value && last.querySelector('.seg-start').value) {
      toast('Renseigne d\'abord le départ de la plage précédente');
      return;
    }
    segmentRow();
  });

  $('#export-btn').addEventListener('click', exportData);
  $('#import-file').addEventListener('change', importData);

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((ok) => {
      $('#storage-info').textContent = ok ? 'Stockage du téléphone protégé contre l\'effacement automatique.'
        : 'Pense à exporter régulièrement vers le PC (sauvegarde).';
    });
  }

  renderProjects();
  render();
  setInterval(renderBadge, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
