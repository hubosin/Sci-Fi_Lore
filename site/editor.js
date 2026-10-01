// In-page editor for wiki moderators.
// Pages live as Markdown files in the GitHub repo (content/ folder). Editors log in
// with a GitHub token; GitHub itself decides who may edit (repo collaborators only).
// Saving commits straight to the repo, which rebuilds the site automatically.
(function () {
  var W = window.WIKI || {};
  var API = 'https://api.github.com';
  var TOKEN_KEY = 'wiki-editor-token', USER_KEY = 'wiki-editor-user';
  var token = null, user = null, editor = null, overlay = null;
  var RAW = 'https://raw.githubusercontent.com/' + W.owner + '/' + W.repo + '/' + W.branch + '/' + W.dir + '/';

  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- GitHub API ----------
  function gh(path, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 204) return null;
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) { var e = new Error(data.message || ('GitHub error ' + r.status)); e.status = r.status; throw e; }
          return data;
        });
      });
  }
  function repoPath(p) { return '/repos/' + W.owner + '/' + W.repo + '/contents/' + (W.dir + '/' + p).split('/').map(encodeURIComponent).join('/'); }
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(b64.replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function getFile(p) {
    return gh(repoPath(p) + '?ref=' + encodeURIComponent(W.branch))
      .then(function (d) { return { text: b64decode(d.content || ''), sha: d.sha }; })
      .catch(function (e) { if (e.status === 404) return null; throw e; });
  }
  function putFile(p, text, sha, message) {
    return gh(repoPath(p), { method: 'PUT', body: { message: message, content: b64encode(text), sha: sha || undefined, branch: W.branch } });
  }
  function putBase64(p, b64, message) {
    return gh(repoPath(p), { method: 'PUT', body: { message: message, content: b64, branch: W.branch } });
  }
  function deleteFile(p, sha, message) {
    return gh(repoPath(p), { method: 'DELETE', body: { message: message, sha: sha, branch: W.branch } });
  }

  // ---------- small UI helpers ----------
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function toast(msg, kind, keep) {
    var t = document.getElementById('ed-toast');
    if (!t) { t = el('<div id="ed-toast" role="status"></div>'); document.body.appendChild(t); }
    t.className = kind || ''; t.innerHTML = msg; t.hidden = false;
    clearTimeout(toast.timer);
    if (!keep) toast.timer = setTimeout(function () { t.hidden = true; }, 6000);
    return t;
  }
  function modal(title, bodyHtml, buttons) {
    var m = el('<div class="ed-modal-back"><div class="ed-modal" role="dialog" aria-modal="true">' +
      '<h2>' + esc(title) + '</h2><div class="ed-modal-body">' + bodyHtml + '</div>' +
      '<div class="ed-modal-buttons"></div></div></div>');
    var bar = m.querySelector('.ed-modal-buttons');
    (buttons || []).forEach(function (b) {
      var x = el('<button type="button" class="' + (b.primary ? 'primary' : '') + (b.danger ? ' danger' : '') + '">' + esc(b.label) + '</button>');
      x.onclick = function () { b.onclick(m, x); };
      bar.appendChild(x);
    });
    m.addEventListener('keydown', function (e) { if (e.key === 'Escape') m.remove(); });
    document.body.appendChild(m);
    var first = m.querySelector('input, select, textarea, button.primary');
    if (first) setTimeout(function () { first.focus(); }, 30);
    return m;
  }
  function busy(btn, on, label) { if (!btn) return; btn.disabled = on; if (label) btn.textContent = label; }

  // ---------- login ----------
  function loginDialog() {
    var url = 'https://github.com/settings/tokens/new?scopes=public_repo&description=' + encodeURIComponent('Sci-Fi Lore wiki editor');
    modal('Editor login',
      '<p>Editing is limited to wiki moderators (people added as collaborators on the GitHub repo).</p>' +
      '<ol><li><a href="' + url + '" target="_blank" rel="noopener">Create a GitHub token</a>. The form is pre-filled: pick an expiry, keep only <b>public_repo</b> ticked, and click <b>Generate token</b>.</li>' +
      '<li>Copy the token and paste it below. It is stored only in this browser.</li></ol>' +
      '<input type="password" class="ed-token" placeholder="ghp_…" autocomplete="off" spellcheck="false">' +
      '<p class="ed-error" hidden></p>',
      [{ label: 'Cancel', onclick: function (m) { m.remove(); } },
       { label: 'Log in', primary: true, onclick: function (m, btn) {
          var t = m.querySelector('.ed-token').value.trim(), err = m.querySelector('.ed-error');
          if (!t) return;
          busy(btn, true, 'Checking…'); err.hidden = true;
          verify(t).then(function () { m.remove(); toast('Logged in as <b>' + esc(user) + '</b>. You can now edit pages.', 'ok'); installUI(); })
            .catch(function (e) { err.textContent = e.message; err.hidden = false; busy(btn, false, 'Log in'); });
        } }]);
  }
  function verify(t) {
    token = t;
    return gh('/user').then(function (u) {
      user = u.login;
      return gh('/repos/' + W.owner + '/' + W.repo);
    }).then(function (r) {
      if (!r.permissions || !r.permissions.push) throw new Error('Your GitHub account (' + user + ') does not have edit access to this wiki. Ask the owner to add you as a collaborator.');
      save(TOKEN_KEY, t); save(USER_KEY, user);
    }).catch(function (e) {
      token = null; user = null;
      if (e.status === 401) e.message = 'That token was not accepted. Check you copied all of it, and that it hasn’t expired.';
      throw e;
    });
  }
  function logout() { save(TOKEN_KEY, null); save(USER_KEY, null); location.reload(); }

  // ---------- header controls for logged-in editors ----------
  function installUI() {
    if (document.getElementById('ed-controls')) return;
    if (!document.querySelector('link[href="editor.css"]')) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'editor.css'; document.head.appendChild(l);
    }
    var header = document.getElementById('site-header'), graphBtn = document.getElementById('graph-toggle');
    var canEdit = W.page && W.page !== 'search';
    var c = el('<div id="ed-controls">' +
      (canEdit ? '<button type="button" class="ed-btn" id="ed-edit" title="Edit this page (E)">✎ <span>Edit</span></button>' : '') +
      '<button type="button" class="ed-btn" id="ed-new" title="Create a new page">＋ <span>New page</span></button>' +
      '<div class="ed-user"><button type="button" class="ed-btn ed-user-btn" aria-haspopup="true" title="Editor menu">' + esc(user || 'Editor') + ' ▾</button>' +
      '<div class="ed-menu" hidden>' +
        '<button type="button" data-a="sidebar">Edit the menu (sidebar)</button>' +
        '<button type="button" data-a="footer">Edit the footer</button>' +
        '<a href="https://github.com/' + W.owner + '/' + W.repo + '/commits/' + W.branch + '/' + W.dir + '" target="_blank" rel="noopener">Recent changes</a>' +
        '<a href="https://github.com/' + W.owner + '/' + W.repo + '/settings/access" target="_blank" rel="noopener">Manage editors</a>' +
        '<button type="button" data-a="logout">Log out</button>' +
      '</div></div></div>');
    header.insertBefore(c, graphBtn);
    var editBtn = c.querySelector('#ed-edit');
    if (editBtn) editBtn.onclick = function () { openEditor(W.page); };
    c.querySelector('#ed-new').onclick = newPageDialog;
    var menu = c.querySelector('.ed-menu');
    c.querySelector('.ed-user-btn').onclick = function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', function () { menu.hidden = true; });
    menu.addEventListener('click', function (e) {
      var a = e.target.getAttribute('data-a');
      if (a === 'sidebar') openEditor('_Sidebar', { markdown: true, title: 'Menu (sidebar)' });
      if (a === 'footer') openEditor('_Footer', { markdown: true, title: 'Footer' });
      if (a === 'logout') logout();
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'e' || e.key === 'E') && canEdit && !overlay && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); openEditor(W.page);
      }
    });
    document.documentElement.classList.add('is-editor');
    var ll = document.getElementById('editor-login-link');
    if (ll) ll.parentNode.style.display = 'none';
  }

  // ---------- load the rich editor library on demand ----------
  var libPromise = null;
  function loadLib() {
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      ['vendor/toastui-editor.css', 'editor.css'].forEach(function (href) {
        if (document.querySelector('link[href="' + href + '"]')) return;
        var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
      });
      var s = document.createElement('script');
      s.src = 'vendor/toastui-editor.bundle.js';
      s.onload = function () { resolve(window.ToastEditor); };
      s.onerror = function () { libPromise = null; reject(new Error('Could not load the editor.')); };
      document.body.appendChild(s);
    });
    return libPromise;
  }

  // ---------- page list (for link picker) ----------
  var pages = null;
  function getPages() {
    if (pages) return Promise.resolve(pages);
    return fetch('search.json').then(function (r) { return r.json(); }).then(function (d) {
      pages = d.map(function (e) { return { p: e.p, t: e.t }; }).sort(function (a, b) { return a.t.localeCompare(b.t); });
      return pages;
    });
  }

  // ---------- the editor ----------
  var uploads = [];
  function openEditor(page, opts) {
    opts = opts || {};
    if (overlay) return;
    var title = opts.title || (page === 'Home' ? 'Main Page' : page.replace(/-/g, ' '));
    toast('Opening editor…', '', true);
    Promise.all([loadLib(), opts.text != null ? Promise.resolve({ text: opts.text, sha: null }) : getFile(page + '.md')])
      .then(function (res) {
        var Editor = res[0], file = res[1];
        if (!file) { toast('This page doesn’t exist in the wiki yet.', 'err'); return; }
        document.getElementById('ed-toast').hidden = true;
        buildOverlay(Editor, page, title, file, opts);
      })
      .catch(function (e) { toast(esc(e.message), 'err'); });
  }

  function buildOverlay(Editor, page, title, file, opts) {
    uploads = [];
    var hasHtml = /<(img|div|details|table|span|br)\b/i.test(file.text);
    var markdownFirst = opts.markdown || hasHtml;
    overlay = el('<div id="ed-overlay" role="dialog" aria-label="Editing ' + esc(title) + '">' +
      '<div class="ed-bar">' +
        '<div class="ed-title"><span>' + (opts.isNew ? 'New page' : 'Editing') + '</span> <b>' + esc(title) + '</b></div>' +
        '<input type="text" class="ed-summary" placeholder="Summary of your change (optional)" maxlength="120">' +
        '<button type="button" class="ed-cancel">Cancel</button>' +
        '<button type="button" class="ed-save primary">' + (opts.isNew ? 'Create page' : 'Save') + '</button>' +
        (opts.isNew || /^_/.test(page) || page === 'Home' ? '' : '<button type="button" class="ed-delete danger" title="Delete this page">Delete</button>') +
      '</div>' +
      (hasHtml && !opts.markdown ? '<div class="ed-note">This page contains HTML (like sized images), so it opened in <b>Markdown</b> mode to keep it intact. You can switch to WYSIWYG at the bottom right, but HTML may be lost.</div>' : '') +
      '<div class="ed-help">Tips: <b>Page link</b> links to another wiki page · <b>Infobox</b> adds the facts box · <b>Tree</b> inserts a family/tech tree · drag images straight into the editor.</div>' +
      '<div class="ed-root"></div></div>');
    document.body.appendChild(overlay);
    document.documentElement.classList.add('ed-open');

    function tool(label, tip, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ed-tool'; b.textContent = label; b.title = tip;
      b.addEventListener('click', function (e) { e.preventDefault(); fn(); });
      return { name: label.toLowerCase().replace(/\W+/g, ''), tooltip: tip, el: b };
    }
    editor = new Editor({
      el: overlay.querySelector('.ed-root'),
      height: '100%',
      initialEditType: markdownFirst ? 'markdown' : 'wysiwyg',
      previewStyle: window.innerWidth > 1000 ? 'vertical' : 'tab',
      initialValue: file.text,
      usageStatistics: false,
      autofocus: true,
      toolbarItems: [
        ['heading', 'bold', 'italic', 'strike'],
        ['hr', 'quote'],
        ['ul', 'ol', 'indent', 'outdent'],
        ['table', 'image', 'link'],
        ['code', 'codeblock'],
        [tool('Page link', 'Link to another wiki page', pageLinkPicker),
         tool('Infobox', 'Add the facts box at the top of the page', insertInfobox),
         tool('Tree', 'Insert a family / tech / faction tree', insertTree)]
      ],
      hooks: { addImageBlobHook: uploadImage }
    });

    overlay.querySelector('.ed-cancel').onclick = function () { closeEditor(false); };
    overlay.querySelector('.ed-save').onclick = function (e) { saveEdit(page, title, file, opts, e.target); };
    var del = overlay.querySelector('.ed-delete');
    if (del) del.onclick = function () { deleteDialog(page, title, file); };
    overlay.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); overlay.querySelector('.ed-save').click(); }
    });
    window.addEventListener('beforeunload', warnUnsaved);
    editor.__initial = editor.getMarkdown();
  }
  function warnUnsaved(e) {
    if (editor && editor.getMarkdown() !== editor.__initial) { e.preventDefault(); e.returnValue = ''; }
  }
  function closeEditor(force) {
    if (!overlay) return;
    if (!force && editor && editor.getMarkdown() !== editor.__initial && !confirm('Discard your changes?')) return;
    window.removeEventListener('beforeunload', warnUnsaved);
    try { editor.destroy(); } catch (e) {}
    editor = null; overlay.remove(); overlay = null;
    document.documentElement.classList.remove('ed-open');
  }

  function finalMarkdown() {
    var md = editor.getMarkdown();
    // images uploaded during this edit are previewed from GitHub; store them as normal wiki paths
    md = md.split(RAW + 'images/').join('images/');
    return md.replace(/\s+$/, '') + '\n';
  }

  function saveEdit(page, title, file, opts, btn) {
    var md = finalMarkdown();
    if (!opts.isNew && (editor.getMarkdown() === editor.__initial || md === file.text)) { closeEditor(true); toast('No changes to save.'); return; }
    var summary = overlay.querySelector('.ed-summary').value.trim();
    var msg = (opts.isNew ? 'Create ' : 'Edit ') + title + (summary ? ': ' + summary : '') + ' (by ' + user + ' via site editor)';
    busy(btn, true, 'Saving…');
    var chain = opts.isNew ? createWithSidebar(page, title, md, opts, msg) : putFile(page + '.md', md, file.sha, msg);
    chain.then(function (res) {
      closeEditor(true);
      published(res && res.commit && res.commit.sha, opts.isNew ? page : (page.charAt(0) === '_' ? W.page : page));
    }).catch(function (e) {
      busy(btn, false, opts.isNew ? 'Create page' : 'Save');
      if (e.status === 409 || e.status === 422) {
        alert('Someone else saved this page while you were editing.\n\nCopy your text somewhere safe, then reload the page and edit again.');
      } else alert('Could not save: ' + e.message);
    });
  }

  // After a save: watch the site rebuild, then offer a reload.
  function published(sha, goto) {
    var t = toast('<b>Saved.</b> Publishing to the site… <span class="ed-spin"></span>', 'ok', true);
    var tries = 0;
    (function poll() {
      tries++;
      gh('/repos/' + W.owner + '/' + W.repo + '/actions/runs?branch=' + W.branch + '&per_page=5').then(function (d) {
        var run = (d.workflow_runs || []).filter(function (r) { return !sha || r.head_sha === sha; })[0];
        if (run && run.status === 'completed') {
          if (run.conclusion === 'success') {
            t.innerHTML = '<b>Published!</b> <a href="' + esc(goto) + '.html?v=' + Date.now() + '">Reload to see it</a>';
          } else {
            t.className = 'err';
            t.innerHTML = 'Saved, but the site build failed. <a href="' + esc(run.html_url) + '" target="_blank" rel="noopener">See what went wrong</a>';
          }
          return;
        }
        if (tries < 60) setTimeout(poll, 6000);
        else t.innerHTML = 'Saved. The site is taking a while to update. <a href="' + esc(goto) + '.html?v=' + Date.now() + '">Reload</a>';
      }).catch(function () { if (tries < 60) setTimeout(poll, 8000); });
    })();
  }

  // ---------- editor tools ----------
  function pageLinkPicker() {
    getPages().then(function (list) {
      var m = modal('Link to a page',
        '<input type="search" class="ed-pfind" placeholder="Type to find a page…">' +
        '<div class="ed-plist"></div>' +
        '<label class="ed-plabel">Link text (optional) <input type="text" class="ed-ptext"></label>',
        [{ label: 'Cancel', onclick: function (mm) { mm.remove(); } }]);
      var find = m.querySelector('.ed-pfind'), box = m.querySelector('.ed-plist');
      function render() {
        var q = find.value.trim().toLowerCase();
        box.innerHTML = list.filter(function (p) { return !q || p.t.toLowerCase().indexOf(q) >= 0; }).slice(0, 60)
          .map(function (p) { return '<button type="button" data-p="' + esc(p.p) + '" data-t="' + esc(p.t) + '">' + esc(p.t) + '</button>'; }).join('') ||
          '<p class="ed-muted">No page with that name. You can create it with <b>New page</b>.</p>';
      }
      find.oninput = render; render();
      box.onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var text = m.querySelector('.ed-ptext').value.trim() || b.getAttribute('data-t');
        editor.exec('addLink', { linkUrl: b.getAttribute('data-p'), linkText: text });
        m.remove(); editor.focus();
      };
    });
  }
  function insertInfobox() {
    var md = editor.getMarkdown();
    if (/^\s*\*\*[^*]{1,40}:\*\*/.test(md)) { alert('This page already has an infobox. It is the first line, starting with **Label:**.'); return; }
    editor.setMarkdown('**Type:** … · **Timeline:** Canon\n\n' + md);
    editor.moveCursorToStart && editor.moveCursorToStart();
    toast('Infobox added at the top. Change the labels and values; separate pairs with “ · ”.');
  }
  function insertTree() {
    modal('Insert a tree',
      '<label>Kind <select class="ed-tkind"><option value="family">Family tree</option><option value="tech">Tech tree</option>' +
      '<option value="faction">Faction tree</option><option value="species">Species tree</option><option value="">Plain</option></select></label>' +
      '<label><input type="checkbox" class="ed-tright"> Draw sideways (left to right)</label>' +
      '<p class="ed-muted">Each line is a box. Indent two spaces to make a child. <code>Name | detail</code> adds small text; <code>A + B</code> makes a couple.</p>',
      [{ label: 'Cancel', onclick: function (m) { m.remove(); } },
       { label: 'Insert', primary: true, onclick: function (m) {
          var kind = m.querySelector('.ed-tkind').value, right = m.querySelector('.ed-tright').checked;
          var head = '```tree' + (kind ? ' ' + kind : '') + (right ? ' right' : '');
          var body = kind === 'family'
            ? '- Parent + Partner | detail\n  - Child one\n  - Child two\n    - Grandchild'
            : '- Top\n  - Branch one | detail\n    - Leaf\n  - Branch two';
          m.remove();
          editor.changeMode('markdown');
          editor.insertText('\n' + head + '\n' + body + '\n```\n');
          editor.focus();
        } }]);
  }
  function uploadImage(blob, callback) {
    var name = (blob.name || 'image.png').toLowerCase().replace(/[^a-z0-9.\-]+/g, '-').replace(/^-+|-+$/g, '');
    var stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    var path = 'images/' + stamp + '-' + Math.random().toString(36).slice(2, 6) + '-' + name;
    if (blob.size > 10 * 1024 * 1024) { alert('That image is over 10 MB. Please shrink it first.'); return; }
    var t = toast('Uploading image…', '', true);
    var reader = new FileReader();
    reader.onload = function () {
      var b64 = String(reader.result).split(',')[1];
      putBase64(path, b64, 'Upload ' + name + ' (by ' + user + ' via site editor)').then(function () {
        t.hidden = true;
        callback(RAW + path, name.replace(/\.[a-z0-9]+$/, '').replace(/[-_]+/g, ' '));
      }).catch(function (e) { toast('Image upload failed: ' + esc(e.message), 'err'); });
    };
    reader.readAsDataURL(blob);
  }

  // ---------- new page ----------
  function slugify(title) {
    return title.trim().replace(/[^\w\s\-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }
  function sidebarTargets(md) {
    // every section heading and every list item that has (or could have) pages under it
    var lines = md.split('\n'), out = [], trail = [];
    lines.forEach(function (ln, i) {
      var h = ln.match(/^\*\*(.+)\*\*\s*$/);
      if (h && !/^\s/.test(ln)) {
        var name = h[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
        trail = [{ indent: -2, name: name }];
        out.push({ line: i, indent: -2, label: name });
        return;
      }
      var m = ln.match(/^(\s*)[-*]\s+(.*)$/);
      if (!m || !trail.length) return;
      var indent = m[1].length, text = m[2].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
      while (trail.length > 1 && trail[trail.length - 1].indent >= indent) trail.pop();
      trail.push({ indent: indent, name: text });
      var next = lines[i + 1] || '', nm = next.match(/^(\s*)[-*]\s+/);
      var isGroup = (nm && nm[1].length > indent) || !/\]\(/.test(m[2]);
      if (isGroup) out.push({ line: i, indent: indent, label: trail.map(function (t) { return t.name; }).join(' › ') });
    });
    return out;
  }
  function insertIntoSidebar(md, target, entry) {
    var lines = md.split('\n'), i = target.line + 1, childIndent = target.indent + 2;
    // walk to the end of this group's block
    for (; i < lines.length; i++) {
      var ln = lines[i];
      if (/^\*\*.+\*\*\s*$/.test(ln)) break;
      if (!ln.trim()) { var j = i; while (j < lines.length && !lines[j].trim()) j++; if (j >= lines.length || /^\*\*/.test(lines[j])) break; continue; }
      var m = ln.match(/^(\s*)[-*]\s+/);
      if (m && m[1].length < childIndent) break;
    }
    var newLine = new Array(childIndent + 1).join(' ') + '- ' + entry;
    lines.splice(i, 0, newLine);
    return lines.join('\n');
  }
  function newPageDialog() {
    toast('Loading…', '', true);
    getFile('_Sidebar.md').then(function (sb) {
      document.getElementById('ed-toast').hidden = true;
      var targets = sb ? sidebarTargets(sb.text) : [];
      var opts = targets.map(function (t, k) { return '<option value="' + k + '">' + esc(t.label) + '</option>'; }).join('');
      var m = modal('Create a new page',
        '<label>Page title <input type="text" class="ed-ntitle" placeholder="e.g. Sonorous Leviathan"></label>' +
        '<p class="ed-muted ed-nslug"></p>' +
        '<label>Put it in the menu under <select class="ed-nwhere"><option value="">(don’t add to the menu)</option>' + opts + '</select></label>' +
        '<p class="ed-error" hidden></p>',
        [{ label: 'Cancel', onclick: function (mm) { mm.remove(); } },
         { label: 'Next: write the page', primary: true, onclick: function (mm, btn) {
            var title = mm.querySelector('.ed-ntitle').value.trim(), slug = slugify(title), err = mm.querySelector('.ed-error');
            if (!slug) { err.textContent = 'Give the page a title.'; err.hidden = false; return; }
            busy(btn, true, 'Checking…');
            getFile(slug + '.md').then(function (exists) {
              if (exists) { err.innerHTML = 'A page called <b>' + esc(slug) + '</b> already exists.'; err.hidden = false; busy(btn, false, 'Next: write the page'); return; }
              var w = mm.querySelector('.ed-nwhere').value;
              mm.remove();
              var tpl = '**Type:** … · **Timeline:** Canon\n\nOne sentence saying what ' + title + ' is.\n\n## Overview\n\n\n## History\n\n\n## Related\n\n';
              openEditor(slug, { isNew: true, title: title, text: tpl, sidebar: sb, target: w === '' ? null : targets[+w] });
            }).catch(function (e) { err.textContent = e.message; err.hidden = false; busy(btn, false, 'Next: write the page'); });
          } }]);
      var t = m.querySelector('.ed-ntitle'), s = m.querySelector('.ed-nslug');
      t.oninput = function () { var x = slugify(t.value); s.textContent = x ? 'Page address: ' + x : ''; };
    }).catch(function (e) { toast(esc(e.message), 'err'); });
  }
  function createWithSidebar(slug, title, md, opts, msg) {
    return putFile(slug + '.md', md, null, msg).then(function (res) {
      if (!opts.target || !opts.sidebar) return res;
      // re-read the sidebar in case it changed, then add the new page to it
      return getFile('_Sidebar.md').then(function (sb) {
        var targets = sidebarTargets(sb.text);
        var t = targets.filter(function (x) { return x.label === opts.target.label; })[0] || opts.target;
        var updated = insertIntoSidebar(sb.text, t, '[' + title + '](' + slug + ')');
        return putFile('_Sidebar.md', updated, sb.sha, 'Add ' + title + ' to the menu (by ' + user + ' via site editor)');
      });
    });
  }

  // ---------- delete ----------
  function deleteDialog(page, title, file) {
    modal('Delete “' + title + '”?',
      '<p>This removes the page from the wiki and from the menu. Links to it on other pages will stop working. (It can be recovered from the repo history if needed.)</p>' +
      '<label>Type <b>' + esc(page) + '</b> to confirm <input type="text" class="ed-dconfirm"></label>',
      [{ label: 'Cancel', onclick: function (m) { m.remove(); } },
       { label: 'Delete page', danger: true, onclick: function (m, btn) {
          if (m.querySelector('.ed-dconfirm').value.trim() !== page) return;
          busy(btn, true, 'Deleting…');
          deleteFile(page + '.md', file.sha, 'Delete ' + title + ' (by ' + user + ' via site editor)').then(function () {
            return getFile('_Sidebar.md');
          }).then(function (sb) {
            if (!sb) return;
            var re = new RegExp('\\]\\(' + page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(#[^)]*)?\\)');
            var kept = sb.text.split('\n').filter(function (ln) { return !(/^\s*[-*]\s/.test(ln) && re.test(ln)); }).join('\n');
            if (kept !== sb.text) return putFile('_Sidebar.md', kept, sb.sha, 'Remove ' + title + ' from the menu (by ' + user + ' via site editor)');
          }).then(function (res) {
            m.remove(); closeEditor(true);
            published(res && res.commit && res.commit.sha, 'index');
          }).catch(function (e) { alert('Could not delete: ' + e.message); busy(btn, false, 'Delete page'); });
        } }]);
  }

  // ---------- start ----------
  if (!document.querySelector('link[href="editor.css"]')) {
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'editor.css'; document.head.appendChild(css);
  }
  window.WikiEditor = { login: loginDialog };
  var saved = load(TOKEN_KEY);
  if (saved) { token = saved; user = load(USER_KEY); installUI(); }
})();
