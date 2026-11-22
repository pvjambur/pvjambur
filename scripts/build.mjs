// Re-mines the profile: pulls contribution data from GitHub, then redraws every
// README image, the game data file and the auto-updated README sections.
//   GH_TOKEN=... node scripts/build.mjs      (in CI the workflow passes the token)
//   node scripts/build.mjs                   (offline: reuses data/profile.json or data/seed.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../docs/art.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const wr = (p, s) => { fs.mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true }); fs.writeFileSync(path.join(ROOT, p), s); };
const cfg = JSON.parse(rd('profile.config.json'));
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const LOGIN = process.env.GH_LOGIN || cfg.login;

// ------------------------------------------------------------------ data
const QUERY = `query($login:String!){ user(login:$login){
  followers{ totalCount }
  repositories(ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC, first:100){ totalCount nodes{ stargazerCount } }
  contributionsCollection{
    totalCommitContributions totalPullRequestContributions totalIssueContributions
    totalPullRequestReviewContributions restrictedContributionsCount
    contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount contributionLevel } } }
    commitContributionsByRepository(maxRepositories:8){
      repository{ name isPrivate description url primaryLanguage{ name } }
      contributions{ totalCount }
    }
  }
}}`;
const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

async function fetchGitHub() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-mine' },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const j = await res.json();
  if (!j.data?.user) throw new Error('GitHub API error: ' + JSON.stringify(j.errors || j));
  const u = j.data.user, c = u.contributionsCollection;
  return {
    seed: false,
    login: LOGIN,
    days: c.contributionCalendar.weeks.flatMap(w => w.contributionDays)
      .map(d => ({ date: d.date, count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0 })),
    publicRepos: u.repositories.totalCount,
    stars: u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0),
    followers: u.followers.totalCount,
    commits: c.totalCommitContributions,
    prs: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    reviews: c.totalPullRequestReviewContributions,
    top: c.commitContributionsByRepository.map(x => ({
      name: x.repository.isPrivate ? 'private repo' : x.repository.name,
      private: x.repository.isPrivate,
      url: x.repository.isPrivate ? '' : x.repository.url,
      desc: x.repository.isPrivate ? '' : (x.repository.description || ''),
      lang: x.repository.primaryLanguage?.name || '',
      commits: x.contributions.totalCount,
    })),
  };
}

async function loadData() {
  if (TOKEN) {
    try {
      const d = await fetchGitHub();
      d.updated = new Date().toISOString().slice(0, 10);
      wr('data/profile.json', JSON.stringify(d, null, 1));
      return d;
    } catch (e) {
      console.warn('could not reach GitHub, falling back to cached data:', e.message);
    }
  }
  for (const f of ['data/profile.json', 'data/seed.json'])
    if (fs.existsSync(path.join(ROOT, f))) { console.log('offline mode, using', f); return JSON.parse(rd(f)); }
  throw new Error('No token and no cached data');
}

function enrich(d) {
  const days = d.days.map(x => ({ ...x }));
  if (days.some(x => x.level === undefined)) {
    const nz = days.map(x => x.count).filter(Boolean).sort((a, b) => a - b);
    const q = (p) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] || 1;
    const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
    for (const x of days) x.level = !x.count ? 0 : x.count <= q1 ? 1 : x.count <= q2 ? 2 : x.count <= q3 ? 3 : 4;
  }
  const total = days.reduce((a, x) => a + x.count, 0);
  const best = days.reduce((b, x) => (x.count > b.count ? x : b), days[0]);
  let longest = 0, run = 0;
  for (const x of days) { run = x.count ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count) current++;
    else if (i === days.length - 1) continue; // today can still be empty
    else break;
  }
  const levelCounts = [0, 0, 0, 0, 0];
  days.forEach(x => levelCounts[x.level]++);
  const months = {};
  days.forEach(x => { const m = x.date.slice(0, 7); months[m] = (months[m] || 0) + x.count; });
  const busiestMonth = Object.entries(months).sort((a, b) => b[1] - a[1])[0];
  return {
    ...d, days, total, best, longest, current, levelCounts,
    activeDays: days.filter(x => x.count).length, months, busiestMonth,
    updated: d.updated || new Date().toISOString().slice(0, 10),
  };
}

// ------------------------------------------------------------------ svg helpers
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const fmtDate = (iso) => { const [y, m, dd] = iso.split('-'); return `${MON[+m - 1]} ${+dd} ${y}`; };

