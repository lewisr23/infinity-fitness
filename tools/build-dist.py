#!/usr/bin/env python3
"""
Assemble exactly what should go on the public server, into dist/.

    python tools/build-dist.py              the real site, into dist/
    python tools/build-dist.py --preview    a test copy, into dist-preview/

Then drag the folder into Cloudflare Pages. The two builds land in different
folders so a test copy, which hides itself from search engines, cannot be
handed over as the launch by mistake.

The point of this is not convenience, it is to stop the wrong things going up.
docs/ holds the meeting notes and the working arrangement, and shots/ and
assets/originals/ are working files. None of that belongs on a public website,
and dragging the project folder straight into Pages would publish all of it.

It also fills in the two things index.html deliberately does not carry: the
gym's bank details and the live site URL. Both come from payee.local.json,
which is not in version control. See load_config below.
"""

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
DIST_PREVIEW = ROOT / "dist-preview"
CONFIG = ROOT / "payee.local.json"

# the URL index.html carries in the repo, swapped for the real one at build time
PLACEHOLDER_URL = "https://infinity-preview.pages.dev"

# everything here ships, nothing else does
FILES = [
    "index.html",
    "assets/social-card.jpg",       # the preview image shown when the link is shared
]

TREES = [
    "assets/gallery",
    "tools/vendor",
    "tools/sample-data",
]
TOOL_PAGES = [
    "tools/reconcile.html",
]

ROBOTS = """User-agent: *
Allow: /
Disallow: /tools/

Sitemap: %s/sitemap.xml
"""

# A preview carries facts nobody has signed off yet. Getting that indexed under
# the gym's name, then having it outrank the real site later, is a mess worth
# one line of prevention.
ROBOTS_PREVIEW = """User-agent: *
Disallow: /
"""

NOINDEX_TAG = '<meta name="robots" content="noindex, nofollow">'

