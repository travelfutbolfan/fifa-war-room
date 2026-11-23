const CONF_ORDER = ['UEFA', 'CAF', 'AFC', 'CONCACAF', 'OFC', 'CONMEBOL'];
const CAND_NAME = { inf: 'Infantino', diallo: 'Diallo', tashima: 'Tashima', none: 'No pick yet' };
const KIND_LABEL = { withdrawal: 'Support withdrawn', endorsement: 'Endorsement', bloc: 'Confederation', candidacy: 'Candidacy', rule: 'Process', context: 'Context', note: 'Note' };
const DAY = 86400000;
const baseCand = (s) => ({ inf_d: 'inf', inf_b: 'inf', diallo_d: 'diallo', diallo_b: 'diallo', tashima: 'tashima' }[s] || 'none');
const state = { view: 'map', colorBy: 'pledge', tiles: false, tlFocus: null, mode: 'reported', brush: 'inf', focus: null, pinned: null, hover: null, evId: null, evNames: new Set(), replayIdx: null, replayT: Infinity, replayLabel: '' };
const scen = {};
const fmtDay = d3.utcFormat('%b %-d, %Y');
const fmtShort = d3.utcFormat('%b %-d');
const parseDay = d3.utcParse('%Y-%m-%d');

/* view state from the link: #map, #map-confed, #whatif, #timeline, #learn */
const hashMatch = /^(map|whatif|timeline|learn)(-confed)?$/.exec((location.hash || '').slice(1));
if (hashMatch) { state.view = hashMatch[1]; state.colorBy = hashMatch[2] ? 'confed' : 'pledge'; }
function deriveMode() { state.mode = state.view === 'whatif' ? 'whatif' : state.view === 'timeline' ? 'replay' : state.colorBy === 'confed' ? 'blocs' : 'reported'; }
deriveMode();

const effCand = (a) => scen[a.name] || baseCand(a.status);
const RS_LABEL = { inf_d: 'Infantino, declared', inf_b: 'Infantino, via confederation', diallo_d: 'Diallo, declared', diallo_b: 'Diallo, via UEFA', tashima: 'Tashima, declared', anti: 'Against Infantino, no candidate named', und: 'No position found', unk: 'Nothing dated yet' };
let rcache = { t: null, A: null, E: null, map: null };
function replayMap(T) {
  const A = dash.data('associations'), E = dash.data('events');
  if (A.status !== 'ok' || E.status !== 'ok') return null;
  if (rcache.t === T && rcache.A === A.data && rcache.E === E.data) return rcache.map;
  const byName = new Map(A.data.map((a) => [a.name, a]));
  const m = new Map(A.data.map((a) => [a.name, 'unk']));
  E.data.filter((e) => { const d = parseDay(e.date); return d && d.getTime() <= T; })
    .sort((x, y) => String(x.date).localeCompare(String(y.date)) || x.id - y.id)
    .forEach((e) => expandMembers(e, A.data).forEach((n) => {
      const a = byName.get(n); if (!a) return;
      if (e.kind === 'withdrawal') m.set(n, 'anti');
      else if (e.kind === 'endorsement') m.set(n, 'inf_d');
      else if (e.kind === 'bloc') { const bs = a.conf === 'UEFA' ? 'diallo_b' : 'inf_b'; if (a.status === bs || (bs === 'inf_b' && a.status === 'inf_d')) m.set(n, bs); }
      else if (e.kind === 'candidacy' && (a.status === 'diallo_d' || a.status === 'tashima')) m.set(n, a.status);
    }));
  rcache = { t: T, A: A.data, E: E.data, map: m };
  return m;
}
const effStatus = (a) => {
  if (state.mode === 'replay' && state.replayT !== Infinity) { const m = replayMap(state.replayT); if (m) return m.get(a.name) || a.status; }
  return a.status;
};
const keyOf = (a) => (state.mode === 'whatif' ? effCand(a) : state.mode === 'blocs' ? a.conf : effStatus(a));
const clsOf = (a) => (state.mode === 'whatif' ? 'c-' + effCand(a) : state.mode === 'blocs' ? 'k-' + a.conf : 's-' + effStatus(a));
const posText = (a) => (state.mode === 'whatif' ? CAND_NAME[effCand(a)] + (scen[a.name] ? ' (your pick)' : ' (from reports)') : state.mode === 'blocs' ? a.conf : state.mode === 'replay' ? RS_LABEL[effStatus(a)] : a.position);
const el$ = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const safeUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

/* events: which associations does a logged event touch, and is it inside the time range */
const eventDate = (e) => parseDay(e.date);
const inRange = () => true;
const expandMembers = (e, assoc) => String(e.members || '').split('|').filter(Boolean)
  .flatMap((t) => (t.startsWith('conf:') ? assoc.filter((a) => a.conf === t.slice(5)).map((a) => a.name) : [t]));
