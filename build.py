#!/usr/bin/env python3
"""
Khanimator site builder.

Reads data/videos.json and regenerates the category pages plus early-khan.html.
Hand-written pages (index, work, about, support, contact) are left alone.

    python build.py

Everything it writes is plain static HTML — there is no runtime dependency on
this script. It exists so the catalogue lives in one place instead of being
copy-pasted across pages.
"""

import json
import pathlib
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).parent
DATA = ROOT / "data" / "videos.json"

# Absolute base URL, used only for sitemap.xml.
# CHANGE THIS when the real domain is pointed at the site, then re-run the
# build and update the Sitemap line in robots.txt to match.
SITE_URL = "https://khanimator.netlify.app"

# Pages that should appear in the sitemap. Generated category pages are added
# automatically; these are the hand-written ones. 404 and thanks are excluded
# on purpose — they are not destinations.
STATIC_PAGES = ["index.html", "work.html", "about.html",
                "support.html", "contact.html"]


def resolve_thumb(video_id):
    """Pick the best thumbnail size that actually exists.

    YouTube only generates maxresdefault.jpg for videos uploaded above 720p, and
    for everything else it answers with a 120x90 grey placeholder instead of a
    clean 404 — which means the browser fires `load`, not `error`, and a naive
    client-side fallback never triggers. Older uploads hit this constantly, so
    we settle it here at build time and write the right URL into the HTML.
    """
    url = f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"
    req = urllib.request.Request(url, method="HEAD",
                                 headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            length = int(r.headers.get("Content-Length") or 0)
            # A real 1280x720 still is comfortably over 10 KB; the grey
            # placeholder is roughly 1-2 KB.
            return "maxresdefault" if length > 6000 else "hqdefault"
    except (urllib.error.HTTPError, urllib.error.URLError, OSError):
        return "hqdefault"

NAV_ITEMS = [
    ("index.html", "Home"),
    ("work.html", "Work"),
    ("about.html", "About"),
    ("support.html", "Support"),
    ("contact.html", "Contact"),
]


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def nav(current):
    """`current` is the top-level page this one sits under."""
    links = "\n".join(
        f'      <li><a href="{href}"{" aria-current=\"page\"" if href == current else ""}>{label}</a></li>'
        for href, label in NAV_ITEMS
    )
    return f"""<header class="nav">
  <div class="wrap nav__inner">
    <a class="brand" href="index.html">
      <img src="assets/img/logo.jpg" alt="">
      Khanimator
    </a>
    <ul class="nav__links">
{links}
    </ul>
    <a class="btn btn--primary nav__cta" href="contact.html">Work with me</a>
    <button class="nav__toggle" aria-label="Menu" aria-expanded="false"><span></span></button>
  </div>
</header>"""


def subnav(cats, active):
    """Category strip shown on every catalogue page."""
    items = [("work.html", "All work", "all")]
    items += [(f'{c["slug"]}.html', c["title"], c["slug"]) for c in cats.values()]
    items += [("early-khan.html", "Early Khan", "early-khan")]

    links = "\n".join(
        f'      <a class="subnav__link{" is-active" if key == active else ""}" href="{href}">{esc(label)}</a>'
        for href, label, key in items
    )
    return f"""  <nav class="subnav" aria-label="Catalogue categories">
    <div class="wrap subnav__inner">
{links}
    </div>
  </nav>"""


def card(v, rank=None):
    thumb = f"https://i.ytimg.com/vi/{v['id']}/{v.get('thumb', 'hqdefault')}.jpg"
    title = esc(v["title"])
    rank_html = f'            <div class="card__rank">{rank:02d}</div>\n' if rank else ""
    credit = (f'<span class="tag">{esc(v["credit"])}</span>'
              if v.get("credit") else f'<span class="tag">{esc(v["series"])}</span>')
    return f"""        <article class="card" data-reveal>
          <div class="player" data-yt="{v['id']}" data-title="{title}" role="button" tabindex="0">
            <img src="{thumb}" alt="{title}" loading="lazy">
            <span class="player__play"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></span>
            <span class="player__dur">{v['duration']}</span>
          </div>
          <div class="card__body">
{rank_html}            <h3>{title}</h3>
            <div class="card__meta"><strong>{v['views']} views</strong><span>{v['duration']}</span><span>{v['age']}</span>{credit}</div>
          </div>
        </article>"""


def footer():
    site = "\n".join(
        f'          <li><a href="{href}">{label}</a></li>' for href, label in NAV_ITEMS
    )
    return f"""<footer class="footer">
  <div class="wrap">
    <div class="footer__grid">
      <div>
        <a class="brand" href="index.html">
          <img src="assets/img/logo.jpg" alt="">
          Khanimator
        </a>
        <p>2D fan animation by Moiz Khan. Just another animator out there drawing till I drop.</p>
      </div>
      <div>
        <h4>Site</h4>
        <ul>
{site}
        </ul>
      </div>
      <div>
        <h4>Elsewhere</h4>
        <ul>
          <li><a href="https://www.youtube.com/@khanimator5674" target="_blank" rel="noopener">YouTube</a></li>
          <li><a href="https://www.instagram.com/khanimator_/" target="_blank" rel="noopener">Instagram</a></li>
          <li><a href="https://discord.gg/SVFk3C9xRk" target="_blank" rel="noopener">Discord</a></li>
          <li><a href="https://www.patreon.com/user?u=84554672" target="_blank" rel="noopener">Patreon</a></li>
        </ul>
      </div>
    </div>
    <div class="footer__base">
      <span>&copy; <span data-year>2026</span> Khanimator — Moiz Khan. All animation is fan work, made for love of the source material.</span>
      <span>Built by TMC</span>
    </div>
  </div>
</footer>"""


def page(*, filename, title, description, eyebrow, h1, lead, cats, active,
         cards, extra_section="", stats=""):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} — Khanimator</title>
