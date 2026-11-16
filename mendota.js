/* mendota.js — Lake Mendota live buoy dashboard
 *
 * Unattended kiosk display: fixed, no-scroll layout that auto-refreshes.
 * Left sidebar shows headline current conditions; right side shows a live
 * temperature-depth profile plus small-multiple trend charts.
 */

/* ---------- Config ---------- */

const DEPTHS  = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const WT_KEYS = DEPTHS.map((_, i) => `wt${i + 1}`);
const MAX_DEPTH = DEPTHS[DEPTHS.length - 1];

const EARLIEST    = new Date(new Date().getFullYear(), 3, 1); // April 1
const LOOKBACK_DAYS = 2;     // days of buffer to search back for the latest reading
const REFRESH_MS    = 600000; // how often to pull fresh data

// No-data modals
const FORCE_WINTER_MODAL = false; // set true to always show the 'out for the winter' modal
const OFFLINE_HOURS = 12;         // hours without data before the 'buoy is offline' modal
const WINTER_DAYS   = 7;          // days without data (Nov 1 – Apr 1) before the winter modal
const LAST_READING_SEARCH_DAYS = 200; // how far back to look for the last reading when offline

const FILE_PREFIX = 'https://mendota-buoy-proxy.uwcfl.workers.dev/mendota_buoy_limnodata.';
const COL_INDEX   = {};

/* ---------- Time Utilities ---------- */

const _chicagoParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

function toChicago(utcDate) {
  const parts = {};
  for (const p of _chicagoParts.formatToParts(utcDate)) parts[p.type] = p.value;
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return new Date(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(hour), Number(parts.minute), Number(parts.second)
  );
}

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDate(d) { return d3.timeFormat('%Y-%m-%d %H:%M')(d); }

function getCompassDirection(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.floor((deg / 22.5) + 0.5) % 16];
}

/* ---------- Parsing ---------- */

function parseMendotaFile(text) {
  const rows = d3.csvParseRows(text);
  const header = rows[1];
  header.forEach((h, i) => COL_INDEX[h] = i);
  const data = rows.slice(4).filter(r => r.length > 1 && r[0]);
  const num = v => { const f = parseFloat(v); return (v === undefined || v === 'NAN' || isNaN(f)) ? null : f; };
  return data.map(r => {
    const rec = { timestamp: toChicago(new Date(r[0].replace(' ', 'T') + 'Z')) };
    WT_KEYS.forEach((k, i) => rec[k] = num(r[COL_INDEX[`watertemp(${i + 1})`]]));
    for (const k of ['airTL', 'rhL', 'wsL', 'wdL', 'IRTL', 'pco2ppm_Avg', 'PAR_above_Avg',
      'PAR_below_Avg', 'pco2volt_Avg', 'waterT', 'spCond', 'pH', 'do_raw',
      'do_sat', 'chlorYSI', 'phycoYSI', 'turbid', 'fdom', 'battYSI']) {
      rec[k] = num(r[COL_INDEX[k]]);
    }
    return rec;
  });
}

async function fetchDay(d) {
  try {
    const url = `${FILE_PREFIX}${dateStr(d)}.csv`;
    const resp = await fetch(url);
    if (!resp.ok) return 'missing';
    const text = await resp.text();
    return parseMendotaFile(text);
  } catch (_) {
    return 'missing';
  }
}

/* ---------- State & Data Loading ---------- */

const state = {
  domain: null,
  cache: new Map(), // dateStr -> records[] | 'missing' | Promise
};

async function loadDay(d) {
  const key = dateStr(d);
  if (state.cache.has(key)) return state.cache.get(key);
  const promise = fetchDay(d);
  state.cache.set(key, promise);
  const result = await promise;
  state.cache.set(key, result);
  return result;
}

async function loadRange(start, end) {
  const days = [];
  for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    d <= end; d.setDate(d.getDate() + 1)) {
    if (d < EARLIEST) continue;
    days.push(new Date(d));
  }
  document.getElementById('loadStatus').textContent = 'loading…';
  await Promise.all(days.map(loadDay));
  document.getElementById('loadStatus').textContent = '';

  let recs = [];
  for (const d of days) {
    const v = state.cache.get(dateStr(d));
    if (v && v !== 'missing') recs = recs.concat(v);
  }
  recs.sort((a, b) => a.timestamp - b.timestamp);
  return recs;
}

/* ---------- Value Helpers ---------- */

function cToF(c) { return c * 9 / 5 + 32; }

function getLastValue(records, key) {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i][key] != null && !isNaN(records[i][key])) return records[i][key];
  }
  return null;
}

function getLatestProfileRecord(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    if (WT_KEYS.some(k => records[i][k] != null)) return records[i];
  }
  return null;
}

/* ---------- Sidebar ---------- */

function setText(id, text) { document.getElementById(id).textContent = text; }

