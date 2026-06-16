// Match detail page
var liveRefreshTimer = null;

async function initMatchPage(gameId, params) {
  var loading = document.getElementById('match-loading');
  var content = document.getElementById('match-content');

  document.getElementById('mp-home').textContent = params.home || 'Home';
  document.getElementById('mp-away').textContent = params.away || 'Away';

  var hs = params.homeScore || '0';
  var as = params.awayScore || '0';

  if (params.live) {
    document.getElementById('mp-score').textContent = hs + ' - ' + as;
    document.getElementById('mp-tournament').textContent = params.tournament || '';
    document.getElementById('mp-time').innerHTML = '<span class="live-badge pulse-badge">LIVE</span> &#183; ' + (params.time || '');
    startLiveRefresh(gameId, params);
  } else {
    if (hs !== '' && as !== '') {
      hs = isNaN(parseInt(hs)) ? '' : hs;
      as = isNaN(parseInt(as)) ? '' : as;
      if (hs !== '' && as !== '') document.getElementById('mp-score').textContent = hs + ' - ' + as;
    }
    document.getElementById('mp-tournament').textContent = params.tournament || '';
    document.getElementById('mp-time').textContent = params.time || '';
  }

  await loadAndRender(gameId, params);
  loading.classList.add('hidden');
  content.classList.remove('hidden');
}

async function loadAndRender(gameId, params) {
  try {
    var apiPath = params.live ? '/api/live_match_detail/' + gameId : '/api/match_detail/' + gameId + '?type=all';
    var resp = await fetch(apiPath);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.json();
    if (data.error && !data.incidents && !data.stats) throw new Error(data.error);
    renderDetailTabs(data);
    renderDetailPanels(data, params);
  } catch (err) {
    document.getElementById('match-loading').innerHTML = '<div class="error">Failed to load: ' + escapeHtml(err.message) + '</div>';
  }
}

function startLiveRefresh(gameId, params) {
  if (liveRefreshTimer) clearInterval(liveRefreshTimer);
  liveRefreshTimer = setInterval(async function() {
    try {
      var resp = await fetch('/api/live_matches');
      var d = await resp.json();
      var m = (d.matches || []).find(function(x) { return x.game_id === gameId; });
      if (m) {
        var hs = m.home_score != null ? m.home_score : 0;
        var as = m.away_score != null ? m.away_score : 0;
        document.getElementById('mp-score').textContent = hs + ' - ' + as;
        var min = m.status_desc || '';
        if (m.status_minute != null) { min = m.status_minute + '\''; if (m.status_extra) min += '+' + m.status_extra; }
        if (m.status_type === 'halftime') min = 'Halftime';
        document.getElementById('mp-time').innerHTML = '<span class="live-badge pulse-badge">LIVE</span> &#183; ' + min;
      }
      var detailResp = await fetch('/api/live_match_detail/' + gameId);
      var detailData = await detailResp.json();
      renderDetailPanels(detailData, params);
    } catch (_) {}
  }, 15000);
}

function renderDetailTabs(data) {
  var tabs = document.getElementById('detail-tabs');
  var h = '<button class="dt-tab active" data-dt="incidents">Incidents</button>';
  h += '<button class="dt-tab" data-dt="momentum">Momentum</button>';
  if (data.stats && data.stats.length) h += '<button class="dt-tab" data-dt="stats">Stats</button>';
  if (data.shots && data.shots.length) h += '<button class="dt-tab" data-dt="shots">Shots</button>';
  if (data.details && data.details.length) h += '<button class="dt-tab" data-dt="info">Info</button>';
  if (data.h2h && data.h2h.length) h += '<button class="dt-tab" data-dt="h2h">H2H</button>';
  tabs.innerHTML = h;

  tabs.querySelectorAll('.dt-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      tabs.querySelectorAll('.dt-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.dt-panel').forEach(function(p) { p.classList.remove('active'); });
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.dt).classList.add('active');
    });
  });
}

function renderDetailPanels(data, params) {
  var panels = document.getElementById('detail-panels');
  panels.innerHTML =
    '<div class="dt-panel active" id="panel-incidents">' + renderIncidents(data.incidents || []) + '</div>' +
    '<div class="dt-panel" id="panel-momentum">' + renderMomentum(data.momentum || [], data.incidents || [], params) + '</div>' +
    '<div class="dt-panel" id="panel-stats">' + renderStats(data.stats || []) + '</div>' +
    '<div class="dt-panel" id="panel-shots">' + renderShots(data.shots || []) + '</div>' +
    '<div class="dt-panel" id="panel-info">' + renderInfo(data.details || []) + '</div>' +
    '<div class="dt-panel" id="panel-h2h">' + renderH2H(data.h2h || []) + '</div>';
}

