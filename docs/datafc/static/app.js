// --- Cascade state ---
const countrySelect = document.getElementById('country-select');
const tournamentSelect = document.getElementById('tournament-select');
const seasonSelect = document.getElementById('global-season-id');
const tinfoMeta = document.getElementById('tinfo-meta');
const pqCountry = document.getElementById('pq-country');
const pqTournament = document.getElementById('pq-tournament');
const pqSeason = document.getElementById('pq-season');

let currentTournamentId = 52;
let currentSeasonId = 77805;
let currentCountry = '';

function setLoading(selectEl, text) {
  selectEl.innerHTML = `<option value="">${text}</option>`;
  selectEl.disabled = true;
}

setLoading(countrySelect, 'Loading...');

async function loadCountries() {
  try {
    const resp = await fetch('/api/countries');
    const data = await resp.json();
    countrySelect.innerHTML = '<option value="">— pick country —</option>' +
      data.countries.map(c => `<option value="${c}">${c}</option>`).join('');
    countrySelect.disabled = false;
    countrySelect.value = 'Turkey';
    onCountryChange();
  } catch (err) {
    console.error(err);
    countrySelect.innerHTML = `<option value="">Error loading</option>`;
  }
}

async function onCountryChange() {
  const country = countrySelect.value;
  currentCountry = country;
  tournamentSelect.disabled = !country;
  seasonSelect.disabled = true;

  if (!country) {
    tournamentSelect.innerHTML = '<option value="">— pick country first —</option>';
    seasonSelect.innerHTML = '<option>— pick tournament first —</option>';
    return;
  }

  tournamentSelect.innerHTML = '<option value="">Loading...</option>';
  try {
    const resp = await fetch('/api/tournaments_by_country', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country }),
    });
    const data = await resp.json();
    const tournaments = data.tournaments || [];
    if (!tournaments.length) {
      tournamentSelect.innerHTML = '<option value="">No tournaments</option>';
      return;
    }
    tournamentSelect.innerHTML = '<option value="">— pick tournament —</option>' +
      tournaments.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    tournamentSelect.disabled = false;
  } catch (_) {
    tournamentSelect.innerHTML = '<option value="">Error</option>';
  }
}

async function onTournamentChange() {
  const tid = parseInt(tournamentSelect.value, 10);
  seasonSelect.disabled = true;
  if (!tid) { seasonSelect.innerHTML = '<option>— pick tournament first —</option>'; return; }
  currentTournamentId = tid;
  seasonSelect.innerHTML = '<option>Loading...</option>';
  try {
    const resp = await fetch('/api/seasons', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournament_id: tid }),
    });
    const data = await resp.json();
    if (data.error) { seasonSelect.innerHTML = `<option>${escapeHtml(data.error)}</option>`; return; }
    seasonSelect.innerHTML = data.seasons.map(s =>
      `<option value="${s.id}">${escapeHtml(s.name)}</option>`
    ).join('');
    seasonSelect.disabled = false;
    if (data.seasons.length) {
      seasonSelect.value = data.seasons[0].id;
      currentSeasonId = data.seasons[0].id;
      onSeasonChange();
    }
  } catch (err) {
    seasonSelect.innerHTML = `<option>Error: ${escapeHtml(err.message)}</option>`;
  }
}

async function onSeasonChange() {
  const sid = parseInt(seasonSelect.value, 10);
  if (!sid) return;
  currentSeasonId = sid;
  try {
    const resp = await fetch('/api/tournament_info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournament_id: currentTournamentId, season_id: sid }),
    });
    const data = await resp.json();
    const name = data.tournament || tournamentSelect.options[tournamentSelect.selectedIndex]?.text || '—';
    tinfoMeta.textContent = `${data.country || currentCountry} › ${name} › ${data.season || ''}`;
    pqCountry.value = data.country || currentCountry;
    pqTournament.value = data.tournament || '';
    pqSeason.value = data.season || '';
  } catch (_) {}
}

countrySelect.addEventListener('change', onCountryChange);
tournamentSelect.addEventListener('change', onTournamentChange);
seasonSelect.addEventListener('change', onSeasonChange);

loadCountries();

// --- Fixture date defaults ---
const now = new Date();
const fixtureDateEl = document.getElementById('fixture-date');
if (fixtureDateEl) fixtureDateEl.value = now.toISOString().slice(0, 10);

