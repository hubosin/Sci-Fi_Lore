(function () {
  var root = document.documentElement;
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var phone = function () { return window.matchMedia('(max-width: 720px)').matches; };

  // ---------- menu panel: collapse on desktop, slide-in on phones ----------
  var toggle = document.getElementById('nav-toggle');
  if (toggle) toggle.addEventListener('click', function () {
    if (phone()) { document.body.classList.toggle('nav-open'); return; }
    var c = root.classList.toggle('nav-collapsed');
    save('nav-collapsed', c ? '1' : '0');
  });
  var scrim = document.getElementById('nav-scrim');
  if (scrim) scrim.addEventListener('click', function () { document.body.classList.remove('nav-open'); });

  // ---------- collapsible menu sections and sub-categories (remembered) ----------
  var state = {};
  try { state = JSON.parse(load('nav-state') || '{}'); } catch (e) {}
  var here = location.pathname.split('/').pop() || 'index.html';
  var restoring = true;
  document.querySelectorAll('#mw-panel details[data-portal]').forEach(function (d) {
    var id = (d.classList.contains('portal') ? 'p:' : 'g:') + d.getAttribute('data-portal');
    if (id in state) { if (state[id]) d.setAttribute('open', ''); else d.removeAttribute('open'); }
    d.addEventListener('toggle', function () {
      if (restoring) return;
      state[id] = d.open ? 1 : 0;
      save('nav-state', JSON.stringify(state));
    });
    var link = d.querySelector(':scope > summary a');
    if (link) link.addEventListener('click', function (ev) { ev.stopPropagation(); });
  });
  // Highlight the current page and open every group above it
  document.querySelectorAll('#mw-panel a').forEach(function (a) {
    if (a.getAttribute('href') === here) {
      a.classList.add('current');
      for (var d = a.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.setAttribute('open', '');
    }
  });
  setTimeout(function () { restoring = false; }, 0);

  // ---------- contents column: hide/show + highlight current section ----------
  function setTocHidden(h) { root.classList.toggle('toc-hidden', h); save('toc-hidden', h ? '1' : '0'); }
  var hide = document.getElementById('toc-side-hide'), show = document.getElementById('toc-side-show');
  if (hide) hide.addEventListener('click', function () { setTocHidden(true); });
  if (show) show.addEventListener('click', function () { setTocHidden(false); });

  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('#toc-side a[href^="#"]:not(.toc-top)'));
  if (tocLinks.length) {
    var heads = tocLinks.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
    var ticking = false;
    function mark() {
      ticking = false;
      var y = window.scrollY + 90, cur = -1;
      heads.forEach(function (h, i) { if (h && h.getBoundingClientRect().top + window.scrollY <= y) cur = i; });
      tocLinks.forEach(function (a, i) { a.classList.toggle('active', i === cur); });
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(mark); } });
    mark();
  }

  // ---------- search ----------
  var index = null;
  function getIndex(cb) {
    if (index) return cb(index);
    fetch('search.json').then(function (r) { return r.json(); })
      .then(function (d) { index = d; cb(d); }).catch(function () {});
  }
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function words(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }
  function score(e, ws, q) {
    var t = e.t.toLowerCase(), x = e.x.toLowerCase(), s = 0;
    if (ws.length > 1 && x.indexOf(q) >= 0) s += 200;   // whole phrase appears
    if (t === q) s += 1000;
    else if (t.indexOf(q) === 0) s += 400;
    else if (t.indexOf(q) >= 0) s += 250;
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i], inT = t.indexOf(w) >= 0, n = x.split(w).length - 1;
      if (!inT && !n) return 0;          // every word must appear somewhere
      s += (inT ? 60 : 0) + Math.min(n, 15) * 3;
    }
    return s;
  }
  function search(q) {
    var ql = q.trim().toLowerCase(), ws = words(ql);
    if (!ws.length) return [];
    return index.map(function (e) { return [score(e, ws, ql), e]; })
      .filter(function (p) { return p[0] > 0; })
      .sort(function (a, b) { return b[0] - a[0]; })
      .map(function (p) { return p[1]; });
  }
  function snippet(e, q, len) {
    var ws = words(q), x = e.x, xl = x.toLowerCase(), i = xl.indexOf(q.trim().toLowerCase());
    for (var k = 0; k < ws.length && i < 0; k++) i = xl.indexOf(ws[k]);
    var start = i < 0 ? 0 : Math.max(0, i - Math.floor(len / 3));
    var part = x.slice(start, start + len);
    var out = esc(part);
    ws.forEach(function (w) {
      out = out.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<b>$1</b>');
    });
    return (start ? '…' : '') + out + (start + len < x.length ? '…' : '');
  }

  var input = document.getElementById('searchInput');
  var box = document.getElementById('suggestions');
  if (input && box) {
    var active = -1;
    function render() {
      var q = input.value;
      getIndex(function () {
        var res = search(q).slice(0, 7);
        active = -1;
        if (!q.trim()) { box.style.display = 'none'; return; }
        box.innerHTML = res.map(function (e) {
          return '<a href="' + e.p + '.html"><span class="s-title">' + esc(e.t) + '</span>' +
                 '<span class="s-snip">' + snippet(e, q, 110) + '</span></a>';
        }).join('') + '<a class="s-all" href="search.html?q=' + encodeURIComponent(q) + '">Search all pages for “' + esc(q) + '”</a>';
        box.style.display = 'block';
      });
    }
    input.addEventListener('input', render);
    input.addEventListener('focus', function () { if (input.value.trim()) render(); });
    input.addEventListener('keydown', function (ev) {
      var items = box.querySelectorAll('a');
      if (ev.key === 'Escape') { box.style.display = 'none'; return; }
      if (!items.length || box.style.display === 'none') return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (active >= 0) items[active].classList.remove('active');
        active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[active].classList.add('active');
        items[active].scrollIntoView({ block: 'nearest' });
      } else if (ev.key === 'Enter' && active >= 0) {
        ev.preventDefault();
        location.href = items[active].getAttribute('href');
      }
    });
    document.addEventListener('click', function (ev) {
      if (!box.contains(ev.target) && ev.target !== input) box.style.display = 'none';
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === '/' && document.activeElement !== input && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        ev.preventDefault(); input.focus();
      }
    });
  }

  // Full results page
  var results = document.getElementById('search-results');
  if (results) {
    var q = new URLSearchParams(location.search).get('q') || '';
    if (input) input.value = q;
    document.getElementById('firstHeading').textContent = 'Search results';
    document.title = 'Search results - ' + document.title.split(' - ').pop();
    getIndex(function () {
      var ql = q.trim().toLowerCase();
      var exact = index.filter(function (e) { return e.t.toLowerCase() === ql; })[0];
      if (exact) { location.replace(exact.p + '.html'); return; }
      var res = search(q);
      if (!res.length) {
        results.innerHTML = '<p>There were no results matching the query <b>' + esc(q) + '</b>.</p>';
        return;
      }
      results.innerHTML = '<p>' + res.length + ' page' + (res.length > 1 ? 's' : '') + ' found for <b>' + esc(q) + '</b>:</p>' +
        res.map(function (e) {
          return '<div class="searchresult"><a href="' + e.p + '.html">' + esc(e.t) + '</a>' +
                 '<div class="snippet">' + snippet(e, q, 240) + '</div></div>';
        }).join('');
    });
  }
})();

// In-article Contents box toggle (phones / when the column is hidden)
function toggleToc() {
  var toc = document.getElementById('toc');
  if (!toc) return false;
  toc.classList.toggle('collapsed');
  var a = toc.querySelector('.toctoggle a');
  if (a) a.textContent = toc.classList.contains('collapsed') ? 'show' : 'hide';
  return false;
}
