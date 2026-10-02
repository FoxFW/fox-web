const ALLOWED_ORIGINS = ['https://foxfw.github.io'];
const THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const THROTTLE_MAX_HITS = 40;
const THROTTLE_MAX_KEYS = 5000;
const MAX_BODY_CHARS = 1024;
const STATS_MAX_AGE_SECONDS = 120;

const SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const COUNTRY = /^[A-Z][A-Z0-9]$/;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const HIDDEN_REPOS = [];
const REPO_LIST_LIMIT = 50;
const RECENT_LIMIT = 25;

const versionOrCustom = (v) => v === 'custom' || SEMVER.test(v);
const empty = (v) => v === '';

const APPS = {
  esp32: {
    targets: ['ESP32', 'ESP32-S2', 'ESP32-S3', 'ESP32-C3', 'ESP32-C5', 'ESP32-C6', 'ESP32-C2', 'ESP32-C61', 'ESP32-H2', 'ESP32-P4', 'ESP8266', 'unknown'],
    stages: ['connect', 'flash', 'verify', 'unsupported'],
    links: ['usb-otg', 'usb-jtag', 'uart', 'flipper'],
    fw: versionOrCustom,
  },
  foxfw: {
    targets: ['tgz', 'dfu'],
    stages: ['connect', 'flash'],
    links: [''],
    fw: versionOrCustom,
  },
  fap: {
    targets: ['fap'],
    stages: ['dispatch', 'build', 'download'],
    links: [''],
    fw: empty,
  },
};

const SCHEMA = `CREATE TABLE IF NOT EXISTS hits (
  app TEXT NOT NULL,
  day TEXT NOT NULL,
  country TEXT NOT NULL,
  target TEXT NOT NULL,
  fw TEXT NOT NULL,
  result TEXT NOT NULL,
  stage TEXT NOT NULL,
  link TEXT NOT NULL,
  os TEXT NOT NULL,
  browser TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app, day, country, target, fw, result, stage, link, os, browser)
) WITHOUT ROWID`;

const REPO_SCHEMA = `CREATE TABLE IF NOT EXISTS fap_repos (
  day TEXT NOT NULL,
  repo TEXT NOT NULL,
  name TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  fail INTEGER NOT NULL DEFAULT 0,
  last_ts TEXT NOT NULL,
  last_ok INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, repo)
) WITHOUT ROWID`;

const REPO_UPSERT = `INSERT INTO fap_repos (day, repo, name, ok, fail, last_ts, last_ok)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  ON CONFLICT (day, repo)
  DO UPDATE SET ok = ok + excluded.ok, fail = fail + excluded.fail, name = excluded.name, last_ts = excluded.last_ts, last_ok = excluded.last_ok`;

const UPSERT = `INSERT INTO hits (app, day, country, target, fw, result, stage, link, os, browser, n)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1)
  ON CONFLICT (app, day, country, target, fw, result, stage, link, os, browser)
  DO UPDATE SET n = n + 1`;

let schemaReady = null;
const recentHits = new Map();

function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch([env.DB.prepare(SCHEMA), env.DB.prepare(REPO_SCHEMA)]).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function respond(body, status, headers) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? headers : { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function hitHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function statsHeaders(maxAge) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
  };
}

function throttled(key, now) {
  if (!key) return false;
  if (recentHits.size > THROTTLE_MAX_KEYS) {
    for (const [k, v] of recentHits) {
      if (now - v.start > THROTTLE_WINDOW_MS) recentHits.delete(k);
    }
    if (recentHits.size > THROTTLE_MAX_KEYS) recentHits.clear();
  }
  const entry = recentHits.get(key);
  if (!entry || now - entry.start > THROTTLE_WINDOW_MS) {
    recentHits.set(key, { start: now, n: 1 });
    return false;
  }
  entry.n += 1;
  return entry.n > THROTTLE_MAX_HITS;
}

function osFromUserAgent(ua) {
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return 'Other';
}

function browserFromUserAgent(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\/|Chromium\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}

function countryOf(request) {
  const c = request.cf && request.cf.country;
  return typeof c === 'string' && COUNTRY.test(c) ? c : 'XX';
}

function validHit(body) {
  if (!body || typeof body !== 'object') return null;
  const app = APPS[body.app];
  if (!app) return null;
  const str = (v) => (typeof v === 'string' ? v : '');
  const target = str(body.target);
  const fw = str(body.fw);
  const result = str(body.result);
  const stage = str(body.stage);
  const link = str(body.link);
  if (!app.targets.includes(target)) return null;
  if (!app.fw(fw)) return null;
  if (result === 'ok') {
    if (stage !== '') return null;
  } else if (result === 'fail') {
    if (!app.stages.includes(stage)) return null;
  } else {
    return null;
  }
  if (link !== '' && !app.links.includes(link)) return null;
  let repo = '';
  if (body.app === 'fap' && typeof body.repo === 'string' && body.repo !== '') {
    const repoName = body.repo.slice(body.repo.indexOf('/') + 1);
    if (!REPO.test(body.repo) || repoName === '.' || repoName === '..' || repoName.endsWith('.git')) return null;
    if (result === 'ok' || stage === 'build') repo = body.repo;
  }
  return { app: body.app, target, fw, result, stage, link, repo };
}

