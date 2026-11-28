/* Szafarz 3.0 – strona „Ustawienia”: szafarze, osiedla i terminy harmonogramu (dodawanie, zmiana i usuwanie).
 * Wspólna logika dla wersji na komputer (/Ustawienia) i telefon (/UstawieniaTelefon).
 */
(function () {
  'use strict';
  var H = { 'X-Requested-With': 'szafarz', 'Content-Type': 'application/json' };
  var WD = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
  var GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  var dateLabel = function (iso) {
    var p = iso.split('-').map(Number); var wd = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
    return WD[wd] + ' ' + p[2] + ' ' + GEN[p[1] - 1] + ' ' + p[0];
  };
  var chorych = function (n) { return n + ' ' + (n === 1 ? 'chory' : 'chorych'); };
  var terminach = function (n) { return n + ' ' + (n === 1 ? 'terminie' : 'terminach'); };
  // komunikat po zapisie pokazujemy w zasięgu wzroku (na telefonie lista bywa długa)
  var pokaz = function () { setTimeout(function () { var el = document.querySelector('#root [role=alert], #root [role=status]'); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 60); };

  class Ustawienia extends DCLogic {
    // log interakcji (sz_logs): najnowsze 100 wpisów, potem doczytywanie po 100
    loadLogs(more) {
      var self = this, st = this.state || {};
      var przed = more && st.logi && st.logi.length ? st.logi[st.logi.length - 1].id : '';
      this.setState({ logiLoading: true });
      fetch('/api/ustawienia/logi?limit=100' + (przed ? '&przed=' + przed : ''), { headers: H })
        .then(function (r) { if (r.status === 401) { location.reload(); throw new Error('auth'); } if (!r.ok) throw new Error(); return r.json(); })
        .then(function (j) { self.setState({ logi: (more ? (self.state.logi || []) : []).concat(j.logi), logiWiecej: j.wiecej, logiLoading: false, logiErr: null }); })
        .catch(function () { self.setState({ logiLoading: false, logiErr: 'Nie udało się wczytać logu.' }); });
    }

    load() {
      var self = this;
      this._loading = true;
      if (!this._logsAsked) { this._logsAsked = true; this.loadLogs(false); }
      fetch('/api/ustawienia', { headers: H })
        .then(function (r) { if (r.status === 401) { location.reload(); throw new Error('auth'); } if (!r.ok) throw new Error(); return r.json(); })
        .then(function (d) { self._loading = false; self.setState({ data: d }); })
        .catch(function () { self._loading = false; self.setState({ err: 'Nie udało się wczytać ustawień. Odśwież stronę.' }); });
    }

    call(method, path, body, reset, closeEdit) {
      var self = this;
      this.setState({ busy: true });
      fetch('/api/ustawienia/' + path, { method: method, headers: H, body: body ? JSON.stringify(body) : undefined })
        .then(function (r) { if (r.status === 401) { location.reload(); return new Promise(function () {}); } return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok) { self.setState({ busy: false, err: x.j.error || 'Nie udało się zapisać zmiany.', msg: null, confirm: null }); pokaz(); return; }
          var patch = { busy: false, msg: x.j.message, err: null, confirm: null };
          if (closeEdit) { patch.edit = null; patch.e = {}; }
          if (reset) patch.f = Object.assign({}, self.state.f || {}, reset);
          self.setState(patch);
          self.load();
          self.loadLogs(false);
          pokaz();
        })
        .catch(function () { self.setState({ busy: false, err: 'Brak połączenia z serwerem. Spróbuj ponownie.', msg: null }); });
    }

    renderVals() {
      var self = this, st = this.state || {}, d = st.data, f = st.f || {}, confirm = st.confirm || null;
      // pasek z datą na komputerze (LIT_MAKE jest na stronie /Ustawienia)
      var lit = typeof LIT_MAKE === 'function' ? LIT_MAKE() : {};
      if (!d && !this._loading && !st.err) this.load();
      var set = function (k) { return function (e) { var nf = Object.assign({}, self.state.f || {}); nf[k] = e.target.value; self.setState({ f: nf }); }; };
      var enter = function (fn) { return function (e) { if (e && e.key === 'Enter') fn(); }; };
      var editing = st.edit || null, e = st.e || {};
      var ask = function (key) { return function () { self.setState({ confirm: key, edit: null, msg: null, err: null }); }; };
      var no = function () { self.setState({ confirm: null }); };
      var open = function (key, values) { return function () { self.setState({ edit: key, e: values, confirm: null, msg: null, err: null }); }; };
      var close = function () { self.setState({ edit: null, e: {} }); };
      var eset = function (k) { return function (ev) { var ne = Object.assign({}, self.state.e || {}); ne[k] = ev.target.value; self.setState({ e: ne }); }; };
      var row = function (key, extra, values) {
        var isEd = editing === key;
        return Object.assign({
          confirm: confirm === key, notConfirm: confirm !== key, ask: ask(key), no: no,
          editing: isEd, idle: confirm !== key && !isEd, edit: open(key, values), cancelEdit: close
        }, extra);
      };
      if (!d) return { lit: lit, loading: !st.err, ready: false, msg: null, err: st.err || null, accent: '#BD4F38' };

      var szafarze = d.szafarze.map(function (s) {
        return row('sz:' + s.id, {
          label: (s.imie ? s.imie + ' ' : '') + s.nazwisko,
          info: s.przyszlych ? 'przydział w ' + terminach(s.przyszlych) + ' od dziś' : 'bez przydziałów od dziś',
          question: s.przyszlych ? 'Nie można usunąć – najpierw zmień przydziały w Harmonogramie.' : 'Usunąć szafarza z listy?',
          canYes: !s.przyszlych,
          yes: function () { self.call('DELETE', 'szafarze/' + s.id); },
          eid: 'ust-e-sz-' + s.id, eNazw: e.nazw || '', eImie: e.imie || '', onENazw: eset('nazw'), onEImie: eset('imie'),
          save: function () { self.call('PUT', 'szafarze/' + s.id, { nazwisko: self.state.e.nazw, imie: self.state.e.imie }, null, true); }
        }, { nazw: s.nazwisko, imie: s.imie });
      });
      var osiedla = d.osiedla.map(function (o) {
        return row('os:' + o.kod, {
          kod: o.kod, nazwa: o.nazwa,
          info: chorych(o.chorych) + (o.wizyt ? ' · ' + o.wizyt + ' zaplanowanych wizyt' : ''),
          question: o.chorych ? 'Nie można usunąć – najpierw przenieś chorych na inne osiedle.' : 'Usunąć osiedle? Zniknie też z harmonogramu.',
          canYes: !o.chorych,
          yes: function () { self.call('DELETE', 'osiedla/' + encodeURIComponent(o.kod)); },
          eid: 'ust-e-os-' + o.kod, eKod: e.kod || '', eNazwa: e.nazwa || '', onEKod: eset('kod'), onENazwa: eset('nazwa'),
          save: function () { self.call('PUT', 'osiedla/' + encodeURIComponent(o.kod), { kod: self.state.e.kod, nazwa: self.state.e.nazwa }, null, true); }
        }, { kod: o.kod, nazwa: o.nazwa });
      });
      var names = d.szafarze.map(function (s) { return s.nazwisko; });
      var all = !!st.allTerms;
      var past = d.terminy.filter(function (t) { return t.minal; }).length;
      var terminy = d.terminy.filter(function (t) { return all || !t.minal; }).map(function (t) {
        return row('t:' + t.data, {
          date: dateLabel(t.data), nazwa: t.nazwa, op: t.minal ? '0.6' : '1',
          who: d.osiedla.map(function (o) { return o.kod + ': ' + (t.przydzialy[o.kod] || '—'); }).join(' · '),
          question: t.wizyt ? 'Usunąć termin? Zaplanowane na ten dzień wizyty (' + t.wizyt + ') też zostaną usunięte.' : 'Usunąć termin z harmonogramu?',
          canYes: true,
          yes: function () { self.call('DELETE', 'terminy/' + t.data); },
          eid: 'ust-e-t-' + t.data, eData: e.data || '', eNazwa: e.nazwa || '', onEData: eset('data'), onENazwa: eset('nazwa'),
          eSelects: d.osiedla.map(function (o) {
            var cur = (e.sel || {})[o.kod] || '';
            var opts = names.indexOf(cur) < 0 && cur ? [cur].concat(names) : names;
            return {
              os: o.kod, id: 'ust-e-t-' + t.data + '-' + o.kod, value: cur, options: opts,
              onChange: function (ev) { var ne = Object.assign({}, self.state.e || {}); ne.sel = Object.assign({}, ne.sel || {}); ne.sel[o.kod] = ev.target.value; self.setState({ e: ne }); }
            };
          }),
          save: function () { var x = self.state.e || {}; self.call('PUT', 'terminy/' + t.data, { data: x.data, nazwa: x.nazwa, przydzialy: x.sel || {} }, null, true); }
        }, { data: t.data, nazwa: t.nazwa, sel: Object.assign({}, t.przydzialy) });
      });
      var sel = f.sel || {};
      var selects = d.osiedla.map(function (o) {
        return {
          os: o.kod, id: 'ust-t-os-' + o.kod, value: sel[o.kod] || '', options: names,
          onChange: function (e) { var ns = Object.assign({}, (self.state.f || {}).sel || {}); ns[o.kod] = e.target.value; self.setState({ f: Object.assign({}, self.state.f || {}, { sel: ns }) }); }
        };
      });
      var addSz = function () { self.call('POST', 'szafarze', { nazwisko: f.nazw, imie: f.imie }, { nazw: '', imie: '' }); };
      var addOs = function () { self.call('POST', 'osiedla', { kod: f.kod, nazwa: f.onazwa }, { kod: '', onazwa: '' }); };
      var addT = function () { self.call('POST', 'terminy', { data: f.tdata, nazwa: f.tnazwa, przydzialy: sel }, { tdata: '', tnazwa: '', sel: {} }); };
      return {
        lit: lit, accent: '#BD4F38', loading: false, ready: true, busy: !!st.busy,
        msg: st.msg || null, err: st.err || null,
        szafarze: szafarze, szCount: String(szafarze.length),
        osiedla: osiedla, osCount: String(osiedla.length),
        terminy: terminy, tCount: String(d.terminy.length), noTerms: terminy.length === 0,
        hasPast: past > 0, pastToggle: all ? 'Ukryj minione' : 'Pokaż minione (' + past + ')',
        togglePast: function () { self.setState({ allTerms: !all }); },
        fNazw: f.nazw || '', fImie: f.imie || '', onNazw: set('nazw'), onImie: set('imie'), addSz: addSz, keySz: enter(addSz),
        fKod: f.kod || '', fONazwa: f.onazwa || '', onKod: set('kod'), onONazwa: set('onazwa'), addOs: addOs, keyOs: enter(addOs),
        fTData: f.tdata || '', fTNazwa: f.tnazwa || '', onTData: set('tdata'), onTNazwa: set('tnazwa'), addT: addT, keyT: enter(addT),
        selects: selects,
        logi: (st.logi || []).map(function (l) {
          var t = new Date(l.czas), z = function (x) { return (x < 10 ? '0' : '') + x; };
          return { czas: z(t.getDate()) + '.' + z(t.getMonth() + 1) + '.' + t.getFullYear() + ' ' + z(t.getHours()) + ':' + z(t.getMinutes()) + ':' + z(t.getSeconds()),
            opis: l.opis, zmiana: l.zmiana || '—', ip: l.adres_ip || '—' };
        }),
        logiInfo: st.logi ? (st.logi.length ? 'Wyświetlono ' + st.logi.length + ' najnowszych wpisów.' : 'Log jest pusty.') : 'Wczytywanie logu…',
        logiWiecej: !!st.logiWiecej && !st.logiLoading, logiLoading: !!st.logiLoading, logiErr: st.logiErr || null,
        loadMoreLogs: function () { self.loadLogs(true); },
        nazwUkryte: d.atrybuty && d.atrybuty.nazwiska_ukryte ? 'true' : 'false',
        ukryteStan: d.atrybuty && d.atrybuty.nazwiska_ukryte ? 'Teraz: nazwiska domyślnie ukryte.' : 'Teraz: nazwiska domyślnie widoczne.',
        toggleUkryte: function (ev) { self.call('PUT', 'atrybuty/nazwiska_ukryte', { wartosc: !!(ev && ev.target && ev.target.checked) }); }
      };
    }
  }
  window.Ustawienia = Ustawienia;
})();