function changedNames() {
  const A = dash.data('associations'), E = dash.data('events');
  const s = new Set();
  if (A.status === 'ok' && E.status === 'ok') E.data.filter(inRange).forEach((e) => expandMembers(e, A.data).forEach((n) => s.add(n)));
  return s;
}
const isDim = (a, changed) => (state.focus && keyOf(a) !== state.focus) || (state.mode === 'momentum' && !changed.has(a.name));

const REDRAW = ['replay', 'map', 'grid', 'detail', 'topbar', 'alerts', 'alertnote', 'latest', 'cands', 'news', 'fact', 'cnt'];
function redraw() { REDRAW.forEach((n) => dash.draw(n)); }
function pick(list) {
  if (!list || !list.length) return;
  if (state.mode === 'whatif') list.forEach((a) => { scen[a.name] = state.brush; });
  state.pinned = list[0].name;
  if (state.view === 'timeline') { state.tlFocus = state.pinned; redraw(); return; }
  if (state.view === 'learn') { state.view = 'map'; changed(); return; }
  redraw();
}

/* ---------- calcs ---------- */
dash.calc('tally', {
  title: 'Votes by reported position',
  description: 'Member associations counted by the position reported for each.',
  inputs: ['associations'],
  fn: (associations) => {
    const order = [['inf_d', 'Infantino, declared'], ['inf_b', 'Infantino, via confederation'], ['diallo_d', 'Diallo, declared'],
      ['diallo_b', 'Diallo, via UEFA'], ['tashima', 'Tashima, declared'], ['anti', 'Against Infantino, no candidate named'], ['und', 'No position found']];
    const rows = order.map(([key, label]) => ({ key, label, count: associations.filter((a) => a.status === key).length }));
    const sum = (ks) => rows.filter((r) => ks.includes(r.key)).reduce((s, r) => s + r.count, 0);
    rows.push({ key: 'inf_total', label: 'Infantino, all endorsements', count: sum(['inf_d', 'inf_b']) });
    rows.push({ key: 'diallo_total', label: 'Diallo, all endorsements', count: sum(['diallo_d', 'diallo_b']) });
    return rows;
  },
});

/* ---------- generic number drawings ---------- */
const whereKey = (el) => (el.getAttribute('data-where') || '').split('=')[1];
dash.draw('cnt', (el) => {
  const t = dash.data('tally');
  const r = t.status === 'ok' ? t.data.find((x) => x.key === whereKey(el)) : null;
  el.textContent = r ? String(r.count) : '—';
});
dash.draw('fact', (el) => {
  const f = dash.data('facts');
  const r = f.status === 'ok' ? f.data.find((x) => x.key === whereKey(el)) : null;
  if (!r) { el.textContent = '—'; return; }
  if (r.key === 'asof') { const d = parseDay(r.value); el.textContent = d ? d3.utcFormat('%B %-d, %Y')(d) : String(r.value); return; }
  el.textContent = String(r.value);
});

/* ---------- scoreboard: one function feeds the top bar and the share image ---------- */
function score() {
  const f = dash.data('facts'), A = dash.data('associations');
  if (f.status !== 'ok' || A.status !== 'ok') return null;
  const members = +f.data.find((r) => r.key === 'members').value;
  const maj = +f.data.find((r) => r.key === 'majority').value;
  const wi = state.mode === 'whatif', rp = state.mode === 'replay';
  let cands, segs;
  if (wi) {
    const c = { inf: 0, diallo: 0, tashima: 0, none: 0 };
    A.data.forEach((a) => { c[effCand(a)] += 1; });
    cands = ['inf', 'diallo', 'tashima'].map((k) => ({ cls: 'c-' + k, name: CAND_NAME[k], n: c[k] }));
    segs = ['inf', 'diallo', 'tashima', 'none'].map((k) => ({ cls: 'c-' + k, n: c[k], label: CAND_NAME[k] }));
  } else {
    const c = {};
    A.data.forEach((a) => { const k = effStatus(a); c[k] = (c[k] || 0) + 1; });
    const g = (k) => c[k] || 0;
    cands = [{ cls: 'c-inf', name: 'Infantino', n: g('inf_d') + g('inf_b') }, { cls: 'c-diallo', name: 'Diallo', n: g('diallo_d') + g('diallo_b') }, { cls: 'c-tashima', name: 'Tashima', n: g('tashima') }];
    const keys = ['inf_d', 'inf_b', 'diallo_d', 'diallo_b', 'tashima', 'anti', 'und'].concat(rp ? ['unk'] : []);
    segs = keys.map((k) => ({ cls: 's-' + k, n: g(k), label: RS_LABEL[k] }));
  }
  const tag = wi ? 'What-if scenario' : rp ? 'Replay: ' + (state.replayLabel || 'today') : 'Reported pledges';
  return { members, maj, cands, segs, tag };
}

