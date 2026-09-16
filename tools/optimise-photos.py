#!/usr/bin/env python3
"""
Turn phone photos into web-ready gallery images.

    python tools/optimise-photos.py

Drop full-size photos into assets/originals/ and run this. It writes WebP at two
widths plus a JPEG fallback into assets/gallery/, named from the original file.

Why bother: a phone photo is 3-5 MB. Putting a handful straight on the page would
make the site several times heavier than everything else on it combined. These come
out around 40-80 KB each.

Needs Pillow:  pip install pillow
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Pillow is not installed. Run:  pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "originals"
OUT = ROOT / "assets" / "gallery"

WIDTHS = [480, 960]        # 960 covers retina phones and normal desktop tiles
WEBP_QUALITY = 78
JPEG_QUALITY = 80
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".tif", ".tiff"}


def main():
    if not SRC.is_dir():
        SRC.mkdir(parents=True, exist_ok=True)
        sys.exit("Created %s - put the photos in there and run this again." % SRC)

    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in SRC.iterdir() if p.suffix.lower() in EXTS)
    if not files:
        sys.exit("No images found in %s" % SRC)

    total_in = total_out = 0
    for path in files:
        try:
            im = Image.open(path)
        except Exception as exc:
            print("  skipped %s (%s)" % (path.name, exc))
            continue

        # honour the phone's rotation flag, then drop it so nothing re-rotates later
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")

        stem = path.stem.lower().replace(" ", "-").replace("_", "-")
        size_in = path.stat().st_size
        total_in += size_in
        made = []

        # never upscale, and name each file by the width it actually is
        targets = sorted({min(w, im.width) for w in WIDTHS})
        widest = max(targets)

        for w in targets:
            resized = im if w == im.width else im.resize(
                (w, round(im.height * w / im.width)), Image.LANCZOS)
            webp = OUT / ("%s-%d.webp" % (stem, w))
            resized.save(webp, "WEBP", quality=WEBP_QUALITY, method=6)
            made.append(webp)

            if w == widest:                          # one JPEG fallback per photo
                jpg = OUT / ("%s-%d.jpg" % (stem, w))
                resized.save(jpg, "JPEG", quality=JPEG_QUALITY, optimize=True,
                             progressive=True)
                made.append(jpg)

        out_bytes = sum(f.stat().st_size for f in made)
        total_out += out_bytes
        print("%-26s %dx%d  %5.0f KB in -> %5.0f KB out   widths: %s"
              % (path.name, im.width, im.height, size_in / 1024, out_bytes / 1024,
                 ", ".join(str(t) for t in targets)))
        if im.width < 1200:
            print("   NOTE: source is only %dpx wide, so it cannot be sharpened by "
                  "re-encoding. Shoot the real photos at full resolution." % im.width)

    print("\n%d photo(s):  %.0f KB in, %.0f KB out" % (len(files), total_in / 1024, total_out / 1024))
    print("Written to %s" % OUT)


if __name__ == "__main__":
    main()
