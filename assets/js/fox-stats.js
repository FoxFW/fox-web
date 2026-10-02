(function () {
  'use strict';

  var ENDPOINT = 'https://foxfw-stats.foxcustomfirmware.workers.dev';
  var SOURCE_URL = 'https://github.com/FoxFW/fox-web/tree/main/cloudflare/stats-worker';
  var MAX_OK_REPORTS = 50;
  var MAX_FAIL_REPORTS = 5;
  var LIST_LIMIT = 8;
  var PLOT_HEIGHT = 120;

  var APPS = {
    esp32: {
      one: 'install', a: 'an install', many: 'installs', title: 'Installs',
      targetTitle: 'By chip', targetNames: { unknown: 'Unknown chip' },
      fwTitle: 'By firmware', fwNames: { custom: 'Custom files' },
      linkTitle: 'By connection',
      linkNames: { 'usb-otg': 'Built-in USB', 'usb-jtag': 'USB Serial/JTAG', uart: 'USB-serial adapter', flipper: 'Through a Flipper', '': 'Not recorded' },
      stageNames: { connect: 'Could not connect', flash: 'Flash failed', verify: 'Verification failed', unsupported: 'Unsupported chip' },
      softStages: ['connect', 'unsupported'],
      counted: 'the chip, the firmware version and the connection type'
    },
    foxfw: {
      one: 'install', a: 'an install', many: 'installs', title: 'Installs',
      targetTitle: 'By method', targetNames: { tgz: 'Standard Update', dfu: 'DFU Recovery' },
      fwTitle: 'By firmware', fwNames: { custom: 'Custom file' },
      linkTitle: null, linkNames: {},
      stageNames: { connect: 'Could not connect', flash: 'Install failed' },
      softStages: ['connect'],
      counted: 'the install method and the firmware version'
    },
    fap: {
      one: 'compile', a: 'a compile', many: 'compiles', title: 'Compiles',
      targetTitle: null, targetNames: { fap: '' },
      fwTitle: null, fwNames: {},
      linkTitle: null, linkNames: {},
      stageNames: { dispatch: 'Could not start', build: 'Build failed', download: 'Download failed' },
      softStages: [],
      counted: 'the GitHub repository that was compiled and whether the build succeeded'
    }
  };

  var CSS = [
    '.fxs{--fxs-accent:var(--fox,var(--accent,#f89521));--fxs-surface:var(--panel,var(--card,#1e1e1e));--fxs-inset:var(--panel-2,var(--mid,#161616));--fxs-line:var(--line,var(--border,#2a2a2a));--fxs-ink:var(--text,var(--light,#eceef1));--fxs-dim:var(--text-dim,#999);--fxs-bar:#d96d0a;--fxs-mono:var(--mono,inherit);box-sizing:border-box;width:100%;background:var(--fxs-surface);border:1px solid var(--fxs-line);border-radius:8px;color:var(--fxs-ink);font-size:13px;line-height:1.5;text-align:left}',
    '.fxs *{box-sizing:border-box}',
    '.fxs-toggle{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;width:100%;margin:0;padding:14px 18px;background:transparent;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}',
    '.fxs-toggle:focus-visible,.fxs-btn:focus-visible,.fxs-col:focus-visible,.fxs-more:focus-visible{outline:2px solid var(--fxs-accent);outline-offset:2px}',
    '.fxs-caret{display:inline-block;width:10px;color:var(--fxs-dim);font-size:11px;transition:transform .15s}',
    '.fxs.open .fxs-caret{transform:rotate(90deg)}',
    '.fxs-title{font-family:var(--fxs-mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--fxs-dim)}',
    '.fxs-toggle:hover .fxs-title{color:var(--fxs-accent)}',
    '.fxs-note{margin-left:auto;font-size:11px;color:var(--fxs-dim)}',
    '.fxs-body{padding:0 18px 18px}',
    '.fxs-body[hidden]{display:none}',
    '.fxs-view{transition:opacity .15s}',
    '.fxs-view.stale{opacity:.45}',
    '.fxs-nav{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:14px}',
    '.fxs-month{min-width:150px;text-align:center;font-weight:600}',
    '.fxs-btn{width:28px;height:28px;padding:0;border:1px solid var(--fxs-line);border-radius:6px;background:var(--fxs-inset);color:var(--fxs-ink);font:inherit;line-height:1;cursor:pointer}',
    '.fxs-btn:hover:not(:disabled){border-color:var(--fxs-accent);color:var(--fxs-accent)}',
    '.fxs-btn:disabled{opacity:.3;cursor:default}',
    '.fxs-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px}',
    '.fxs-tile{background:var(--fxs-inset);border:1px solid var(--fxs-line);border-radius:8px;padding:10px 12px;min-width:0}',
    '.fxs-tile-k{font-size:11px;color:var(--fxs-dim)}',
    '.fxs-tile-v{font-size:22px;font-weight:600;line-height:1.25}',
    '.fxs-tile-s{font-size:11px;color:var(--fxs-dim)}',
    '.fxs-h{margin:18px 0 8px;font-family:var(--fxs-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--fxs-dim)}',
    '.fxs-chart{position:relative}',
    '.fxs-plot{position:relative;display:flex;align-items:flex-end;gap:2px;margin-left:30px;border-bottom:1px solid var(--fxs-line)}',
    '.fxs-grid-line{position:absolute;left:0;right:0;height:0;border-top:1px solid var(--fxs-line);opacity:.6;pointer-events:none}',
    '.fxs-tick{position:absolute;left:-30px;width:24px;margin-top:-8px;text-align:right;font-size:10px;color:var(--fxs-dim);font-variant-numeric:tabular-nums}',
    '.fxs-col{position:relative;flex:1 1 0;min-width:0;display:flex;align-items:flex-end;justify-content:center;outline:none}',
    '.fxs-bar{width:100%;max-width:24px;background:var(--fxs-bar);border-radius:4px 4px 0 0}',
    '.fxs-col:hover .fxs-bar,.fxs-col:focus .fxs-bar{filter:brightness(1.3)}',
    '.fxs-peak{position:absolute;left:50%;transform:translateX(-50%);font-size:10px;color:var(--fxs-ink);white-space:nowrap;pointer-events:none}',
    '.fxs-x{display:flex;gap:2px;margin:4px 0 0 30px}',
    '.fxs-x span{flex:1 1 0;min-width:0;text-align:center;font-size:10px;color:var(--fxs-dim);white-space:nowrap}',
    '.fxs-tip{position:absolute;z-index:5;display:none;min-width:130px;max-width:220px;padding:8px 10px;background:#0a0b0d;border:1px solid var(--fxs-line);border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.5);font-size:12px;pointer-events:none}',
    '.fxs-tip.show{display:block}',
    '.fxs-tip-d{color:var(--fxs-dim);font-size:11px}',
    '.fxs-tip-v{font-weight:600;font-size:14px}',
    '.fxs-tip-r{color:var(--fxs-dim)}',
    '.fxs-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:0 26px}',
    '.fxs-row{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(32px,1fr) minmax(26px,auto) 34px;align-items:center;gap:8px;padding:3px 0}',
    '.fxs-block.wide{grid-column:1/-1}',
    '.fxs-block.wide .fxs-row{grid-template-columns:minmax(0,2.6fr) minmax(32px,1fr) minmax(26px,auto) 34px}',
    '.fxs-name{min-width:0;line-height:1.3;overflow-wrap:anywhere}',
    '.fxs-code{margin-left:5px;font-size:10px;color:var(--fxs-dim);white-space:nowrap}',
    '.fxs-track{height:8px}',
    '.fxs-fill{display:block;height:8px;min-width:2px;background:var(--fxs-bar);border-radius:0 4px 4px 0}',
    '.fxs-val{text-align:right;font-variant-numeric:tabular-nums}',
    '.fxs-pct{text-align:right;font-size:11px;color:var(--fxs-dim);font-variant-numeric:tabular-nums}',
    '.fxs-more{margin-top:4px;padding:0;border:0;background:transparent;color:var(--fxs-dim);font:inherit;font-size:11px;text-decoration:underline;cursor:pointer}',
    '.fxs-more:hover{color:var(--fxs-accent)}',
    '.fxs-empty{padding:18px 0 6px;text-align:center;color:var(--fxs-dim)}',
    '.fxs-details{margin-top:18px}',
    '.fxs-details summary{margin:0;font-family:var(--fxs-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--fxs-dim);cursor:pointer}',
    '.fxs-details summary:hover{color:var(--fxs-accent)}',
    '.fxs-scroll{overflow-x:auto;margin-top:8px}',
    '.fxs-table{width:100%;border-collapse:collapse;font-size:12px}',
    '.fxs-table th{padding:5px 8px;border-bottom:1px solid var(--fxs-line);font-size:11px;font-weight:400;color:var(--fxs-dim);text-align:left;white-space:nowrap}',
    '.fxs-table td{padding:5px 8px;border-bottom:1px solid var(--fxs-line);vertical-align:top}',
    '.fxs-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.fxs-table .rank{width:1%;color:var(--fxs-dim);font-variant-numeric:tabular-nums}',
    '.fxs-table a{color:var(--fxs-ink);text-decoration:none;overflow-wrap:anywhere}',
    '.fxs-table a:hover{color:var(--fxs-accent);text-decoration:underline}',
    '.fxs-owner{color:var(--fxs-dim)}',
    '.fxs-mark{display:inline-block;min-width:14px;font-weight:600}',
    '.fxs-foot{margin:16px 0 0;font-size:11px;line-height:1.6;color:var(--fxs-dim)}',
    '.fxs-foot a{color:var(--fxs-accent);text-decoration:none}',
    '.fxs-foot a:hover{text-decoration:underline}',
    '.embedded-frame .fxs{display:none}',
    '@media (prefers-reduced-motion:reduce){.fxs-caret,.fxs-view{transition:none}}'
  ].join('\n');

  var sent = {};
  var bust = 0;
  var regionNames = null;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function num(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  function plural(n, cfg) {
    return num(n) + ' ' + (n === 1 ? cfg.one : cfg.many);
  }

  function currentMonth() {
    return new Date().toISOString().slice(0, 7);
  }

  function monthLabel(month, short) {
    var d = new Date(Date.UTC(parseInt(month.slice(0, 4), 10), parseInt(month.slice(5, 7), 10) - 1, 1));
    return d.toLocaleDateString('en-US', { month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function dayLabel(day) {
    var d = new Date(day + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function daysInMonth(month) {
    return new Date(Date.UTC(parseInt(month.slice(0, 4), 10), parseInt(month.slice(5, 7), 10), 0)).getUTCDate();
  }

  function countryName(code) {
    if (code === 'XX') return 'Unknown';
    if (code === 'T1') return 'Tor network';
    try {
      if (!regionNames && typeof Intl !== 'undefined' && Intl.DisplayNames) regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
      var name = regionNames ? regionNames.of(code) : null;
      return name && name !== code ? name : code;
    } catch (_) {
      return code;
    }
  }

  function sumValues(obj, skip) {
    var total = 0;
    Object.keys(obj || {}).forEach(function (k) {
      if (!skip || skip.indexOf(k) < 0) total += obj[k];
    });
    return total;
  }

  function niceScale(max) {
    var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000];
    var step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) {
      if (max / steps[i] <= 4) { step = steps[i]; break; }
    }
    var top = Math.max(step, Math.ceil(max / step) * step);
    var ticks = [];
    for (var t = step; t <= top; t += step) ticks.push(t);
    return { top: top, ticks: ticks };
  }

  function injectStyle() {
    if (document.getElementById('fxs-style')) return;
    var style = document.createElement('style');
    style.id = 'fxs-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function report(fields) {
    try {
      if (!fields || !APPS[fields.app]) return;
      var result = fields.result === 'ok' ? 'ok' : 'fail';
      var key = fields.app + ':' + result + ':' + (fields.stage || '');
      sent[key] = (sent[key] || 0) + 1;
      if (sent[key] > (result === 'ok' ? MAX_OK_REPORTS : MAX_FAIL_REPORTS)) return;
      bust += 1;
      var body = JSON.stringify({
        app: fields.app,
        target: String(fields.target || ''),
        fw: String(fields.fw || ''),
        result: result,
        stage: result === 'ok' ? '' : String(fields.stage || ''),
        link: String(fields.link || ''),
        repo: fields.repo ? String(fields.repo) : undefined
      });
      fetch(ENDPOINT + '/hit', {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain' },
        body: body
      }).catch(function () {});
    } catch (_) {}
  }

  function rankedList(parent, heading, rows, labelOf, codeOf, wide) {
    if (!rows || !rows.length) return;
    var total = rows.reduce(function (a, r) { return a + r[1]; }, 0);
    var max = rows[0][1] || 1;
    var block = el('div', wide ? 'fxs-block wide' : 'fxs-block');
    block.appendChild(el('div', 'fxs-h', heading));
    var list = el('div', 'fxs-list');
    block.appendChild(list);
    var expanded = false;

    function draw() {
      list.textContent = '';
      var shown = expanded ? rows : rows.slice(0, LIST_LIMIT);
      shown.forEach(function (r) {
        var row = el('div', 'fxs-row');
        var name = el('span', 'fxs-name', labelOf(r[0]));
        var code = codeOf ? codeOf(r[0]) : '';
        if (code) name.appendChild(el('span', 'fxs-code', code));
        var track = el('span', 'fxs-track');
        var fill = el('span', 'fxs-fill');
        fill.style.width = Math.max(1, Math.round((r[1] / max) * 100)) + '%';
        track.appendChild(fill);
        row.appendChild(name);
        row.appendChild(track);
        row.appendChild(el('span', 'fxs-val', num(r[1])));
        row.appendChild(el('span', 'fxs-pct', total ? Math.round((r[1] / total) * 100) + '%' : ''));
        list.appendChild(row);
      });
      if (rows.length > LIST_LIMIT) {
        var more = el('button', 'fxs-more', expanded ? 'Show fewer' : 'Show all ' + rows.length);
        more.type = 'button';
        more.addEventListener('click', function () { expanded = !expanded; draw(); });
        list.appendChild(more);
      }
    }

    draw();
    parent.appendChild(block);
  }

  function dailyChart(parent, data, cfg) {
    var byDay = {};
    data.days.forEach(function (d) { byDay[d.day] = d; });
    var count = daysInMonth(data.month);
    var values = [];
    var max = 0;
    for (var i = 1; i <= count; i++) {
      var key = data.month + '-' + (i < 10 ? '0' + i : String(i));
      var rec = byDay[key] || { day: key, ok: 0, fail: {}, countries: [] };
      values.push(rec);
      if (rec.ok > max) max = rec.ok;
    }
    var scale = niceScale(max || 1);
    var chart = el('div', 'fxs-chart');
    var plot = el('div', 'fxs-plot');
    plot.style.height = (PLOT_HEIGHT + 18) + 'px';
    var tip = el('div', 'fxs-tip');
    tip.setAttribute('role', 'status');

    scale.ticks.forEach(function (t) {
      var y = 18 + PLOT_HEIGHT - Math.round((t / scale.top) * PLOT_HEIGHT);
      var line = el('div', 'fxs-grid-line');
      line.style.top = y + 'px';
      plot.appendChild(line);
      var tick = el('div', 'fxs-tick', num(t));
      tick.style.top = y + 'px';
      plot.appendChild(tick);
    });
    var zero = el('div', 'fxs-tick', '0');
    zero.style.top = (18 + PLOT_HEIGHT) + 'px';
    plot.appendChild(zero);

    var peakDone = false;
    values.forEach(function (rec) {
      var col = el('div', 'fxs-col');
      col.style.height = PLOT_HEIGHT + 'px';
      col.tabIndex = 0;
      var failed = sumValues(rec.fail);
      col.setAttribute('role', 'img');
      col.setAttribute('aria-label', dayLabel(rec.day) + ': ' + plural(rec.ok, cfg) + (failed ? ', ' + num(failed) + ' did not finish' : ''));
      var h = rec.ok ? Math.max(2, Math.round((rec.ok / scale.top) * PLOT_HEIGHT)) : 0;
      if (h) {
        var bar = el('div', 'fxs-bar');
        bar.style.height = h + 'px';
        if (h < 4) bar.style.borderRadius = '2px 2px 0 0';
        col.appendChild(bar);
      }
      if (max > 0 && rec.ok === max && !peakDone) {
        peakDone = true;
        var peak = el('div', 'fxs-peak', num(rec.ok));
        peak.style.bottom = (h + 2) + 'px';
        col.appendChild(peak);
      }

      function show() {
        tip.textContent = '';
        tip.appendChild(el('div', 'fxs-tip-d', dayLabel(rec.day)));
        tip.appendChild(el('div', 'fxs-tip-v', plural(rec.ok, cfg)));
        Object.keys(rec.fail).forEach(function (stage) {
          tip.appendChild(el('div', 'fxs-tip-r', num(rec.fail[stage]) + ' × ' + (cfg.stageNames[stage] || stage).toLowerCase()));
        });
        rec.countries.slice(0, 4).forEach(function (c) {
          tip.appendChild(el('div', 'fxs-tip-r', countryName(c[0]) + ' ' + num(c[1])));
        });
        if (rec.countries.length > 4) tip.appendChild(el('div', 'fxs-tip-r', '+' + (rec.countries.length - 4) + ' more'));
        tip.classList.add('show');
        var colLeft = plot.offsetLeft + col.offsetLeft;
        var left = colLeft + col.offsetWidth + 8;
        if (left + tip.offsetWidth > chart.offsetWidth) left = colLeft - tip.offsetWidth - 8;
        tip.style.left = Math.max(0, left) + 'px';
        tip.style.top = plot.offsetTop + 'px';
      }
      function hide() { tip.classList.remove('show'); }
      col.addEventListener('pointerenter', show);
      col.addEventListener('pointerleave', hide);
      col.addEventListener('focus', show);
      col.addEventListener('blur', hide);
      plot.appendChild(col);
    });

    var axis = el('div', 'fxs-x');
    for (var d = 1; d <= count; d++) {
      axis.appendChild(el('span', '', d === 1 || d % 5 === 0 ? d : ''));
    }
    chart.appendChild(plot);
    chart.appendChild(axis);
    chart.appendChild(tip);
    parent.appendChild(chart);
  }

  function dailyTable(parent, data, cfg) {
    var active = data.days.filter(function (d) { return d.ok || sumValues(d.fail); });
    if (!active.length) return;
    var details = el('details', 'fxs-details');
    details.appendChild(el('summary', '', 'Daily table'));
    var scroll = el('div', 'fxs-scroll');
    var table = el('table', 'fxs-table');
    var head = el('tr');
    [['Date (UTC)', ''], [cfg.title, 'num'], ['Did not finish', 'num'], ['Countries', '']].forEach(function (h) {
      head.appendChild(el('th', h[1], h[0]));
    });
    var thead = el('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    var tbody = el('tbody');
    active.slice().reverse().forEach(function (d) {
      var tr = el('tr');
      tr.appendChild(el('td', '', dayLabel(d.day)));
      tr.appendChild(el('td', 'num', num(d.ok)));
      var fails = Object.keys(d.fail).map(function (s) { return num(d.fail[s]) + ' ' + (cfg.stageNames[s] || s).toLowerCase(); });
      tr.appendChild(el('td', 'num', fails.length ? fails.join(', ') : '0'));
      tr.appendChild(el('td', '', d.countries.map(function (c) { return countryName(c[0]) + ' ' + num(c[1]); }).join(', ') || '—'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    details.appendChild(scroll);
    parent.appendChild(details);
  }

  function agoLabel(iso) {
    var then = new Date(iso).getTime();
    if (!then) return '';
    var mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hours / 24);
    if (days < 31) return days + (days === 1 ? ' day ago' : ' days ago');
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  function repoCell(name) {
    var td = el('td');
    var a = el('a');
    a.href = 'https://github.com/' + name.split('/').map(encodeURIComponent).join('/');
    a.target = '_blank';
    a.rel = 'noopener';
    var slash = name.indexOf('/');
    a.appendChild(el('span', 'fxs-owner', name.slice(0, slash + 1)));
    a.appendChild(document.createTextNode(name.slice(slash + 1)));
    td.appendChild(a);
    return td;
  }

  function table(parent, heading, headers, rows, limit) {
    var block = el('div');
    block.appendChild(el('div', 'fxs-h', heading));
    var scroll = el('div', 'fxs-scroll');
    var tbl = el('table', 'fxs-table');
    var thead = el('thead');
    var hr = el('tr');
    headers.forEach(function (h) { hr.appendChild(el('th', h[1], h[0])); });
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tbody = el('tbody');
    tbl.appendChild(tbody);
    scroll.appendChild(tbl);
    block.appendChild(scroll);
    var expanded = false;
    var more = null;

    function draw() {
      tbody.textContent = '';
      (expanded ? rows : rows.slice(0, limit)).forEach(function (cells) {
        var tr = el('tr');
        cells.forEach(function (c) { tr.appendChild(c); });
        tbody.appendChild(tr);
      });
      if (more) more.textContent = expanded ? 'Show fewer' : 'Show all ' + rows.length;
    }

    if (rows.length > limit) {
      more = el('button', 'fxs-more');
      more.type = 'button';
      more.addEventListener('click', function () { expanded = !expanded; draw(); });
      block.appendChild(more);
    }
    draw();
    parent.appendChild(block);
  }

  function repoTables(parent, data) {
    var repos = data.repos;
    if (!repos) return;
    if (repos.top && repos.top.length) {
      table(parent, 'Most compiled apps in ' + monthLabel(data.month),
        [['#', 'rank'], ['App', ''], ['This month', 'num'], ['All time', 'num'], ['Failed builds', 'num'], ['Last compiled', '']],
        repos.top.map(function (r, i) {
          var last = el('td', '', agoLabel(r.last));
          last.title = r.last;
          return [el('td', 'rank', i + 1), repoCell(r.name), el('td', 'num', num(r.ok)), el('td', 'num', num(r.allOk)), el('td', 'num', num(r.allFail)), last];
        }), 10);
    }
    if (repos.recent && repos.recent.length) {
      table(parent, 'Recently compiled',
        [['App', ''], ['Result', ''], ['When', '']],
        repos.recent.map(function (r) {
          var result = el('td');
          result.appendChild(el('span', 'fxs-mark', r.ok ? '✓' : '✕'));
          result.appendChild(document.createTextNode(r.ok ? 'Compiled' : 'Build failed'));
          var when = el('td', '', agoLabel(r.at));
          when.title = r.at;
          return [repoCell(r.name), result, when];
        }), 10);
    }
  }

  function tile(parent, label, value, sub) {
    var t = el('div', 'fxs-tile');
    t.appendChild(el('div', 'fxs-tile-k', label));
    t.appendChild(el('div', 'fxs-tile-v', value));
    t.appendChild(el('div', 'fxs-tile-s', sub || ' '));
    parent.appendChild(t);
  }

  function render(view, data, cfg) {
    view.textContent = '';
    var ok = data.totals.ok;
    var hard = sumValues(data.totals.fail, cfg.softStages);
    var soft = sumValues(data.totals.fail) - hard;

    var tiles = el('div', 'fxs-tiles');
    tile(tiles, cfg.title + ' in ' + monthLabel(data.month, true), num(ok),
      data.totals.countries ? 'from ' + num(data.totals.countries) + (data.totals.countries === 1 ? ' country' : ' countries') : '');
    tile(tiles, 'Success rate', ok + hard ? Math.round((ok / (ok + hard)) * 100) + '%' : '—',
      hard ? num(hard) + ' did not finish' : (ok ? 'none failed' : ''));
    if (cfg.softStages.length) tile(tiles, 'Could not connect', num(soft), soft === 1 ? 'attempt this month' : 'attempts this month');
    tile(tiles, 'All time', num(data.allTime.ok),
      data.allTime.firstDay ? 'since ' + monthLabel(data.allTime.firstDay.slice(0, 7), true) + ' · ' + num(data.allTime.countries) + (data.allTime.countries === 1 ? ' country' : ' countries') : '');
    view.appendChild(tiles);

    if (!ok && !sumValues(data.totals.fail)) {
      view.appendChild(el('div', 'fxs-empty', 'Nothing recorded in ' + monthLabel(data.month) + (data.month === currentMonth() ? ' yet.' : '.')));
      repoTables(view, data);
      return;
    }

    view.appendChild(el('div', 'fxs-h', cfg.title + ' per day'));
    dailyChart(view, data, cfg);

    var cols = el('div', 'fxs-cols');
    rankedList(cols, 'By country', data.byCountry, countryName, function (c) { return c === 'XX' ? '' : c; });
    if (cfg.targetTitle) rankedList(cols, cfg.targetTitle, data.byTarget, function (k) { return cfg.targetNames[k] || k; });
    if (cfg.fwTitle) rankedList(cols, cfg.fwTitle, data.byFw, function (k) { return cfg.fwNames[k] || 'v' + k; });
    if (cfg.linkTitle) rankedList(cols, cfg.linkTitle, data.byLink, function (k) { return cfg.linkNames[k] || k; });
    rankedList(cols, 'By operating system', data.byOs, function (k) { return k; });
    rankedList(cols, 'By browser', data.byBrowser, function (k) { return k; });
    var failures = data.failures.map(function (f) {
      var target = cfg.targetNames[f[0]] !== undefined ? cfg.targetNames[f[0]] : f[0];
      var stage = cfg.stageNames[f[1]] || f[1];
      return [target ? target + ' · ' + stage : stage, f[2]];
    });
    rankedList(cols, 'Did not finish', failures, function (k) { return k; }, null, true);
    view.appendChild(cols);

    repoTables(view, data);
    dailyTable(view, data, cfg);
  }

  function init(opts) {
    var cfg = opts && APPS[opts.app];
    if (!cfg) return;
    var mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    if (!mount) return;
    injectStyle();

    var cache = {};
    var month = currentMonth();
    var months = [month];
    var loaded = false;
    var seq = 0;

    var root = el('section', 'fxs');
    root.setAttribute('aria-label', 'Statistics');
    var toggle = el('button', 'fxs-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.appendChild(el('span', 'fxs-caret', '▸'));
    toggle.appendChild(el('span', 'fxs-title', 'Statistics'));
    toggle.appendChild(el('span', 'fxs-note', 'Anonymous ' + cfg.one + ' counts. No IP addresses or personal data are stored.'));
    var body = el('div', 'fxs-body');
    body.hidden = true;

    var nav = el('div', 'fxs-nav');
    var prev = el('button', 'fxs-btn', '<');
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous month');
    var label = el('div', 'fxs-month', monthLabel(month));
    label.setAttribute('aria-live', 'polite');
    var next = el('button', 'fxs-btn', '>');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next month');
    nav.appendChild(prev);
    nav.appendChild(label);
    nav.appendChild(next);

    var view = el('div', 'fxs-view');
    var foot = el('p', 'fxs-foot');
    foot.appendChild(document.createTextNode(
      'What is counted: one anonymous tally each time ' + cfg.a + ' finishes or fails, with the date, the country (as reported by Cloudflare), ' +
      cfg.counted + ', and the operating system and browser family. No IP addresses, cookies, device IDs or personal details are stored. Dates are UTC. '));
    var link = el('a', '', 'See exactly how it works');
    link.href = SOURCE_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    foot.appendChild(link);
    foot.appendChild(document.createTextNode('.'));

    body.appendChild(nav);
    body.appendChild(view);
    body.appendChild(foot);
    root.appendChild(toggle);
    root.appendChild(body);
    mount.appendChild(root);

    function neighbor(dir) {
      var sorted = months.slice().sort();
      var found = null;
      sorted.forEach(function (m) {
        if (dir < 0 && m < month) found = m;
        if (dir > 0 && m > month && found === null) found = m;
      });
      return found;
    }

    function updateNav() {
      label.textContent = monthLabel(month);
      prev.disabled = neighbor(-1) === null;
      next.disabled = neighbor(1) === null;
    }

    function showMessage(text, retry) {
      view.classList.remove('stale');
      view.textContent = '';
      var box = el('div', 'fxs-empty', text);
      if (retry) {
        box.appendChild(document.createTextNode(' '));
        var again = el('button', 'fxs-more', 'Try again');
        again.type = 'button';
        again.addEventListener('click', load);
        box.appendChild(again);
      }
      view.appendChild(box);
    }

    function load() {
      var key = month + ':' + bust;
      var mine = ++seq;
      updateNav();
      if (cache[key]) {
        view.classList.remove('stale');
        render(view, cache[key], cfg);
        return;
      }
      if (view.childNodes.length) view.classList.add('stale');
      else showMessage('Loading statistics…');
      var url = ENDPOINT + '/stats?app=' + encodeURIComponent(opts.app) + '&month=' + month + (bust ? '&v=' + bust : '');
      fetch(url, { credentials: 'omit' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (mine !== seq) return;
          cache[key] = data;
          if (Array.isArray(data.months) && data.months.length) months = data.months;
          if (months.indexOf(currentMonth()) < 0) months.push(currentMonth());
          updateNav();
          view.classList.remove('stale');
          render(view, data, cfg);
        })
        .catch(function () {
          if (mine !== seq) return;
          showMessage('Statistics are unavailable right now.', true);
        });
    }

    toggle.addEventListener('click', function () {
      var open = body.hidden;
      body.hidden = !open;
      root.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && (!loaded || !cache[month + ':' + bust])) {
        loaded = true;
        load();
      }
    });
    prev.addEventListener('click', function () {
      var m = neighbor(-1);
      if (m) { month = m; load(); }
    });
    next.addEventListener('click', function () {
      var m = neighbor(1);
      if (m) { month = m; load(); }
    });
    updateNav();
  }

  window.FoxStats = { init: init, report: report };
})();