dash.draw('topbar', (el) => {
  const sc = score();
  if (!sc) { el.replaceChildren(); return; }
  const { members, maj, cands, segs, tag } = sc;
  const top = el$('div', 'tally-top');
  cands.forEach((c) => {
    const won = c.n >= maj;
    const box = el$('div', 'ct ' + c.cls + (won ? ' win' : ''));
    box.append(el$('b', '', String(c.n)), el$('span', '', c.name), el$('i', '', won ? 'Majority reached' : (maj - c.n) + ' short of ' + maj));
    top.appendChild(box);
  });
  top.appendChild(el$('span', 'tally-tag', tag));
  const track = el$('div', 'tally-track');
  track.setAttribute('role', 'img');
  track.setAttribute('aria-label', segs.map((x) => x.label + ' ' + x.n).join(', '));
  segs.forEach((x) => { const seg = el$('div', 'tally-seg ' + x.cls); seg.style.flex = x.n + ' 1 0'; track.appendChild(seg); });
  const bar = el$('div', 'tally-bar');
  const pct = (maj / members) * 100;
  const mark = el$('div', 'tally-mark' + (pct > 70 ? ' flip' : ''));
  mark.style.left = pct + '%';
  mark.appendChild(el$('span', '', 'Majority: ' + maj));
  bar.append(track, mark);
  el.replaceChildren(top, bar);
});

/* ---------- replay steps ---------- */
dash.calc('steps', {
  title: 'Replay steps',
  description: 'Dated events that change a position, grouped by day, oldest first.',
  inputs: ['events'],
  fn: (events) => {
    const by = new Map();
    events.filter((e) => ['withdrawal', 'endorsement', 'bloc', 'candidacy'].includes(e.kind)).forEach((e) => {
      if (!by.has(e.date)) by.set(e.date, []);
      by.get(e.date).push(e.headline);
    });
    return [...by.keys()].sort().map((date) => ({ date, text: by.get(date).join(' · ') }));
  },
});

/* ---------- countdown to the vote ---------- */
dash.draw('countdown', {
  mount(el) {
    const box = el$('div', 'cd');
    const parts = ['days', 'hrs', 'min', 'sec'].map((lab) => { const c = el$('div', 'cd-c'); const b = el$('b', '', '—'); c.append(b, el$('span', '', lab)); box.appendChild(c); return b; });
    el.replaceChildren(el$('span', 'cmd-label', 'Until the vote'), box);
    const made = { parts, target: null, timer: null };
    made.tick = () => {
      if (made.target === null) return;
      let ms = Math.max(0, made.target - Date.now());
      const d = Math.floor(ms / DAY); ms -= d * DAY;
      const h = Math.floor(ms / 3600000); ms -= h * 3600000;
      const m = Math.floor(ms / 60000); ms -= m * 60000;
      const sec = Math.floor(ms / 1000);
      [d, h, m, sec].forEach((v, i) => { parts[i].textContent = String(v).padStart(i === 0 ? 1 : 2, '0'); });
    };
    return made;
  },
  update(el, made) {
    const f = dash.data('facts');
    const r = f.status === 'ok' ? f.data.find((x) => x.key === 'congress') : null;
    const d = r ? d3.utcParse('%d %B %Y')(String(r.value)) : null;
    made.target = d ? d.getTime() - 3600000 : null;
    made.tick();
    if (!made.timer) made.timer = setInterval(made.tick, 1000);
  },
  unmount(el, made) { if (made && made.timer) clearInterval(made.timer); },
});

/* ---------- replay controls ---------- */
dash.draw('replay', {
  mount(el) {
    const play = el$('button', 'rp-play', 'Play'); play.type = 'button';
    const range = el$('input'); range.type = 'range'; range.min = '0'; range.step = '1'; range.setAttribute('aria-label', 'Replay position');
    const date = el$('span', 'rp-date', '');
    const row = el$('div', 'rp-row'); row.append(play, range, date);
    const text = el$('div', 'rp-text', '');
    el.replaceChildren(row, text);
    const made = { play, range, date, text, timer: null, n: 0, steps: [] };
    const stop = () => { if (made.timer) { clearInterval(made.timer); made.timer = null; } play.textContent = 'Play'; };
    const apply = (i) => { state.replayIdx = i; redraw(); };
    range.oninput = () => { stop(); apply(+range.value); };
    play.onclick = () => {
      if (made.timer) { stop(); return; }
      if (state.replayIdx === null || state.replayIdx >= made.n) apply(0);
      play.textContent = 'Pause';
      made.timer = setInterval(() => { if (state.replayIdx >= made.n) { stop(); return; } apply(state.replayIdx + 1); }, 1100);
    };
    made.stop = stop;
    return made;
  },
  update(el, made) {
    const S = dash.data('steps');
    if (S.status !== 'ok' || !S.data.length) return;
    made.steps = S.data; made.n = S.data.length + 1;
    made.range.max = String(made.n);
    if (state.replayIdx === null || state.replayIdx > made.n) state.replayIdx = made.n;
    const i = state.replayIdx;
    let label, body, T;
    if (i === 0) { const d = parseDay(made.steps[0].date); T = d.getTime() - DAY; label = 'Start'; body = 'Before ' + fmtDay(d) + ': no dated positions in the log yet.'; }
    else if (i >= made.n) { T = Infinity; label = 'Today'; body = 'Current reported positions, including stances that have no date.'; }
    else { const st = made.steps[i - 1]; const d = parseDay(st.date); T = d.getTime(); label = fmtDay(d); body = st.text; }
    state.replayT = T; state.replayLabel = label;
    made.range.value = String(i);
    made.date.textContent = label;
    made.text.textContent = body;
  },
  unmount(el, made) { if (made && made.timer) clearInterval(made.timer); },
});