function runs(cells) { // cells: [x,y,color] -> merged horizontal rects
  const byRow = new Map();
  for (const [x, y, c] of cells) { if (!c) continue; const k = y; if (!byRow.has(k)) byRow.set(k, []); byRow.get(k).push([x, c]); }
  let out = '';
  for (const [y, row] of byRow) {
    row.sort((a, b) => a[0] - b[0]);
    let i = 0;
    while (i < row.length) {
      let j = i;
      while (j + 1 < row.length && row[j + 1][0] === row[j][0] + 1 && row[j + 1][1] === row[i][1]) j++;
      out += `<rect x="${row[i][0]}" y="${y}" width="${j - i + 1}" height="1" fill="${row[i][1]}"/>`;
      i = j + 1;
    }
  }
  return out;
}
const gridCells = (rows, colors) => rows.flatMap((r, y) => [...r].map((ch, x) => [x, y, colors[ch] || ''])).filter(c => c[2]);
const pxGroup = (cells, x, y, s, extra = '') => `<g transform="translate(${x} ${y}) scale(${s})"${extra}>${runs(cells)}</g>`;

function blockDefs(names) {
  return names.map(n => {
    const t = A.texture(n);
    const cells = t.map((c, i) => [i % 16, Math.floor(i / 16), c]);
    return `<symbol id="b-${n}" viewBox="0 0 16 16">${runs(cells)}</symbol>`;
  }).join('');
}
const block = (n, x, y, s = 16, extra = '') => `<use href="#b-${n}" x="${x}" y="${y}" width="${s}" height="${s}"${extra}/>`;

// pixel text. align: 'l' | 'c' | 'r'
function text(str, x, y, s, fill, shadow, align = 'l') {
  const { pixels, width } = A.textPixels(str);
  const ox = align === 'c' ? x - (width * s) / 2 : align === 'r' ? x - width * s : x;
  let out = '';
  if (shadow) out += pxGroup(pixels.map(([a, b]) => [a, b, shadow]), ox + s, y + s, s);
  out += pxGroup(pixels.map(([a, b]) => [a, b, fill]), ox, y, s);
  return out;
}
const tw = (str, s) => A.textWidth(str) * s;

function svgDoc(w, h, body, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges"><defs>${defs}</defs>${body}</svg>\n`;
}

// miner sprite. Returns svg group with optional SMIL bits.
function miner(x, y, s, { armAnim = '', bodyAnim = '', legsA = '', legsB = '', outerAnim = '' } = {}) {
  const C = A.MINER_COLORS;
  const body = A.MINER_BODY.slice(0, 14);
  const legs1 = A.MINER_BODY.slice(14);
  const legs2 = ['..NN.NN...', '.NN...NN..', 'KKK...KKK.'];
  const bodyCells = gridCells(body, C);
  const l1 = gridCells(legs1, C).map(([a, b, c]) => [a, b + 14, c]);
  const l2 = gridCells(legs2, C).map(([a, b, c]) => [a, b + 14, c]);
  const arm = gridCells(A.MINER_ARM, C);
  const [px, py] = A.MINER_PIVOT;
  return `<g transform="translate(${x} ${y})">${outerAnim}<g>${bodyAnim}
    <g transform="scale(${s})">${runs(bodyCells)}
      <g>${legsA}${runs(l1)}</g>
      ${legsB ? `<g opacity="0">${legsB}${runs(l2)}</g>` : ''}
      <g>${armAnim.replaceAll('PIV', `${px} ${py}`)}${runs(arm)}</g>
    </g></g></g>`;
}

function crackStages(x, y, s) { // 4 stages of cracks, returns array of svg strings
  const r = A.rng(42);
  const cells = [];
  let cx = 8, cy = 8;
  for (let i = 0; i < 60; i++) {
    cells.push([cx, cy]);
    cx = Math.max(0, Math.min(15, cx + Math.round(r() * 2 - 1)));
    cy = Math.max(0, Math.min(15, cy + Math.round(r() * 2 - 1)));
    if (i % 15 === 14) { cx = 8 + Math.round(r() * 4 - 2); cy = 8 + Math.round(r() * 4 - 2); }
  }
  return [15, 30, 45, 60].map(n => pxGroup(cells.slice(0, n).map(([a, b]) => [a, b, '#000000']), x, y, s / 16, ' opacity="0.55"'));
}

function gemItem(ore, x, y, s) {
  const g = A.gemIcon(ore);
  return pxGroup(g.flatMap((row, yy) => row.map((c, xx) => [xx, yy, c])), x, y, s);
}