<meta name="description" content="{esc(description)}">
<link rel="icon" href="assets/img/logo.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

<!-- GENERATED BY build.py — do not edit by hand.
     Change data/videos.json and re-run `python build.py` instead. -->

<a class="skip" href="#main">Skip to content</a>

{nav("work.html")}

<main id="main">

  <section class="pagehead">
    <div class="wrap" data-reveal>
      <span class="eyebrow">{esc(eyebrow)}</span>
      <h1>{h1}</h1>
      <p class="lead">{lead}</p>
{stats}    </div>
  </section>

{subnav(cats, active)}

{extra_section}  <section class="section">
    <div class="wrap">
      <div class="grid">
{cards}
      </div>
    </div>
  </section>

  <section class="section cta section--alt">
    <div class="wrap">
      <div data-reveal>
        <span class="eyebrow" style="justify-content:center">Open to work</span>
        <h2>Want one of<br>your own?</h2>
        <p class="lead">Commissions, collabs and guest sequences. Tell me the fight and I'll tell you what it takes to animate it properly.</p>
        <div class="btn-row">
          <a class="btn btn--primary" href="contact.html">Start a project</a>
          <a class="btn btn--ghost" href="support.html">Support the work</a>
        </div>
      </div>
    </div>
  </section>

</main>

{footer()}

<script src="assets/js/main.js"></script>
</body>
</html>
"""


def main():
    if not DATA.exists():
        sys.exit(f"Missing {DATA}")

    data = json.loads(DATA.read_text(encoding="utf-8"))
    cats = data["categories"]
    videos = data["videos"]

    # ------------------------------------------------ resolve thumbnails --
    # Cached in videos.json after the first run. Delete a "thumb" key to force
    # a re-check for that video.
    missing = [v for v in videos if "thumb" not in v]
    if missing:
        print(f"Checking thumbnails for {len(missing)} video(s)...")
        for v in missing:
            v["thumb"] = resolve_thumb(v["id"])
        DATA.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
        downgraded = [v["id"] for v in missing if v["thumb"] == "hqdefault"]
        if downgraded:
            print(f"  no maxres for: {', '.join(downgraded)}\n")

    written = []

    # ---------------------------------------------------- category pages --
    for slug, cat in cats.items():
        items = [v for v in videos if v["category"] == slug]
        items.sort(key=lambda v: v["viewCount"], reverse=True)

        total = sum(v["viewCount"] for v in items)
        stats = f"""      <div class="pagehead__stats">
        <span><b>{len(items)}</b> films</span>
        <span><b>{total:,}</b> combined views</span>
      </div>