/* ---------- share image: 1080x1920 picture of the current view ---------- */
const SHARE_COLORS = { 's-inf_d': '#D55E00', 's-inf_b': '#F2A97A', 's-diallo_d': '#0072B2', 's-diallo_b': '#7DBFE8', 's-tashima': '#009E73', 's-anti': '#CC79A7', 's-und': '#9AA3A8', 's-unk': '#D3D8DB',
  'c-inf': '#D55E00', 'c-diallo': '#0072B2', 'c-tashima': '#009E73', 'c-none': '#9AA3A8', 'k-UEFA': '#0072B2', 'k-CAF': '#E69F00', 'k-AFC': '#CC79A7', 'k-CONCACAF': '#009E73', 'k-OFC': '#56B4E9', 'k-CONMEBOL': '#D55E00', mixed: '#7C8A93' };
const escX = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function buildShareSvg() {
  const sc = score(), A = dash.data('associations'), G = dash.data('mapgeo'), F = dash.data('facts');
  if (!sc || A.status !== 'ok' || G.status !== 'ok' || F.status !== 'ok') return null;
  const congress = (F.data.find((r) => r.key === 'congress') || {}).value || '';
  const changed = changedNames();
  const byFeat = new Map();
  A.data.forEach((a) => { if (a.feat) { if (!byFeat.has(a.feat)) byFeat.set(a.feat, []); byFeat.get(a.feat).push(a); } });
  const paths = G.data.map((d) => {
    const m = byFeat.get(d.n);
    let fill = '#26333D', op = 1;
    if (m) {
      const ks = new Set(m.map(clsOf));
      fill = SHARE_COLORS[ks.size === 1 ? [...ks][0] : 'mixed'] || '#7C8A93';
      if (m.every((a) => isDim(a, changed))) op = 0.22;
    }
    return '<path d="' + d.d + '" fill="' + fill + '" fill-opacity="' + op + '" stroke="#0E1A24" stroke-width="0.5"/>';
  }).join('');
  const W = 1080, barX = 60, barW = 960;
  let x = barX;
  const tot = sc.segs.reduce((s, g) => s + g.n, 0) || 1;
  const segs = sc.segs.map((g) => { const w = (g.n / tot) * barW; const r = '<rect x="' + x.toFixed(1) + '" y="640" width="' + w.toFixed(1) + '" height="30" fill="' + (SHARE_COLORS[g.cls] || '#9AA3A8') + '"/>'; x += w; return r; }).join('');
  const mx = barX + (sc.maj / sc.members) * barW;
  const cols = sc.cands.map((c, i) => {
    const cx = 60 + i * 330, won = c.n >= sc.maj;
    return '<text x="' + cx + '" y="520" font-size="150" font-family="Georgia,serif" fill="' + (SHARE_COLORS[c.cls] || '#fff') + '">' + c.n + '</text>' +
      '<text x="' + cx + '" y="568" font-size="36" fill="#FFFFFF" font-family="Helvetica,Arial,sans-serif">' + escX(c.name) + '</text>' +
      '<text x="' + cx + '" y="606" font-size="26" fill="' + (won ? '#5FD39B' : '#9FB0BC') + '" font-family="Helvetica,Arial,sans-serif">' + (won ? 'Majority reached' : (sc.maj - c.n) + ' short of ' + sc.maj) + '</text>';
  }).join('');
  const legend = sc.segs.filter((g) => g.n > 0).map((g, i) => {
    const lx = 60 + (i % 2) * 500, ly = 1400 + Math.floor(i / 2) * 64;
    return '<rect x="' + lx + '" y="' + (ly - 26) + '" width="30" height="30" rx="6" fill="' + (SHARE_COLORS[g.cls] || '#9AA3A8') + '"/>' +
      '<text x="' + (lx + 44) + '" y="' + ly + '" font-size="27" fill="#E6EDF2" font-family="Helvetica,Arial,sans-serif">' + escX(g.label.replace('Against Infantino, no candidate named', 'Against Infantino').replace('via confederation', 'via bloc')) + ' · ' + g.n + '</text>';
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">' +
    '<rect width="1080" height="1920" fill="#0E1A24"/>' +
    '<text x="60" y="110" font-size="28" letter-spacing="3" fill="#9FB0BC" font-family="Helvetica,Arial,sans-serif">FIFA PRESIDENTIAL ELECTION · ' + escX(String(congress).toUpperCase()) + '</text>' +
    '<text x="60" y="200" font-size="78" fill="#FFFFFF" font-family="Georgia,serif">FIFA Election War Room</text>' +
    '<text x="60" y="270" font-size="38" fill="#F2A97A" font-family="Helvetica,Arial,sans-serif">' + escX(sc.tag) + '</text>' +
    cols + segs +
    '<rect x="' + (mx - 2).toFixed(1) + '" y="624" width="4" height="62" fill="#FFFFFF"/>' +
    '<text x="' + (mx - 10).toFixed(1) + '" y="716" text-anchor="end" font-size="26" font-weight="700" fill="#FFFFFF" font-family="Helvetica,Arial,sans-serif">' + sc.maj + ' needed to win</text>' +
    '<g transform="translate(0,760) scale(1.08)">' + paths + '</g>' +
    legend +
    '<text x="60" y="1760" font-size="40" font-weight="700" fill="#FFFFFF" font-family="Helvetica,Arial,sans-serif">Build your own map</text>' +
    '<text x="60" y="1812" font-size="32" fill="#9FB0BC" font-family="Helvetica,Arial,sans-serif">Created by Danny Navarro · @travelfutbolfan</text>' +
    '<text x="60" y="1860" font-size="24" fill="#6F8392" font-family="Helvetica,Arial,sans-serif">Pledges are public statements, not votes. The ballot is secret.</text>' +
    '</svg>';
}

dash.draw('share', {
  mount(el) {
    const btn = el$('button', 'sharebtn', 'Share this map'); btn.type = 'button';
    const ov = el$('div', 'shareov'); ov.hidden = true;
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Share image');
    el.replaceChildren(btn, ov);
    const close = () => { ov.hidden = true; ov.replaceChildren(); };
    const showBox = (content, note, href) => {
      const box = el$('div', 'sharebox');
      const row = el$('div', 'sharerow');
      if (href) { const a = el$('a', '', 'Save PNG'); a.href = href; a.download = 'race-to-106.png'; row.appendChild(a); }
      const c = el$('button', '', 'Close'); c.type = 'button'; c.onclick = close; row.appendChild(c);
      box.append(content, el$('p', '', note), row);
      ov.replaceChildren(box); ov.hidden = false; c.focus();
    };
    ov.onclick = (e) => { if (e.target === ov) close(); };
    ov.onkeydown = (e) => { if (e.key === 'Escape') close(); };
    btn.onclick = () => {
      const svg = buildShareSvg();
      if (!svg) return;
      const inlineFallback = () => {
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        showBox(document.importNode(doc.documentElement, true), 'Take a screenshot of this image, or press and hold it to save.', null);
      };
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920;
          cv.getContext('2d').drawImage(img, 0, 0, 1080, 1920);
          const url = cv.toDataURL('image/png');
          const prev = new Image(); prev.alt = 'Share image preview';
          prev.onload = () => showBox(prev, 'Save it, then post it to your story or reel.', url);
          prev.onerror = inlineFallback;
          prev.src = url;
        } catch (err) { inlineFallback(); }
      };
      img.onerror = inlineFallback;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    };
    return { btn, ov };
  },
  update() {},
});

