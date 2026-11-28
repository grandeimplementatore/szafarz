/* Szafarz 3.0 – lekki silnik stron.
 * Rozwija szablony stron (wstawki {{...}}, <sc-for>, <sc-if>), podpina zdarzenia.
 * Dane z bazy (harmonogram, szafarze, osiedla, chorzy, wizyty, zmiany) pobiera przez /api/state i tam zapisuje zmiany;
 * stałe treści są w /tresci.js, a „Słowo na dziś” przychodzi z /api/slowo.
 */
(function () {
  'use strict';

  // ---------- dane z serwera ----------
  var cache = null;          // JSON wspólnych danych (tekst)
  var version = 0;           // wersja danych na serwerze
  var chain = Promise.resolve();
  var FOCUS_KEY = 'sz-focus';

  function toast(msg, kind) {
    var el = document.getElementById('sz-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sz-toast';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;max-width:min(92vw,520px);padding:12px 16px;font:700 14px/1.4 Lato,system-ui,sans-serif;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);border-radius:6px';
      document.body.appendChild(el);
    }
    el.style.background = kind === 'error' ? '#B3261E' : '#003C60';
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.display = 'none'; }, 5000);
  }

  function readFocus() {
    try { var f = window.sessionStorage.getItem(FOCUS_KEY); return f ? JSON.parse(f) : null; } catch (e) { return null; }
  }
  function writeFocus(f) {
    try { window.sessionStorage.setItem(FOCUS_KEY, JSON.stringify(f || null)); } catch (e) {}
  }

  function today() {
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }

  // „Słowo na dziś” z API – nie blokuje strony dłużej niż kilka sekund.
  function slowo() {
    var iso = today();
    var req = fetch('/api/slowo?data=' + iso, { headers: { 'X-Requested-With': 'szafarz' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    var limit = new Promise(function (res) { setTimeout(function () { res(null); }, 4000); });
    return Promise.race([req, limit]).then(function (s) {
      var out = {};
      if (s && s.rows && s.rows.length) out[iso] = [s.quote || '', s.ref || '', s.rows];
      return out;
    });
  }

  function boot() {
    var state = fetch('/api/state', { credentials: 'same-origin', headers: { 'X-Requested-With': 'szafarz' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    return Promise.all([state, slowo()]).then(function (all) {
      var j = all[0];
      version = j.version;
      if (j.db) { j.db.focus = readFocus(); cache = JSON.stringify(j.db); }
      SZ.revealCode = String((j.config && j.config.revealCode) || '');
      SZ.nazwiskaUkryte = !!(j.config && j.config.nazwiskaUkryte);
      SZ.ref = Object.assign({}, window.SZ_TRESCI || {}, j.ref || {}, { slowo: all[1] });
    });
  }

  function save(text) {
    var db = JSON.parse(text);
    writeFocus(db.focus);          // „focus” (gdzie otworzyć Planner) jest osobny dla każdego urządzenia
    delete db.focus;
    chain = chain.then(function () {
      return fetch('/api/state', {
        method: 'PUT', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'szafarz' },
        body: JSON.stringify({ version: version, db: db })
      }).then(function (r) {
        if (r.status === 409) {
          toast('W międzyczasie ktoś inny zmienił dane. Odświeżam stronę – wprowadź zmianę jeszcze raz.', 'error');
          setTimeout(function () { location.reload(); }, 2500);
          return;
        }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json().then(function (j) { version = j.version; });
      }).catch(function () {
        toast('Nie udało się zapisać zmian. Sprawdź połączenie z internetem i spróbuj ponownie.', 'error');
      });
    });
  }

  // ---------- szablony ----------
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var BOOL = { disabled: 1, checked: 1, selected: 1, hidden: 1, required: 1, readonly: 1, multiple: 1 };

  function lookup(scope, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var v = scope, parts = path.split('.');
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function interp(str, scope) {
    return str.replace(/\{\{([^}]+)\}\}/g, function (m, p) {
      var v = lookup(scope, p);
      return v == null || typeof v === 'function' ? '' : String(v);
    });
  }
  function eventName(attr, tag, type) {
    var ev = attr.slice(2);
    if (ev === 'change' && (tag === 'input' || tag === 'textarea') && type !== 'checkbox' && type !== 'radio') return 'input';
    return ev;
  }

  function expand(node, scope, out) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(interp(node.textContent, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName.toLowerCase();
    if (tag === 'sc-for') {
      var list = lookup(scope, node.getAttribute('list').replace(/[{}]/g, '')) || [];
      var as = node.getAttribute('as');
      list.forEach(function (item, i) {
        var s = Object.create(scope); s[as] = item; s.$index = i;
        node.childNodes.forEach(function (c) { expand(c, s, out); });
      });
      return;
    }
    if (tag === 'sc-if') {
      if (lookup(scope, node.getAttribute('value').replace(/[{}]/g, ''))) node.childNodes.forEach(function (c) { expand(c, scope, out); });
      return;
    }
    if (tag === 'helmet') return;
    if (tag === 'sc-select') tag = 'select';
    if (tag === 'sc-option') tag = 'option';
    var isSvg = node.namespaceURI === SVG_NS;
    var el = isSvg ? document.createElementNS(SVG_NS, node.tagName) : document.createElement(tag);
    var value = null, type = (node.getAttribute('type') || '').toLowerCase();
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i], name = a.name;
      if (name.indexOf('hint-') === 0) continue;
      if (/^on/.test(name)) {
        var m = /^\{\{(.+)\}\}$/.exec(a.value.trim());
        var fn = m && lookup(scope, m[1]);
        if (typeof fn === 'function') el.addEventListener(eventName(name, tag, type), (function (f) { return function (e) { f(e); }; })(fn));
        continue;                                  // nigdy nie ustawiamy atrybutów on* jako kodu
      }
      if (name === 'classname') name = 'class';
      var val = interp(a.value, scope);
      if (name === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) { value = val; continue; }
      if (BOOL[name] && (val === 'false' || val === '')) continue;
      try { el.setAttribute(name, val); } catch (e) {}
    }
    node.childNodes.forEach(function (c) { expand(c, scope, el); });
    if (value !== null) {
      if (tag === 'textarea') el.textContent = value;
      el.value = value;
      if (tag === 'select') el.setAttribute('data-value', value);
    }
    out.appendChild(el);
  }

  // ---------- komponent ----------
  function DCLogic() { this.props = {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    this.state = Object.assign({}, this.state, typeof patch === 'function' ? patch(this.state) : patch);
    schedule();
  };

  var comp = null, tpl = null, root = null, pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    Promise.resolve().then(function () { pending = false; render(); });
  }

  function scrollers() { return root.querySelectorAll('[style*="overflow-y: auto"],[style*="overflow-x: auto"],[style*="overflow: auto"]'); }

  function render() {
    var ae = document.activeElement, focusId = ae && root.contains(ae) ? ae.id : null, sel = null;
    if (focusId) { try { sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) {} }
    var keep = Array.prototype.map.call(scrollers(), function (el) { return [el.scrollTop, el.scrollLeft]; });
    var wy = window.scrollY;

    var vals = Object.assign({ ref: SZ.ref }, comp.renderVals());
    var frag = document.createDocumentFragment();
    tpl.content.childNodes.forEach(function (n) { expand(n, vals, frag); });
    root.replaceChildren(frag);
    root.querySelectorAll('select[data-value]').forEach(function (s) { s.value = s.getAttribute('data-value'); });

    Array.prototype.forEach.call(scrollers(), function (el, i) { if (keep[i]) { el.scrollTop = keep[i][0]; el.scrollLeft = keep[i][1]; } });
    window.scrollTo(0, wy);
    if (focusId) {
      var f = document.getElementById(focusId);
      if (f) { f.focus({ preventScroll: true }); if (sel && sel[0] != null) { try { f.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
    }
  }

  function mount(Component, opt) {
    opt = opt || {};
    var w = window.innerWidth;
    if (opt.mobile && w < 760) { location.replace(opt.mobile + location.search); return; }
    if (opt.desktop && w >= 1000) { location.replace(opt.desktop + location.search); return; }
    tpl = document.getElementById('tpl');
    root = document.getElementById('root');
    boot().then(function () {
      comp = new Component();
      render();
    }).catch(function (e) {
      root.innerHTML = '<p style="font:16px Lato,sans-serif;padding:24px">Nie udało się wczytać danych. Odśwież stronę za chwilę.</p>';
    });
  }

  var SZ = window.SZ = {
    revealCode: '',
    nazwiskaUkryte: false,
    ref: {},
    getItem: function () { return cache; },
    setItem: function (k, v) { cache = v; save(v); },
    mount: mount
  };
  window.DCLogic = DCLogic;
})();