"""

        html = page(
            filename=f"{slug}.html",
            title=cat["title"],
            description=cat["blurb"],
            eyebrow=cat["tagline"],
            h1=cat["title"].replace(" ", "<br>", 1) if " " in cat["title"] else cat["title"],
            lead=esc(cat["blurb"]),
            cats=cats,
            active=slug,
            cards="\n".join(card(v) for v in items),
            stats=stats,
        )
        (ROOT / f"{slug}.html").write_text(html, encoding="utf-8")
        written.append((f"{slug}.html", len(items)))

    # -------------------------------------------------------- early khan --
    early = sorted([v for v in videos if v.get("early")],
                   key=lambda v: v["earlyRank"])

    intro = """  <section class="section section--tight">
    <div class="wrap split">
      <div data-reveal>
        <span class="eyebrow">Where it started</span>
        <h2>Four seconds<br>at a time</h2>
      </div>
      <div data-reveal data-reveal-delay="120">
        <p class="lead" style="margin-bottom:22px">
          The first ten uploads on the channel, oldest first. Most are under ten
          seconds. One is a single frame short of being a GIF.
        </p>
        <p style="color:var(--muted)">
          They are kept up on purpose. Every animator's early work looks like this,
          and pretending otherwise does nobody starting out any favours — the gap
          between video one and the film that took a year is the whole point.
        </p>
      </div>
    </div>
  </section>

"""

    html = page(
        filename="early-khan.html",
        title="Early Khan",
        description=(
            "The first ten animations Khanimator ever uploaded, from 2019 onwards "
            "— kept up exactly as they were."
        ),
        eyebrow="2019 — 2021",
        h1="Early<br><span class=\"accent\">Khan</span>",
        lead=(
            "Where it began. The first ten uploads, in order, warts and all — from "
            "a four-second jump cycle to the first fight that ran past forty seconds."
        ),
        cats=cats,
        active="early-khan",
        cards="\n".join(card(v, rank=v["earlyRank"]) for v in early),
        extra_section=intro,
        stats="",
    )
    (ROOT / "early-khan.html").write_text(html, encoding="utf-8")
    written.append(("early-khan.html", len(early)))

    # ----------------------------------------------------------- sitemap --
    pages = STATIC_PAGES + [name for name, _ in written]
    urls = "\n".join(
        f"  <url><loc>{SITE_URL}/{p}</loc><priority>"
        f"{'1.0' if p == 'index.html' else '0.8'}</priority></url>"
        for p in pages
    )
    sitemap = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
               f"{urls}\n</urlset>\n")
    (ROOT / "sitemap.xml").write_text(sitemap, encoding="utf-8")

    # ------------------------------------------------------------ report --
    print(f"Read {len(videos)} videos from {DATA.name}\n")
    for name, n in written:
        print(f"  wrote {name:<24} {n:>2} videos")
    print(f"  wrote {'sitemap.xml':<24} {len(pages):>2} urls   ({SITE_URL})")

    uncategorised = [v["id"] for v in videos if v["category"] not in cats]
    if uncategorised:
        print(f"\n  WARNING unknown category on: {', '.join(uncategorised)}")
    if len(early) != 10:
        print(f"\n  WARNING expected 10 'early' videos, found {len(early)}")


if __name__ == "__main__":
    main()
