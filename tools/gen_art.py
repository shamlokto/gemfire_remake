#!/usr/bin/env python3
"""Generate the game's art with the xAI image API from docs/SHOTLIST*.md.

    XAI_API_KEY=... python3 tools/gen_art.py OUT_DIR [--only 1,16-21] [--dry] [--jobs 6] [--model M]

Writes OUT_DIR/NNN.jpg (skips slots that already exist) and OUT_DIR/prompts.json.
Then install with: python3 tools/process_art.py OUT_DIR
"""
import argparse, base64, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STYLE = ('Painterly high-fantasy illustration, rich jewel-tone colours, soft rim light, detailed but '
         'readable, storybook oil-painting style, no text, no letters, no watermark.')
SPRITE = ('Single figure, three-quarter top-down view, centred, full body, small margin around it, '
          'plain flat pale grey background, game unit sprite.')
PORTRAIT = 'Bust portrait, facing slightly left, dark vignette background.'
TILE = 'Seamless top-down game texture tile, flat even lighting, fills the whole frame, no border.'
FX = 'Glowing magical effect only, on a pure black background, nothing else in the frame.'
WIDE = 'Wide cinematic composition.'
CUTIN = ('Dynamic side-view battle action, motion, dust and sparks, dramatic low angle, wide cinematic. '
         'Attackers on the left, right third darker.')
MAP = ('Top-down fantasy atlas map of a realm: snowy mountains in the north, central plains with a river '
       'running north to south, eastern sea coast, southern marshes, western highlands, painted like an '
       'illuminated atlas, no labels, no text.')
FLAT = 'Centred, plain flat pale grey background.'
HOUSE_COLOURS = {'Aldmere': 'blue and silver', 'Corvane': 'black and violet', 'Isolde': 'teal and white',
                 'Hrothgar': 'brown and amber', 'Seraphine': 'white and gold', 'Vey': 'green and bronze'}

# Per-section suffix and aspect ratio (xAI accepts 1:1 3:4 4:3 16:9 9:16 2:3 3:2 21:9 5:2 ...).
SECTION = {
    'A': ('', '16:9'), 'B': ('', '4:3'), 'C': (PORTRAIT, '3:4'), 'D': ('Full figure, dramatic.', '1:1'),
    'E': (SPRITE, '1:1'), 'F': (SPRITE + ' Neutral grey-and-white heraldry.', '1:1'), 'G': (TILE, '1:1'),
    'H': (FX, '1:1'), 'I': (WIDE, '16:9'), 'J': ('Heraldic crest on a shield. ' + FLAT, '1:1'),
    'K': ('Wide painted landscape, low horizon, no figures.', '21:9'), 'L': (MAP, '4:3'),
    'M': ('Small wide painting of the place.', '16:9'), 'N': (SPRITE, '1:1'), 'O': (WIDE, '16:9'),
    'P': (WIDE + ' Triumphant.', '16:9'), 'Q': ('Wide interior or scene, no people in the foreground.', '21:9'),
    'R': (CUTIN, '21:9'), 'S': ('The spirit appearing over a battlefield, huge, troops below for scale. ' + WIDE, '21:9'),
    'T': (WIDE, '21:9'), 'U': (FX + ' Full frame.', '1:1'), 'V': (FLAT, '1:1'),
    'W': ('Small wide painting of the place.', '16:9'),     # island provinces 231-234
    'X': (PORTRAIT, '3:4'),                                   # wanderers and heirs 235-270
    'Y': (CUTIN, '21:9'),                                     # clash cut-ins for new companies 271-278
    # Land and battle set 279-378
    'Z1': ('Isometric game building sprite, 2:1 isometric angle, one building on a single diamond tile of grass, centred, small margin, plain flat pale grey background.', '1:1'),
    'Z2': ('Isometric game tile sprite, 2:1 isometric angle, a single diamond tile, centred, small margin, plain flat pale grey background.', '1:1'),
    'Z3': ('Wide painted landscape seen from a hill, soft and slightly hazy, no figures.', '21:9'),
    'Z4': (WIDE, '16:9'),
    'Z5': ('Wide painted battlefield landscape, low horizon, empty of soldiers, dramatic sky.', '21:9'),
    'Z6': ('Wide cinematic battle painting, dynamic, dramatic lighting.', '21:9'),
    'Z7': (FX, '1:1'),
    # Isometric battlefield set 379-478
    'Z8': ('Isometric game unit sprite, 2:1 isometric angle, a single soldier standing ready, full body, facing down-right, small margin, plain flat pale grey background.', '1:1'),
    'Z9': ('Isometric game unit sprite, 2:1 isometric angle, full body, facing down-right, small margin, plain flat pale grey background.', '1:1'),
    'Z10': ('Side-view game sprite of one figure in mid-action, full body, facing right, small margin, plain flat pale grey background.', '1:1'),
    'Z11': ('Isometric game tile, 2:1 isometric angle, a single diamond tile seen from above, centred, small margin, plain flat pale grey background.', '1:1'),
    'Z12': ('Isometric game prop sprite, 2:1 isometric angle, centred, small margin, plain flat pale grey background.', '1:1'),
}
SLOT_ASPECT = {3: '1:1', 4: '5:2', 5: '5:2', 6: '5:2', 7: '5:2', 12: '1:1', 13: '1:1', 14: '1:1', 15: '1:1'}
SLOT_EXTRA = {
    10: MAP + ' Summer greens and golds.', 11: MAP + ' Covered in winter snow.',
    12: 'Drifting grey clouds and fog, soft, seamless, filling the frame.',
    13: 'Game map token. ' + FLAT, 14: 'Game map token. ' + FLAT, 15: FLAT,
}