async function repoIsPublic(env, key, name) {
  const known = await env.DB.prepare('SELECT 1 AS x FROM fap_repos WHERE repo = ?1 LIMIT 1').bind(key).first();
  if (known) return true;
  try {
    const res = await fetch(`https://github.com/${name}`, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'foxfw-stats' } });
    return res.status !== 404;
  } catch (_) {
    return true;
  }
}

async function recordRepo(env, hit, day) {
  const key = hit.repo.toLowerCase();
  if (HIDDEN_REPOS.includes(key)) return;
  if (!(await repoIsPublic(env, key, hit.repo))) return;
  const ok = hit.result === 'ok' ? 1 : 0;
  await env.DB.prepare(REPO_UPSERT).bind(day, key, hit.repo, ok, 1 - ok, new Date().toISOString(), ok).run();
}

async function handleHit(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED_ORIGINS.includes(origin)) return respond({ error: 'forbidden' }, 403, { 'Cache-Control': 'no-store' });
  const headers = hitHeaders(origin);
  if (throttled(request.headers.get('CF-Connecting-IP') || '', Date.now())) {
    return respond({ error: 'slow down' }, 429, headers);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return respond({ error: 'too large' }, 400, headers);
  let body = null;
  try { body = JSON.parse(text); } catch (_) { body = null; }
  const hit = validHit(body);
  if (!hit) return respond({ error: 'invalid' }, 400, headers);

  const ua = request.headers.get('User-Agent') || '';
  const day = new Date().toISOString().slice(0, 10);
  await ensureSchema(env);
  await env.DB.prepare(UPSERT)
    .bind(hit.app, day, countryOf(request), hit.target, hit.fw, hit.result, hit.stage, hit.link, osFromUserAgent(ua), browserFromUserAgent(ua))
    .run();
  if (hit.repo) {
    try { await recordRepo(env, hit, day); } catch (_) {}
  }
  return respond(null, 204, headers);
}

