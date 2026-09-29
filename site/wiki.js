// Keep the article box at least as tall as the side navigation
(function () {
  function fit() {
    var c = document.getElementById('content'), p = document.getElementById('mw-panel');
    if (!c || !p) return;
    c.style.minHeight = window.innerWidth > 720 ? (p.offsetHeight - c.offsetTop) + 'px' : '';
  }
  window.addEventListener('load', fit); window.addEventListener('resize', fit); fit();
})();

// Table of contents toggle
function toggleToc() {
  var toc = document.getElementById('toc');
  if (!toc) return false;
  toc.classList.toggle('collapsed');
  var a = toc.querySelector('.toctoggle a');
  if (a) a.textContent = toc.classList.contains('collapsed') ? 'show' : 'hide';
  return false;
}

// Search: suggestions while typing, full results on search.html
(function () {
  var index = null;
  function load(cb) {
    if (index) return cb(index);
    fetch('search.json').then(function (r) { return r.json(); })
      .then(function (d) { index = d; cb(d); }).catch(function () {});
  }
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function score(e, q) {
    var t = e.t.toLowerCase(), x = e.x.toLowerCase();
    if (t === q) return 100;
    if (t.indexOf(q) === 0) return 80;
    if (t.indexOf(q) >= 0) return 60;
    var n = x.split(q).length - 1;
    return n ? Math.min(40, 10 + n) : 0;
  }
  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    return index.map(function (e) { return [score(e, q), e]; })
      .filter(function (p) { return p[0] > 0; })
      .sort(function (a, b) { return b[0] - a[0]; })
      .map(function (p) { return p[1]; });
  }

  var input = document.getElementById('searchInput');
  var box = document.getElementById('suggestions');
  if (input && box) {
    var active = -1;
    input.addEventListener('input', function () {
      var q = input.value;
      load(function () {
        var res = search(q).slice(0, 8);
        active = -1;
        box.innerHTML = res.map(function (e) {
          return '<li><a href="' + e.p + '.html">' + esc(e.t) + '</a></li>';
        }).join('');
        box.style.display = res.length ? 'block' : 'none';
      });
    });
    input.addEventListener('keydown', function (ev) {
      var items = box.querySelectorAll('li');
      if (!items.length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (active >= 0) items[active].classList.remove('active');
        active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[active].classList.add('active');
      } else if (ev.key === 'Enter' && active >= 0) {
        ev.preventDefault();
        location.href = items[active].querySelector('a').getAttribute('href');
      }
    });
    document.addEventListener('click', function (ev) {
      if (!box.contains(ev.target) && ev.target !== input) box.style.display = 'none';
    });
  }

  var results = document.getElementById('search-results');
  if (results) {
    var q = new URLSearchParams(location.search).get('q') || '';
    if (input) input.value = q;
    document.getElementById('firstHeading').textContent = 'Search results';
    load(function () {
      var res = search(q);
      var ql = q.trim().toLowerCase();
      var exact = index.filter(function (e) { return e.t.toLowerCase() === ql; })[0];
      if (exact) { location.replace(exact.p + '.html'); return; }
      if (!res.length) {
        results.innerHTML = '<p>There were no results matching the query <b>' + esc(q) + '</b>.</p>';
        return;
      }
      results.innerHTML = '<p>Results for <b>' + esc(q) + '</b>:</p>' + res.map(function (e) {
        var i = e.x.toLowerCase().indexOf(ql), snip = '';
        if (i >= 0) {
          var s = Math.max(0, i - 80);
          snip = (s ? '…' : '') + esc(e.x.slice(s, i)) + '<b>' + esc(e.x.slice(i, i + ql.length)) + '</b>' + esc(e.x.slice(i + ql.length, i + ql.length + 120)) + '…';
        } else { snip = esc(e.x.slice(0, 180)) + '…'; }
        return '<div class="searchresult"><a href="' + e.p + '.html">' + esc(e.t) + '</a><div class="snippet">' + snip + '</div></div>';
      }).join('');
    });
  }
})();
