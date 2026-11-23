/* Minimal stand-in for the dashboard runtime so the page runs on any static host.
   Loads data/*.json from the same site and refreshes it every 5 minutes. */
(function () {
  var draws = {}, calcs = {}, store = {}, status = {};
  var ids = ['associations', 'mapgeo', 'news', 'candidates', 'facts', 'events'];
  function run(name) {
    var d = draws[name]; if (!d) return;
    document.querySelectorAll('[data-draw="' + name + '"]').forEach(function (el) {
      try {
        if (typeof d === 'function') d(el);
        else { if (!el.__m) { el.replaceChildren(); el.__m = d.mount(el); } d.update(el, el.__m); }
      } catch (e) { if (window.console) console.error(name, e); }
    });
  }
  window.dash = {
    data: function (id) {
      if (calcs[id]) {
        var c = calcs[id], ins = c.inputs.map(function (i) { return store[i]; });
        if (ins.some(function (x) { return !x; })) return { status: 'loading', data: [] };
        return { status: 'ok', data: c.fn.apply(null, ins) };
      }
      if (store[id]) return { status: 'ok', data: store[id] };
      return { status: status[id] === 'error' ? 'error' : 'loading', data: [] };
    },
    calc: function (id, o) { calcs[id] = o; },
    setLink: function (name) { try { history.replaceState(null, '', '#' + name); } catch (e) {} },
    draw: function (name, fn) { if (fn !== undefined) { draws[name] = fn; return; } run(name); },
    start: function () {
      function load(first) {
        return Promise.all(ids.map(function (k) {
          return fetch('data/' + k + '.json?t=' + Date.now()).then(function (r) { if (!r.ok) throw new Error(k); return r.json(); })
            .then(function (j) { store[k] = j; status[k] = 'ok'; })
            .catch(function () { if (!store[k]) status[k] = 'error'; });
        })).then(function () { Object.keys(draws).forEach(run); });
      }
      load(true);
      setInterval(function () { load(false); }, 300000);
    },
  };
})();
