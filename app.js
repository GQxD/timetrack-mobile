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

function calculateDayTotal(entry) {
  const dateStr = entry.date || '';
  let total = 0;
  let night = 0;
  if (entry.manual_hours) {
    total = entry.manual_hours;
  } else if (entry.arrival) {
    const span = calculatePeriod(`${entry.arrival}-${entry.departure || ''}`);
    total = Math.max(0, span.total - (parseInt(entry.break_minutes, 10) || 0));
    night = Math.min(span.night, total);
  } else {
    for (const key of ['morning', 'afternoon', 'night']) {
      const p = calculatePeriod(entry[key] || '');
      total += p.total;
      night += p.night;
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
        initial_overtime_minutes: Math.max(0, parseInt(data.initial_overtime_minutes, 10) || 0),
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

/** Datetime réel d'une heure "HH:MM" du jour badgé (le départ peut tomber le lendemain). */
function timeOnDate(dateStr, timeStr, after) {
  const t = parseTime(timeStr);
  const d = parseIso(dateStr);
  d.setHours(t.hours, t.minutes, 0, 0);
  if (after && d <= after) d.setDate(d.getDate() + 1);
  return d;
}

function badgeStatus() {
  const { date, entry } = badgeEntry();
  const session = loadSession();
  if (!entry || (!entry.arrival && !entry.manual_hours && !entry.morning && !entry.afternoon && !entry.night)) {
    return { state: 'none', date, entry };
  }
  if (entry.arrival && !entry.departure && session && session.date === date) {
    return { state: session.pauseStart ? 'paused' : 'working', date, entry, session };
  }
  return { state: 'done', date, entry };
}

function workedMinutesNow(status) {
  const { entry, session } = status;
  if (!entry || !entry.arrival) return calculateDayTotal(entry || {}).total;
  const start = timeOnDate(status.date, entry.arrival);
  let end = new Date();
  if (status.state === 'done') return calculateDayTotal(entry).total;
  let minutes = Math.floor((end - start) / 60000) - (parseInt(entry.break_minutes, 10) || 0);
  if (session && session.pauseStart) minutes -= Math.floor((end - session.pauseStart) / 60000);
  return Math.max(0, minutes);
}

function doArrival() {
  const { year, data, entry, date } = badgeEntry(true);
  const prefs = currentPrefs();
  Object.assign(entry, {
    arrival: hhmm(new Date()), departure: '', break_minutes: 0,
    morning: '', afternoon: '', night: '', project: prefs.project, location: prefs.location,
    modified_at: localStamp(),
  });
  delete entry.manual_hours;
  saveYear(year, data);
  saveSession({ date });
  toast(`✅ Arrivée badgée à ${entry.arrival}`);
  render();
}

function doPause() {
  const session = loadSession();
  saveSession({ ...session, pauseStart: Date.now() });
  toast('☕ Pause démarrée');
  render();
}

function endPause() {
  const session = loadSession();
  if (!session || !session.pauseStart) return;
  const { year, data, entry } = badgeEntry();
  const minutes = Math.round((Date.now() - session.pauseStart) / 60000);
  entry.break_minutes = (parseInt(entry.break_minutes, 10) || 0) + minutes;
  entry.modified_at = localStamp();
  saveYear(year, data);
  saveSession({ date: session.date });
  return minutes;
}

function doResume() {
  const minutes = endPause();
  toast(`▶️ Reprise (pause de ${minutesToTime(minutes)})`);
  render();
}

function doDeparture() {
  endPause();
  const { year, data, entry } = badgeEntry();
  entry.departure = hhmm(new Date());
  entry.modified_at = localStamp();
  saveYear(year, data);
  saveSession(null);
  const calc = calculateDayTotal(entry);
  toast(`👋 Départ à ${entry.departure} • ${minutesToTime(calc.total)} travaillées`);
  render();
}

/** Reprendre après un départ : le temps écoulé depuis le départ compte comme une pause. */
function doRestart() {
  const { year, data, entry, date } = badgeEntry();
  if (!entry || !entry.arrival || !entry.departure) return;
  const departure = timeOnDate(date, entry.departure, timeOnDate(date, entry.arrival));
  const gap = Math.max(0, Math.round((Date.now() - departure) / 60000));
  entry.break_minutes = (parseInt(entry.break_minutes, 10) || 0) + gap;
  entry.departure = '';
  entry.modified_at = localStamp();
  saveYear(year, data);
  saveSession({ date });
  toast('▶️ Journée reprise');
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
  card.className = `status-card ${status.state}`;
  const labels = { none: 'Pas encore badgé', working: '🟢 Au travail', paused: '☕ En pause', done: '✅ Journée terminée' };
  $('#status-label').textContent = labels[status.state];
  $('#status-timer').textContent = minutesToTime(workedMinutesNow(status));

  let sub = '';
  if (status.state === 'paused') {
    sub = `Pause depuis ${minutesToTime(Math.floor((Date.now() - status.session.pauseStart) / 60000))}`;
  } else if (status.state === 'working') {
    const remaining = DAILY_TARGET_MINUTES - workedMinutesNow(status);
    sub = isWeekend(status.date) ? 'Week-end : tout va au solde'
      : remaining > 0 ? `Encore ${minutesToTime(remaining)} pour faire 7h44` : `+${minutesToTime(-remaining)} au-delà de 7h44`;
  }
  $('#status-sub').textContent = sub;

  const actions = $('#badge-actions');
  actions.innerHTML = '';
  actions.className = 'badge-actions';
  if (status.state === 'none') {
    actions.append(button('Arrivée', 'success big', doArrival));
  } else if (status.state === 'working') {
    actions.classList.add('two');
    actions.append(button('☕ Pause', 'warning big', doPause), button('Départ', 'danger big', doDeparture));
  } else if (status.state === 'paused') {
    actions.classList.add('two');
    actions.append(button('▶️ Reprendre', 'success big', doResume), button('Départ', 'danger big', doDeparture));
  } else if (status.entry && status.entry.arrival && status.entry.departure) {
    actions.append(button('↩️ Reprendre la journée', 'secondary', doRestart));
  }

  const e = status.entry || {};
  const calc = calculateDayTotal(e);
  $('#t-arrival').textContent = e.arrival || (e.manual_hours ? 'manuel' : '–');
  $('#t-pause').textContent = e.break_minutes ? minutesToTime(e.break_minutes) : '–';
  $('#t-departure').textContent = e.departure || '–';
  $('#t-credit').textContent = status.state === 'done' && calc.overtime ? `+${minutesToTime(calc.overtime)}` : '–';
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
function openDay(dateStr) {
  state.editingDate = dateStr;
  const data = loadYear(dateStr.slice(0, 4));
  const list = entriesOn(data, dateStr);
  const entry = list[0] || {};
  const prefs = loadPrefs();
  const d = parseIso(dateStr);
  $('#day-title').textContent = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` +
    (list.length > 1 ? ` (+${list.length - 1} autre saisie)` : '');

  // Ancien format du PC (créneaux) : première arrivée, dernier départ, trous = pause
  let arrival = entry.arrival || '';
  let departure = entry.departure || '';
  let pause = entry.break_minutes || '';
  if (!arrival && !entry.manual_hours) {
    const slots = ['morning', 'afternoon', 'night'].map((k) => entry[k]).filter((s) => s && s.includes('-'));
    if (slots.length) {
      arrival = slots[0].split('-')[0];
      departure = slots[slots.length - 1].split('-')[1];
      const worked = slots.reduce((s, x) => s + calculatePeriod(x).total, 0);
      const span = calculatePeriod(`${arrival}-${departure}`).total;
      pause = span > worked ? span - worked : '';
    }
  }
  $('#d-arrival').value = toInputTime(arrival);
  $('#d-departure').value = toInputTime(departure);
  $('#d-pause').value = pause;
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
  const arrival = $('#d-arrival').value;
  const departure = $('#d-departure').value;
  if (!arrival && !departure) return { data: null };
  if (!arrival) return { error: 'Arrivée manquante' };
  const pause = parseInt($('#d-pause').value, 10) || 0;
  const data = { arrival, departure, break_minutes: pause };
  if (departure && calculateDayTotal({ date: state.editingDate, ...data }).total <= 0) {
    return { error: 'La pause est plus longue que la journée' };
  }
  return { data };
}

function updateDayResult() {
  const el = $('#d-result');
  const { data, error } = readDayForm();
  el.classList.toggle('error', Boolean(error));
  if (error) { el.textContent = `⚠️ ${error}`; return; }
  if (!data) { el.textContent = ''; return; }
  if (data.arrival && !data.departure) { el.textContent = 'Journée en cours (pas de départ)'; return; }
  const calc = calculateDayTotal({ date: state.editingDate, ...data });
  el.textContent = `${minutesToTime(calc.total)} travaillées` +
    (calc.overtime ? ` → +${minutesToTime(calc.overtime)} au solde` : '') +
    (calc.night ? ` (nuit ${minutesToTime(calc.night)})` : '');
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
  ['manual_hours', 'arrival', 'departure', 'break_minutes'].forEach((k) => delete entry[k]);
  Object.assign(entry, { morning: '', afternoon: '', night: '' }, form, {
    project: $('#d-project').value.trim(),
    location: $('#d-location').value.trim(),
    modified_at: localStamp(),
  });
  saveYear(year, data);

  // Une journée corrigée avec un départ clôt la session de badgeage en cours
  const session = loadSession();
  if (session && session.date === dateStr && (entry.departure || entry.manual_hours)) saveSession(null);
  if (entry.arrival && !entry.departure && dateStr === isoDate(new Date())) saveSession({ date: dateStr });

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
    initial_overtime_minutes: Math.max(0, parseInt(raw.initial_overtime_minutes, 10) || 0),
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
  ['#d-arrival', '#d-departure', '#d-pause', '#d-manual'].forEach((s) => $(s).addEventListener('input', updateDayResult));

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