// ------------------------------------------------------------------ hero
function hero(D) {
  const W = 1200, H = 400, B = 32;
  const groundY = 272;
  let body = '';
  body += `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  // sun
  body += `<rect x="1060" y="36" width="56" height="56" fill="#fff6c2"/><rect x="1068" y="44" width="40" height="40" fill="#ffe36b"/>`;
  // clouds
  const cloud = (w) => `<rect x="0" y="8" width="${w}" height="16" fill="#fff" opacity=".92"/><rect x="${w * 0.2}" y="0" width="${w * 0.45}" height="8" fill="#fff" opacity=".92"/>`;
  [[90, 60, 70, 0], [140, 120, 95, -30], [110, 30, 80, -55], [70, 150, 60, -15]].forEach(([w, cy, dur, del]) => {
    body += `<g transform="translate(-200 ${cy})"><g>${cloud(w)}<animateTransform attributeName="transform" type="translate" from="0 0" to="${W + 400} 0" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/></g></g>`;
  });
  // title: stone letters with depth
  const title = cfg.name.toUpperCase().replace(/ V /, ' ');
  const ts = 9, tW = tw(title, ts), tx = (W - tW) / 2, ty = 44;
  const { pixels } = A.textPixels(title);
  body += pxGroup(pixels.map(([a, b]) => [a, b, '#1e1e1e']), tx + 6, ty + 8, ts);
  body += pxGroup(pixels.map(([a, b]) => [a, b, '#4a4a4a']), tx + 3, ty + 4, ts);
  body += `<g fill="url(#stonePat)">${pixels.map(([a, b]) => `<rect x="${tx + a * ts}" y="${ty + b * ts}" width="${ts}" height="${ts}"/>`).join('')}</g>`;
  body += pxGroup(pixels.filter(([a, b]) => !pixels.some(([c, d]) => c === a && d === b - 1)).map(([a, b]) => [a, b * 3, '#c8c8c8']), tx, ty, ts, '').replace(/scale\(9\)/, `scale(${ts} ${ts / 3})`);
  // tagline, pulsing
  const tag = cfg.tagline, tgS = 3, tgW = tw(tag, tgS);
  body += `<g transform="translate(${W / 2} ${ty + 7 * ts + 46}) rotate(-2)"><g>
    <animateTransform attributeName="transform" type="scale" values="1;1.05;1" dur="1.2s" repeatCount="indefinite"/>
    ${text(tag, -tgW / 2, -10, tgS, '#ffff55', '#3f3f15')}</g></g>`;
  body += text(cfg.subline, W / 2, ty + 7 * ts + 76, 2, '#ffffff', '#2a3a55', 'c');
  // ground
  const cols = Math.ceil(W / B);
  const r = A.rng(7);
  for (let i = 0; i < cols; i++) {
    body += block('grass', i * B, groundY, B);
    body += block('dirt', i * B, groundY + B, B);
    for (let k = 2; k < 4; k++) {
      const v = r();
      const n = v < 0.06 ? 'diamond' : v < 0.12 ? 'gold' : v < 0.2 ? 'iron' : v < 0.3 ? 'coal' : 'stone';
      body += block(n, i * B, groundY + k * B, B);
    }
  }
  // tree
  const tX = 64;
  for (let k = 1; k <= 3; k++) body += block('log', tX, groundY - k * B, B);
  for (let dx = -2; dx <= 2; dx++) for (let dy = 3; dy <= 4; dy++) if (Math.abs(dx) < 2 || dy === 3) body += block('leaf', tX + dx * B, groundY - (dy + 1) * B, B);
  body += block('leaf', tX, groundY - 6 * B, B);
  // miner mining a diamond block on the surface
  const ms = 4, mx = 836, my = groundY - 17 * ms;
  const T = 3;
  const swing = `<animateTransform attributeName="transform" type="rotate" values="0 PIV;105 PIV;-5 PIV;105 PIV;-5 PIV;105 PIV;0 PIV;0 PIV" keyTimes="0;.1;.25;.35;.5;.6;.75;1" dur="${T}s" repeatCount="indefinite"/>`;
  body += miner(mx, my, ms, { armAnim: swing });
  const bx = mx + 13 * ms, by = groundY - B;
  body += `<g>${block('diamond', bx, by, B)}<animate attributeName="opacity" values="1;1;0;0;1;1" keyTimes="0;.62;.63;.95;.96;1" dur="${T}s" repeatCount="indefinite"/></g>`;
  crackStages(bx, by, B).forEach((c, i) => {
    const on = [0.1, 0.35, 0.5, 0.6][i];
    body += `<g opacity="0">${c}<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;${on};.63;1" calcMode="discrete" dur="${T}s" repeatCount="indefinite"/></g>`;
  });
  body += particles(bx + B / 2, by + B / 2, ['#5ae6ee', '#1c9aa6', '#7f7f7f', '#d8ffff'], T, 0.63, 0.85, 4);
  body += `<g opacity="0">${gemItem('diamond', bx + 6, by + 6, 1.3)}<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.63;.64;.9;1" dur="${T}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -22;0 -30" keyTimes="0;.63;.8;1" dur="${T}s" repeatCount="indefinite"/></g>`;
  // play hint
  body += text('▶ CLICK TO PLAY THE MINE', W - 24, H - 28, 2, '#ffffff', '#000000', 'r');
  const defs = blockDefs(['grass', 'dirt', 'stone', 'coal', 'iron', 'gold', 'diamond', 'log', 'leaf']) +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f9ff7"/><stop offset="1" stop-color="#bcd6ff"/></linearGradient>
     <pattern id="stonePat" patternUnits="userSpaceOnUse" width="48" height="48"><use href="#b-stone" width="48" height="48"/></pattern>`;
  return svgDoc(W, H, body, defs);
}

function particles(cx, cy, colors, T, t0, t1, s) {
  const r = A.rng(99);
  let out = '';
  for (let i = 0; i < 10; i++) {
    const dx = (r() * 2 - 1) * 34, up = -10 - r() * 22, c = colors[i % colors.length];
    out += `<rect x="${cx}" y="${cy}" width="${s}" height="${s}" fill="${c}" opacity="0">
      <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${t0};${t0 + 0.001};${t1 - 0.05};${t1};1" dur="${T}s" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 0;${dx * 0.6} ${up};${dx} ${-up * 0.8};${dx} ${-up * 0.8}" keyTimes="0;${t0};${(t0 + t1) / 2};${t1};1" dur="${T}s" repeatCount="indefinite"/></rect>`;
  }
  return out;
}

// ------------------------------------------------------------------ the mine (heatmap)
function mine(D) {
  const B = 16, X0 = 56, GY = 120;
  const weeks = [];
  D.days.forEach((d) => {
    const wd = new Date(d.date + 'T00:00:00Z').getUTCDay();
    if (!weeks.length || wd === 0) weeks.push([]);
    weeks[weeks.length - 1][wd] = d;
  });
  const W = X0 + weeks.length * B + 40, H = GY + B * 9 + 70;
  let body = `<rect width="${W}" height="${H}" fill="#0f1218"/>`;
  body += `<rect width="${W}" height="${GY}" fill="url(#msky)"/>`;
  body += text(`THE MINE · ${D.total} CONTRIBUTIONS IN THE LAST YEAR`, 24, 14, 3, '#ffffff', '#1b2a44');
  body += text(`EVERY DAY IS A BLOCK. MORE CONTRIBUTIONS, RARER ORE.`, 24, 44, 2, '#dfe8ff', '#1b2a44');
  // month labels
  let lastM = -1, lastI = -9;
  weeks.forEach((w, i) => {
    const d = w.find(Boolean); const m = +d.date.slice(5, 7) - 1;
    if (m !== lastM) {
      if (i - lastI >= 3 && i < weeks.length - 2) { body += text(MON[m], X0 + i * B, 66, 2, '#ffffff', '#1b2a44'); lastI = i; }
      lastM = m;
    }
  });
  // surface
  for (let i = -3; i < weeks.length + 2; i++) body += block('grass', X0 + i * B, GY, B);
  // days
  const sparkles = [];
  let bestPos = null;
  weeks.forEach((w, i) => {
    for (let wd = 0; wd < 7; wd++) {
      const x = X0 + i * B, y = GY + B * (wd + 1);
      const d = w[wd];
      if (!d) { body += block('stone', x, y, B, ' opacity=".35"'); continue; }
      let ore = A.LEVEL_ORE[d.level];
      if (d === D.best || d.date === D.best.date) { ore = 'emerald'; bestPos = [x, y, i]; continue; }
      body += block(ore, x, y, B);
      if (!d.count) body += `<rect x="${x}" y="${y}" width="${B}" height="${B}" fill="#000" opacity=".38"/>`;
      if (ore === 'diamond' || ore === 'gold') sparkles.push([x, y]);
    }
  });
  for (let i = -3; i < weeks.length + 2; i++) body += block('bed', X0 + i * B, GY + B * 8, B);
  body += `<rect x="0" y="${GY}" width="${X0 - 3 * B}" height="${B * 9}" fill="#0f1218"/>`;
  ['M', 'W', 'F'].forEach((l, k) => { body += text(l, X0 - 18, GY + B * (2 * k + 2) + 1, 2, '#c9d1e0'); });
  // sparkles
  const r = A.rng(5);
  sparkles.forEach(([x, y]) => {
    const dl = (r() * 4).toFixed(2), sx = x + 3 + Math.floor(r() * 9), sy = y + 3 + Math.floor(r() * 9);
    body += `<g opacity="0"><rect x="${sx}" y="${sy - 1}" width="1" height="3" fill="#fff"/><rect x="${sx - 1}" y="${sy}" width="3" height="1" fill="#fff"/>
      <animate attributeName="opacity" values="0;1;0" dur="1.6s" begin="${dl}s" repeatCount="indefinite"/></g>`;
  });
  // the miner walks to the best day and mines it
  const T = 12;
  const [bx, by, bi] = bestPos;
  const ms = 2, my = GY - 17 * ms;
  const xStart = X0 - 60, xT = bx - 20, xEnd = W + 40;
  const outer = `<animateTransform attributeName="transform" type="translate" values="${xStart} ${my};${xT} ${my};${xT} ${my};${xEnd} ${my}" keyTimes="0;.38;.72;1" dur="${T}s" repeatCount="indefinite"/>`;
  const sw = [0, 0];
  const kt = [0, 0.38];
  for (let k = 0; k < 5; k++) { sw.push(105, -5); kt.push(+(0.40 + k * 0.06).toFixed(3), +(0.43 + k * 0.06).toFixed(3)); }
  sw.push(0, 0); kt.push(0.72, 1);
  const armAnim = `<animateTransform attributeName="transform" type="rotate" values="${sw.map(a => a + ' PIV').join(';')}" keyTimes="${kt.join(';')}" dur="${T}s" repeatCount="indefinite"/>`;
  const bobVals = [], bobKt = [], legA = [], legB = [], legKt = [];
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const walking = t < 0.38 || t > 0.72;
    const k = Math.round(t * 50) % 2;
    bobVals.push(`0 ${walking && k ? -1 : 0}`); bobKt.push(+t.toFixed(2));
    legA.push(walking && k ? 0 : 1); legB.push(walking && k ? 1 : 0); legKt.push(+t.toFixed(2));
  }
  bobKt[bobKt.length - 1] = 1; legKt[legKt.length - 1] = 1;
  const disc = (vals) => `values="${vals.join(';')}" keyTimes="${legKt.join(';')}" calcMode="discrete" dur="${T}s" repeatCount="indefinite"`;
  body += miner(0, 0, ms, {
    outerAnim: outer, armAnim,
    bodyAnim: `<animateTransform attributeName="transform" type="translate" values="${bobVals.join(';')}" keyTimes="${bobKt.join(';')}" calcMode="discrete" dur="${T}s" repeatCount="indefinite"/>`,
    legsA: `<animate attributeName="opacity" ${disc(legA)}/>`,
    legsB: `<animate attributeName="opacity" ${disc(legB)}/>`,
  });
  // best day block, selection box, cracks, break
  body += `<g>${block('emerald', bx, by, B)}<animate attributeName="opacity" values="1;1;0;0;1;1" keyTimes="0;.69;.7;.98;.99;1" dur="${T}s" repeatCount="indefinite"/></g>`;
  body += `<g opacity="0"><rect x="${bx - 1}" y="${by - 1}" width="${B + 2}" height="${B + 2}" fill="none" stroke="#000" stroke-width="2"/><rect x="${bx - 2}" y="${by - 2}" width="${B + 4}" height="${B + 4}" fill="none" stroke="#fff" stroke-width="1"/>
    <animate attributeName="opacity" values="0;1;0;0" keyTimes="0;.38;.7;1" calcMode="discrete" dur="${T}s" repeatCount="indefinite"/></g>`;
  crackStages(bx, by, B).forEach((c, i) => {
    const on = [0.42, 0.5, 0.58, 0.65][i];
    body += `<g opacity="0">${c}<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;${on};.7;1" calcMode="discrete" dur="${T}s" repeatCount="indefinite"/></g>`;
  });
  body += particles(bx + B / 2, by + B / 2, ['#3ee07a', '#138a42', '#7f7f7f', '#c8ffd8'], T, 0.7, 0.8, 2);
  // popup label
  const lbl = `BEST DAY · ${fmtDate(D.best.date)} · ${D.best.count} CONTRIBUTIONS`;
  const lw = tw(lbl, 1) + 16;
  const lx = Math.min(Math.max(8, bx + B / 2 - lw / 2), W - lw - 8), ly = 60;
  body += `<g opacity="0"><rect x="${lx}" y="${ly}" width="${lw}" height="19" fill="#120a1e" stroke="#4b1f8c" stroke-width="2"/>${text(lbl, lx + 8, ly + 6, 1, '#7dffa8')}
    <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.7;.71;.97;1" dur="${T}s" repeatCount="indefinite"/></g>`;
  body += `<g opacity="0">${gemItem('emerald', bx + 3, by + 3, 0.7)}<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;.7;.71;.8;.81;1" dur="${T}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;0 0;-14 ${GY - by - 4};-14 ${GY - by - 4}" keyTimes="0;.7;.8;1" dur="${T}s" repeatCount="indefinite"/></g>`;
  // legend
  const LY = GY + B * 9 + 16;
  body += text('LESS', 24, LY + 1, 2, '#c9d1e0');
  ['stone', 'coal', 'iron', 'gold', 'diamond'].forEach((n, i) => { body += block(n, 82 + i * 20, LY, B); });
  body += `<rect x="82" y="${LY}" width="${B}" height="${B}" fill="#000" opacity=".38"/>`;
  body += text('MORE', 82 + 5 * 20 + 6, LY + 1, 2, '#c9d1e0');
  body += block('emerald', 250, LY, B) + text('BEST DAY', 274, LY + 1, 2, '#7dffa8');
  body += text(`UPDATED ${fmtDate(D.updated)}`, W - 24, LY + 1, 2, '#8a94a8', null, 'r');
  const defs = blockDefs(['grass', 'stone', 'coal', 'iron', 'gold', 'diamond', 'emerald', 'bed']) +
    `<linearGradient id="msky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f6fc9"/><stop offset="1" stop-color="#8fb4f2"/></linearGradient>`;
  return svgDoc(W, H, body, defs);
}