// --- Tab switching ---
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`[data-panel="${btn.dataset.tab}"]`).classList.add('active');
    // Live tab polling
    if (btn.dataset.tab === 'live') startLivePoll(); else stopLivePoll();
  });
});

// --- Result close ---
document.getElementById('result-close').addEventListener('click', () => {
  document.getElementById('result').hidden = true;
});

// --- Fixtures form ---
const fixturesForm = document.getElementById('fixtures-form');
if (fixturesForm) {
  fixturesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = fixturesForm.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Searching...';

    const payload = {};
    new FormData(fixturesForm).forEach((v, k) => { payload[k] = v; });

    try {
      const resp = await fetch('/api/scheduled_events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      renderFixtures(data);
    } catch (err) {
      document.getElementById('fixture-list').innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Search Matches';
    }
  });
}

function renderFixtures(data) {
  const list = document.getElementById('fixture-list');
  if (data.error) {
    list.innerHTML = `<div class="error">${escapeHtml(data.error)}${data.trace ? '\n' + escapeHtml(data.trace) : ''}</div>`;
    return;
  }
  if (!data.matches || !data.matches.length) {
    list.innerHTML = '<p style="color:var(--muted);padding:12px">No matches for this date.</p>';
    return;
  }
  list.innerHTML = `<p class="meta" style="padding:0 0 8px">${data.total} match${data.total === 1 ? '' : 'es'}</p>` +
    data.matches.map(m => renderMatchCard(m)).join('');
}

function renderMatchCard(m) {
  const ended = m.status_type === 'finished' || m.status_code === 100;
  const scoreCls = ended ? 'score-ended' : 'score-upcoming';
  const score = m.home_score != null ? `${m.home_score} - ${m.away_score}` : 'vs';
  const timeLabel = m.start_time ? formatMatchTime(m.start_time) : '—';

  const params = new URLSearchParams({
    home: m.home_team, away: m.away_team,
    hs: m.home_score != null ? m.home_score : '', as: m.away_score != null ? m.away_score : '',
    tn: m.tournament_name || '', ts: timeLabel,
  });
  return `<a href="/match/${m.game_id}?${params}" class="match-card">
    <div class="match-teams">
      <span class="team home">${escapeHtml(m.home_team)}</span>
      <span class="score ${scoreCls}">${score}</span>
      <span class="team away">${escapeHtml(m.away_team)}</span>
    </div>
    <div class="match-meta">
      <span>${timeLabel}</span>
      ${m.tournament_name ? `<span class="tournament-chip">${escapeHtml(m.tournament_name)}</span>` : ''}
      ${m.status_desc ? `<span class="status-badge">${escapeHtml(m.status_desc)}</span>` : ''}
    </div>
  </a>`;
}

function formatMatchTime(ts) {
  const d = new Date(ts + (ts.includes('T') ? '' : 'Z').replace(' ', 'T'));
  if (isNaN(d.getTime())) return ts;
  const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return d.toLocaleDateString('en-US', opts);
}

// --- Live matches with auto-refresh ---
let liveTimer = null;

async function loadLiveMatches() {
  const list = document.getElementById('live-list');
  const status = document.getElementById('live-status');
  try {
    const resp = await fetch('/api/live_matches');
    const data = await resp.json();
    if (data.error) { list.innerHTML = '<div class="error">' + escapeHtml(data.error) + '</div>'; return; }
    if (!data.matches || !data.matches.length) {
      list.innerHTML = '<p style="color:var(--muted);padding:12px">No live matches right now.</p>';
      status.textContent = 'Last update: ' + new Date().toLocaleTimeString();
      return;
    }
    status.textContent = data.total + ' live match' + (data.total === 1 ? '' : 'es') + ' · Updated: ' + new Date().toLocaleTimeString();
    list.innerHTML = data.matches.map(function(m) { return renderLiveCard(m); }).join('');
  } catch (err) {
    list.innerHTML = '<div class="error">' + escapeHtml(err.message) + '</div>';
  }
}