function incIcon(type, iclass) {
  if (type === 'goal') return '\u26BD';
  if (type === 'penaltyGoal') return '\u26BD(P)';
  if (type === 'ownGoal') return '\u26BD(OG)';
  if (type === 'card' && iclass === 'yellow') return '\uD83D\uDFE8';
  if (type === 'card' && iclass === 'red') return '\uD83D\uDFE5';
  if (type === 'substitution') return '\u21C4';
  if (type === 'varDecision') return 'VAR';
  return '\u2022';
}

function renderIncidents(incidents) {
  if (!incidents.length) return '<p class="muted">No incidents yet</p>';
  return '<div class="incident-list">' + incidents.map(function(i) {
    var team = i.is_home ? 'home' : 'away';
    var score = i.home_score != null ? '<span class="incident-score">' + i.home_score + '-' + i.away_score + '</span>' : '';
    return '<div class="incident-row ' + team + '">' +
      '<span class="incident-time">' + (i.time || '?') + '\'</span>' +
      '<span class="incident-icon">' + incIcon(i.incident_type, i.incident_class) + '</span>' +
      '<span class="incident-player">' + escapeHtml(i.player_name || '') + '</span>' + score + '</div>';
  }).join('') + '</div>';
}

function renderStats(stats) {
  if (!stats.length) return '<p class="muted">No stats yet</p>';
  var groups = {};
  stats.forEach(function(s) {
    var k = s.group_name || 'General';
    if (!groups[k]) groups[k] = [];
    groups[k].push(s);
  });
  var h = '';
  Object.keys(groups).forEach(function(g) {
    h += '<h4 class="stat-group-name">' + escapeHtml(g) + '</h4><div class="stat-grid">';
    groups[g].forEach(function(s) {
      h += '<div class="stat-row">' +
        '<span class="stat-val home">' + (s.home_team_stat != null ? s.home_team_stat : '-') + '</span>' +
        '<span class="stat-label">' + escapeHtml(s.stat_name || '') + '</span>' +
        '<span class="stat-val away">' + (s.away_team_stat != null ? s.away_team_stat : '-') + '</span></div>';
    });
    h += '</div>';
  });
  return h;
}