// ------------------------------------------------------------------ inventory
function gui(x, y, w, h) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/>
    <rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="#ffffff"/>
    <rect x="${x + 6}" y="${y + 6}" width="${w - 8}" height="${h - 8}" fill="#555555"/>
    <rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" fill="#c6c6c6"/>`;
}
const slot = (x, y, s = 48) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#ffffff"/><rect x="${x}" y="${y}" width="${s - 3}" height="${s - 3}" fill="#373737"/><rect x="${x + 3}" y="${y + 3}" width="${s - 6}" height="${s - 6}" fill="#8b8b8b"/>`;

function inventory(D) {
  const W = 960, H = 330;
  let body = gui(0, 0, W, H);
  body += text('INVENTORY', 26, 22, 3, '#3f3f3f');
  const items = [
    ['emerald', D.best.count, 'BEST DAY'],
    ['diamond', D.levelCounts[4], 'DIAMOND'],
    ['gold', D.levelCounts[3], 'GOLD'],
    ['iron', D.levelCounts[2], 'IRON'],
    ['coal', D.levelCounts[1], 'COAL'],
    ['chest', D.publicRepos ?? '--', 'REPOS'],
    ['star', D.stars ?? '--', 'STARS'],
    ['pick', D.commits ?? '--', 'COMMITS'],
    ['book', D.prs ?? '--', 'PRS'],
  ];
  const sp = (W - 52) / 9;
  items.forEach(([it, n, lbl], i) => {
    const x = 26 + i * sp + (sp - 72) / 2, y = 58;
    body += slot(x, y, 72);
    if (A.ORES[it]) body += gemItem(it, x + 8, y + 10, 3.5);
    else if (it === 'chest') body += pxGroup(gridCells(A.CHEST, A.CHEST_COLORS), x + 8, y + 12, 4);
    else if (it === 'star') body += pxGroup(gridCells(A.STAR, { '#': '#ffd84a' }), x + 6, y + 12, 4);
    else if (it === 'pick') body += pxGroup(gridCells(A.PICK, { G: '#b8bec4', T: '#8a5a2b' }), x + 4, y + 14, 4);
    else if (it === 'book') body += pxGroup(gridCells(A.BOOK, A.BOOK_COLORS), x + 12, y + 14, 4);
    body += text(String(n), x + 67, y + 46, 3, '#ffffff', '#3f3f3f', 'r');
    body += text(lbl, x + 36, y + 84, 2, '#3f3f3f', null, 'c');
  });
  const lines = [
    ['TOTAL', D.total], ['ACTIVE DAYS', D.activeDays], ['BUSIEST MONTH', `${MON[+D.busiestMonth[0].slice(5) - 1]} ${D.busiestMonth[0].slice(0, 4)} (${D.busiestMonth[1]})`],
    ['LONGEST STREAK', `${D.longest} DAYS`], ['CURRENT STREAK', `${D.current} DAYS`], ['BEST DAY', fmtDate(D.best.date)],
  ];
  const py = 178, ph = 128;
  body += `<rect x="26" y="${py}" width="${W - 52}" height="${ph}" fill="#ffffff"/><rect x="26" y="${py}" width="${W - 55}" height="${ph - 3}" fill="#373737"/><rect x="29" y="${py + 3}" width="${W - 58}" height="${ph - 6}" fill="#1e1e1e"/>`;
  const colW = (W - 52) / 2;
  lines.forEach(([k, v], i) => {
    const cx = 26 + (i < 3 ? 0 : colW), y = py + 18 + (i % 3) * 36;
    body += text(k, cx + 20, y, 2, '#a8a8a8');
    body += text(String(v), cx + colW - 22, y, 2, '#ffff55', null, 'r');
  });
  return svgDoc(W, H, body, '');
}