function updateSidebar(records) {
  const surfaceTemp = getLastValue(records, WT_KEYS[0]);
  const bottomTemp  = getLastValue(records, WT_KEYS[WT_KEYS.length - 1]);
  const windSpeedMs = getLastValue(records, 'wsL');
  const windDirDeg  = getLastValue(records, 'wdL');
  const airTemp     = getLastValue(records, 'airTL');
  const rh          = getLastValue(records, 'rhL');

  setText('val-surface', surfaceTemp != null ? surfaceTemp.toFixed(1) : '–');
  setText('val-surface-f', surfaceTemp != null ? cToF(surfaceTemp).toFixed(0) : '–');
  setText('val-bottom', bottomTemp != null ? bottomTemp.toFixed(1) : '–');
  setText('val-bottom-f', bottomTemp != null ? cToF(bottomTemp).toFixed(0) : '–');
  setText('val-wind', windSpeedMs != null ? (windSpeedMs * 2.23694).toFixed(1) : '–');
  setText('val-airtemp', airTemp != null ? airTemp.toFixed(1) : '–');
  setText('val-airtemp-f', airTemp != null ? cToF(airTemp).toFixed(0) : '–');
  setText('val-rh', rh != null ? rh.toFixed(0) : '–');

  if (windDirDeg != null) {
    setText('val-winddir', `${windDirDeg.toFixed(0)}° ${getCompassDirection(windDirDeg)}`);
  } else {
    setText('val-winddir', '–');
  }
}

/* ---------- Temperature-Depth Profile ---------- */

function renderProfilePlot(records) {
  const container = document.getElementById('profileChart');
  container.innerHTML = '';

  const width  = container.clientWidth  || 400;
  const height = container.clientHeight || 300;

  // Scale margins/offsets with the *viewport* width, using the same
  // 700-1600 calibration range as the CSS clamp() driving .axis text's
  // font-size. Using the plot container's own width here (which is only
  // ~50% of the viewport in the side-by-side desktop/tablet layout) would
  // drift out of sync with the actual rendered font size at in-between
  // widths, leaving too little margin and causing overlap.
  const scale = Math.max(0, Math.min(1, (window.innerWidth - 700) / (1600 - 700)));
  const lerp = (min, max) => min + (max - min) * scale;
  const margin = {
    top:    lerp(10, 20),
    right:  lerp(12, 30),
    bottom: lerp(40, 90),
    left:   lerp(48, 100),
  };
  const xTitleGap = lerp(6, 15);
  const yTitleGap  = lerp(13, 28);

  const svg = d3.select(container).append('svg').attr('class', 'chart')
    .attr('viewBox', `0 0 ${width} ${height}`);

  const rec  = getLatestProfileRecord(records);
  const data = [];
  if (rec) {
    DEPTHS.forEach((depth, i) => {
      const v = rec[WT_KEYS[i]];
      if (v != null) data.push({ depth, temp: v });
    });
  }

  const temps = data.map(d => d.temp);
  // Enforce a minimum 5 °C span so a near-isothermal profile isn't stretched across the full axis.
  const MIN_WT_RANGE = 5;
  let tDomain = temps.length ? d3.extent(temps) : [0, 30];
  if (tDomain[1] - tDomain[0] < MIN_WT_RANGE) {
    const mid = (tDomain[0] + tDomain[1]) / 2;
    tDomain = [mid - MIN_WT_RANGE / 2, mid + MIN_WT_RANGE / 2];
  }
  const x = d3.scaleLinear()
    .domain(tDomain).nice()
    .range([margin.left, width - margin.right]);
  const y = d3.scaleLinear()
    .domain([0, MAX_DEPTH])
    .range([margin.top, height - margin.bottom]);

  svg.append('g').attr('class', 'axis axis-bottom')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(Math.max(3, Math.floor((width - margin.left - margin.right) / 150))));
  svg.append('g').attr('class', 'axis axis-left')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(Math.max(3, Math.floor((height - margin.top - margin.bottom) / 90))));

  svg.append('text').attr('class', 'axis-title')
    .attr('x', (margin.left + width - margin.right) / 2)
    .attr('y', height - xTitleGap)
    .attr('text-anchor', 'middle')
    .text('Temperature (°C)');

  svg.append('text').attr('class', 'axis-title')
    .attr('transform', 'rotate(-90)')
    .attr('x', -(margin.top + height - margin.bottom) / 2)
    .attr('y', yTitleGap)
    .attr('text-anchor', 'middle')
    .text('Depth (m)');

  const line = d3.line().x(d => x(d.temp)).y(d => y(d.depth));
  svg.append('path').datum(data).attr('class', 'legend-line').attr('stroke', '#14708c').attr('d', line);
  svg.selectAll('.profile-dot').data(data).enter().append('circle')
    .attr('class', 'profile-dot')
    .attr('cx', d => x(d.temp)).attr('cy', d => y(d.depth)).attr('r', 6)
    .attr('fill', '#0b3d4c');

  document.getElementById('profileAsOf').textContent = rec ? `As of ${fmtDate(rec.timestamp)}` : '';
}