function renderShots(shots) {
  if (!shots.length) return '<p class="muted">No shots</p>';
  return '<div class="table-wrap" style="max-height:400px"><table>' +
    '<thead><tr><th>Player</th><th>Min</th><th>Type</th><th>Body</th><th>xG</th></tr></thead><tbody>' +
    shots.map(function(s) { return '<tr>' +
      '<td>' + escapeHtml(s.player_name || '') + '</td>' +
      '<td>' + (s.time || '-') + '\'</td>' +
      '<td>' + escapeHtml(String(s.shot_type || '-')) + '</td>' +
      '<td>' + escapeHtml(String(s.body_part || '-')) + '</td>' +
      '<td>' + (s.xg != null ? Number(s.xg).toFixed(2) : '-') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function renderInfo(details) {
  if (!details.length) return '<p class="muted">No info</p>';
  var d = details[0];
  var h = '<div class="info-grid">';
  if (d.venue_name) h += '<div class="info-item"><span class="info-label">Venue</span><span>' + escapeHtml(d.venue_name) + (d.venue_city ? ', ' + escapeHtml(d.venue_city) : '') + (d.venue_capacity ? ' (' + d.venue_capacity + ')' : '') + '</span></div>';
  if (d.referee_name) h += '<div class="info-item"><span class="info-label">Referee</span><span>' + escapeHtml(d.referee_name) + (d.referee_country ? ' (' + escapeHtml(d.referee_country) + ')' : '') + '</span></div>';
  h += '</div>';
  return h;
}

function renderH2H(h2h) {
  if (!h2h.length) return '<p class="muted">No H2H</p>';
  var r = h2h[0];
  var h = '<div class="info-grid">';
  if (r.home_wins != null) h += '<div class="info-item"><span class="info-label">' + escapeHtml(r.home_team || 'Home') + ' Wins</span><span>' + r.home_wins + '</span></div>';
  if (r.away_wins != null) h += '<div class="info-item"><span class="info-label">' + escapeHtml(r.away_team || 'Away') + ' Wins</span><span>' + r.away_wins + '</span></div>';
  if (r.draws != null) h += '<div class="info-item"><span class="info-label">Draws</span><span>' + r.draws + '</span></div>';
  h += '</div>';
  return h;
}

function renderMomentum(momentum, incidents, params) {
  if (!momentum || !momentum.length) return '<p class="muted">No momentum data yet</p>';

  var svgWidth = 900, svgHeight = 260;
  var padLeft = 55, padRight = 20, padTop = 25, padBottom = 35;
  var chartW = svgWidth - padLeft - padRight;
  var chartH = svgHeight - padTop - padBottom;

  var vals = momentum.map(function(p) { return p.value; });
  var mins = momentum.map(function(p) { return p.minute; });
  var maxAbs = Math.max(Math.abs(Math.max.apply(null, vals)), Math.abs(Math.min.apply(null, vals)), 1);
  var yMid = chartH / 2;

  function xPos(i) { return padLeft + (i / (vals.length - 1)) * chartW; }
  function yPos(v) { return padTop + yMid - (v / maxAbs) * yMid; }

  var posPath = 'M ' + xPos(0).toFixed(1) + ' ' + yPos(0).toFixed(1) + ' ';
  var negPath = 'M ' + xPos(0).toFixed(1) + ' ' + yPos(0).toFixed(1) + ' ';
  var linePath = '';
  for (var i = 0; i < vals.length; i++) {
    posPath += 'L ' + xPos(i).toFixed(1) + ' ' + Math.min(yPos(vals[i]), yPos(0)).toFixed(1) + ' ';
    negPath += 'L ' + xPos(i).toFixed(1) + ' ' + Math.max(yPos(vals[i]), yPos(0)).toFixed(1) + ' ';
    linePath += (i === 0 ? 'M' : 'L') + ' ' + xPos(i).toFixed(1) + ' ' + yPos(vals[i]).toFixed(1);
  }
  posPath += 'L ' + xPos(vals.length - 1).toFixed(1) + ' ' + yPos(0).toFixed(1) + ' Z';
  negPath += 'L ' + xPos(vals.length - 1).toFixed(1) + ' ' + yPos(0).toFixed(1) + ' Z';

  var homeColor = '#4f8cff', awayColor = '#f85149';

  var goalMarkers = '';
  if (incidents && incidents.length) {
    incidents.forEach(function(inc) {
      var isGoal = inc.incident_type === 'goal' || inc.incident_type === 'penaltyGoal' || inc.incident_type === 'ownGoal';
      if (!isGoal || inc.time == null) return;
      var bestIdx = 0, bestDist = Infinity;
      for (var j = 0; j < mins.length; j++) {
        var d = Math.abs(mins[j] - inc.time);
        if (d < bestDist) { bestDist = d; bestIdx = j; }
      }
      var gx = xPos(bestIdx), gy = yPos(vals[bestIdx]);
      var color = inc.is_home ? homeColor : awayColor;
      var dy = inc.is_home ? -16 : 20;
      goalMarkers += '<line x1="' + gx.toFixed(1) + '" y1="' + gy.toFixed(1) + '" x2="' + gx.toFixed(1) + '" y2="' + (gy + dy).toFixed(1) + '" stroke="' + color + '" stroke-width="1" stroke-dasharray="2,2"/>';
      goalMarkers += '<text x="' + gx.toFixed(1) + '" y="' + (gy + dy + (inc.is_home ? -4 : 13)).toFixed(1) + '" text-anchor="middle" fill="' + color + '" font-size="14" font-weight="bold">\u26BD</text>';
    });
  }

  var xTicks = '';
  var step = Math.max(1, Math.floor(mins.length / 12));
  for (var k = 0; k < mins.length; k += step) {
    var x = xPos(k);
    xTicks += '<line x1="' + x + '" y1="' + (padTop + chartH) + '" x2="' + x + '" y2="' + (padTop + chartH + 5) + '" stroke="var(--muted)" stroke-width="0.5"/>';
    xTicks += '<text x="' + x + '" y="' + (padTop + chartH + 18) + '" text-anchor="middle" fill="var(--muted)" font-size="10">' + Math.round(mins[k]) + '\'</text>';
  }

  return '<div class="momentum-chart">' +
    '<h4 class="stat-group-name" style="margin-top:0">Attack Momentum — ' + escapeHtml(params.home || 'Home') + ' vs ' + escapeHtml(params.away || 'Away') + '</h4>' +
    '<svg viewBox="0 0 ' + svgWidth + ' ' + svgHeight + '" width="100%" style="max-height:280px">' +
    '<defs>' +
      '<linearGradient id="mgHome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + homeColor + '" stop-opacity="0.3"/><stop offset="100%" stop-color="' + homeColor + '" stop-opacity="0.02"/></linearGradient>' +
      '<linearGradient id="mgAway" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="' + awayColor + '" stop-opacity="0.3"/><stop offset="100%" stop-color="' + awayColor + '" stop-opacity="0.02"/></linearGradient>' +
    '</defs>' +
    '<line x1="' + padLeft + '" y1="' + yPos(0) + '" x2="' + (padLeft + chartW) + '" y2="' + yPos(0) + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="4,4"/>' +
    '<path d="' + posPath + '" fill="url(#mgHome)"/>' +
    '<path d="' + negPath + '" fill="url(#mgAway)"/>' +
    '<path d="' + linePath + '" fill="none" stroke="' + homeColor + '" stroke-width="2" stroke-linejoin="round"/>' +
    xTicks + goalMarkers +
    '<text x="' + padLeft + '" y="' + (padTop - 8) + '" fill="' + homeColor + '" font-size="12" font-weight="600">' + escapeHtml(params.home || 'Home') + '</text>' +
    '<text x="' + padLeft + '" y="' + (svgHeight - 5) + '" fill="' + awayColor + '" font-size="12" font-weight="600">' + escapeHtml(params.away || 'Away') + '</text>' +
    '</svg></div>';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