// ------------------------------------------------------------------ top veins (repos)
function veins(D) {
  const W = 960;
  const list = D.top?.length ? D.top.slice(0, 6) : null;
  const rows = list || (D.recent || []).slice(0, 6);
  const H = 64 + rows.length * 34 + 16;
  let body = `<rect width="${W}" height="${H}" fill="#14161c"/>`;
  for (let i = 0; i < W / 16; i++) { body += block('deep', i * 16, 0, 16) + block('deep', i * 16, H - 16, 16); }
  body += `<rect x="0" y="16" width="${W}" height="${H - 32}" fill="#14161c"/>`;
  body += text(list ? 'TOP VEINS · COMMITS PER REPO, LAST YEAR' : 'RECENT VEINS · LAST MINED', 24, 30, 2, '#ffffff', '#000');
  const max = list ? Math.max(...list.map(x => x.commits)) : 1;
  rows.forEach((r, i) => {
    const y = 64 + i * 34;
    let name = r.name.toUpperCase();
    if (name.length > 24) name = name.slice(0, 23) + '.';
    body += block(['diamond', 'gold', 'iron', 'coal', 'coal', 'coal'][i], 24, y - 1, 20);
    body += text(name, 56, y + 4, 2, '#e8e8e8');
    if (list) {
      const n = Math.max(1, Math.round((r.commits / max) * 24));
      for (let k = 0; k < n; k++) body += block(k === n - 1 ? 'diamond' : 'gold', 380 + k * 20, y - 1, 20);
      body += text(String(r.commits), 380 + n * 20 + 10, y + 4, 2, '#ffff55');
    } else {
      body += text(fmtDate(r.pushed), W - 24, y + 4, 2, '#ffff55', null, 'r');
    }
  });
  return svgDoc(W, H, body, blockDefs(['gold', 'diamond', 'iron', 'coal', 'deep']));
}

