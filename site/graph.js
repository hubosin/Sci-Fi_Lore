// Graph view: every wiki page as a node, every link between pages as an edge.
// Pages are pulled toward their sidebar section (and sub-category) so related
// pages sit together in labelled clusters.
(function () {
  var view, canvas, ctx, tip, data, nodes = [], links = [], byId = {};
  var groups = [], groupInfo = {}, hidden = {}, adj = {};
  var W = 0, H = 0, DPR = 1;
  var cam = { x: 0, y: 0, k: 1 };
  var hover = null, dragNode = null, panning = null, moved = false;
  var alpha = 1, running = false, query = '', localOnly = false;
  var current = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
  if (current === 'index') current = 'Home';

  var PALETTE = ['#3366cc', '#dc3912', '#ff9900', '#109618', '#990099', '#0099c6',
                 '#dd4477', '#66aa00', '#b82e2e', '#316395', '#994499', '#22aa99'];

  function open() {
    if (!view) build();
    view.hidden = false;
    document.documentElement.classList.add('graph-open');
    resize();
    if (data) { kick(); } else load();
    setTimeout(function () { view.querySelector('.gv-search').focus({ preventScroll: true }); }, 50);
  }
  function close() {
    if (!view) return;
    view.hidden = true;
    document.documentElement.classList.remove('graph-open');
    running = false;
  }
  window.toggleGraph = function () { (view && !view.hidden) ? close() : open(); };

  function build() {
    view = document.createElement('div');
    view.id = 'graph-view';
    view.innerHTML =
      '<div class="gv-bar">' +
        '<strong class="gv-title">Graph view</strong>' +
        '<input class="gv-search" type="search" placeholder="Find a page…" aria-label="Find a page in the graph">' +
        '<label class="gv-local"><input type="checkbox"> This page’s neighbourhood</label>' +
        '<button type="button" class="gv-center">Centre on this page</button><button type="button" class="gv-fit">Show everything</button>' +
        '<button type="button" class="gv-close" aria-label="Close graph">✕</button>' +
      '</div>' +
      '<div class="gv-legend"></div>' +
      '<canvas></canvas><div class="gv-tip" hidden></div>' +
      '<div class="gv-help">Scroll to zoom · drag to move · click a page to open it · Esc to close</div>';
    document.body.appendChild(view);
    canvas = view.querySelector('canvas');
    ctx = canvas.getContext('2d');
    tip = view.querySelector('.gv-tip');
    view.querySelector('.gv-close').onclick = close;
    view.querySelector('.gv-center').onclick = function () { focusOn(current, true); };
    view.querySelector('.gv-fit').onclick = function () { fitAll(); };
    view.querySelector('.gv-search').oninput = function (e) { query = e.target.value.trim().toLowerCase(); draw(); };
    view.querySelector('.gv-search').onkeydown = function (e) {
      if (e.key === 'Enter') {
        var m = nodes.filter(function (n) { return visible(n) && n.t.toLowerCase().indexOf(query) >= 0; })[0];
        if (m) focusOn(m.id, true);
      }
    };
    view.querySelector('.gv-local input').onchange = function (e) {
      localOnly = e.target.checked; near = null;
      fitAll(); kick();
    };
    window.addEventListener('resize', function () { if (!view.hidden) resize(); });
    bindPointer();
  }

  function load() {
    fetch('graph.json').then(function (r) { return r.json(); }).then(function (d) {
      data = d; setup(); fitAll(); kick();
      setTimeout(fitAll, 1200);
    });
  }

  function setup() {
    var names = data.groups.slice();
    data.nodes.forEach(function (n) { if (names.indexOf(n.g) < 0) names.push(n.g); });
    groups = names.filter(function (g) { return data.nodes.some(function (n) { return n.g === g; }); });
    var R = 220 + 62 * groups.length;
    groups.forEach(function (g, i) {
      var a = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
      groupInfo[g] = { x: Math.cos(a) * R, y: Math.sin(a) * R, color: PALETTE[i % PALETTE.length], subs: {} };
    });
    // sub-categories orbit their section's centre
    groups.forEach(function (g) {
      var subs = [];
      data.nodes.forEach(function (n) { if (n.g === g && subs.indexOf(n.s) < 0) subs.push(n.s); });
      var gi = groupInfo[g];
      subs.forEach(function (s, j) {
        if (subs.length === 1) { gi.subs[s] = { x: gi.x, y: gi.y }; return; }
        var a = (j / subs.length) * Math.PI * 2;
        var r = 40 + 14 * subs.length;
        gi.subs[s] = { x: gi.x + Math.cos(a) * r, y: gi.y + Math.sin(a) * r };
      });
    });
    nodes = data.nodes.map(function (n, i) {
      var anchor = groupInfo[n.g].subs[n.s];
      var o = {
        id: n.id, t: n.t, g: n.g, s: n.s, d: n.d,
        x: anchor.x + (Math.random() - 0.5) * 60, y: anchor.y + (Math.random() - 0.5) * 60,
        vx: 0, vy: 0, ax: anchor.x, ay: anchor.y,
        r: 4 + Math.sqrt(n.d) * 1.8
      };
      byId[o.id] = o; adj[o.id] = {};
      return o;
    });
    links = data.links.map(function (l) {
      adj[l[0]][l[1]] = 1; adj[l[1]][l[0]] = 1;
      return { a: byId[l[0]], b: byId[l[1]] };
    });
    // legend
    var lg = view.querySelector('.gv-legend');
    lg.innerHTML = '<button type="button" class="gv-legend-head">Sections</button>' + groups.map(function (g) {
      return '<button type="button" data-g="' + g + '"><i style="background:' + groupInfo[g].color + '"></i>' + g + '</button>';
    }).join('');
    if (window.matchMedia('(max-width: 720px)').matches) lg.classList.add('folded');
    lg.querySelector('.gv-legend-head').onclick = function () { lg.classList.toggle('folded'); };
    lg.querySelectorAll('button[data-g]').forEach(function (b) {
      b.onclick = function () {
        var g = b.getAttribute('data-g');
        hidden[g] = !hidden[g]; b.classList.toggle('off', !!hidden[g]); kick();
      };
    });
  }

  function neighbourhood() {
    var keep = {}; keep[current] = 1;
    Object.keys(adj[current] || {}).forEach(function (a) { keep[a] = 1; });
    return keep;
  }
  var near = null;
  function visible(n) {
    if (hidden[n.g]) return false;
    if (localOnly) { near = near || neighbourhood(); return !!near[n.id]; }
    return true;
  }

  // ---------- simulation ----------
  function kick() { alpha = Math.max(alpha, 0.6); near = null; if (!running) { running = true; requestAnimationFrame(loop); } }
  function loop() {
    if (!running || view.hidden) { running = false; return; }
    step(); draw();
    if (alpha > 0.005 || dragNode) requestAnimationFrame(loop); else running = false;
  }
  function step() {
    var vis = nodes.filter(visible), i, j;
    for (i = 0; i < vis.length; i++) {
      var a = vis[i];
      for (j = i + 1; j < vis.length; j++) {
        var b = vis[j], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 40000) continue;
        var f = (a.g === b.g ? 1300 : 900) / d2 * alpha, d = Math.sqrt(d2);
        var fx = dx / d * f, fy = dy / d * f;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    links.forEach(function (l) {
      if (!visible(l.a) || !visible(l.b)) return;
      var dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      var same = l.a.g === l.b.g;
      var f = (d - (same ? 60 : 200)) * (same ? 0.025 : 0.0006) * alpha;
      var fx = dx / d * f, fy = dy / d * f;
      l.a.vx += fx; l.a.vy += fy; l.b.vx -= fx; l.b.vy -= fy;
    });
    vis.forEach(function (n) {
      n.vx += (n.ax - n.x) * 0.04 * alpha;
      n.vy += (n.ay - n.y) * 0.04 * alpha;
      if (n === dragNode) { n.vx = n.vy = 0; return; }
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx; n.y += n.vy;
    });
    alpha *= 0.985;
  }

  // ---------- drawing ----------
  function resize() {
    DPR = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    draw();
  }
  function toScreen(x, y) { return [(x - cam.x) * cam.k + W / 2, (y - cam.y) * cam.k + H / 2]; }
  function toWorld(x, y) { return [(x - W / 2) / cam.k + cam.x, (y - H / 2) / cam.k + cam.y]; }

  function draw() {
    if (!ctx || !data) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(cam.k, cam.k); ctx.translate(-cam.x, -cam.y);

    var focus = hover ? hover.id : null;
    var matches = query ? function (n) { return n.t.toLowerCase().indexOf(query) >= 0; } : null;

    // cluster backdrops
    groups.forEach(function (g) {
      if (hidden[g]) return;
      var ms = nodes.filter(function (n) { return n.g === g && visible(n); });
      if (!ms.length) return;
      var cx = 0, cy = 0;
      ms.forEach(function (n) { cx += n.x; cy += n.y; }); cx /= ms.length; cy /= ms.length;
      var ds = ms.map(function (n) { return Math.hypot(n.x - cx, n.y - cy) + n.r + 18; }).sort(function (a, b) { return a - b; });
      var r = Math.max(34, ds[Math.floor((ds.length - 1) * 0.9)]);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = hexA(groupInfo[g].color, 0.06); ctx.fill();
      ctx.strokeStyle = hexA(groupInfo[g].color, 0.25); ctx.lineWidth = 1 / cam.k; ctx.stroke();
      ctx.fillStyle = groupInfo[g].color;
      ctx.font = 'bold ' + (14 / Math.max(cam.k, 0.6)) + 'px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(g, cx, cy - r - 6 / cam.k);
    });

    // edges
    links.forEach(function (l) {
      if (!visible(l.a) || !visible(l.b)) return;
      var hot = focus && (l.a.id === focus || l.b.id === focus);
      ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y);
      ctx.strokeStyle = hot ? 'rgba(51,102,204,0.9)' : (focus || matches ? 'rgba(160,166,175,0.12)' : (l.a.g === l.b.g ? 'rgba(140,146,155,0.55)' : 'rgba(160,166,175,0.22)'));
      ctx.lineWidth = (hot ? 1.8 : 0.8) / cam.k;
      ctx.stroke();
    });

    // nodes
    nodes.forEach(function (n) {
      if (!visible(n)) return;
      var dim = (focus && n.id !== focus && !adj[focus][n.id]) || (matches && !matches(n));
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = dim ? hexA(groupInfo[n.g].color, 0.18) : groupInfo[n.g].color;
      ctx.fill();
      if (n.id === current) {
        ctx.lineWidth = 3 / cam.k; ctx.strokeStyle = '#202122'; ctx.stroke();
      }
    });

    // labels
    ctx.textAlign = 'center';
    nodes.forEach(function (n) {
      if (!visible(n)) return;
      var important = localOnly || n.id === current || n.id === focus || (focus && adj[focus][n.id]) || (matches && matches(n));
      if (!important && cam.k < 0.85 && n.d < 8) return;
      var dim = (focus && !important) || (matches && !matches(n));
      ctx.font = (n.id === focus || n.id === current ? 'bold ' : '') + (11 / Math.max(cam.k, 0.7)) + 'px sans-serif';
      ctx.fillStyle = dim ? 'rgba(32,33,34,0.25)' : '#202122';
      ctx.fillText(n.t, n.x, n.y + n.r + 11 / Math.max(cam.k, 0.7));
    });
    ctx.restore();
  }

  function hexA(hex, a) {
    var v = parseInt(hex.slice(1), 16);
    return 'rgba(' + (v >> 16) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')';
  }

  function fitAll() {
    var vis = nodes.filter(visible); if (!vis.length) return;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    vis.forEach(function (n) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); });
    cam.x = (x0 + x1) / 2; cam.y = (y0 + y1) / 2;
    cam.k = Math.min(1.2, Math.min((W - 80) / (x1 - x0 + 120), (H - 60) / (y1 - y0 + 120)));
    draw();
  }
  function focusOn(id, animate) {
    var n = byId[id]; if (!n) return;
    var tx = n.x, ty = n.y, tk = localOnly ? 1.4 : Math.max(cam.k, 1.1);
    if (!animate) { cam.x = tx; cam.y = ty; cam.k = localOnly ? 1.4 : 0.75; draw(); return; }
    var sx = cam.x, sy = cam.y, sk = cam.k, t0 = performance.now();
    (function anim(t) {
      var p = Math.min(1, (t - t0) / 350), e = p * (2 - p);
      cam.x = sx + (tx - sx) * e; cam.y = sy + (ty - sy) * e; cam.k = sk + (tk - sk) * e;
      draw(); if (p < 1) requestAnimationFrame(anim);
    })(t0);
  }

  // ---------- interaction ----------
  function pick(mx, my) {
    var w = toWorld(mx, my), best = null, bd = Infinity;
    nodes.forEach(function (n) {
      if (!visible(n)) return;
      var d = Math.hypot(n.x - w[0], n.y - w[1]);
      if (d < n.r + 6 / cam.k && d < bd) { bd = d; best = n; }
    });
    return best;
  }
  function pos(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  var touches = {}, pinch = null;
  function bindPointer() {
    canvas.addEventListener('pointerdown', function (e) {
      var p = pos(e); moved = false;
      touches[e.pointerId] = p;
      var ids = Object.keys(touches);
      if (ids.length === 2) {
        var a = touches[ids[0]], b = touches[ids[1]];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: cam.k };
        dragNode = null; panning = null; moved = true;
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      var n = pick(p[0], p[1]);
      if (n) { dragNode = n; kick(); }
      else panning = { x: p[0], y: p[1], cx: cam.x, cy: cam.y };
    });
    canvas.addEventListener('pointermove', function (e) {
      var p = pos(e);
      if (touches[e.pointerId]) touches[e.pointerId] = p;
      if (pinch) {
        var ids = Object.keys(touches);
        if (ids.length === 2) {
          var a = touches[ids[0]], b = touches[ids[1]];
          var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], before = toWorld(mid[0], mid[1]);
          cam.k = Math.max(0.15, Math.min(4, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
          var after = toWorld(mid[0], mid[1]);
          cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
          draw();
        }
        return;
      }
      if (dragNode) {
        var w = toWorld(p[0], p[1]); dragNode.x = w[0]; dragNode.y = w[1]; moved = true; alpha = Math.max(alpha, 0.3);
        return;
      }
      if (panning) {
        cam.x = panning.cx - (p[0] - panning.x) / cam.k; cam.y = panning.cy - (p[1] - panning.y) / cam.k;
        moved = true; draw(); return;
      }
      var n = pick(p[0], p[1]);
      if (n !== hover) {
        hover = n; canvas.style.cursor = n ? 'pointer' : 'grab'; draw();
        if (n) {
          tip.hidden = false;
          tip.innerHTML = '<b>' + n.t + '</b><br><span>' + n.s + ' · ' + n.d + ' link' + (n.d === 1 ? '' : 's') + '</span>';
        } else tip.hidden = true;
      }
      if (n) { tip.style.left = (p[0] + 14) + 'px'; tip.style.top = (p[1] + 14) + 'px'; }
    });
    function lift(e) {
      delete touches[e.pointerId];
      if (Object.keys(touches).length < 2) pinch = null;
    }
    canvas.addEventListener('pointercancel', function (e) { lift(e); dragNode = null; panning = null; });
    canvas.addEventListener('pointerup', function (e) {
      var p = pos(e);
      lift(e);
      if (!moved) {
        var n = pick(p[0], p[1]);
        if (n) { location.href = n.id + '.html'; return; }
      }
      dragNode = null; panning = null;
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = pos(e), before = toWorld(p[0], p[1]);
      cam.k = Math.max(0.15, Math.min(4, cam.k * Math.exp(-e.deltaY * 0.0015)));
      var after = toWorld(p[0], p[1]);
      cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
      draw();
    }, { passive: false });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && view && !view.hidden) close();
    });
  }

  // Open with the header button or the G key
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'g' || e.key === 'G') && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); window.toggleGraph();
    }
  });
  var btn = document.getElementById('graph-toggle');
  if (btn) btn.addEventListener('click', window.toggleGraph);
  if (location.hash === '#graph') open();
})();
