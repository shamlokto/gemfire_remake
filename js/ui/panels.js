// Realm screen panels: top bar, province panel with orders and order dialogs, houses overview,
// chronicle. The app object passed in provides: state (getter), apply(order) -> result,
// refresh(), endMonth(), openMenu(), openSettings(), map (MapView).
import { PROVINCES, MONTHS, SEASONS, seasonOf } from '../data/world.js';
import { HOUSES, HOUSE_BY_ID } from '../data/houses.js';
import { VASSAL_BY_ID } from '../data/vassals.js';
import { TROOPS, COMPANIES, MAX_SOLDIERS, MAX_VASSALS_PER_PROVINCE } from '../data/units.js';
import { SPIRITS } from '../data/spirits.js';
import { art, PROVINCE_VIGNETTE, ORDER_BACKDROP } from '../data/art.js';
import {
  provinceVassals, governorOf, houseTotals, canSee, captivesOf, atPeace, pairKey, provinceDefence,
  vassalPower, unitPower, ownedProvinces, envoyOf,
} from '../realm/state.js';
import { listOrders, musterCost, developGain, trainGain, recruitChance, DEVELOP_COST, FEAST_FOOD, SPY_COST, MAX_MARCH, adjacentForeign, adjacentOwn } from '../realm/orders.js';
import { forecast } from '../realm/economy.js';
import { DIPLOMACY, bribeCost, truceChance, marriageChance, tributeChance, bribeChance } from '../realm/diplomacy.js';
import { h, portrait, crestImg, houseColor, fmt } from './portraits.js';
import { modal, toast } from './events.js';
import { sfx } from './audio.js';

const SEASON_BANNER = [4, 5, 6, 7];
const ORDER_ICON = { develop: '⚒', govern: '⚖', muster: '⚔', train: '🛡', hire: '💰', dismiss: '✕', march: '🚩', supply: '🛒', diplomacy: '🕊', spy: '👁', recruit: '⛓', rest: '☾' };
const ORDER_HINT = {
  develop: 'Fields, market or dikes', govern: 'Feast or tax', muster: 'Raise soldiers', train: 'Drill the troops',
  hire: 'Sign a company', dismiss: 'Pay off the company', march: 'Move or attack', supply: 'Send food and gold',
  diplomacy: 'Truce, pact, bribe', spy: 'Scout a province', recruit: 'Win over a captive', rest: 'Do nothing',
};
const pct = x => Math.round(x * 100) + '%';