/* ---------- map ---------- */
dash.draw('map', {
  mount(el) {
    const NS = 'http://www.w3.org/2000/svg';
    const box = el$('div', 'mapbox');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1000 520');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'World map of FIFA member associations colored by reported support in the 2027 presidential election');
    svg.setAttribute('class', 'mapsvg');
    const g = document.createElementNS(NS, 'g');
    svg.appendChild(g);
    const tip = el$('div', 'tip'); tip.hidden = true;
    const msg = el$('div', 'mapmsg', 'Loading the map…');
    box.append(svg, tip, msg);
    el.replaceChildren(box);
    const zoom = d3.zoom().scaleExtent([1, 14]).translateExtent([[0, 0], [1000, 520]])
      .filter((e) => { if (e.type === 'wheel') return e.ctrlKey || e.metaKey; if (e.type.startsWith('touch')) return e.touches && e.touches.length > 1; return !e.button; })
      .on('zoom', (e) => g.setAttribute('transform', e.transform.toString()));
    d3.select(svg).call(zoom).on('dblclick.zoom', null);
    document.querySelectorAll('[data-zoom]').forEach((b) => {
      b.onclick = () => {
        const k = b.getAttribute('data-zoom'); const s = d3.select(svg);
        if (k === 'in') s.transition().duration(200).call(zoom.scaleBy, 1.7);
        else if (k === 'out') s.transition().duration(200).call(zoom.scaleBy, 1 / 1.7);
        else s.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
      };
    });
    return { box, svg, g, tip, msg };
  },
  update(el, made) {
    const A = dash.data('associations'), G = dash.data('mapgeo');
    if (A.status === 'error' || G.status === 'error') { made.msg.textContent = 'The map did not load.'; made.msg.hidden = false; return; }
    if (A.status !== 'ok' || G.status !== 'ok') { made.msg.textContent = 'Loading the map…'; made.msg.hidden = false; return; }
    made.msg.hidden = true;
    const changed = changedNames();
    const byFeat = new Map();
    A.data.forEach((a) => { if (a.feat) { if (!byFeat.has(a.feat)) byFeat.set(a.feat, []); byFeat.get(a.feat).push(a); } });
    const classOf = (d) => {
      const m = byFeat.get(d.n);
      if (!m) return 'nomember';
      const keys = new Set(m.map(clsOf));
      let c = 'member ' + (keys.size === 1 ? [...keys][0] : 'mixed');
      if (m.every((a) => isDim(a, changed))) c += ' dim';
      if (state.pinned && m.some((a) => a.name === state.pinned)) c += ' sel';
      if (m.some((a) => state.evNames.has(a.name))) c += ' hl';
      return c;
    };
    d3.select(made.g).selectAll('path').data(G.data, (d) => d.n).join('path')
      .attr('d', (d) => d.d)
      .attr('class', classOf)
      .on('mousemove', (e, d) => {
        const m = byFeat.get(d.n);
        if (!m) { made.tip.hidden = true; return; }
        const r = made.box.getBoundingClientRect();
        made.tip.replaceChildren(...m.map((a) => el$('div', '', a.name + ': ' + posText(a))));
        made.tip.hidden = false;
        made.tip.style.left = Math.max(4, Math.min(e.clientX - r.left + 12, r.width - 196)) + 'px';
        made.tip.style.top = (e.clientY - r.top + 12) + 'px';
        if (state.hover !== m[0].name) { state.hover = m[0].name; dash.draw('detail'); }
      })
      .on('mouseleave', () => { made.tip.hidden = true; state.hover = null; dash.draw('detail'); })
      .on('click', (e, d) => pick(byFeat.get(d.n)));
  },
});