SITEMAP = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>%s/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
"""


def load_config():
    """Read payee.local.json, or explain how to make one.

    index.html ships with the bank details blank and a placeholder URL, so a
    build without this file still produces a working site, one whose Join page
    says "ask at reception". That is a fine site and a bad surprise, so say no
    rather than quietly shipping one.
    """
    if CONFIG.is_file():
        return json.loads(CONFIG.read_text(encoding="utf-8"))

    if "--no-payee" in sys.argv:
        print("No payee.local.json, and --no-payee was passed.")
        print('Building with the Join page set to "ask at reception".')
        print()
        return {}

    sys.exit("\n".join([
        "STOP: payee.local.json is missing.",
        "",
        "It holds the gym's bank details and the live site URL, and it is kept",
        "out of version control on purpose. Create it next to index.html:",
        "",
        "  {",
        '    "siteUrl": "https://the-real-domain.co.uk",',
        '    "payee": { "name": "", "sortCode": "00-00-00", "account": "00000000" }',
        "  }",
        "",
        'Leave any value as "" if you do not have it yet. To build without bank',
        "details on purpose, run again with --no-payee.",
    ]))


def fill_payee(html, payee):
    """Write the bank details into the PAYEE block of the built copy.

    Scoped to that one block rather than the whole file, so a stray "name" or
    "account" elsewhere in 250KB of page cannot be rewritten by accident.
    """
    start = html.find("var PAYEE = {")
    if start < 0:
        sys.exit("STOP: could not find the PAYEE block in index.html.")
    end = html.find("};", start)
    block = html[start:end]

    for key in ("name", "sortCode", "account"):
        value = str(payee.get(key, "") or "")
        if '"' in value or "\\" in value:
            sys.exit("STOP: payee %s contains a quote or backslash, which would "
                     "break the page. Fix it in payee.local.json." % key)
        pattern = r"(\b" + key + r":\s*)\"[^\"]*\""
        block, n = re.subn(pattern, lambda m: m.group(1) + '"' + value + '"', block, count=1)
        if n != 1:
            sys.exit("STOP: could not set payee %s. Has the PAYEE block changed shape?" % key)

    return html[:start] + block + html[end:]


def main():
    preview = "--preview" in sys.argv
    out = DIST_PREVIEW if preview else DIST
    config = load_config()
    site_url = (config.get("siteUrl") or PLACEHOLDER_URL).rstrip("/")
    if preview and config.get("previewUrl"):
        site_url = config["previewUrl"].rstrip("/")
    payee = config.get("payee") or {}

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    missing = []
    copied = 0

    for rel in FILES + TOOL_PAGES:
        src = ROOT / rel
        if not src.is_file():
            missing.append(rel)
            continue
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1

    for rel in TREES:
        src = ROOT / rel
        if not src.is_dir():
            missing.append(rel + "/")
            continue
        dst = out / rel
        shutil.copytree(src, dst)
        copied += sum(1 for _ in dst.rglob("*") if _.is_file())

    # the built page, not the source, is where the real values belong
    page = out / "index.html"
    url_hits = 0
    if page.is_file():
        html = page.read_text(encoding="utf-8")
        html = fill_payee(html, payee)
        url_hits = html.count(PLACEHOLDER_URL)
        html = html.replace(PLACEHOLDER_URL, site_url)
        if preview and NOINDEX_TAG not in html:
            # after the charset declaration, which browsers want to see first
            anchor = '<meta charset="UTF-8">'
            if anchor not in html:
                sys.exit("STOP: could not find the charset meta to insert noindex after.")
            html = html.replace(anchor, anchor + "\n" + NOINDEX_TAG, 1)
        page.write_text(html, encoding="utf-8")

    if preview:
        (out / "robots.txt").write_text(ROBOTS_PREVIEW, encoding="utf-8")
    else:
        (out / "robots.txt").write_text(ROBOTS % site_url, encoding="utf-8")
        (out / "sitemap.xml").write_text(SITEMAP % site_url, encoding="utf-8")

    if missing:
        print("MISSING, not copied:")
        for m in missing:
            print("   " + m)
        print()

    total = 0
    print("%s/ contents:" % out.name)
    for f in sorted(out.rglob("*")):
        if f.is_file():
            size = f.stat().st_size
            total += size
            print("  %-42s %7.1f KB" % (f.relative_to(out).as_posix(), size / 1024))

    print()
    print("%d files, %.1f MB total" % (copied + 1, total / (1024 * 1024)))
    print()
    print("Site URL:     %s (%d references rewritten)" % (site_url, url_hits))

    # index.html shows each row it has, and only falls back to "ask at reception"
    # when the sort code or the account number is missing
    have = [k for k in ("name", "sortCode", "account") if str(payee.get(k) or "").strip()]
    if "sortCode" in have and "account" in have:
        if "name" in have:
            print("Bank details: name, sort code and account number all shown")
        else:
            print("Bank details: sort code and account number shown, no account name.")
            print("              Members will guess the name and may get a Confirmation")
            print("              of Payee mismatch warning. Worth one more ask.")
    else:
        print('Bank details: incomplete, the Join page says "ask at reception"')
        if have:
            print("              (have %s)" % ", ".join(have))

    if preview:
        print("Mode:         PREVIEW, in dist-preview/. noindex on the page, robots.txt")
        print("              blocks everything, no sitemap. Not for the real launch:")
        print("              that is dist/, from a build without --preview.")
    elif site_url == PLACEHOLDER_URL:
        print()
        print("NOTE: still on the placeholder domain. The canonical URL and the social")
        print("      preview image will both be wrong once this is live on the real one.")

    # a public page that leaked the working notes would be genuinely bad, so check
    leaked = [f.relative_to(out).as_posix() for f in out.rglob("*")
              if f.is_file() and (
                  "for-the-owner" in f.name or "meeting-notes" in f.name
                  or "launch-plan" in f.name or "pre-redesign" in f.name
                  or f.name == "payee.local.json")]
    if leaked:
        sys.exit("STOP: working documents ended up in %s/: %s" % (out.name, ", ".join(leaked)))
    print()
    print("Checked: no working documents in %s/. Safe to upload." % out.name)


if __name__ == "__main__":
    main()
