// Modals, event cards, toasts and the month curtain.
import { h } from './portraits.js';
import { art } from '../data/art.js';
import { sfx } from './audio.js';

// Open a modal. build(close) returns { title, body, foot } (nodes), or a node.
// Returns a promise resolving with the value passed to close().
export function modal(build, { wide = false, cls = '', dismissable = true, backdrop = null } = {}) {
  return new Promise(resolve => {
    let done = false;
    const close = val => {
      if (done) return; done = true;
      back.style.opacity = '0';
      back.style.transition = 'opacity 0.2s';
      setTimeout(() => back.remove(), 200);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const parts = build(close);
    const box = h('div.modal' + (wide ? '.wide' : '') + (cls ? '.' + cls : ''), { role: 'dialog', 'aria-modal': 'true' });
    if (backdrop) {
      box.append(h('div.modal-backdrop-img', { style: { height: '120px', backgroundImage: `url(${art(backdrop)})`, backgroundSize: 'cover', backgroundPosition: 'center', maskImage: 'linear-gradient(180deg,#000 40%,transparent)', WebkitMaskImage: 'linear-gradient(180deg,#000 40%,transparent)', marginBottom: '-50px' } }));
    }
    if (parts instanceof Node) box.append(parts);
    else {
      if (parts.title) box.append(h('div.modal-head', h('h2', parts.title)));
      if (parts.body) box.append(h('div.modal-body', parts.body));
      if (parts.foot) box.append(h('div.modal-foot', parts.foot));
    }
    const back = h('div.modal-back', { onclick: e => { if (dismissable && e.target === back) close(null); } }, box);
    const onKey = e => { if (e.key === 'Escape' && dismissable) close(null); };
    document.addEventListener('keydown', onKey);
    document.body.append(back);
    const first = box.querySelector('.btn.primary') || box.querySelector('button');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
  });
}

// Story / random event card with scene art. ev.choices: [{ label, value }] -> resolves to the value.
export function eventCard(ev) {
  sfx('page');
  return modal(close => h('div',
    h('div.scene', { style: { backgroundImage: `url(${art(ev.art || 99)})` } }),
    h('div.modal-head', h('h2', ev.title || 'News')),
    h('div.modal-body', ...(String(ev.text || '').split('\n').map(p => h('p', p)))),
    h('div.modal-foot', ...(ev.choices
      ? ev.choices.map((c, i) => h('button.btn' + (i === ev.choices.length - 1 ? '.primary' : ''), { onclick: () => { sfx('click'); close(c.value); } }, c.label))
      : [h('button.btn.primary', { onclick: () => { sfx('click'); close(true); } }, 'Continue')]))),
  { wide: true, cls: 'event-card' });
}

export function confirmBox(title, text, ok = 'Yes', cancel = 'Cancel') {
  return modal(close => ({
    title, body: h('p', text),
    foot: [h('button.btn', { onclick: () => close(false) }, cancel), h('button.btn.primary', { onclick: () => close(true) }, ok)],
  }));
}

let toastWrap = null;
export function toast(text, bad = false, ms = 2600) {
  if (!toastWrap) { toastWrap = h('div.toast-wrap'); document.body.append(toastWrap); }
  const t = h('div.toast' + (bad ? '.bad' : ''), text);
  toastWrap.append(t);
  setTimeout(() => { t.style.transition = 'opacity 0.4s'; t.style.opacity = '0'; }, ms);
  setTimeout(() => t.remove(), ms + 450);
}

let curtain = null;
export async function monthCurtain(title, sub, hold = 900) {
  if (!curtain) { curtain = h('div.month-curtain', h('div.txt', h('div.m'), h('div.s'))); document.body.append(curtain); }
  curtain.querySelector('.m').textContent = title;
  curtain.querySelector('.s').textContent = sub || '';
  curtain.classList.add('on');
  await wait(hold);
}
export function hideCurtain() { if (curtain) curtain.classList.remove('on'); }
export const wait = ms => new Promise(r => setTimeout(r, ms));
