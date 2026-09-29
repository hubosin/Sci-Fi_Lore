#!/usr/bin/env python3
"""Build a classic-encyclopedia-style static website from the GitHub wiki.

Usage:  python site/build.py --wiki path/to/Sci-Fi_Lore.wiki --out _site

Each wiki page (Page-Name.md) becomes Page-Name.html. The wiki's _Sidebar.md
becomes the left navigation, and a first line like
    **Timeline:** Canon · **Population:** 14 million
becomes the infobox on the right. Nothing in the wiki needs special syntax.
"""
import argparse, html, json, os, re, shutil, subprocess, datetime
import markdown

SITE_NAME = "Sci-Fi Lore"
TAGLINE = "The Retrofuture Encyclopedia"
REPO = "hubosin/Sci-Fi_Lore"
HERE = os.path.dirname(os.path.abspath(__file__))


def slugify(value, separator="-"):
    # Same anchor rules GitHub uses, so wiki links like Page#section keep working.
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value).strip().lower()
    value = re.sub(r"[^\w\- ]", "", value)
    return value.replace(" ", separator)


def title_of(name):
    return "Main Page" if name == "Home" else name.replace("-", " ")


def fix_links(md_text):
    """Turn wiki-style links (Page-Name, Page#anchor) into .html links."""
    def repl(m):
        text, target = m.group(1), m.group(2)
        if re.match(r"^(https?:|mailto:|#|images/)", target) or "." in target.split("#")[0]:
            return m.group(0)
        page, _, anchor = target.partition("#")
        return f"[{text}]({page}.html{'#' + anchor if anchor else ''})"
    # [text](target) but not images ![...]
    return re.sub(r"(?<!!)\[((?:[^\[\]]|\[[^\]]*\])*)\]\(([^)\s]+)\)", repl, md_text)


def mermaid_blocks(md_text):
    return re.sub(r"```mermaid\n(.*?)```",
                  lambda m: '<pre class="mermaid">\n' + html.escape(m.group(1)) + "</pre>",
                  md_text, flags=re.S)


def md_to_html(md_text):
    return markdown.markdown(
        md_text,
        extensions=["tables", "fenced_code", "sane_lists", "md_in_html", "toc"],
        extension_configs={"toc": {"slugify": slugify, "toc_depth": "2-3"}},
    )


def inline_md(text):
    out = md_to_html(fix_links(text))
    return re.sub(r"^<p>(.*)</p>$", r"\1", out.strip(), flags=re.S)


def extract_infobox(md_text):
    """If the page starts with '**Key:** value · **Key:** value', pull it out."""
    lines = md_text.lstrip("\n").split("\n")
    block = []
    for ln in lines:
        if not ln.strip():
            break
        block.append(ln)
    first = " ".join(l.rstrip() for l in block)
    if not re.match(r"^\*\*[^*]{1,40}:\*\*", first):
        return None, md_text
    rows = []
    for part in re.split(r"\s+·\s+|\s{2,}", first):
        m = re.match(r"^\*\*([^*]{1,40}):\*\*\s*(.*)$", part.strip())
        if m:
            rows.append((m.group(1), inline_md(m.group(2))))
        elif rows:
            rows[-1] = (rows[-1][0], rows[-1][1] + " " + inline_md(part))
    rest = "\n".join(lines[len(block):])
    return rows, rest


def first_image(md_text):
    """Pull the first image out of the page so it can sit in the infobox."""
    m = re.search(r'^!\[([^\]]*)\]\((images/[^)]+)\)\s*$', md_text, flags=re.M)
    if m:
        return (m.group(2), m.group(1)), md_text[:m.start()] + md_text[m.end():]
    m = re.search(r'^<img src="(images/[^"]+)"[^>]*?(?:alt="([^"]*)")?[^>]*>\s*$', md_text, flags=re.M)
    if m:
        return (m.group(1), m.group(2) or ""), md_text[:m.start()] + md_text[m.end():]
    return None, md_text


def thumbnails(body_html):
    """Standalone images become framed thumbnails with a caption, floated right."""
    def repl(m):
        attrs = m.group(1)
        alt = re.search(r'alt="([^"]*)"', attrs)
        cap = alt.group(1) if alt else ""
        attrs = re.sub(r'\s(width|height)="[^"]*"', "", attrs)
        src = re.search(r'src="([^"]+)"', attrs).group(1)
        return (f'<figure class="thumb"><a href="{src}">'
                f'<img{attrs}></a><figcaption>{cap}</figcaption></figure>')
    return re.sub(r"<p>\s*<img([^>]*)>\s*</p>", repl, body_html)