/* ---------- detail panel ---------- */
dash.draw('detail', (el) => {
  const A = dash.data('associations'), E = dash.data('events');
  if (A.status !== 'ok') { el.replaceChildren(el$('p', 'muted', A.status === 'error' ? 'The data did not load.' : 'Loading…')); return; }
  const name = state.hover || state.pinned;
  const a = name && A.data.find((r) => r.name === name);
  if (!a) { el.replaceChildren(el$('p', 'muted', 'Nothing selected yet. Click a country on the map, or a tile, to see who has backed whom.')); return; }
  const meta = el$('div', 'meta');
  const whatif = state.mode === 'whatif';
  meta.append(el$('span', 'pill ' + (whatif ? 'c-' + effCand(a) : 's-' + effStatus(a)), whatif || state.mode === 'replay' ? posText(a) : a.position), el$('span', '', a.conf));
  const ul = el$('ul');
  String(a.notes || '').split('\n').filter(Boolean).forEach((t) => ul.appendChild(el$('li', '', t)));
  const parts = [el$('h3', '', a.name), meta, ul];
  if (E.status === 'ok') {
    const mine = E.data.filter((e) => expandMembers(e, A.data).includes(a.name)).sort((x, y) => String(y.date).localeCompare(String(x.date)));
    if (mine.length) {
      const tl = el$('ul', 'tl');
      mine.forEach((e) => { const li = el$('li'); const d = eventDate(e); li.append(el$('b', '', d ? fmtShort(d) : e.date), document.createTextNode(e.headline)); tl.appendChild(li); });
      parts.push(el$('h4', 'muted', 'Change log'), tl);
    }
  }
  const srcs = el$('div', 'srcs');
  String(a.sources || '').split('\n').filter(Boolean).forEach((line) => {
    const i = line.lastIndexOf('|'); const label = line.slice(0, i), url = line.slice(i + 1);
    if (!safeUrl(url)) { srcs.appendChild(el$('span', '', label)); return; }
    const l = el$('a', '', label); l.href = url; l.target = '_blank'; l.rel = 'noopener noreferrer'; srcs.appendChild(l);
  });
  parts.push(srcs);
  el.replaceChildren(...parts);
});