export class RealmUI {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.tab = 'province';
    this.selected = null;
    this.build();
  }

  get state() { return this.app.state; }

  build() {
    const r = this.root;
    r.innerHTML = '';
    this.top = h('header.topbar');
    this.mapwrap = h('div.mapwrap');
    this.side = h('aside.side');
    r.append(this.top, h('div.realm-body', this.mapwrap, this.side));
    this.sheetHandle = h('button.sheet-handle', { 'aria-label': 'Expand panel', onclick: () => this.toggleSheet() });
    this.tabs = h('nav.side-tabs');
    this.body = h('div.side-body');
    this.side.append(this.sheetHandle, this.tabs, this.body);
    this.mapControls = h('div.map-controls',
      h('button.icon-btn', { title: 'Zoom in', onclick: () => this.app.map.zoom(1.25) }, '+'),
      h('button.icon-btn', { title: 'Zoom out', onclick: () => this.app.map.zoom(0.8) }, '−'),
      h('button.icon-btn', { title: 'Fit map', onclick: () => this.app.map.fit() }, '⤢'));
    this.legend = h('div.map-legend');
    this.mapwrap.append(this.mapControls, this.legend);
  }

  toggleSheet() {
    const s = this.side;
    if (s.classList.contains('expanded')) { s.classList.remove('expanded'); s.classList.add('collapsed'); }
    else if (s.classList.contains('collapsed')) s.classList.remove('collapsed');
    else s.classList.add('expanded');
  }

  select(pid) {
    this.selected = pid;
    this.tab = 'province';
    this.side.classList.remove('collapsed');
    this.render();
  }

  render() {
    const st = this.state;
    if (!st) return;
    this.renderTop();
    this.renderTabs();
    const keep = this.lastTab === this.tab && this.lastSel === this.selected ? this.body.scrollTop : 0;
    this.lastTab = this.tab; this.lastSel = this.selected;
    this.body.innerHTML = '';
    if (this.tab === 'province') this.body.append(this.selected == null ? this.overview() : this.provincePanel(this.selected));
    else if (this.tab === 'houses') this.body.append(this.housesPanel());
    else this.body.append(this.chronicle());
    this.body.scrollTop = keep;
    this.renderLegend();
  }

  renderTop() {
    const st = this.state, house = HOUSE_BY_ID[st.player];
    const t = houseTotals(st, st.player);
    const season = seasonOf(st.month);
    const waiting = ownedProvinces(st, st.player).filter(p => !p.ordered).length;
    this.top.innerHTML = '';
    this.top.append(
      h('div.season-banner', { style: { backgroundImage: `url(${art(SEASON_BANNER[season])})` } }),
      h('div.date', h('span.m', MONTHS[st.month]), h('span.y', `${SEASONS[season]}, year ${st.year}`)),
      h('div.house-tag', { '--hc': houseColor(st.player) }, crestImg(st.player, 30), h('span.n', house.short)),
      h('div.totals',
        h('span', { title: 'Provinces' }, h('i', '🏰'), t.provinces),
        h('span', { title: 'Gold (all provinces)' }, h('i', '🪙'), fmt(t.gold)),
        h('span', { title: 'Food (all provinces)' }, h('i', '🌾'), fmt(t.food)),
        h('span', { title: 'Soldiers' }, h('i', '⚔'), fmt(t.soldiers)),
        h('span', { title: 'Lantern Shards' }, h('i', '◆'), t.shards.length)),
      h('div.top-actions',
        h('button.icon-btn', { title: 'Settings', onclick: () => this.app.openSettings() }, '⚙'),
        h('button.icon-btn', { title: 'Menu', onclick: () => this.app.openMenu() }, '☰'),
        h('button.btn.primary', { onclick: () => this.app.endMonth(), title: waiting ? `${waiting} province(s) have not acted` : '' },
          'End Month', waiting ? h('span', { style: { opacity: 0.7, marginLeft: '6px', fontSize: '12px' } }, `(${waiting})`) : null)),
    );
  }

  renderTabs() {
    this.tabs.innerHTML = '';
    for (const [id, label] of [['province', 'Province'], ['houses', 'Houses'], ['log', 'Chronicle']]) {
      this.tabs.append(h('button' + (this.tab === id ? '.on' : ''), { onclick: () => { sfx('click'); this.tab = id; this.side.classList.remove('collapsed'); this.render(); } }, label));
    }
  }

  renderLegend() {
    const st = this.state;
    this.legend.innerHTML = '';
    for (const hs of HOUSES) {
      if (!st.houses[hs.id].alive) continue;
      const n = ownedProvinces(st, hs.id).length;
      this.legend.append(h('span.chip', { '--hc': hs.color }, h('span.sw'), hs.short, h('b', n)));
    }
  }

  // --------------------------------------------------------------- overview (nothing selected)
  overview() {
    const st = this.state;
    const mine = ownedProvinces(st, st.player);
    const frag = h('div');
    frag.append(h('div.prov-head', crestImg(st.player, 56), h('div', h('h2', HOUSE_BY_ID[st.player].name), h('div.owner', h('i', HOUSE_BY_ID[st.player].motto)))));
    frag.append(h('p.hint', 'Select a province on the map to give it orders. Each of your provinces can act once a month.'));
    frag.append(h('div.section-title', 'Your provinces'));
    for (const p of mine) {
      const gov = governorOf(st, p.id);
      frag.append(h('div.vassal', { style: { cursor: 'pointer' }, onclick: () => { this.app.map.centerOn(p.id); this.app.select(p.id); } },
        gov ? portrait(gov.id, { size: 44 }) : h('div', { style: { width: '44px', textAlign: 'center', fontSize: '24px' } }, '🏰'),
        h('div', h('div.nm', PROVINCES[p.id].name, p.ordered ? h('span', { style: { color: 'var(--good)', marginLeft: '6px' } }, '✓') : ''),
          h('div.mini', h('span', '🪙 ', h('b', fmt(p.gold))), h('span', '🌾 ', h('b', fmt(p.food))), h('span', 'Loyalty ', h('b', p.loyalty)), h('span', 'Vassals ', h('b', p.vassals.length))))));
    }
    return frag;
  }

  // --------------------------------------------------------------- province
  provincePanel(pid) {
    const st = this.state, pr = st.provinces[pid], P = PROVINCES[pid];
    const mine = pr.owner === st.player;
    const seen = canSee(st, st.player, pid);
    const frag = h('div');
    frag.append(h('div', { style: { margin: '-14px -14px 10px', height: '120px', backgroundImage: `url(${art(PROVINCE_VIGNETTE(pid))})`, backgroundSize: 'cover', backgroundPosition: 'center', maskImage: 'linear-gradient(180deg,#000 55%,transparent)', WebkitMaskImage: 'linear-gradient(180deg,#000 55%,transparent)' } }));
    const gov = seen ? governorOf(st, pid) : null;
    frag.append(h('div.prov-head',
      gov ? portrait(gov.id, { size: 60 }) : (pr.owner ? crestImg(pr.owner, 56) : null),
      h('div',
        h('h2', P.name),
        h('div.owner', { '--hc': houseColor(pr.owner) }, h('span.sw'), pr.owner ? HOUSE_BY_ID[pr.owner].name : 'Free hold'),
        h('div.terrain-tag', P.terrain, pr.owner && st.houses[pr.owner].capital === pid ? ' · capital' : '', gov ? ` · governed by ${VASSAL_BY_ID[gov.id].name}` : ''),
        pr.shard && seen ? h('div.shard-tag', { '--sc': SPIRITS[pr.shard].color }, '◆ ', `${SPIRITS[pr.shard].name} shard`) : null)));

    if (!seen) {
      frag.append(h('p.hint', 'Your scouts have no news of this province. Spy on it, or take a neighbouring province, to see inside.'));
      return frag;
    }

    // resources
    const fc = mine ? forecast(st, pid) : null;
    frag.append(h('div.res-row',
      res('Gold', pr.gold, fc ? fc.gold : null),
      res('Food', pr.food, fc ? fc.food : null, fc && st.month <= 6 ? `harvest +${fc.harvest}` : null),
      pr.owner ? null : res('Militia', pr.militia)));

    const bars = h('div.stats');
    const bar = (lbl, v, cls = '') => bars.append(h('span.lbl', lbl), h('div.bar' + (cls ? '.' + cls : ''), h('i', { style: { width: v + '%' } })), h('span', v));
    bar('Fields', pr.fields); bar('Market', pr.market); bar('Dikes', pr.dikes, 'dike'); bar('Loyalty', pr.loyalty, 'loy');
    frag.append(h('div.parchment', { style: { '--parchment-img': `url(${art(3)})` } }, bars));

    // vassals
    const vs = provinceVassals(st, pid);
    frag.append(h('div.section-title', `Vassals ${vs.length}/${MAX_VASSALS_PER_PROVINCE}`));
    if (!vs.length) frag.append(h('p.hint', pr.owner ? 'No vassal is stationed here.' : `${pr.militia} militia guard this free hold.`));
    for (const v of vs) frag.append(vassalRow(st, v));
    if (pr.company) {
      const c = COMPANIES[pr.company.type];
      frag.append(h('div.vassal', h('img', { src: art(c.sprite), style: { width: '48px', height: '48px', objectFit: 'contain' } }),
        h('div', h('div.nm', c.name), h('div.ti', 'Hired company'), h('div.mini', h('span', 'Soldiers ', h('b', pr.company.soldiers)), h('span', 'Wage ', h('b', c.wage + 'g/mo'))))));
    }
    const marching = (st.marches || []).filter(m => m.from === pid && m.house === st.player);
    for (const m of marching) frag.append(h('div.ordered-note', { style: { marginTop: '6px' } }, `🚩 ${m.vassals.length} vassal(s) marching on ${PROVINCES[m.to].name}.`));

    if (mine) frag.append(this.ordersBlock(pid));
    else if (pr.owner) {
      const rel = relation(st, st.player, pr.owner);
      if (rel) frag.append(h('p.hint', rel));
    }
    return frag;
  }

  ordersBlock(pid) {
    const st = this.state, pr = st.provinces[pid];
    const wrap = h('div');
    wrap.append(h('div.section-title', 'Orders'));
    if (pr.ordered) wrap.append(h('div.ordered-note', '✓ This province has acted this month.'));
    const grid = h('div.orders');
    for (const o of listOrders(st, pid)) {
      const b = h('button.btn' + (o.type === 'march' && !o.disabled ? '.primary' : ''), {
        disabled: !!o.disabled, title: o.disabled || '', onclick: () => { sfx('click'); this.openOrder(pid, o.type); },
      }, h('span', `${ORDER_ICON[o.type] || ''} ${o.label}`), h('small', o.disabled && !pr.ordered ? o.disabled : ORDER_HINT[o.type] + (o.cost ? ` · ${o.cost}${o.type === 'govern' ? ' food' : 'g'}` : '')));
      grid.append(b);
    }
    wrap.append(grid);
    return wrap;
  }

  // --------------------------------------------------------------- order dialogs
  async openOrder(pid, type) {
    const fn = this['dlg_' + type];
    const order = fn ? await fn.call(this, pid) : { type, province: pid };
    if (!order) return;
    this.app.apply(order);
  }

  dlg_rest(pid) { return { type: 'rest', province: pid }; }
  dlg_dismiss(pid) { return { type: 'dismiss', province: pid }; }

  dlg_develop(pid) {
    const st = this.state, pr = st.provinces[pid];
    const g = developGain(governorOf(st, pid));
    return modal(close => ({
      title: 'Develop ' + PROVINCES[pid].name,
      body: [h('p.hint', `Costs ${DEVELOP_COST} gold. Your governor's wits give +${g}.`),
        h('div.target-grid', ...[['fields', 'Fields', 'More food at harvest'], ['market', 'Market', 'More gold each month'], ['dikes', 'Dikes', 'Protect against floods']].map(([k, n, d]) =>
          h('button.target', { disabled: pr[k] >= 100, onclick: () => close({ type: 'develop', province: pid, kind: k }) },
            h('div.nm', n), h('div.meta', `${pr[k]} → ${Math.min(100, pr[k] + g)}`), h('div.meta', d))))],
      foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel')],
    }), { backdrop: ORDER_BACKDROP.fields });
  }

  dlg_govern(pid) {
    const st = this.state, pr = st.provinces[pid];
    return modal(close => ({
      title: 'Govern ' + PROVINCES[pid].name,
      body: h('div.target-grid',
        h('button.target', { disabled: pr.food < FEAST_FOOD, onclick: () => close({ type: 'govern', province: pid, kind: 'feast' }) },
          h('div.nm', 'Hold a feast'), h('div.meta', `−${FEAST_FOOD} food, loyalty +8`)),
        h('button.target', { onclick: () => close({ type: 'govern', province: pid, kind: 'tax' }) },
          h('div.nm', 'Raise taxes'), h('div.meta', `+${pr.market} gold, loyalty −10`))),
      foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel')],
    }), { backdrop: ORDER_BACKDROP.throne });
  }

  dlg_muster(pid) {
    const st = this.state, pr = st.provinces[pid];
    const vs = provinceVassals(st, pid);
    let vid = (vs.find(v => v.soldiers < MAX_SOLDIERS) || vs[0]).id;
    return modal(close => {
      const out = h('output');
      const cost = h('span');
      const range = h('input', { type: 'range', min: 10, step: 10, max: 10, value: 10 });
      const sync = () => {
        const v = st.vassals[vid];
        const max = Math.max(10, Math.min(MAX_SOLDIERS - v.soldiers, Math.floor(pr.gold / TROOPS[v.troop].cost) * 10));
        range.max = max;
        if (+range.value > max) range.value = max;
        out.textContent = range.value;
        cost.textContent = `${musterCost(v.troop, +range.value)} gold of ${pr.gold} · ${v.soldiers} → ${v.soldiers + +range.value} ${TROOPS[v.troop].name.toLowerCase()}`;
      };
      range.addEventListener('input', sync);
      const picks = vassalPicker(st, vs, 'radio', [vid], ids => { vid = ids[0]; sync(); });
      setTimeout(sync);
      return {
        title: 'Muster troops',
        body: [picks, h('div.field', h('label', 'Soldiers'), h('div.range-row', range, out)), h('p.hint', cost)],
        foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel'),
          h('button.btn.primary', { onclick: () => close({ type: 'muster', province: pid, vassal: vid, soldiers: +range.value }) }, 'Muster')],
      };
    }, { backdrop: ORDER_BACKDROP.muster });
  }

  dlg_train(pid) {
    const st = this.state;
    const vs = provinceVassals(st, pid);
    return modal(close => ({
      title: 'Train troops',
      body: [h('p.hint', 'All vassals here drill together. Training raises fighting strength.'),
        ...vs.map(v => h('div.vassal', portrait(v.id, { size: 44 }), h('div', h('div.nm', VASSAL_BY_ID[v.id].name), h('div.mini', `Training ${v.training} → ${Math.min(100, v.training + trainGain(v))}`))))],
      foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel'), h('button.btn.primary', { onclick: () => close({ type: 'train', province: pid }) }, 'Drill')],
    }), { backdrop: ORDER_BACKDROP.train });
  }

  dlg_hire(pid) {
    const st = this.state, pr = st.provinces[pid];
    return modal(close => ({
      title: 'Hire a company',
      body: h('div.target-grid', ...Object.entries(COMPANIES).map(([k, c]) =>
        h('button.target', { disabled: pr.gold < c.hire, onclick: () => close({ type: 'hire', province: pid, company: k }) },
          h('img', { src: art(c.sprite), style: { width: '100%', height: '70px', objectFit: 'contain' } }),
          h('div.nm', c.name), h('div.meta', `${c.size} strong · atk ${c.atk} def ${c.def}`), h('div.meta', `${c.hire}g, then ${c.wage}g/month`)))),
      foot: [h('span.hint', { style: { marginRight: 'auto' } }, `Treasury: ${pr.gold} gold`), h('button.btn', { onclick: () => close(null) }, 'Cancel')],
    }), { wide: true, backdrop: ORDER_BACKDROP.hire });
  }

  dlg_march(pid) {
    const st = this.state, pr = st.provinces[pid];
    const vs = provinceVassals(st, pid);
    const targets = [...adjacentForeign(st, pid), ...adjacentOwn(st, pid)];
    let to = null, chosen = vs.filter(v => v.soldiers > 0).slice(0, MAX_MARCH).map(v => v.id);
    this.app.map.setHighlights(targets);
    return modal(close => {
      const compare = h('div');
      const foodR = h('input', { type: 'range', min: 0, max: pr.food, step: 10, value: Math.min(pr.food, 60) });
      const foodOut = h('output', foodR.value);
      foodR.addEventListener('input', () => { foodOut.textContent = foodR.value; });
      const comp = pr.company ? h('input', { type: 'checkbox', checked: true }) : null;
      const go = h('button.btn.primary', { disabled: true }, 'March');
      const sync = () => {
        go.disabled = to == null || !chosen.length;
        compare.innerHTML = '';
        if (to == null) return;
        const tp = st.provinces[to];
        const ours = chosen.reduce((a, id) => a + vassalPower(st.vassals[id]), 0) + (comp && comp.checked ? unitPower(pr.company.type, pr.company.soldiers, 60, 50) : 0);
        if (tp.owner === st.player) { go.textContent = 'Move'; compare.append(h('p.hint', `Move to ${PROVINCES[to].name} (room for ${MAX_VASSALS_PER_PROVINCE - tp.vassals.length}).`)); return; }
        go.textContent = 'Attack';
        const seen = canSee(st, st.player, to);
        const theirs = seen ? provinceDefence(st, to) : null;
        compare.append(h('div.compare',
          h('div', h('div.hint', 'Your force'), h('div.side-v', fmt(ours))),
          h('div', '⚔'),
          h('div', h('div.hint', PROVINCES[to].name), h('div.side-v', theirs == null ? '?' : fmt(theirs)))));
        if (theirs != null) {
          const r = ours / Math.max(1, theirs);
          compare.append(h('p.hint', { style: { textAlign: 'center' } }, r > 1.6 ? 'Your captains are confident.' : r > 1.05 ? 'An even fight, slightly in your favour.' : r > 0.7 ? 'A risky battle.' : 'Your captains urge caution.'));
        }
      };
      const tg = h('div.target-grid', ...targets.map(t => {
        const tp = st.provinces[t];
        const peace = tp.owner && tp.owner !== st.player && atPeace(st, st.player, tp.owner);
        const b = h('button.target', { disabled: peace, '--hc': houseColor(tp.owner), onclick: () => { to = t; tg.querySelectorAll('.target').forEach(x => x.classList.remove('on')); b.classList.add('on'); this.app.map.select(t); sync(); } },
          h('div.nm', PROVINCES[t].name), h('div.meta', tp.owner === st.player ? 'Your province' : (tp.owner ? HOUSE_BY_ID[tp.owner].short : 'Free hold') + (peace ? ' · at peace' : '')));
        return b;
      }));
      const picker = vassalPicker(st, vs, 'checkbox', chosen, ids => { chosen = ids.slice(0, MAX_MARCH); sync(); });
      if (comp) comp.addEventListener('change', sync);
      go.addEventListener('click', () => close({ type: 'march', from: pid, province: pid, to, vassals: chosen, company: comp ? comp.checked : false, food: +foodR.value }));
      setTimeout(sync);
      return {
        title: 'March from ' + PROVINCES[pid].name,
        body: [h('div.field', h('label', 'Destination'), tg), h('div.field', h('label', `Vassals (up to ${MAX_MARCH})`), picker),
          comp ? h('label.pick', { style: { gridTemplateColumns: 'auto 1fr' } }, comp, `Bring the ${COMPANIES[pr.company.type].name}`) : null,
          h('div.field', h('label', 'Food carried'), h('div.range-row', foodR, foodOut)), compare],
        foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel'), go],
      };
    }, { wide: true }).finally(() => { this.app.map.setHighlights(null); this.app.map.select(this.selected); });
  }

  dlg_supply(pid) {
    const st = this.state, pr = st.provinces[pid];
    const targets = adjacentOwn(st, pid);
    let to = targets[0];
    this.app.map.setHighlights(targets);
    return modal(close => {
      const food = h('input', { type: 'range', min: 0, max: pr.food, step: 10, value: 0 });
      const gold = h('input', { type: 'range', min: 0, max: pr.gold, step: 10, value: 0 });
      const fo = h('output', '0'), go = h('output', '0');
      food.addEventListener('input', () => { fo.textContent = food.value; });
      gold.addEventListener('input', () => { go.textContent = gold.value; });
      const tg = h('div.target-grid', ...targets.map((t, i) => {
        const b = h('button.target' + (i === 0 ? '.on' : ''), { onclick: () => { to = t; tg.querySelectorAll('.target').forEach(x => x.classList.remove('on')); b.classList.add('on'); } },
          h('div.nm', PROVINCES[t].name), h('div.meta', `🪙 ${st.provinces[t].gold} · 🌾 ${st.provinces[t].food}`));
        return b;
      }));
      return {
        title: 'Send supplies',
        body: [h('div.field', h('label', 'To'), tg), h('div.field', h('label', 'Food'), h('div.range-row', food, fo)), h('div.field', h('label', 'Gold'), h('div.range-row', gold, go))],
        foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel'), h('button.btn.primary', { onclick: () => close({ type: 'supply', province: pid, from: pid, to, food: +food.value, gold: +gold.value }) }, 'Send')],
      };
    }).finally(() => this.app.map.setHighlights(null));
  }

  dlg_spy(pid) {
    const st = this.state;
    const targets = PROVINCES.filter(p => st.provinces[p.id].owner !== st.player).map(p => p.id);
    return modal(close => ({
      title: 'Send spies',
      body: [h('p.hint', `Costs ${SPY_COST} gold. Reveals the province for six months.`),
        h('div.target-grid', ...targets.map(t => h('button.target', { onclick: () => close({ type: 'spy', province: pid, target: t }) },
          h('div.nm', PROVINCES[t].name), h('div.meta', st.provinces[t].owner ? HOUSE_BY_ID[st.provinces[t].owner].short : 'Free hold', canSee(st, st.player, t) ? ' · visible' : ''))))],
      foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel')],
    }), { wide: true, backdrop: ORDER_BACKDROP.spy });
  }

  dlg_recruit(pid) {
    const st = this.state;
    const envoy = envoyOf(st, pid);
    const caps = captivesOf(st, st.player);
    return modal(close => ({
      title: 'Recruit a captive',
      body: h('div.pick-list', ...caps.map(c => h('button.target', { style: { display: 'grid', gridTemplateColumns: '48px 1fr', gap: '10px', alignItems: 'center' }, onclick: () => close({ type: 'recruit', province: pid, captive: c.id }) },
        portrait(c.id, { size: 44 }), h('div', h('div.nm', VASSAL_BY_ID[c.id].name), h('div.meta', `${VASSAL_BY_ID[c.id].title} · chance ${pct(recruitChance(envoy, c))}`))))),
      foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel')],
    }), { backdrop: ORDER_BACKDROP.council });
  }

  dlg_diplomacy(pid) {
    const st = this.state;
    const envoy = envoyOf(st, pid);
    const others = HOUSES.filter(x => x.id !== st.player && st.houses[x.id].alive);
    let kind = 'truce', target = others[0]?.id, vassal = null;
    return modal(close => {
      const info = h('div');
      const send = h('button.btn.primary', 'Send envoy');
      const kinds = h('div.target-grid');
      const targetsBox = h('div');
      const sync = () => {
        kinds.querySelectorAll('.target').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
        targetsBox.innerHTML = '';
        info.innerHTML = '';
        if (kind === 'bribe') {
          const cands = Object.values(st.vassals).filter(v => v.status === 'active' && v.house !== st.player && v.location != null && canSee(st, st.player, v.location) && st.houses[v.house].ruler !== v.id);
          if (!cands.some(v => v.id === vassal)) vassal = cands[0]?.id ?? null;
          targetsBox.append(h('div.pick-list', ...cands.map(v => h('button.target' + (v.id === vassal ? '.on' : ''), { style: { display: 'grid', gridTemplateColumns: '44px 1fr', gap: '10px', alignItems: 'center' }, onclick: () => { vassal = v.id; sync(); } },
            portrait(v.id, { size: 40 }), h('div', h('div.nm', VASSAL_BY_ID[v.id].name), h('div.meta', `${HOUSE_BY_ID[v.house].short} · loyalty ${v.loyalty} · ${bribeCost(v)}g`))))));
          if (!cands.length) targetsBox.append(h('p.hint', 'No foreign vassal is in sight.'));
          if (vassal) info.append(h('p.hint', `Chance ${pct(bribeChance(st, envoy, st.vassals[vassal]))}. Costs ${bribeCost(st.vassals[vassal])} gold from this province.`));
          send.disabled = !vassal;
        } else {
          targetsBox.append(h('div.target-grid', ...others.map(o => h('button.target' + (o.id === target ? '.on' : ''), { '--hc': o.color, onclick: () => { target = o.id; sync(); } },
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, crestImg(o.id, 26), h('div.nm', o.short)), h('div.meta', relation(st, st.player, o.id) || 'No pact')))));
          const ch = { truce: truceChance, marriage: marriageChance, tribute: tributeChance }[kind];
          const d = DIPLOMACY[kind];
          if (target) info.append(h('p.hint', `Chance ${pct(ch(st, st.player, target, envoy))}.` + (d.cost ? ` Costs ${d.cost} gold.` : '') + (d.months ? ` Lasts ${d.months} months.` : '')));
          send.disabled = !target;
        }
      };
      for (const [k, d] of Object.entries(DIPLOMACY)) kinds.append(h('button.target', { 'data-k': k, onclick: () => { kind = k; sync(); } }, h('div.nm', d.label)));
      send.addEventListener('click', () => close({ type: 'diplomacy', province: pid, kind, target, vassal, envoy: envoy.id }));
      setTimeout(sync);
      return {
        title: 'Diplomacy',
        body: [h('div.vassal', portrait(envoy.id, { size: 44 }), h('div', h('div.nm', 'Envoy: ' + VASSAL_BY_ID[envoy.id].name), h('div.mini', `Charm ${envoy.charm}`))), kinds, h('div.field', targetsBox), info],
        foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel'), send],
      };
    }, { wide: true, backdrop: ORDER_BACKDROP.diplomacy });
  }

  // --------------------------------------------------------------- houses
  housesPanel() {
    const st = this.state;
    const frag = h('div');
    const max = Math.max(1, ...HOUSES.map(x => houseTotals(st, x.id).power));
    for (const hs of HOUSES) {
      const alive = st.houses[hs.id].alive;
      const t = houseTotals(st, hs.id);
      frag.append(h('div.house-row' + (alive ? '' : '.dead'), { '--hc': hs.color },
        alive ? portrait(st.houses[hs.id].ruler, { size: 44 }) : crestImg(hs.id, 40),
        h('div',
          h('div.nm', hs.name, hs.id === st.player ? ' (you)' : ''),
          h('div.meta', alive ? `${t.provinces} provinces · ${t.vassals} vassals · ${fmt(t.soldiers)} soldiers` : 'Fallen'),
          alive ? h('div.power-bar', h('i', { style: { width: (t.power / max * 100) + '%' } })) : null,
          t.shards.length ? h('div.meta', t.shards.map(s => '◆ ' + SPIRITS[s].name).join('  ')) : null),
        h('div.rel', hs.id === st.player ? '' : relation(st, st.player, hs.id) || '')));
    }
    const caps = captivesOf(st, st.player);
    if (caps.length) {
      frag.append(h('div.section-title', 'Your captives'));
      for (const c of caps) frag.append(h('div.vassal', portrait(c.id, { size: 44 }), h('div', h('div.nm', VASSAL_BY_ID[c.id].name), h('div.ti', `Formerly of ${HOUSE_BY_ID[VASSAL_BY_ID[c.id].house]?.short || '?'}`))));
    }
    return frag;
  }

  chronicle() {
    const st = this.state;
    const list = h('div.log-list');
    for (const e of st.log.slice(-120)) {
      list.append(h('div.log-item.' + (e.kind || 'info'), h('div.t', `${MONTHS[(e.turn) % 12]}, year ${412 + Math.floor(e.turn / 12)}`), e.text));
    }
    return list;
  }
}

