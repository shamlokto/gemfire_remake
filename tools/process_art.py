#!/usr/bin/env python3
"""Install generated images into art/ for Lanternfall.

    python3 tools/process_art.py SRC_DIR [--only 16,17] [--quality 86]

Finds files named NNN.jpg / NNN.png / NNN.webp (any slot in art.js; extra text after the number is fine,
e.g. "016_aldmere.jpg"), processes each according to its slot in js/data/art.js, writes
art/NNN.webp and records it in art/manifest.json. Prints which slots are filled or missing.

Modes:
  cover   centre-crop to the slot aspect, resize
  cutout  crop, resize, remove the flat background (flood fill from the borders) -> alpha
  tile    square crop, resize, blend the edges with a mirrored copy so the tile repeats
  fx      crop/resize only (drawn with 'screen' blending, so black stays transparent in-game)
"""
import argparse, json, os, re, sys
from collections import deque

from PIL import Image, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_JS = os.path.join(ROOT, 'js', 'data', 'art.js')
OUT = os.path.join(ROOT, 'art')
MANIFEST = os.path.join(OUT, 'manifest.json')
MAXSLOT = 0


def load_slots():
    """Parse the `...S(from, to, 'kind', w, h, 'mode')` lines of js/data/art.js."""
    src = open(ART_JS, encoding='utf-8').read()
    slots = {}
    for m in re.finditer(r"S\((\d+),\s*(\d+),\s*'(\w+)',\s*(\d+),\s*(\d+),\s*'(\w+)'\)", src):
        a, b, kind, w, h, mode = m.groups()
        for i in range(int(a), int(b) + 1):
            slots[i] = dict(kind=kind, w=int(w), h=int(h), mode=mode)
    global MAXSLOT
    MAXSLOT = max(slots)
    missing = [i for i in range(1, MAXSLOT + 1) if i not in slots]
    if missing:
        sys.exit(f'art.js parse failed; slots missing: {missing}')
    return slots


def cover(img, w, h):
    sw, sh = img.size
    scale = max(w / sw, h / sh)
    nw, nh = max(w, round(sw * scale)), max(h, round(sh * scale))
    img = img.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - w) // 2, (nh - h) // 2
    return img.crop((left, top, left + w, top + h))