def build_toc(body_html):
    heads = re.findall(r'<h([23]) id="([^"]+)">(.*?)</h\1>', body_html)
    if len(heads) < 3:
        return ""
    out, n2, n3 = [], 0, 0
    for lvl, hid, txt in heads:
        txt = re.sub(r"<[^>]+>", "", txt)
        if lvl == "2":
            n2 += 1; n3 = 0
            out.append(f'<li class="toclevel-1"><a href="#{hid}"><span class="tocnumber">{n2}</span> <span class="toctext">{txt}</span></a></li>')
        else:
            n3 += 1
            out.append(f'<li class="toclevel-2"><a href="#{hid}"><span class="tocnumber">{n2}.{n3}</span> <span class="toctext">{txt}</span></a></li>')
    return ('<div id="toc" class="toc"><div class="toctitle"><h2>Contents</h2>'
            '<span class="toctoggle">[<a href="#" onclick="return toggleToc()">hide</a>]</span></div>'
            f'<ul>{"".join(out)}</ul></div>')


def build_side_toc(body_html):
    """The sticky 'Contents' column shown beside long articles."""
    heads = re.findall(r'<h([23]) id="([^"]+)">(.*?)</h\1>', body_html)
    if len(heads) < 3:
        return ""
    out, open_sub = ['<li><a href="#top" class="toc-top">(Top)</a></li>'], False
    for lvl, hid, txt in heads:
        txt = re.sub(r"<[^>]+>", "", txt)
        if lvl == "2":
            if open_sub:
                out.append("</ul></li>"); open_sub = False
            out.append(f'<li class="toc-h2"><a href="#{hid}">{txt}</a>')
            out.append("<ul>"); open_sub = True
        else:
            out.append(f'<li class="toc-h3"><a href="#{hid}">{txt}</a></li>')
    if open_sub:
        out.append("</ul></li>")
    html_ = "".join(out).replace("<ul></ul>", "")
    return ('<nav id="toc-side" aria-label="Contents"><div class="toc-side-head"><span>Contents</span>'
            '<button type="button" id="toc-side-hide">hide</button></div>'
            f'<ul>{html_}</ul></nav>')


def insert_toc(body_html, toc):
    if not toc:
        return body_html
    i = body_html.find("<h2")
    return body_html[:i] + toc + body_html[i:] if i >= 0 else body_html + toc


def parse_sidebar(md_text):
    """Return [(heading_html, [item_html, ...]), ...] from _Sidebar.md."""
    portals, cur = [], None
    for ln in md_text.split("\n"):
        if not ln.strip():
            continue
        m = re.match(r"^\*\*(.+)\*\*\s*$", ln.strip())
        if m and not ln.startswith(" "):
            cur = (inline_md(m.group(1)), [])
            portals.append(cur)
            continue
        m = re.match(r"^(\s*)[-*]\s+(.*)$", ln)
        if m:
            if cur is None:
                cur = ("", []); portals.append(cur)
            cls = "sub" if len(m.group(1)) >= 2 else ""
            cur[1].append((cls, inline_md(m.group(2))))
    return portals


def page_categories(name, sidebar_md):
    """A page's categories are the sidebar sections it's listed under."""
    cats, section = [], None
    for ln in sidebar_md.split("\n"):
        m = re.match(r"^\*\*(?:\[([^\]]+)\]\([^)]+\)|([^*]+))\*\*\s*$", ln.strip())
        if m and not ln.startswith(" "):
            section = (m.group(1) or m.group(2)).strip()
            continue
        if section and re.search(r"\]\(" + re.escape(name) + r"(#[^)]*)?\)", ln):
            if section not in cats:
                cats.append(section)
    return cats


def last_edited(wiki_dir, filename):
    try:
        out = subprocess.run(["git", "-C", wiki_dir, "log", "-1", "--format=%ct", "--", filename],
                             capture_output=True, text=True, timeout=20).stdout.strip()
        if out:
            d = datetime.datetime.fromtimestamp(int(out), datetime.timezone.utc)
            return f"{d.day} {d.strftime('%B %Y')}, at {d.strftime('%H:%M')} (UTC)"
    except Exception:
        pass
    return None