/* ---------- tile grid ---------- */
dash.draw('grid', (el) => {
  const A = dash.data('associations');
  if (A.status !== 'ok') { el.replaceChildren(el$('p', 'muted', A.status === 'error' ? 'The data did not load.' : 'Loading…')); return; }
  const changed = changedNames();
  const blocks = CONF_ORDER.map((conf) => {
    const m = A.data.filter((a) => a.conf === conf);
    const block = el$('div', 'gblock');
    const h = el$('h4', '', conf); h.appendChild(el$('span', '', String(m.length)));
    const tiles = el$('div', 'tiles');
    m.forEach((a) => {
      const b = el$('button', 'tile ' + clsOf(a));
      b.type = 'button';
      b.setAttribute('aria-label', a.name + ': ' + posText(a));
      if (isDim(a, changed)) b.classList.add('dim');
      if (state.pinned === a.name) b.classList.add('sel');
      if (state.evNames.has(a.name)) b.classList.add('hl');
      b.onmouseenter = () => { if (state.hover !== a.name) { state.hover = a.name; dash.draw('detail'); } };
      b.onmouseleave = () => { state.hover = null; dash.draw('detail'); };
      b.onclick = () => pick([a]);
      tiles.appendChild(b);
    });
    block.append(h, tiles);
    return block;
  });
  el.replaceChildren(...blocks);
});

/* ---------- change feed ---------- */
dash.draw('alertnote', (p) => {
  const E = dash.data('events');
  if (E.status !== 'ok') { p.textContent = ''; return; }
  const latest = [...E.data].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const ld = latest && eventDate(latest);
  if (state.view === 'timeline' && state.tlFocus) {
    const x = el$('button', 'linkbtn', 'Show all'); x.type = 'button';
    x.onclick = () => { state.tlFocus = null; redraw(); };
    p.replaceChildren(document.createTextNode('Showing changes for ' + state.tlFocus + '. '), x);
    return;
  }
  p.textContent = E.data.length + ' changes in the log. Latest entry: ' + (ld ? fmtDay(ld) : 'none') + '.';
});

function eventList(ol, rows, A, empty) {
  if (!rows.length) { ol.replaceChildren(el$('li', 'al-empty', empty)); return; }
  ol.replaceChildren(...rows.map((e) => {
    const li = el$('li');
    const b = el$('button', 'al' + (state.evId === e.id ? ' on' : ''));
    b.type = 'button';
    const d = eventDate(e);
    const meta = el$('span', 'al-meta');
    meta.append(el$('span', '', d ? fmtShort(d) : e.date), el$('span', 'al-kind ' + e.kind, KIND_LABEL[e.kind] || e.kind));
    b.append(meta, el$('span', 'al-h', e.headline));
    b.onclick = () => {
      if (state.evId === e.id) { state.evId = null; state.evNames = new Set(); }
      else { state.evId = e.id; state.evNames = new Set(expandMembers(e, A.data)); const first = [...state.evNames][0]; if (first) state.pinned = first; }
      redraw();
    };
    li.appendChild(b);
    if (safeUrl(e.url)) { const a = el$('a', 'al-src', e.outlet || 'Source'); a.href = e.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.appendChild(a); }
    return li;
  }));
}
const sortedEvents = (E) => [...E.data].sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);

dash.draw('alerts', (ol) => {
  const A = dash.data('associations'), E = dash.data('events');
  if (E.status !== 'ok' || A.status !== 'ok') { ol.replaceChildren(el$('li', 'al-empty', E.status === 'error' ? 'The change log did not load.' : 'Loading…')); return; }
  let rows = sortedEvents(E);
  if (state.view === 'timeline' && state.tlFocus) rows = rows.filter((e) => expandMembers(e, A.data).includes(state.tlFocus));
  eventList(ol, rows, A, state.tlFocus ? 'No logged changes for ' + state.tlFocus + '.' : 'No changes logged yet.');
});

dash.draw('latest', (ol) => {
  const A = dash.data('associations'), E = dash.data('events');
  if (E.status !== 'ok' || A.status !== 'ok') { ol.replaceChildren(el$('li', 'al-empty', E.status === 'error' ? 'The change log did not load.' : 'Loading…')); return; }
  eventList(ol, sortedEvents(E).slice(0, 5), A, 'No changes logged yet.');
});

