// Graph view: every wiki page is a dot, every link between pages is a line.
// Layout is a plain force simulation (like Obsidian's graph): links pull pages
// together, pages push each other apart, and a gentle pull keeps it centred.
(function () {
  var view, stage, canvas, ctx, tip, data, nodes = [], links = [], byId = {}, adj = {};
  var groups = [], colors = {}, hidden = {};
  var W = 0, H = 0, DPR = 1;
  var cam = { x: 0, y: 0, k: 1 }, autoFit = true;
  var hover = null, dragNode = null, panning = null, moved = false;
  var alpha = 0, running = false, query = '', localOnly = false, near = null;
  var current = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
  if (current === 'index' || current === '') current = 'Home';

  var PALETTE = ['#5b7bd5', '#d96c4f', '#e0a33a', '#4fa35a', '#a45fb8', '#3aa6bf',
                 '#d4668f', '#8aab3a', '#b3544f', '#5a7a9c', '#9b6fb0', '#3fa596'];

  // ---------- open / close ----------
  function open() {
    if (!view) build();
    view.hidden = false;
    document.documentElement.classList.add('graph-open');
    requestAnimationFrame(function () {
      resize();
      if (data) { autoFit = true; fitAll(); kick(0.3); } else load();
    });
    setTimeout(function () { view.querySelector('.gv-search').focus({ preventScroll: true }); }, 60);
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
        '<label class="gv-local"><input type="checkbox"> Only this page’s links</label>' +
        '<button type="button" class="gv-center">Go to this page</button>' +
        '<button type="button" class="gv-fit">Fit to screen</button>' +
        '<button type="button" class="gv-close" aria-label="Close graph">✕</button>' +
      '</div>' +
      '<div class="gv-stage"><canvas></canvas><div class="gv-legend"></div><div class="gv-tip" hidden></div>' +
      '<div class="gv-help">Scroll or pinch to zoom · drag to move · click a page to open it · Esc to close</div></div>';
    document.body.appendChild(view);
    stage = view.querySelector('.gv-stage');
    canvas = view.querySelector('canvas');
    ctx = canvas.getContext('2d');
    tip = view.querySelector('.gv-tip');
    view.querySelector('.gv-close').onclick = close;
    view.querySelector('.gv-center').onclick = function () { autoFit = false; focusOn(current); };
    view.querySelector('.gv-fit').onclick = function () { autoFit = true; fitAll(true); };
    var search = view.querySelector('.gv-search');
    search.oninput = function () { query = search.value.trim().toLowerCase(); draw(); };
    search.onkeydown = function (e) {
      if (e.key !== 'Enter' || !query) return;
      var m = nodes.filter(function (n) { return visible(n) && n.t.toLowerCase().indexOf(query) >= 0; })[0];
      if (m) { autoFit = false; focusOn(m.id); }
    };
    view.querySelector('.gv-local input').onchange = function (e) {
      localOnly = e.target.checked; near = null; autoFit = true; fitAll(true); kick(0.5);
    };
    if (window.ResizeObserver) new ResizeObserver(function () { if (!view.hidden) resize(); }).observe(stage);
    else window.addEventListener('resize', function () { if (!view.hidden) resize(); });
    bindPointer();
  }

  function load() {
    fetch('graph.json').then(function (r) { return r.json(); }).then(function (d) {
      data = d; setup();
      alpha = 1;
      for (var i = 0; i < 300; i++) step();   // settle before the first frame
      alpha = 0.08;
      autoFit = true; fitAll(); kick(0.08);
    });
  }

  // ---------- data ----------
  function setup() {
    var names = data.groups.slice();
    data.nodes.forEach(function (n) { if (names.indexOf(n.g) < 0) names.push(n.g); });
    groups = names.filter(function (g) { return data.nodes.some(function (n) { return n.g === g; }); });
    groups.forEach(function (g, i) { colors[g] = PALETTE[i % PALETTE.length]; });

    var golden = Math.PI * (3 - Math.sqrt(5));
    nodes = data.nodes.map(function (n, i) {
      var r = 12 * Math.sqrt(0.5 + i), a = i * golden;   // sunflower start, like d3
      var o = { id: n.id, t: n.t, g: n.g, s: n.s, d: n.d, x: r * Math.cos(a), y: r * Math.sin(a), vx: 0, vy: 0,
                r: 2.6 + Math.sqrt(n.d) * 1.1 };
      byId[o.id] = o; adj[o.id] = {};
      return o;
    });
    links = data.links.filter(function (l) { return byId[l[0]] && byId[l[1]]; }).map(function (l) {
      adj[l[0]][l[1]] = 1; adj[l[1]][l[0]] = 1;
      return { a: byId[l[0]], b: byId[l[1]] };
    });
    links.forEach(function (l) {
      var ca = Object.keys(adj[l.a.id]).length, cb = Object.keys(adj[l.b.id]).length;
      l.strength = 1 / Math.min(ca, cb);
      l.bias = ca / (ca + cb);
    });

    var lg = view.querySelector('.gv-legend');
    lg.innerHTML = '<button type="button" class="gv-legend-head">Colour key</button>' + groups.map(function (g) {
      return '<button type="button" data-g="' + g + '"><i style="background:' + colors[g] + '"></i>' + g + '</button>';
    }).join('');
    if (window.matchMedia('(max-width: 720px)').matches) lg.classList.add('folded');
    lg.querySelector('.gv-legend-head').onclick = function () { lg.classList.toggle('folded'); };
    lg.querySelectorAll('button[data-g]').forEach(function (b) {
      b.onclick = function () {
        var g = b.getAttribute('data-g');
        hidden[g] = !hidden[g]; b.classList.toggle('off', !!hidden[g]); kick(0.4);
      };
    });
  }

  function visible(n) {
    if (hidden[n.g]) return false;
    if (localOnly) {
      if (!near) { near = {}; near[current] = 1; Object.keys(adj[current] || {}).forEach(function (a) { near[a] = 1; }); }
      return !!near[n.id];
    }
    return true;
  }

  // ---------- simulation ----------
  function kick(a) {
    alpha = Math.max(alpha, a || 0.3);
    if (!running) { running = true; requestAnimationFrame(loop); }
  }
  function loop() {
    if (!running || view.hidden) { running = false; return; }
    step();
    if (autoFit) fitAll();
    draw();
    if (alpha > 0.002 || dragNode) requestAnimationFrame(loop); else running = false;
  }
  function step() {
    var vis = nodes.filter(visible), n = vis.length, i, j, a, b, dx, dy, d2, d, f;

    // links pull connected pages together
    links.forEach(function (l) {
      if (!visible(l.a) || !visible(l.b)) return;
      dx = l.b.x + l.b.vx - l.a.x - l.a.vx; dy = l.b.y + l.b.vy - l.a.y - l.a.vy;
      d = Math.sqrt(dx * dx + dy * dy) || 1;
      f = (d - 34) / d * alpha * l.strength;
      dx *= f; dy *= f;
      l.b.vx -= dx * l.bias; l.b.vy -= dy * l.bias;
      l.a.vx += dx * (1 - l.bias); l.a.vy += dy * (1 - l.bias);
    });

    // every page pushes every other page away (close ones most)
    for (i = 0; i < n; i++) {
      a = vis[i];
      for (j = i + 1; j < n; j++) {
        b = vis[j];
        dx = b.x - a.x; dy = b.y - a.y; d2 = dx * dx + dy * dy;
        if (d2 > 90000) continue;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        f = -110 * alpha / d2;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        // keep dots from overlapping
        var min = a.r + b.r + 3;
        if (d2 < min * min) {
          d = Math.sqrt(d2); var push = (min - d) / d * 0.5;
          a.vx -= dx * push * 0.5; a.vy -= dy * push * 0.5; b.vx += dx * push * 0.5; b.vy += dy * push * 0.5;
        }
      }
    }

    // gentle pull toward the centre keeps loose pages nearby
    vis.forEach(function (p) {
      p.vx -= p.x * 0.035 * alpha; p.vy -= p.y * 0.035 * alpha;
      if (p === dragNode) { p.vx = p.vy = 0; return; }
      p.vx *= 0.6; p.vy *= 0.6;
      p.x += p.vx; p.y += p.vy;
    });
    alpha += (0 - alpha) * 0.0228;
  }

  // ---------- camera ----------
  function resize() {
    DPR = window.devicePixelRatio || 1;
    var r = stage.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    if (autoFit) fitAll();
    draw();
  }
  function bounds() {
    var vis = nodes.filter(visible); if (!vis.length) return null;
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    vis.forEach(function (n) {
      b.x0 = Math.min(b.x0, n.x - n.r); b.y0 = Math.min(b.y0, n.y - n.r);
      b.x1 = Math.max(b.x1, n.x + n.r); b.y1 = Math.max(b.y1, n.y + n.r);
    });
    return b;
  }
  function fitAll(animate) {
    var b = bounds(); if (!b) return;
    var pad = 60;
    var k = Math.min(1.6, (W - pad * 2) / Math.max(1, b.x1 - b.x0), (H - pad * 2) / Math.max(1, b.y1 - b.y0));
    var tx = (b.x0 + b.x1) / 2, ty = (b.y0 + b.y1) / 2;
    if (animate) return glide(tx, ty, k);
    cam.x = tx; cam.y = ty; cam.k = Math.max(0.2, k);
    draw();
  }
  function focusOn(id) {
    var n = byId[id]; if (!n) return;
    glide(n.x, n.y, Math.max(cam.k, 1.6));
  }
  function glide(tx, ty, tk) {
    var sx = cam.x, sy = cam.y, sk = cam.k, t0 = performance.now();
    (function anim(t) {
      var p = Math.min(1, (t - t0) / 380), e = 1 - Math.pow(1 - p, 3);
      cam.x = sx + (tx - sx) * e; cam.y = sy + (ty - sy) * e; cam.k = sk + (tk - sk) * e;
      draw(); if (p < 1) requestAnimationFrame(anim);
    })(t0);
  }
  function toWorld(x, y) { return [(x - W / 2) / cam.k + cam.x, (y - H / 2) / cam.k + cam.y]; }

  // ---------- drawing ----------
  function rgba(hex, a) {
    var v = parseInt(hex.slice(1), 16);
    return 'rgba(' + (v >> 16) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')';
  }
  function draw() {
    if (!ctx || !data) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(cam.k, cam.k); ctx.translate(-cam.x, -cam.y);

    var focus = hover ? hover.id : null;
    var match = query ? function (n) { return n.t.toLowerCase().indexOf(query) >= 0; } : null;
    var lit = function (n) { return !focus || n.id === focus || adj[focus][n.id]; };

    // lines
    ctx.lineWidth = 1 / cam.k;
    links.forEach(function (l) {
      if (!visible(l.a) || !visible(l.b)) return;
      var hot = focus && (l.a.id === focus || l.b.id === focus);
      ctx.strokeStyle = hot ? 'rgba(91,123,213,0.95)'
        : (focus || match) ? 'rgba(150,155,165,0.12)' : 'rgba(150,155,165,0.42)';
      ctx.lineWidth = (hot ? 1.6 : 1) / cam.k;
      ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
    });

    // dots
    nodes.forEach(function (n) {
      if (!visible(n)) return;
      var dim = !lit(n) || (match && !match(n));
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = dim ? rgba(colors[n.g], 0.18) : (n.id === focus ? '#3a5fcf' : colors[n.g]);
      ctx.fill();
      if (n.id === current) { ctx.lineWidth = 2.2 / cam.k; ctx.strokeStyle = '#202122'; ctx.stroke(); }
    });

    // labels fade in as you zoom, like Obsidian
    var base = Math.max(0, Math.min(1, (cam.k - 0.75) / 0.6));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var fs = 11 / cam.k;
    ctx.font = fs + 'px sans-serif';
    nodes.forEach(function (n) {
      if (!visible(n)) return;
      var strong = n.id === current || n.id === focus || (focus && adj[focus][n.id]) || (match && match(n)) || localOnly;
      var op = strong ? 1 : (focus || match ? base * 0.25 : base);
      if (op < 0.03) return;
      ctx.font = ((n.id === focus || n.id === current) ? 'bold ' : '') + fs + 'px sans-serif';
      ctx.fillStyle = 'rgba(32,33,34,' + op + ')';
      ctx.fillText(n.t, n.x, n.y + n.r + 3 / cam.k);
    });
    ctx.restore();
  }

  // ---------- interaction ----------
  function pick(mx, my) {
    var w = toWorld(mx, my), best = null, bd = Infinity;
    nodes.forEach(function (n) {
      if (!visible(n)) return;
      var d = Math.hypot(n.x - w[0], n.y - w[1]);
      if (d < n.r + 5 / cam.k && d < bd) { bd = d; best = n; }
    });
    return best;
  }
  function pos(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  var touches = {}, pinch = null;
  function bindPointer() {
    canvas.addEventListener('pointerdown', function (e) {
      var p = pos(e); moved = false; autoFit = false;
      canvas.setPointerCapture(e.pointerId);
      touches[e.pointerId] = p;
      var ids = Object.keys(touches);
      if (ids.length === 2) {
        var a = touches[ids[0]], b = touches[ids[1]];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: cam.k };
        dragNode = null; panning = null; moved = true;
        return;
      }
      var n = pick(p[0], p[1]);
      if (n) { dragNode = n; kick(0.3); }
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
          cam.k = Math.max(0.15, Math.min(5, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
          var after = toWorld(mid[0], mid[1]);
          cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
          draw();
        }
        return;
      }
      if (dragNode) {
        var w = toWorld(p[0], p[1]); dragNode.x = w[0]; dragNode.y = w[1]; moved = true;
        alpha = Math.max(alpha, 0.25);
        return;
      }
      if (panning) {
        cam.x = panning.cx - (p[0] - panning.x) / cam.k; cam.y = panning.cy - (p[1] - panning.y) / cam.k;
        if (Math.abs(p[0] - panning.x) + Math.abs(p[1] - panning.y) > 3) moved = true;
        draw(); return;
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
    canvas.addEventListener('pointerleave', function () { if (hover && !dragNode) { hover = null; tip.hidden = true; draw(); } });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault(); autoFit = false;
      var p = pos(e), before = toWorld(p[0], p[1]);
      cam.k = Math.max(0.15, Math.min(5, cam.k * Math.exp(-e.deltaY * 0.0015)));
      var after = toWorld(p[0], p[1]);
      cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
      draw();
    }, { passive: false });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && view && !view.hidden) close();
    });
  }

  // Open with the header button or the G key
  function isTyping(e) {
    var el = e.target && e.target.nodeType === 1 ? e.target : document.activeElement;
    return !!el && (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable ||
      !!(el.closest && el.closest('#ed-overlay, .ed-modal-back, [contenteditable]')));
  }
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'g' || e.key === 'G') && !isTyping(e) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); window.toggleGraph();
    }
  });
  var btn = document.getElementById('graph-toggle');
  if (btn) btn.addEventListener('click', window.toggleGraph);
  if (location.hash === '#graph') open();
})();