def parse():
    prompts, cur = {}, None
    for f in ('docs/SHOTLIST.md', 'docs/SHOTLIST-EXTRA.md'):
        for raw in open(os.path.join(ROOT, f), encoding='utf-8'):
            line = raw.strip()
            m = re.match(r'^\*\*([A-Z][0-9]{0,2})\. (.+?)\*\*', line)
            if m:
                cur = m.group(1)
                house = None
                continue
            if not cur or not re.match(r'^\d', line):
                continue
            r = re.match(r'^(\d+)[–-](\d+)\s+([^:]+):\s*(.+)$', line)
            if r:
                a, b, label, rest = int(r[1]), int(r[2]), r[3].strip(), r[4]
                items = [s.strip() for s in rest.split(';' if ';' in rest else ',')]
                house = next((h for h in HOUSE_COLOURS if h in label), None)
                for i in range(a, b + 1):
                    item = items[i - a] if i - a < len(items) else ''
                    text = f'{label}: {item}'
                    if cur == 'N' and house:
                        text = f'A {item} of House {house}, armour, shield and banner in {HOUSE_COLOURS[house]}'
                    elif house:
                        text = f'{item}, wearing the colours of House {house} ({HOUSE_COLOURS[house]})'
                    prompts[i] = (cur, text)
                continue
            for m in re.finditer(r'(\d{1,3})\s+(.+?)(?=\s+\d{1,3}\s+[A-Z]|$)', line):
                prompts[int(m[1])] = (cur, m[2].strip())
    out = {}
    for slot, (sec, text) in sorted(prompts.items()):
        suffix, aspect = SECTION[sec]
        extra = SLOT_EXTRA.get(slot, suffix)
        out[slot] = {'section': sec, 'aspect': SLOT_ASPECT.get(slot, aspect),
                     'prompt': f'{STYLE} {text}. {extra}'.replace('..', '.')}
    return out


def gen(slot, item, out_dir, model, key):
    path = os.path.join(out_dir, f'{slot:03d}.jpg')
    if os.path.exists(path):
        return slot, 'skip'
    body = json.dumps({'model': model, 'prompt': item['prompt'], 'n': 1,
                       'aspect_ratio': item['aspect'], 'response_format': 'b64_json'}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request('https://api.x.ai/v1/images/generations', data=body, headers={
                'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.load(r)
            open(path, 'wb').write(base64.b64decode(d['data'][0]['b64_json']))
            return slot, 'ok'
        except Exception as e:  # retry with backoff
            err = e
            time.sleep(2 ** attempt * 2)
    return slot, f'FAIL {err}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--only')
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--jobs', type=int, default=6)
    ap.add_argument('--model', default='grok-imagine-image')
    a = ap.parse_args()
    items = parse()
    if a.only:
        want = set()
        for part in a.only.split(','):
            lo, _, hi = part.partition('-')
            want.update(range(int(lo), int(hi or lo) + 1))
        items = {k: v for k, v in items.items() if k in want}
    os.makedirs(a.out, exist_ok=True)
    json.dump(items, open(os.path.join(a.out, 'prompts.json'), 'w'), indent=1)
    print(f'{len(items)} prompts')
    if a.dry:
        return
    key = os.environ.get('XAI_API_KEY') or sys.exit('XAI_API_KEY is not set')
    with ThreadPoolExecutor(a.jobs) as ex:
        for slot, status in ex.map(lambda kv: gen(kv[0], kv[1], a.out, a.model, key), items.items()):
            print(f'{slot:03d} {status}', flush=True)


if __name__ == '__main__':
    main()