// ------------------------------------------------------------------ chest buttons
function button(label, sub, icon, W = 860, H = 72) {
  let body = `<rect width="${W}" height="${H}" fill="#000"/><rect x="2" y="2" width="${W - 4}" height="${H - 4}" fill="#aaaaaa"/>
    <rect x="4" y="4" width="${W - 6}" height="${H - 6}" fill="#4a4a4a"/><rect x="4" y="4" width="${W - 8}" height="${H - 8}" fill="#727272"/>`;
  if (icon.startsWith('gem:')) body += block(icon.slice(4), 16, 12, 48);
  else body += `<rect x="16" y="12" width="48" height="48" fill="#2a2a2a"/>` + pxGroup(gridCells(A.CHEST, A.CHEST_COLORS), 19, 19, 3);
  body += text(label.toUpperCase(), 84, 16, 3, '#ffffff', '#3a3a3a');
  if (sub) body += text(sub, 84, 46, 2, '#e6e6e6', '#3a3a3a');
  body += text('OPEN ▼', W - 20, 30, 2, '#ffff55', '#3f3f15', 'r');
  const defs = icon.startsWith('gem:') ? blockDefs([icon.slice(4)]) : '';
  return svgDoc(W, H, body, defs);
}

function playButton() {
  const W = 560, H = 96;
  let body = `<rect width="${W}" height="${H}" fill="#000"/>
    <rect x="3" y="3" width="${W - 6}" height="${H - 6}" fill="#8ee05a"/>
    <rect x="6" y="6" width="${W - 9}" height="${H - 9}" fill="#2e6b1a"/><rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="#4f9e2c"/>
    <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#ffff55" stroke-width="3"><animate attributeName="opacity" values="0;1;0" dur="1.4s" repeatCount="indefinite"/></rect>`;
  body += text('▶ PLAY THE MINE', W / 2, 20, 4, '#ffffff', '#1f4a10', 'c');
  body += text('PLAYABLE IN YOUR BROWSER', W / 2, 64, 2, '#eaffd8', '#1f4a10', 'c');
  return svgDoc(W, H, body, '');
}

