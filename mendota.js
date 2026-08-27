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
const REFRESH_MS    = 60000; // how often to pull fresh data

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
  const latest = records[records.length - 1];

  const surfaceTemp = getLastValue(records, WT_KEYS[0]);
  const bottomTemp  = getLastValue(records, WT_KEYS[WT_KEYS.length - 1]);
  const windSpeedMs = getLastValue(records, 'wsL');
  const windDirDeg  = getLastValue(records, 'wdL');
  const airTemp     = getLastValue(records, 'airTL');
  const rh          = getLastValue(records, 'rhL');

  setText('val-surface', surfaceTemp != null ? surfaceTemp.toFixed(1) : '–');
  setText('val-bottom', bottomTemp != null ? bottomTemp.toFixed(1) : '–');
  setText('val-wind', windSpeedMs != null ? (windSpeedMs * 2.23694).toFixed(1) : '–');
  setText('val-airtemp', airTemp != null ? airTemp.toFixed(1) : '–');
  setText('val-rh', rh != null ? rh.toFixed(0) : '–');

  if (windDirDeg != null) {
    setText('val-winddir', `${windDirDeg.toFixed(0)}° ${getCompassDirection(windDirDeg)}`);
  } else {
    setText('val-winddir', '–');
  }

  document.getElementById('asOf').textContent = latest ? fmtDate(latest.timestamp) : '–';
}

/* ---------- Temperature-Depth Profile ---------- */

function renderProfilePlot(records) {
  const container = document.getElementById('profileChart');
  container.innerHTML = '';

  const width  = container.clientWidth  || 400;
  const height = container.clientHeight || 300;
  const margin = { top: 20, right: 30, bottom: 90, left: 100 };

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
  const x = d3.scaleLinear()
    .domain(temps.length ? d3.extent(temps) : [0, 30]).nice()
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
    .attr('y', height - 15)
    .attr('text-anchor', 'middle')
    .text('Temperature (°C)');

  svg.append('text').attr('class', 'axis-title')
    .attr('transform', 'rotate(-90)')
    .attr('x', -(margin.top + height - margin.bottom) / 2)
    .attr('y', 28)
    .attr('text-anchor', 'middle')
    .text('Depth (m)');

  const line = d3.line().x(d => x(d.temp)).y(d => y(d.depth));
  svg.append('path').datum(data).attr('class', 'legend-line').attr('stroke', '#14708c').attr('d', line);
  svg.selectAll('.profile-dot').data(data).enter().append('circle')
    .attr('class', 'profile-dot')
    .attr('cx', d => x(d.temp)).attr('cy', d => y(d.depth)).attr('r', 5.25)
    .attr('fill', '#0b3d4c');

  document.getElementById('profileAsOf').textContent = rec ? `As of ${fmtDate(rec.timestamp)}` : '';
}

/* ---------- Main Render ---------- */

let renderToken = 0;

async function render() {
  const token = ++renderToken;
  const [start, end] = state.domain;
  const records = await loadRange(start, end);
  if (token !== renderToken) return;

  updateSidebar(records);
  renderProfilePlot(records);
}

/* ---------- Live Refresh ---------- */

function refreshLive() {
  const now = toChicago(new Date());
  state.cache.delete(dateStr(now));
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