def render(template, **kw):
    for k, v in kw.items():
        template = template.replace("{{" + k + "}}", v)
    return template


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wiki", required=True)
    ap.add_argument("--out", default="_site")
    a = ap.parse_args()

    if os.path.exists(a.out):
        shutil.rmtree(a.out)
    os.makedirs(a.out)
    for f in ("style.css", "wiki.js", "logo.svg"):
        shutil.copy(os.path.join(HERE, f), a.out)
    if os.path.isdir(os.path.join(a.wiki, "images")):
        shutil.copytree(os.path.join(a.wiki, "images"), os.path.join(a.out, "images"))
    template = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()

    sidebar_md = ""
    sp = os.path.join(a.wiki, "_Sidebar.md")
    if os.path.exists(sp):
        sidebar_md = open(sp, encoding="utf-8").read()
    portals = parse_sidebar(sidebar_md)
    nav = []
    for i, (head, items) in enumerate(portals):
        if i == 0:
            items = [("", '<a href="index.html">Main page</a>')] + items
        lis = "".join(f'<li class="{c}">{h}</li>' for c, h in items)
        if i == 0:
            nav.append(f'<div class="portal portal-first"><ul>{lis}</ul></div>')
        else:
            pid = slugify(re.sub(r"<[^>]+>", "", head)) or f"p{i}"
            nav.append(f'<details class="portal" data-portal="{pid}" open><summary>{head}</summary><ul>{lis}</ul></details>')
    nav_html = "\n".join(nav)

    footer_note = ""
    fp = os.path.join(a.wiki, "_Footer.md")
    if os.path.exists(fp):
        footer_note = inline_md(open(fp, encoding="utf-8").read())

    pages = sorted(f[:-3] for f in os.listdir(a.wiki)
                   if f.endswith(".md") and not f.startswith("_"))
    search_index = []

    for name in pages:
        src = open(os.path.join(a.wiki, name + ".md"), encoding="utf-8").read()
        title = title_of(name)
        rows, body_md = extract_infobox(src) if name != "Home" else (None, src)
        img, body_md = first_image(body_md) if rows else (None, body_md)

        body = md_to_html(mermaid_blocks(fix_links(body_md)))
        body = re.sub(r"<table>", '<table class="wikitable">', body)
        body = thumbnails(body)

        infobox = ""
        if rows or img:
            trs = "".join(f"<tr><th>{html.escape(k)}</th><td>{v}</td></tr>" for k, v in (rows or []))
            pic = ""
            if img:
                pic = (f'<tr><td colspan="2" class="infobox-image"><img src="{img[0]}" alt="{html.escape(img[1])}">'
                       f'<div class="infobox-caption">{html.escape(img[1])}</div></td></tr>')
            infobox = f'<table class="infobox"><caption>{html.escape(title)}</caption>{pic}{trs}</table>'

        plain = re.sub(r"<pre class=\"mermaid\">.*?</pre>", " ", body, flags=re.S)
        plain = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", plain))).strip()
        side_toc = build_side_toc(body)
        body = insert_toc(body, build_toc(body))
        content = infobox + body
        info_text = " ".join(f"{k} {re.sub(r'<[^>]+>', '', v)}" for k, v in (rows or []))

        cats = page_categories(name, sidebar_md)
        cat_html = ""
        if cats:
            links = " | ".join(f"<li>{html.escape(c)}</li>" for c in cats)
            cat_html = f'<div id="catlinks"><b>Categories</b>: <ul>{links}</ul></div>'

        edited = last_edited(a.wiki, name + ".md")
        edited_html = f"This page was last edited on {edited}." if edited else ""

        out = render(template,
                     TITLE=html.escape(title),
                     SITE=html.escape(SITE_NAME),
                     TAGLINE=html.escape(TAGLINE),
                     NAV=nav_html,
                     CONTENT=content,
                     CATEGORIES=cat_html,
                     EDITED=edited_html,
                     FOOTNOTE=footer_note,
                     SUBTITLE="" if name == "Home" else f"From {html.escape(SITE_NAME)}, {html.escape(TAGLINE.lower())}",
                     SIDETOC=side_toc,
                     PAGE=name,
                     MAINPAGE_CLASS=("mainpage " if name == "Home" else "") + ("has-toc" if side_toc else ""))
        open(os.path.join(a.out, name + ".html"), "w", encoding="utf-8").write(out)

        search_index.append({"p": name, "t": title, "x": (html.unescape(info_text) + " " + plain)[:20000]})

    shutil.copy(os.path.join(a.out, "Home.html"), os.path.join(a.out, "index.html"))
    # Search results page
    sp_html = render(template, TITLE="Search results", SITE=html.escape(SITE_NAME),
                     TAGLINE=html.escape(TAGLINE), NAV=nav_html,
                     CONTENT='<div id="search-results"><p>Searching…</p></div>',
                     CATEGORIES="", EDITED="", FOOTNOTE=footer_note, SUBTITLE="",
                     SIDETOC="", PAGE="search", MAINPAGE_CLASS="")
    open(os.path.join(a.out, "search.html"), "w", encoding="utf-8").write(sp_html)
    json.dump(search_index, open(os.path.join(a.out, "search.json"), "w", encoding="utf-8"))
    open(os.path.join(a.out, ".nojekyll"), "w").close()
    print(f"Built {len(pages)} pages into {a.out}")


if __name__ == "__main__":
    main()