// ------------------------------------------------------------------ README sections
const ASCII_TITLE = String.raw`██████╗ ██████╗  █████╗ ███╗   ██╗ █████╗ ██╗   ██╗
██╔══██╗██╔══██╗██╔══██╗████╗  ██║██╔══██╗██║   ██║
██████╔╝██████╔╝███████║██╔██╗ ██║███████║██║   ██║
██╔═══╝ ██╔══██╗██╔══██║██║╚██╗██║██╔══██║╚██╗ ██╔╝
██║     ██║  ██║██║  ██║██║ ╚████║██║  ██║ ╚████╔╝
╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝  ╚═══╝
     ██╗ █████╗ ███╗   ███╗██████╗ ██╗   ██╗██████╗
     ██║██╔══██╗████╗ ████║██╔══██╗██║   ██║██╔══██╗
     ██║███████║██╔████╔██║██████╔╝██║   ██║██████╔╝
██   ██║██╔══██║██║╚██╔╝██║██╔══██╗██║   ██║██╔══██╗
╚█████╔╝██║  ██║██║ ╚═╝ ██║██████╔╝╚██████╔╝██║  ██║
 ╚════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝`;

function asciiBlock(D) {
  const row = (k, v) => `  ${(k + ' ').padEnd(34, '.')} ${v}`;
  const now = cfg.experience[0];
  return ['```text', ASCII_TITLE, '',
    `  > loading world "${D.login}" ...`,
    `  [${'#'.repeat(40)}] 100%`, '',
    row('generating terrain', `${D.days.length} days`),
    row('placing ore', `${D.total} contributions`),
    row('richest vein', `${D.best.date} (${D.best.count})`),
    row('longest tunnel', `${D.longest} day streak`),
    row('diamond days', `${D.levelCounts[4]}`),
    row('hidden chests', `${cfg.projects.length} projects`),
    row('player status', `${now.role} @ ${now.org}`),
    '```'].join('\n');
}