function renderLiveCard(m) {
  var minute = '';
  if (m.status_type === 'halftime') {
    minute = 'HT';
  } else if (m.status_minute != null) {
    minute = m.status_minute + '\'';
    if (m.status_extra) minute += '+' + m.status_extra;
  } else if (m.status_desc) {
    minute = escapeHtml(m.status_desc);
  }

  var hs = m.home_score != null ? m.home_score : 0;
  var as = m.away_score != null ? m.away_score : 0;
  var score = hs + ' - ' + as;

  var hsn = m.home_score_normaltime != null ? m.home_score_normaltime : 0;
  var asn = m.away_score_normaltime != null ? m.away_score_normaltime : 0;

  var params = new URLSearchParams({
    home: m.home_team, away: m.away_team,
    hs: hs, as: as,
    hsn: hsn, asn: asn,
    tn: m.tournament_name || '', ts: m.start_time, live: '1'
  });

  return '<a href="/match/' + m.game_id + '?' + params + '" class="match-card live-card">' +
    '<div class="match-teams">' +
      '<span class="team home">' + escapeHtml(m.home_team) + '</span>' +
      '<span class="score score-live">' + score + '</span>' +
      '<span class="team away">' + escapeHtml(m.away_team) + '</span>' +
    '</div>' +
    '<div class="match-meta">' +
      '<span class="live-minute">' + minute + '</span>' +
      (m.tournament_name ? '<span class="tournament-chip">' + escapeHtml(m.tournament_name) + '</span>' : '') +
      '<span class="live-badge pulse-badge">LIVE</span>' +
    '</div>' +
  '</a>';
}

// Start/stop live polling
function startLivePoll() {
  loadLiveMatches();
  liveTimer = setInterval(loadLiveMatches, 15000);
}

function stopLivePoll() {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}

// --- Fixtures form ---

// --- Generic form submissions ---
document.querySelectorAll('form:not(#fixtures-form)').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Loading...';
    const payload = {};
    new FormData(form).forEach((v, k) => { payload[k] = v; });
    if (form.dataset.usesGlobalIds === 'true') {
      payload.tournament_id = currentTournamentId;
      payload.season_id = currentSeasonId;
    }
    const endpoint = form.dataset.endpoint;
    try {
      const resp = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      renderResult(data, form);
    } catch (err) {
      renderError(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Fetch';
    }
  });
});

function renderResult(data, form) {
  const result = document.getElementById('result');
  const title = document.getElementById('result-title');
  const meta = document.getElementById('result-meta');
  const errBox = document.getElementById('result-error');
  const tableWrap = document.getElementById('table-wrap');
  result.hidden = false;
  errBox.hidden = true;
  errBox.textContent = '';
  if (data.error) {
    title.textContent = 'Error';
    meta.textContent = '';
    errBox.hidden = false;
    errBox.textContent = data.error + (data.trace ? '\n\n' + data.trace : '');
    tableWrap.innerHTML = '';
    hideDownloads();
    return;
  }
  const fnName = data.function || form.dataset.fn || 'result';
  title.textContent = fnName;
  const preview = data.preview || {};
  const total = preview.total_rows ?? 0;
  const truncated = preview.truncated ? ` (showing first ${preview.rows.length})` : '';
  meta.textContent = `${total} row${total === 1 ? '' : 's'}${truncated}`;
  if (data.path) {
    tableWrap.innerHTML = `<p>Saved to: <code>${escapeHtml(data.path)}</code></p>`;
    hideDownloads();
    return;
  }
  renderTable(preview.columns || [], preview.rows || []);
  setDownloads(fnName);
}

function renderError(msg) {
  const r = document.getElementById('result');
  const e = document.getElementById('result-error');
  r.hidden = false;
  e.hidden = false;
  e.textContent = msg;
  hideDownloads();
}

function renderTable(cols, rows) {
  const w = document.getElementById('table-wrap');
  if (!cols.length) { w.innerHTML = '<p style="padding:14px;color:var(--muted)">No rows.</p>'; return; }
  w.innerHTML = '<table><thead><tr>' + cols.map(c => `<th>${escapeHtml(c)}</th>`).join('') +
    '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${c === null || c === undefined ? '<span style="color:var(--muted)">null</span>' : escapeHtml(String(c))}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
}

function setDownloads(fn) {
  document.getElementById('dl-json').href = `/api/download/${fn}?format=json`;
  document.getElementById('dl-csv').href = `/api/download/${fn}?format=csv`;
  document.getElementById('dl-xlsx').href = `/api/download/${fn}?format=excel`;
  document.querySelector('.result-actions').style.display = 'flex';
}

function hideDownloads() { document.querySelector('.result-actions').style.display = 'none'; }

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