/* ---------- candidates and news ---------- */
dash.draw('cands', (el) => {
  const C = dash.data('candidates');
  if (C.status !== 'ok') { el.replaceChildren(); return; }
  const cls = { 'Gianni Infantino': 'c-inf', 'Philippe Diallo': 'c-diallo', 'Kozo Tashima': 'c-tashima' };
  el.replaceChildren(...C.data.map((c) => {
    const card = el$('article', 'cand ' + (cls[c.name] || ''));
    card.append(el$('h3', '', c.name), el$('div', 'role', c.country + ' · ' + c.role), el$('p', 'st', c.status), el$('p', '', c.backing), el$('p', 'role', c.note));
    if (safeUrl(c.url)) { const a = el$('a', 'more', 'Source'); a.href = c.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; card.appendChild(a); }
    return card;
  }));
});

dash.draw('news', (ol) => {
  const N = dash.data('news');
  if (N.status !== 'ok') { ol.replaceChildren(); return; }
  const rows = [...N.data].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  ol.replaceChildren(...rows.map((n) => {
    const li = el$('li');
    const d = parseDay(n.date);
    const h = el$('div', 'h');
    if (safeUrl(n.url)) { const a = el$('a', '', n.headline); a.href = n.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; h.appendChild(a); } else h.textContent = n.headline;
    const right = el$('div'); right.append(h, el$('div', 'o', n.outlet));
    li.append(el$('div', 'd', d ? fmtDay(d) : String(n.date)), right);
    if (n.summary) li.appendChild(el$('div', 's', n.summary));
    return li;
  }));
});

/* ---------- controls (listeners and view state only) ---------- */
function setPressed(sel, attr, value) {
  document.querySelectorAll(sel).forEach((b) => {
    const on = b.getAttribute(attr) === String(value);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function syncFocus() {
  document.querySelectorAll('.lg').forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-focus') === state.focus ? 'true' : 'false'));
}
function show(sel, on) { document.querySelectorAll(sel).forEach((n) => { n.hidden = !on; }); }
function syncUI() {
  const v = state.view, m = state.mode;
  document.querySelectorAll('.pane').forEach((p) => { p.hidden = p.id !== 'pane-' + v; });
  show('#grp-color', v === 'map');
  show('#legend-reported', v === 'map' && m === 'reported');
  show('#legend-blocs', v === 'map' && m === 'blocs');
  ['whatif', 'timeline', 'learn'].forEach((k) => show('#note-' + k, v === k));
  show('#tilepane', state.tiles);
  show('#zoomgrp', !state.tiles);
  show('#map-hint', !state.tiles);
  document.querySelectorAll('#tiles-btn').forEach((b) => { b.textContent = state.tiles ? 'Back to the map' : 'All 211 as tiles'; b.setAttribute('aria-pressed', state.tiles ? 'true' : 'false'); });
  setPressed('.view', 'data-view', v);
  setPressed('.cb', 'data-cb', state.colorBy);
  syncFocus();
}
function changed() { deriveMode(); syncUI(); dash.setLink(state.view + ((state.view === 'map' || state.view === 'learn') && state.colorBy === 'confed' ? '-confed' : '')); redraw(); }
function setView(v) { state.view = v; state.focus = null; state.tlFocus = null; changed(); }

document.querySelectorAll('.view').forEach((b) => b.addEventListener('click', () => setView(b.getAttribute('data-view'))));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => setView(b.getAttribute('data-goto'))));
document.querySelectorAll('.cb').forEach((b) => b.addEventListener('click', () => { state.colorBy = b.getAttribute('data-cb'); state.focus = null; changed(); }));
document.querySelectorAll('#tiles-btn').forEach((b) => b.addEventListener('click', () => { state.tiles = !state.tiles; syncUI(); redraw(); }));
document.querySelectorAll('.brush').forEach((b) => b.addEventListener('click', () => { state.brush = b.getAttribute('data-brush'); setPressed('.brush', 'data-brush', state.brush); }));
document.querySelectorAll('.lg').forEach((b) => b.addEventListener('click', () => {
  const k = b.getAttribute('data-focus');
  state.focus = state.focus === k ? null : k; syncFocus(); redraw();
}));
document.querySelectorAll('.act').forEach((b) => b.addEventListener('click', () => {
  const act = b.getAttribute('data-act');
  const A = dash.data('associations');
  if (A.status !== 'ok') return;
  if (act.startsWith('drop-')) {
    const conf = act.slice(5);
    A.data.forEach((a) => { if (a.conf === conf && (a.status === 'inf_b' || a.status === 'diallo_b')) scen[a.name] = 'none'; });
  } else {
    Object.keys(scen).forEach((k) => delete scen[k]);
    if (act === 'declared') A.data.forEach((a) => { if (a.status === 'inf_b' || a.status === 'diallo_b') scen[a.name] = 'none'; });
    if (act === 'clear') A.data.forEach((a) => { scen[a.name] = 'none'; });
  }
  redraw();
}));

window.addEventListener('beforeprint', () => { document.querySelectorAll('.pane').forEach((p) => { p.hidden = false; }); redraw(); });
window.addEventListener('afterprint', () => { syncUI(); redraw(); });
syncUI();