/* ---------- Last Reading Search ---------- */

// When the live window is empty, look further back (a week at a time, in
// parallel) so the display can show the last known conditions behind the modal.
async function findLastReading() {
  const d = toChicago(new Date());
  for (let i = 0; i < LAST_READING_SEARCH_DAYS; i += 7) {
    const days = [];
    for (let j = 0; j < 7; j++) {
      days.push(new Date(d));
      d.setDate(d.getDate() - 1);
    }
    const results = await Promise.all(days.map(loadDay));
    for (const v of results) {
      if (v !== 'missing' && v.length) {
        const recs = v.slice().sort((a, b) => a.timestamp - b.timestamp);
        return { timestamp: recs[recs.length - 1].timestamp, records: recs };
      }
    }
  }
  return null;
}

/* ---------- No-Data Modals ---------- */

const ICON_OFFLINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8.8a15 15 0 0 1 4.2-2.6M9.5 5.2A15 15 0 0 1 22 8.8"/><path d="M5 12.6a10 10 0 0 1 3.4-1.9M13.5 10.3A10 10 0 0 1 19 12.6"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="0.8" fill="currentColor"/><path d="M3 3l18 18"/></svg>';
const ICON_WINTER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 2v20M4.2 6.5l15.6 9M4.2 17.5l15.6-9"/><path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5M3.3 10l3.4.9-.9 3.4M20.7 14l-3.4-.9.9-3.4M5.8 9.7l.9 3.4-3.4.9M18.2 14.3l-.9-3.4 3.4-.9"/></svg>';

// Winter: forced, or no data for a week between Nov 1 and the season start.
// Offline: no data for OFFLINE_HOURS. Winter takes priority.
function noDataKind(lastReading) {
  if (FORCE_WINTER_MODAL) return 'winter';
  const now = toChicago(new Date());
  const ageMs = lastReading ? now - lastReading : Infinity;
  const seasonStart = new Date(now.getFullYear(), EARLIEST.getMonth(), EARLIEST.getDate());
  const offSeason = now.getMonth() >= 10 || now < seasonStart;
  if (offSeason && ageMs > WINTER_DAYS * 86400000) return 'winter';
  if (ageMs > OFFLINE_HOURS * 3600000) return 'offline';
  return null;
}

// Kiosk display: no close button — the modal hides itself once data returns.
function updateNoDataModal(lastReading) {
  let overlay = document.getElementById('nodataOverlay');
  const kind = noDataKind(lastReading);
  if (!kind) {
    if (overlay) overlay.hidden = true;
    return;
  }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'nodataOverlay';
    overlay.className = 'nodata-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-labelledby', 'nodataTitle');
    document.body.appendChild(overlay);
  }
  const isWinter = kind === 'winter';
  overlay.innerHTML = `
    <div class="nodata-card${isWinter ? ' winter' : ''}">
      <div class="nodata-icon">${isWinter ? ICON_WINTER : ICON_OFFLINE}</div>
      <h2 class="nodata-title" id="nodataTitle">${isWinter
        ? 'The buoy has been taken out for the winter!'
        : 'It looks like the buoy is offline.'}</h2>
      <p class="nodata-msg">${isWinter
        ? 'Data collection will resume in the Spring.'
        : 'This is usually resolved in a day or two. Please check again later!'}</p>
      <p class="nodata-meta">${lastReading
        ? `Last reading: ${d3.timeFormat('%b %-d, %Y, %-I:%M %p')(lastReading)}` : ''}</p>
    </div>`;
  overlay.hidden = false;
}

/* ---------- Main Render ---------- */

let renderToken = 0;

async function render() {
  const token = ++renderToken;
  const [start, end] = state.domain;
  let records = await loadRange(start, end);
  if (token !== renderToken) return;

  let lastReading = records.length ? records[records.length - 1].timestamp : null;
  if (!lastReading) {
    const found = await findLastReading();
    if (token !== renderToken) return;
    if (found) {
      lastReading = found.timestamp;
      records = found.records; // show last known conditions behind the modal
    }
  }

  updateSidebar(records);
  renderProfilePlot(records);
  updateNoDataModal(lastReading);
}

/* ---------- Live Refresh ---------- */

function refreshLive() {
  const now = toChicago(new Date());
  state.cache.delete(dateStr(now));
  // Re-check yesterday too, in case its file was missing/partial at the last refresh
  state.cache.delete(dateStr(new Date(now.getTime() - 86400000)));
  let start = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
  if (start < EARLIEST) start = new Date(EARLIEST);
  state.domain = [start, now];
  render();
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 200);
});

/* ---------- Init ---------- */

(function init() {
  refreshLive();
  setInterval(refreshLive, REFRESH_MS);
})();