function nextMonth(month) {
  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function pairs(rows, key) {
  return rows.map((r) => [r[key], r.n]);
}

async function handleStats(url, env) {
  const appName = url.searchParams.get('app') || '';
  if (!APPS[appName]) return respond({ error: 'unknown app' }, 400, statsHeaders(0));
  const nowMonth = new Date().toISOString().slice(0, 7);
  const month = url.searchParams.get('month') || nowMonth;
  if (!MONTH.test(month)) return respond({ error: 'bad month' }, 400, statsHeaders(0));
  const from = `${month}-01`;
  const to = `${nextMonth(month)}-01`;

  await ensureSchema(env);
  const db = env.DB;
  const inMonth = 'app = ?1 AND day >= ?2 AND day < ?3';
  const okInMonth = `${inMonth} AND result = 'ok'`;
  const grouped = (col) => db.prepare(`SELECT ${col} AS k, SUM(n) AS n FROM hits WHERE ${okInMonth} GROUP BY ${col} ORDER BY n DESC, k`).bind(appName, from, to);

  const out = await db.batch([
    db.prepare("SELECT DISTINCT substr(day, 1, 7) AS m FROM hits WHERE app = ?1 ORDER BY m").bind(appName),
    db.prepare("SELECT result, stage, SUM(n) AS n FROM hits WHERE app = ?1 GROUP BY result, stage").bind(appName),
    db.prepare("SELECT COUNT(DISTINCT country) AS c, MIN(day) AS first FROM hits WHERE app = ?1 AND result = 'ok'").bind(appName),
    db.prepare(`SELECT day, country, SUM(n) AS n FROM hits WHERE ${okInMonth} GROUP BY day, country ORDER BY day, n DESC`).bind(appName, from, to),
    db.prepare(`SELECT day, stage, SUM(n) AS n FROM hits WHERE ${inMonth} AND result = 'fail' GROUP BY day, stage ORDER BY day`).bind(appName, from, to),
    grouped('target'),
    grouped('fw'),
    grouped('link'),
    grouped('os'),
    grouped('browser'),
    db.prepare(`SELECT target, stage, SUM(n) AS n FROM hits WHERE ${inMonth} AND result = 'fail' GROUP BY target, stage ORDER BY n DESC`).bind(appName, from, to),
  ]);
  const rows = out.map((r) => r.results || []);

  const allTime = { ok: 0, fail: {} };
  for (const r of rows[1]) {
    if (r.result === 'ok') allTime.ok += r.n;
    else allTime.fail[r.stage] = (allTime.fail[r.stage] || 0) + r.n;
  }
  allTime.countries = rows[2].length ? rows[2][0].c || 0 : 0;
  allTime.firstDay = rows[2].length ? rows[2][0].first || null : null;

  const days = {};
  const countryTotals = {};
  let ok = 0;
  for (const r of rows[3]) {
    const d = days[r.day] || (days[r.day] = { day: r.day, ok: 0, fail: {}, countries: [] });
    d.ok += r.n;
    d.countries.push([r.country, r.n]);
    countryTotals[r.country] = (countryTotals[r.country] || 0) + r.n;
    ok += r.n;
  }
  const fail = {};
  for (const r of rows[4]) {
    const d = days[r.day] || (days[r.day] = { day: r.day, ok: 0, fail: {}, countries: [] });
    d.fail[r.stage] = (d.fail[r.stage] || 0) + r.n;
    fail[r.stage] = (fail[r.stage] || 0) + r.n;
  }

  const months = rows[0].map((r) => r.m);
  if (!months.includes(nowMonth)) months.push(nowMonth);
  months.sort();

  const body = {
    app: appName,
    month,
    months,
    generated: new Date().toISOString(),
    allTime,
    totals: { ok, fail, countries: Object.keys(countryTotals).length },
    days: Object.values(days).sort((a, b) => (a.day < b.day ? -1 : 1)),
    byCountry: Object.entries(countryTotals).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
    byTarget: pairs(rows[5], 'k'),
    byFw: pairs(rows[6], 'k'),
    byLink: pairs(rows[7], 'k'),
    byOs: pairs(rows[8], 'k'),
    byBrowser: pairs(rows[9], 'k'),
    failures: rows[10].map((r) => [r.target, r.stage, r.n]),
  };
  if (appName === 'fap') {
    const visible = (r) => !HIDDEN_REPOS.includes(r.repo);
    const repoRows = await db.batch([
      db.prepare(`SELECT repo, name, MAX(last_ts) AS last,
          SUM(CASE WHEN day >= ?1 AND day < ?2 THEN ok ELSE 0 END) AS m_ok,
          SUM(CASE WHEN day >= ?1 AND day < ?2 THEN fail ELSE 0 END) AS m_fail,
          SUM(ok) AS a_ok, SUM(fail) AS a_fail
        FROM fap_repos GROUP BY repo
        HAVING m_ok + m_fail > 0
        ORDER BY m_ok DESC, a_ok DESC, last DESC LIMIT ${REPO_LIST_LIMIT}`).bind(from, to),
      db.prepare(`SELECT repo, name, last_ts, last_ok FROM fap_repos ORDER BY last_ts DESC LIMIT ${RECENT_LIMIT * 2}`),
    ]);
    const seen = new Set();
    const recent = [];
    for (const r of (repoRows[1].results || []).filter(visible)) {
      if (seen.has(r.repo) || recent.length >= RECENT_LIMIT) continue;
      seen.add(r.repo);
      recent.push({ name: r.name, at: r.last_ts, ok: r.last_ok === 1 });
    }
    body.repos = {
      top: (repoRows[0].results || []).filter(visible).map((r) => ({ name: r.name, ok: r.m_ok, fail: r.m_fail, allOk: r.a_ok, allFail: r.a_fail, last: r.last })),
      recent,
    };
  }
  return respond(body, 200, statsHeaders(month === nowMonth ? STATS_MAX_AGE_SECONDS : STATS_MAX_AGE_SECONDS * 30));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') {
        const origin = request.headers.get('Origin') || '';
        if (url.pathname === '/hit' && ALLOWED_ORIGINS.includes(origin)) return respond(null, 204, hitHeaders(origin));
        return respond(null, 204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
      }
      if (!env.DB) return respond({ error: 'statistics database is not bound (binding name: DB)' }, 503, statsHeaders(0));
      if (url.pathname === '/hit' && request.method === 'POST') return await handleHit(request, env);
      if (url.pathname === '/stats' && request.method === 'GET') return await handleStats(url, env);
      if (url.pathname === '/' && request.method === 'GET') {
        return respond({ service: 'foxfw-stats', apps: Object.keys(APPS), endpoints: ['GET /stats?app=<app>&month=YYYY-MM', 'POST /hit'] }, 200, statsHeaders(0));
      }
      return respond({ error: 'not found' }, 404, statsHeaders(0));
    } catch (err) {
      return respond({ error: 'internal error' }, 500, statsHeaders(0));
    }
  },
};
