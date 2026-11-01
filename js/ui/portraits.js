// Portrait frame component and small DOM helpers shared by the realm UI.
import { art, CREST } from '../data/art.js';
import { VASSAL_BY_ID } from '../data/vassals.js';
import { HOUSE_BY_ID } from '../data/houses.js';

// h('div.cls#id', {attrs}, ...children) — tiny hyperscript.
export function h(tag, attrs, ...kids) {
  const [, name, rest] = /^([a-z0-9]+)(.*)$/i.exec(tag);
  const el = document.createElement(name);
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]); else el.id = m[2];
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('--')) el.style.setProperty(k, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

export const houseColor = id => (id ? `var(--house-${id})` : 'var(--house-none)');

// Portrait of a vassal (or ruler). opts: { size (px width), round, badge, house }
export function portrait(vassalId, opts = {}) {
  const v = VASSAL_BY_ID[vassalId];
  const house = opts.house ?? v?.house;
  const el = h('div.portrait', { '--hc': houseColor(house), style: { width: (opts.size || 64) + 'px' }, title: v ? `${v.name}, ${v.title}` : '' },
    h('img', { src: art(v ? v.portrait : 16), alt: v ? v.name : '', loading: 'lazy', draggable: 'false' }),
    h('div.ribbon'));
  if (opts.round) el.classList.add('round');
  if (opts.badge != null) el.append(h('div.badge', String(opts.badge)));
  return el;
}

export function crestImg(houseId, size = 28) {
  if (!houseId || !CREST[houseId]) return h('span.crest', { style: { width: size + 'px', height: size + 'px', display: 'inline-block', borderRadius: '50%', background: 'var(--house-none)' } });
  return h('img.crest', { src: art(CREST[houseId]), alt: HOUSE_BY_ID[houseId]?.short || '', width: size, height: size, style: { width: size + 'px', height: size + 'px', objectFit: 'contain', filter: 'drop-shadow(0 1px 2px #000)' } });
}

export function fmt(n) { return Math.round(n).toLocaleString('en'); }