function res(k, v, d, extra) {
  return h('div.res', h('div.k', k), h('div.v', fmt(v)),
    d != null ? h('div.d' + (d > 0 ? '.pos' : d < 0 ? '.neg' : ''), (d > 0 ? '+' : '') + d + '/mo') : null,
    extra ? h('div.d', extra) : null);
}

function vassalRow(st, v) {
  const V = VASSAL_BY_ID[v.id];
  const ruler = st.houses[v.house]?.ruler === v.id;
  return h('div.vassal' + (ruler ? '.ruler' : ''),
    portrait(v.id, { size: 48 }),
    h('div',
      h('div.nm', V.name),
      h('div.ti', V.title),
      h('div.mini',
        h('span', TROOPS[v.troop].name, ' ', h('b', v.soldiers)),
        h('span', 'Trn ', h('b', v.training)),
        h('span', 'Loy ', h('b', v.loyalty)),
        h('span', { title: 'Might / Wits / Charm' }, h('b', `${v.might}/${v.wits}/${v.charm}`)))));
}

function vassalPicker(st, vs, kind, selected, onChange) {
  const sel = new Set(selected);
  const box = h('div.pick-list');
  for (const v of vs) {
    const input = h('input', { type: kind, name: 'vp', checked: sel.has(v.id) });
    input.addEventListener('change', () => {
      if (kind === 'radio') { sel.clear(); sel.add(v.id); }
      else if (input.checked) sel.add(v.id); else sel.delete(v.id);
      if (kind === 'checkbox' && sel.size > MAX_MARCH) { sel.delete(v.id); input.checked = false; toast(`At most ${MAX_MARCH} vassals march together.`, true); }
      onChange([...sel]);
    });
    box.append(h('label.pick', input, portrait(v.id, { size: 40 }),
      h('div', h('div.nm', { style: { fontWeight: 600 } }, VASSAL_BY_ID[v.id].name), h('div.hint', { style: { fontStyle: 'normal' } }, `${TROOPS[v.troop].name} ${v.soldiers} · training ${v.training}`))));
  }
  return box;
}

export function relation(st, a, b) {
  if (!b || a === b) return '';
  const m = st.marriages.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
  if (m && m[2] > st.turn) return `Marriage pact (${m[2] - st.turn} mo)`;
  const t = st.truces[pairKey(a, b)];
  if (t && t > st.turn) return `Truce (${t - st.turn} mo)`;
  return '';
}