function chests() {
  const out = [];
  cfg.projects.forEach((p, i) => {
    const file = `assets/chest-${i}.svg`;
    out.push(`<details>\n<summary><img src="${file}" alt="${p.name}" width="95%"></summary>\n\n` +
      `${p.what}\n\nStack: ${p.stack}` + (p.url ? `  \n[${/github\.com/.test(p.url) ? 'Open the repo' : 'Open the demo'}](${p.url})` : '') + `\n\n</details>`);
  });
  const xp = cfg.experience.map(e => `- ${e.org}, ${e.role}${e.when ? ` (${e.when})` : ''}. ${e.what}`).join('\n');
  out.push(`<details>\n<summary><img src="assets/chest-xp.svg" alt="Experience" width="95%"></summary>\n\n${xp}\n\n</details>`);
  const rs = [...cfg.research, ...cfg.side].map(x => `- ${x}`).join('\n');
  out.push(`<details>\n<summary><img src="assets/chest-research.svg" alt="Research and side quests" width="95%"></summary>\n\n${rs}\n\n</details>`);
  return out.join('\n\n');
}

function linkBadges() {
  const L = cfg.links, b = [];
  const badge = (label, color, logo, href) => `<a href="${href}"><img src="https://img.shields.io/badge/${encodeURIComponent(label)}-${color}?style=for-the-badge&logo=${logo}&logoColor=white" alt="${label}"></a>`;
  if (cfg.gameUrl) b.push(badge('Play the mine', '4F9E2C', 'githubpages', cfg.gameUrl));
  if (L.website) b.push(badge('Website', '3F3F3F', 'googlechrome', L.website));
  if (L.linkedin) b.push(badge('LinkedIn', '0A66C2', 'linkedin', L.linkedin));
  if (L.email) b.push(badge('Email', 'EA4335', 'gmail', 'mailto:' + L.email));
  if (L.leetcode) b.push(badge('LeetCode', 'FFA116', 'leetcode', L.leetcode));
  if (L.codeforces) b.push(badge('Codeforces', '1F8ACB', 'codeforces', L.codeforces));
  return `<p align="center">\n  ${b.join('\n  ')}\n</p>`;
}

function replaceBetween(src, tag, content) {
  const re = new RegExp(`(<!-- ${tag}:START -->)[\\s\\S]*?(<!-- ${tag}:END -->)`);
  return re.test(src) ? src.replace(re, `$1\n${content}\n$2`) : src;
}

// ------------------------------------------------------------------ main
const D = enrich(await loadData());
wr('assets/hero.svg', hero(D));
wr('assets/mine.svg', mine(D));
wr('assets/inventory.svg', inventory(D));
wr('assets/veins.svg', veins(D));
wr('assets/play.svg', playButton());
cfg.projects.forEach((p, i) => wr(`assets/chest-${i}.svg`, button(p.name, p.short, `gem:${p.gem}`)));
wr('assets/chest-xp.svg', button('Experience', `${cfg.experience.length} STOPS SO FAR · CURRENTLY ${cfg.experience[0].org.toUpperCase()}`, 'chest'));
wr('assets/chest-research.svg', button('Research & side quests', 'IEEE PAPERS · SPRINGER NATURE · LEETCODE · CODEFORCES', 'chest'));
const game = { ...cfg, stats: { ...D, days: undefined }, days: D.days };
wr('docs/data.js', `// generated by scripts/build.mjs\nwindow.PROFILE = ${JSON.stringify(game)};\n`);
if (fs.existsSync(path.join(ROOT, 'README.md'))) {
  let readme = rd('README.md');
  readme = replaceBetween(readme, 'ASCII', asciiBlock(D));
  readme = replaceBetween(readme, 'CHESTS', chests());
  readme = replaceBetween(readme, 'LINKS', linkBadges());
  wr('README.md', readme);
}
console.log(`mined ${D.total} contributions over ${D.days.length} days; best ${D.best.date} (${D.best.count})`);