def cutout(img, w, h, tol=34):
    """Remove the background connected to the image border. The background colour is the median
    of the border pixels; pixels within `tol` (max channel distance) of it and connected to the
    border become transparent, with a soft 2px edge."""
    img = cover(img.convert('RGB'), w, h)
    px = img.load()
    border = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + \
             [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    bg = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))

    def near(c):
        return max(abs(c[0] - bg[0]), abs(c[1] - bg[1]), abs(c[2] - bg[2])) <= tol

    mask = Image.new('L', (w, h), 255)
    mp = mask.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not near(px[x, y]):
            continue
        mp[x, y] = 0
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    # Enclosed pockets of background (inside a bow, between an arm and the body): flat regions
    # very close to the background colour that the border fill could not reach. Shaded pale areas
    # (white armour, snow) vary in colour and are kept.
    def near_tight(c):
        return max(abs(c[0] - bg[0]), abs(c[1] - bg[1]), abs(c[2] - bg[2])) <= 16
    minsize = max(40, w * h // 900)
    seen2 = bytearray(w * h)
    for y0 in range(h):
        for x0 in range(w):
            i0 = y0 * w + x0
            if seen2[i0] or mp[x0, y0] == 0 or not near_tight(px[x0, y0]):
                continue
            comp = []
            q2 = deque([(x0, y0)])
            seen2[i0] = 1
            while q2:
                x, y = q2.popleft()
                comp.append((x, y))
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not seen2[j] and mp[nx, ny] != 0 and near_tight(px[nx, ny]):
                            seen2[j] = 1
                            q2.append((nx, ny))
            if len(comp) < minsize:
                continue
            n = len(comp)
            mean = [sum(px[x, y][k] for x, y in comp) / n for k in range(3)]
            var = sum(sum((px[x, y][k] - mean[k]) ** 2 for k in range(3)) for x, y in comp) / (n * 3)
            if var < 30:   # flat: background showing through
                for x, y in comp:
                    mp[x, y] = 0
    # Soften: shrink by 1px then blur, so the halo of background colour disappears.
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def tile(img, w, h):
    img = cover(img.convert('RGB'), w, h)
    # Blend with a copy offset by half the size, using a mask that is opaque at the centre and
    # clear at the edges: the result wraps without visible seams.
    off = ImageChops.offset(img, w // 2, h // 2)
    mask = Image.new('L', (w, h), 0)
    mp = mask.load()
    for y in range(h):
        dy = abs(y - h / 2) / (h / 2)
        for x in range(w):
            dx = abs(x - w / 2) / (w / 2)
            d = max(dx, dy)
            mp[x, y] = int(255 * max(0.0, min(1.0, (1 - d) / 0.35)))
    # mask=255 keeps the original (centre), 0 uses the offset copy (whose centre is the old edge).
    return Image.composite(img, off, mask)


def border_opacity(img):
    """Fraction of border pixels that stayed opaque after a cutout (a failed cutout keeps its scene)."""
    a = img.getchannel('A')
    w, h = img.size
    pts = [(x, 0) for x in range(0, w, 8)] + [(x, h - 1) for x in range(0, w, 8)] + \
          [(0, y) for y in range(0, h, 8)] + [(w - 1, y) for y in range(0, h, 8)]
    return sum(1 for p in pts if a.getpixel(p) > 40) / len(pts)


def process(path, slot):
    img = Image.open(path)
    img.load()
    if img.mode not in ('RGB', 'RGBA'):
        img = img.convert('RGBA' if 'A' in img.getbands() else 'RGB')
    mode, w, h = slot['mode'], slot['w'], slot['h']
    if mode == 'cutout':
        return cutout(img, w, h)
    if mode == 'tile':
        return tile(img, w, h)
    return cover(img.convert('RGB'), w, h)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--only', help='comma-separated slot numbers')
    ap.add_argument('--quality', type=int, default=86)
    args = ap.parse_args()
    slots = load_slots()
    only = {int(s) for s in args.only.split(',')} if args.only else None

    found = {}
    for name in sorted(os.listdir(args.src)):
        m = re.match(r'^(\d{1,3})(?:\D.*)?\.(jpe?g|png|webp)$', name, re.I)
        if not m:
            continue
        n = int(m.group(1))
        if n in slots and (only is None or n in only):
            found.setdefault(n, os.path.join(args.src, name))

    os.makedirs(OUT, exist_ok=True)
    try:
        manifest = json.load(open(MANIFEST))
    except (OSError, ValueError):
        manifest = {'slots': {}}
    manifest.setdefault('slots', {})

    for n, path in sorted(found.items()):
        slot = slots[n]
        out = process(path, slot)
        name = f'{n:03d}.webp'
        if slot['mode'] == 'cutout' and border_opacity(out) > 0.2:
            # The generator painted a full scene instead of a sprite on a flat background:
            # leave the slot empty so the game keeps its drawn fallback.
            manifest['slots'].pop(str(n), None)
            stale = os.path.join(OUT, name)
            if os.path.exists(stale):
                os.remove(stale)
            print(f'  {n:03d} SKIPPED: the background could not be cut out (regenerate this one)')
            continue
        out.save(os.path.join(OUT, name), 'WEBP', quality=args.quality, method=6)
        manifest['slots'][str(n)] = name
        print(f'  {n:03d} {slot["kind"]:<9} {slot["mode"]:<6} {out.size[0]}x{out.size[1]}  <- {os.path.basename(path)}')

    manifest['slots'] = dict(sorted(manifest['slots'].items(), key=lambda kv: int(kv[0])))
    with open(MANIFEST, 'w') as f:
        json.dump(manifest, f, indent=1)
        f.write('\n')
    filled = {int(k) for k in manifest['slots']}
    missing = [i for i in range(1, MAXSLOT + 1) if i not in filled]
    print(f'processed {len(found)}; {len(filled)}/{MAXSLOT} slots filled')
    if missing:
        print('missing:', ', '.join(f'{i:03d}' for i in missing))


if __name__ == '__main__':
    main()
