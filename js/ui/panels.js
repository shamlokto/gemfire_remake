// Realm screen panels: top bar, province panel with orders and order dialogs, houses overview,
// chronicle. The app object passed in provides: state (getter), apply(order) -> result,
// refresh(), endMonth(), openMenu(), openSettings(), map (MapView).
import { PROVINCES, MONTHS, SEASONS, seasonOf, ADJACENCY as ADJ } from '../data/world.js';
import { HOUSES, HOUSE_BY_ID } from '../data/houses.js';
import { VASSAL_BY_ID } from '../data/vassals.js';
import { TROOPS, COMPANIES, MAX_SOLDIERS, MAX_VASSALS_PER_PROVINCE, MAX_UNITS_PER_PROVINCE, MAX_UNITS_PER_ARMY } from '../data/units.js';
import { SPIRITS, SPIRIT_UNIT } from '../data/spirits.js';
import { art, hasArt, PROVINCE_VIGNETTE, ORDER_BACKDROP, LAND_MOMENT, LAND_PANORAMA } from '../data/art.js';
import {
  provinceVassals, governorOf, houseTotals, canSee, captivesOf, atPeace, pairKey, provinceDefence,
  ownedProvinces, envoyOf, troopPower, companyPower, spiritPower, leaderOf, unitName, wanderersAt, wanderersNear,
} from '../realm/state.js';
import {
  shardStatus, chargeGain, averageLoyalty, techState, canResearch, techCost, setResearch, researchPoints,
  studyPoints, hasTech, nextInBranch, CHARGE_MAX, CHARGE_LOYALTY_FLOOR, techEffect,
} from '../realm/tech.js';
import { TECHS, TECH_BY_ID, BRANCHES, BRANCH_IDS, techsOf } from '../data/tech.js';
import { listOrders, musterCost, musterLimit, developGain, trainGain, recruitChance, DEVELOP_COST, FEAST_FOOD, SPY_COST, MAX_MARCH, adjacentOwn, marchOptions, musterOptions, hireOptions } from '../realm/orders.js';
import { forecast } from '../realm/economy.js';
import { landOf, yieldOf, landQuality, landPotential, landCtx, damagedCount } from '../realm/landhooks.js';
import { openLandView } from './landview.js';
import { DIPLOMACY, bribeCost, truceChance, marriageChance, tributeChance, bribeChance, wandererChance } from '../realm/diplomacy.js';
import { h, portrait, crestImg, houseColor, fmt } from './portraits.js';
import { modal, toast } from './events.js';
import { quote, tradeRoom, SEASON_FACTOR, TRADE_PER_MARKET, BASE_PRICE } from '../realm/market.js';
import { sfx } from './audio.js';

const SEASON_BANNER = [4, 5, 6, 7];
const ORDER_ICON = { build: '⚒', develop: '⚒', govern: '⚖', muster: '⚔', train: '🛡', hire: '💰', dismiss: '✕', march: '🚩', supply: '🛒', trade: '⚖', diplomacy: '🕊', spy: '👁', recruit: '⛓', disband: '⚐', study: '📜', rest: '☾' };
const ORDER_HINT = {
  build: 'Farms, houses, markets…', develop: 'Fields, market or dikes', govern: 'Feast or tax', muster: 'Raise soldiers', train: 'Drill the troops',
  hire: 'Sign a company', dismiss: 'Pay off the company', march: 'Move or attack', supply: 'Send food and gold',
  diplomacy: 'Truce, pact, bribe, wanderers', spy: 'Scout a province', recruit: 'Win over a captive', disband: 'Send a unit home',
  study: 'Research a tech', trade: 'Buy or sell food', rest: 'Do nothing',
};
const militiaOf = pr => Array.isArray(pr.militia) ? pr.militia.reduce((a, n) => a + n, 0) : (pr.militia || 0);
const soldiersOf = pr => (pr.units || []).reduce((a, u) => a + u.soldiers, 0);
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
    else if (this.tab === 'research') this.body.append(this.researchPanel());
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
      h('div.house-tag', { '--hc': houseColor(st.player) }, crestImg(st.player, 30), h('span.n', house.short),
        st.beta?.gold ? h('span.beta-badge', { title: 'Beta tester: unlimited gold' + (st.beta.food ? ' and food' : '') + '. Change it in the menu.', onclick: () => this.app.openBeta && this.app.openBeta() }, 'Beta') : null),
      h('div.totals',
        h('span', { title: 'Provinces' }, h('i', '🏰'), t.provinces),
        h('span', { title: st.beta?.gold ? 'Gold: unlimited (beta tester)' : 'Gold (all provinces)' }, h('i', '🪙'), st.beta?.gold ? '∞' : fmt(t.gold)),
        h('span', { title: st.beta?.food ? 'Food: unlimited (beta tester)' : 'Food (all provinces)' }, h('i', '🌾'), st.beta?.food ? '∞' : fmt(t.food)),
        h('span', { title: 'Soldiers' }, h('i', '⚔'), fmt(t.soldiers)),
        shardStatus(st, st.player).length ? shardStatus(st, st.player).map(x => chargeMeter(x, true)) : h('span', { title: 'Lantern Shards' }, h('i', '◆'), 0)),
      h('div.top-actions',
        h('button.icon-btn', { title: 'Settings', onclick: () => this.app.openSettings() }, '⚙'),
        h('button.icon-btn', { title: 'Menu', onclick: () => this.app.openMenu() }, '☰'),
        h('button.btn.primary', { onclick: () => this.app.endMonth(), title: waiting ? `${waiting} province(s) have not acted` : '' },
          'End Month', waiting ? h('span', { style: { opacity: 0.7, marginLeft: '6px', fontSize: '12px' } }, `(${waiting})`) : null)),
    );
  }

  renderTabs() {
    this.tabs.innerHTML = '';
    for (const [id, label] of [['province', 'Province'], ['houses', 'Houses'], ['research', 'Research'], ['log', 'Chronicle']]) {
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
          h('div.mini', h('span', '🪙 ', h('b', fmt(p.gold))), h('span', '🌾 ', h('b', fmt(p.food))), h('span', 'Loyalty ', h('b', p.loyalty)), h('span', 'Units ', h('b', p.units.length)), h('span', 'Vassals ', h('b', p.vassals.length))))));
    }
    return frag;
  }

  // --------------------------------------------------------------- province
  provincePanel(pid) {
    const st = this.state, pr = st.provinces[pid], P = PROVINCES[pid];
    const mine = pr.owner === st.player;
    const seen = canSee(st, st.player, pid);
    const frag = h('div');
    const hasLand = !!landOf(st, pid);
    const landSeen = hasLand && (mine || seen);
    const vig = hasArt(PROVINCE_VIGNETTE(pid)) ? PROVINCE_VIGNETTE(pid) : hasArt(LAND_PANORAMA[P.terrain]) ? LAND_PANORAMA[P.terrain] : PROVINCE_VIGNETTE(pid);
    frag.append(h('div.prov-vignette', { style: { margin: '-14px -14px 10px', height: '120px', position: 'relative', backgroundImage: `url(${art(vig)})`, backgroundSize: 'cover', backgroundPosition: 'center' } },
      h('div.vig-fade'),
      landSeen ? h('button.btn.land-btn' + (mine ? '.primary' : ''), { title: mine ? 'Open the land: build farms, houses, markets…' : 'View this land',
        onclick: () => { sfx('click'); this.openLand(pid); } }, mine ? '⚒ Land' : '👁 Land') : null,
      landSeen && landQuality(st, pid) ? h('span.land-quality.q-' + landQuality(st, pid), landQuality(st, pid)) : null));
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
      pr.owner ? res('Soldiers', soldiersOf(pr)) : res('Militia', militiaOf(pr))));

    const bars = h('div.stats');
    const bar = (lbl, v, cls = '') => bars.append(h('span.lbl', lbl), h('div.bar' + (cls ? '.' + cls : ''), h('i', { style: { width: Math.min(100, v) + '%' } })), h('span', v));
    const y = hasLand ? yieldOf(st, pid) : null;
    if (y) {
      const pot = landPotential(st, pid);
      const cell = (k, v, t) => h('div.ly', { title: t || '' }, h('span', k), h('b', v));
      frag.append(h('div.parchment.land-yield', { style: { '--parchment-img': `url(${art(3)})` } },
        h('div.ly-grid',
          cell('Harvest', fmt(y.food), `Food each autumn from farms, orchards, pastures and fisheries. The land could grow about ${fmt(pot.food)}.`),
          cell('Gold', `${Math.round(y.gold * 0.6 * (0.5 + pr.loyalty / 200))}/mo`, 'Taxes, markets, mines and trade, before wages and troop pay'),
          cell('People', fmt(y.pop), 'Houses give people; buildings need hands'),
          cell('Labour', Math.round(y.labour * 100) + '%', y.labour < 1 ? 'Not enough hands: every building works slower. Build houses.' : 'Every building is fully worked'),
          cell('Muster', `${Math.max(30, Math.floor(y.musterCap / 30) * 10)}/order`, `Soldiers one muster can raise here (people: ${fmt(y.musterCap)})`),
          cell('Defence', '+' + Math.round(y.defense * 100) + '%', 'Keep and walls: defenders fight harder')),
        (bar('Dikes', pr.dikes, 'dike'), bar('Loyalty', pr.loyalty, 'loy'), bars)));
    } else {
      bar('Fields', pr.fields); bar('Market', pr.market); bar('Dikes', pr.dikes, 'dike'); bar('Loyalty', pr.loyalty, 'loy');
      frag.append(h('div.parchment', { style: { '--parchment-img': `url(${art(3)})` } }, bars));
    }

    // troop units
    const vs = provinceVassals(st, pid);
    frag.append(h('div.section-title', `Units ${pr.units.length}/${MAX_UNITS_PER_PROVINCE}`));
    if (!pr.units.length) frag.append(h('p.hint', pr.owner ? 'No troops are stationed here. Muster a unit to defend it.'
      : `${militiaOf(pr)} militia guard this free hold${Array.isArray(pr.militia) && pr.militia.length > 1 ? ` in ${pr.militia.length} bands` : ''}.`));
    for (const u of pr.units) frag.append(unitRow(st, pid, u, mine ? () => this.openAssign(pid, u.uid) : null));
    if (pr.company) {
      const c = COMPANIES[pr.company.type];
      frag.append(h('div.vassal.unit-row', h('img', { src: art(c.sprite), style: { width: '48px', height: '48px', objectFit: 'contain' } }),
        h('div', h('div.nm', c.name, h('span.slot5', '5th slot')), h('div.ti', 'Hired company'), h('div.mini', h('span', 'Soldiers ', h('b', pr.company.soldiers)), h('span', 'Wage ', h('b', c.wage + 'g/mo'))))));
    }
    // vassals
    frag.append(h('div.section-title', `Vassals ${vs.length}/${MAX_VASSALS_PER_PROVINCE}`));
    if (!vs.length) frag.append(h('p.hint', pr.owner ? 'No vassal is stationed here. Units can hold the province, but only a vassal can lead an attack.' : 'No lord rules this free hold.'));
    for (const v of vs) frag.append(vassalRow(st, v, pr.units.find(u => u.leader === v.id)));
    // Wanderers here (and, for your own provinces with a vassal, next door): invite each with one
    // click. Inviting is free of the month's order, so you can recruit several a month.
    const mineV = pr.owner === st.player && vs.length;
    const wand = mineV ? wanderersNear(st, pid) : wanderersAt(st, pid);
    if (wand.length) {
      const envoy = mineV ? envoyOf(st, pid) : null;
      frag.append(h('div.section-title', `Wanderers ${wand.length}`));
      frag.append(h('p.hint', mineV ? `Free swords here or next door. Invite as many as you like each month (${DIPLOMACY.wanderer.cost} gold in gifts each; the envoy's Charm decides; refusals make the next offer likelier).`
        : 'Free swords with no house. Invite them from a province of yours with a vassal, here or next door; some offer their service to whoever takes the province they are in.'));
      for (const w of wand) {
        const full = pr.vassals.length >= MAX_VASSALS_PER_PROVINCE;
        const btn = mineV ? h('button.btn.small', { disabled: full, title: full ? 'No room for another vassal here.' : `Chance ${pct(wandererChance(st, st.player, envoy, w))}`,
          onclick: () => { sfx('click'); const r = this.app.apply({ type: 'diplomacy', province: pid, kind: 'wanderer', vassal: w.id }); if (r && r.msg) toast?.(r.msg); this.app.refresh(); } },
          full ? 'No room' : `Invite · ${pct(wandererChance(st, st.player, envoy, w))}`) : null;
        frag.append(h('div.vassal', portrait(w.id, { size: 44 }),
          h('div', h('div.nm', VASSAL_BY_ID[w.id].name, h('span.wanderer-tag', 'wanderer'), w.location !== pid ? h('span.mini', ` · in ${PROVINCES[w.location].name}`) : null), h('div.ti', VASSAL_BY_ID[w.id].title),
            h('div.mini', h('span', 'Might ', h('b', w.might)), h('span', 'Wits ', h('b', w.wits)), h('span', 'Charm ', h('b', w.charm)),
              w.band ? h('span', `${w.band} ${TROOPS[w.troop]?.name.toLowerCase() || ''}`) : null)), btn));
      }
    }
    const marching = (st.marches || []).filter(m => m.from === pid && m.house === st.player);
    for (const m of marching) frag.append(h('div.ordered-note', { style: { marginTop: '6px' } },
      `🚩 ${m.units.length} unit(s)${m.vassals.length ? `, ${m.vassals.length} vassal(s)` : ''}${m.fifth ? ` and the ${m.fifth.kind === 'spirit' ? SPIRITS[m.fifth.id].name : COMPANIES[m.fifth.type]?.name || 'company'}` : ''} marching on ${PROVINCES[m.to].name}.`));

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

  // The build order opens the land view.
  dlg_build(pid) { this.openLand(pid); return null; }

  // Full-screen land view (js/ui/landview.js). Own land: click a tile to build (the province's
  // order for the month); foreign land: look only.
  openLand(pid) {
    const st = this.state, pr = st.provinces[pid];
    const land = landOf(st, pid);
    if (!land) return;
    const mine = pr.owner === st.player;
    const wrap = h('div.land-overlay');
    const box = h('div.land-box');
    const close = () => { view.destroy(); wrap.remove(); document.removeEventListener('keydown', onKey); this.app.refresh(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const status = h('div.land-status');
    const note = () => {
      status.textContent = !mine ? `${HOUSE_BY_ID[pr.owner]?.name || 'A free hold'}'s land: you can look, not build.` :
        `Click tiles to build: as many buildings and projects as you can pay for (building does not use the month's order) · ${st.beta?.gold ? 'unlimited gold (beta tester)' : fmt(pr.gold) + ' gold here'}.`;
    };
    wrap.append(h('div.land-bar', h('h2', `${PROVINCES[pid].name}`, landQuality(st, pid) ? h('span.land-quality.q-' + landQuality(st, pid), landQuality(st, pid)) : null), status,
      mine ? h('button.btn', { onclick: () => { sfx('click'); close(); this.app.apply({ type: 'build', province: pid, kind: 'dikes' }); }, title: 'Raise the dikes against floods (30 gold)' }, `Dikes ${pr.dikes}`) : null,
      mine && damagedCount(st, pid) ? h('button.btn', { onclick: () => {
        sfx('click'); const r = this.app.apply({ type: 'build', province: pid, kind: 'repairAll' });
        view.update(land, { ...landCtx(st, pid), realm: { goldMul: 0.6 * (0.5 + pr.loyalty / 200) }, free: mine && !!st.beta?.gold });
        status.textContent = r.msg; }, title: 'Repair every damaged building you can afford (half its cost each)' }, `Repair all (${damagedCount(st, pid)})`) : null,
      h('button.btn.primary', { onclick: close }, 'Close')), box);
    document.body.append(wrap);
    document.addEventListener('keydown', onKey);
    const view = openLandView(box, land, {
      province: PROVINCES[pid], house: pr.owner ? HOUSE_BY_ID[pr.owner] : null,
      ctx: { ...landCtx(st, pid), realm: { goldMul: 0.6 * (0.5 + pr.loyalty / 200) }, free: mine && !!st.beta?.gold }, readOnly: !mine,
      moment: this.landMoment(pid, land),
      onBuild: ({ x, y, kind }) => {
        const r = this.app.apply({ type: 'build', province: pid, x, y, kind });
        view.update(land, { ...landCtx(st, pid), realm: { goldMul: 0.6 * (0.5 + pr.loyalty / 200) }, free: mine && !!st.beta?.gold });
        if (r.ok) view.showMoment({ slot: LAND_MOMENT.building, title: 'Work begins', text: r.msg, ms: 1800 });
        note();
        return r;
      },
    });
    view.setMonth(st.month);
    note();
  }

  // The painted banner shown when a land view opens: the most notable thing about this land right
  // now (a sack, war damage, a project, the harvest, construction), each shown once per month.
  landMoment(pid, land) {
    const st = this.state, pr = st.provinces[pid], name = PROVINCES[pid].name;
    this.momentsSeen = this.momentsSeen || new Set();
    const damaged = land.d.filter(Boolean).length, building = land.c.filter(c => c > 0).length;
    const proj = land.p.find(p => p.kind === 'drain' || p.kind === 'clear');
    const q = landQuality(st, pid);
    let m = null;
    if (pr.lootedTurn != null && pr.lootedTurn >= st.turn - 1) m = { k: 'loot', slot: LAND_MOMENT.loot, title: 'A sacked town', text: `${name} was looted. Repair the markets and houses to bring it back.` };
    else if (pr.takenTurn != null && pr.takenTurn >= st.turn - 2 && damaged) m = { k: 'raid', slot: LAND_MOMENT.raid, title: 'Scars of war', text: `${damaged} building${damaged > 1 ? 's' : ''} damaged in the fighting. Click one to repair it.` };
    else if (proj) m = { k: proj.kind, slot: LAND_MOMENT[proj.kind], title: proj.kind === 'drain' ? 'Draining the marsh' : 'Clearing the forest', text: `${proj.left} month${proj.left > 1 ? 's' : ''} of work left.` };
    else if (st.month === 6) m = { k: 'harvest', slot: LAND_MOMENT.harvest, title: 'Harvest', text: `The fields of ${name} are gathered in this month.` };
    else if (building) m = { k: 'building', slot: LAND_MOMENT.building, title: 'Builders at work', text: `${building} building${building > 1 ? 's' : ''} under construction.` };
    else if (q === 'breadbasket') m = { k: 'q', slot: LAND_MOMENT.breadbasket, title: 'A breadbasket', text: `${name} is some of the richest farmland in Varenhold.` };
    else if (q === 'barren') m = { k: 'q', slot: LAND_MOMENT.barren, title: 'Hard country', text: `${name} grows little. Look to its mines, springs and pastures.` };
    if (!m) return null;
    const key = `${pid}|${st.turn}|${m.k}`;
    if (this.momentsSeen.has(key) || (m.k === 'q' && this.momentsSeen.has(`${pid}|q`))) return null;
    this.momentsSeen.add(key); if (m.k === 'q') this.momentsSeen.add(`${pid}|q`);
    return m;
  }

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

  // Free action: choose who leads a unit.
  async openAssign(pid, uid) {
    const st = this.state, pr = st.provinces[pid];
    const u = pr.units.find(x => x.uid === uid);
    if (!u) return;
    const vs = provinceVassals(st, pid);
    const choice = await modal(close => ({
      title: `Leader for the ${unitName(u).toLowerCase()}`,
      body: [h('p.hint', 'Assigning a leader is free and does not use the month\'s order. A leader adds Might to attack and defence, Wits to archery and drills; units with no leader break sooner (below 40% instead of 30%).'),
        h('div.pick-list',
          ...vs.map(v => {
            const leads = pr.units.find(x => x.leader === v.id);
            return h('button.target' + (u.leader === v.id ? '.on' : ''), { style: { display: 'grid', gridTemplateColumns: '44px 1fr', gap: '10px', alignItems: 'center' }, onclick: () => close({ vassal: v.id }) },
              portrait(v.id, { size: 40 }), h('div', h('div.nm', VASSAL_BY_ID[v.id].name), h('div.meta', `Might ${v.might} · Wits ${v.wits}` + (leads && leads !== u ? ` · now leads the ${unitName(leads).toLowerCase()}` : leads === u ? ' · leading this unit' : ''))));
          }),
          h('button.target' + (!u.leader ? '.on' : ''), { onclick: () => close({ vassal: null }) }, h('div.nm', 'No leader'), h('div.meta', 'The unit fights on its own')))],
      foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel')],
    }));
    if (!choice || choice.vassal === (u.leader ?? null)) return;
    this.app.apply({ type: 'assign', province: pid, unit: uid, vassal: choice.vassal });
  }

  dlg_muster(pid) {
    const st = this.state, pr = st.provinces[pid];
    const mo = musterOptions(st, pid);
    // target: { kind: 'new', type } or { kind: 'add', uid }
    let target = mo.canRaise ? { kind: 'new', type: 'footmen' } : mo.units[0] ? { kind: 'add', uid: mo.units[0].uid } : null;
    return modal(close => {
      const out = h('output');
      const cost = h('span');
      const range = h('input', { type: 'range', min: 10, step: 10, max: MAX_SOLDIERS });
      range.value = 100;
      const go = h('button.btn.primary', 'Muster');
      const typeOf = () => target.kind === 'new' ? target.type : pr.units.find(u => u.uid === target.uid).type;
      const room = () => target.kind === 'new' ? MAX_SOLDIERS : MAX_SOLDIERS - pr.units.find(u => u.uid === target.uid).soldiers;
      const sync = () => {
        box.querySelectorAll('.target').forEach(b => b.classList.toggle('on', b.dataset.k === (target.kind === 'new' ? 'new:' + target.type : 'add:' + target.uid)));
        const t = typeOf();
        const max = Math.max(10, Math.min(room(), musterLimit(st, pid), Math.floor(pr.gold / musterCost(t, 10, st, pr.owner, pid)) * 10));
        range.max = max;
        if (+range.value > max) range.value = max;
        out.textContent = range.value;
        const have = target.kind === 'new' ? 0 : pr.units.find(u => u.uid === target.uid).soldiers;
        cost.textContent = `${musterCost(t, +range.value, st, pr.owner, pid)} gold of ${pr.gold} · ${target.kind === 'new' ? 'new unit of ' : `${have} → ${have + +range.value} `}${TROOPS[t].name.toLowerCase()}`;
        go.disabled = musterCost(t, +range.value, st, pr.owner, pid) > pr.gold;
      };
      range.addEventListener('input', sync);
      const box = h('div');
      if (mo.canRaise) {
        box.append(h('div.field', h('label', 'Raise a new unit'), h('div.target-grid', ...mo.types.map(t =>
          h('button.target', { 'data-k': 'new:' + t.type, onclick: () => { target = { kind: 'new', type: t.type }; sync(); } },
            h('img', { src: art(TROOPS[t.type].sprite), style: { width: '100%', height: '54px', objectFit: 'contain' } }),
            h('div.nm', t.name), h('div.meta', `${t.costPer10}g per 10 · atk ${TROOPS[t.type].atk} def ${TROOPS[t.type].def}`))))));
      } else box.append(h('p.hint', `This province already has ${MAX_UNITS_PER_PROVINCE} units: reinforce one instead.`));
      if (mo.units.length) {
        box.append(h('div.field', h('label', 'Or reinforce a unit'), h('div.target-grid', ...mo.units.map(u => {
          const unit = pr.units.find(x => x.uid === u.uid), l = leaderOf(st, unit);
          return h('button.target', { 'data-k': 'add:' + u.uid, onclick: () => { target = { kind: 'add', uid: u.uid }; sync(); } },
            h('div.nm', u.name), h('div.meta', `${u.soldiers} soldiers · room ${u.room}`), h('div.meta', l ? 'Led by ' + VASSAL_BY_ID[l.id].name : 'No leader'));
        }))));
      }
      go.addEventListener('click', () => close(target.kind === 'new'
        ? { type: 'muster', province: pid, troop: target.type, soldiers: +range.value }
        : { type: 'muster', province: pid, unit: target.uid, soldiers: +range.value }));
      setTimeout(sync);
      return {
        title: 'Muster troops',
        body: [box, h('div.field', h('label', 'Soldiers'), h('div.range-row', range, out)), h('p.hint', cost)],
        foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel'), go],
      };
    }, { wide: true, backdrop: ORDER_BACKDROP.muster });
  }

  dlg_train(pid) {
    const st = this.state, pr = st.provinces[pid];
    return modal(close => ({
      title: 'Train troops',
      body: [h('p.hint', 'Drill one unit hard, or the whole garrison. A leader\'s Might speeds the drill.'),
        h('div.pick-list',
          h('button.target', { onclick: () => close({ type: 'train', province: pid }) }, h('div.nm', 'Drill every unit'), h('div.meta', `${pr.units.length} units`)),
          ...pr.units.map(u => {
            const l = leaderOf(st, u);
            return h('button.target', { style: { display: 'grid', gridTemplateColumns: '44px 1fr', gap: '10px', alignItems: 'center' }, onclick: () => close({ type: 'train', province: pid, unit: u.uid }) },
              l ? portrait(l.id, { size: 40 }) : h('img', { src: art(TROOPS[u.type]?.sprite || 63), style: { width: '40px', height: '40px', objectFit: 'contain' } }),
              h('div', h('div.nm', `${unitName(u)} (${u.soldiers})`), h('div.meta', `Training ${u.training} → ${Math.min(100, u.training + trainGain(l, techEffect(st, pr.owner, 'trainGain')))}` + (l ? ` · led by ${VASSAL_BY_ID[l.id].name}` : ' · no leader'))));
          }))],
      foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel')],
    }), { backdrop: ORDER_BACKDROP.train });
  }

  dlg_disband(pid) {
    const st = this.state, pr = st.provinces[pid];
    return modal(close => ({
      title: 'Disband a unit',
      body: [h('p.hint', 'The soldiers go home to their fields. The people are glad (loyalty +2).'),
        h('div.pick-list', ...pr.units.map(u => h('button.target', { onclick: () => close({ type: 'disband', province: pid, unit: u.uid }) },
          h('div.nm', `${unitName(u)} (${u.soldiers})`), h('div.meta', leaderOf(st, u) ? 'Led by ' + VASSAL_BY_ID[u.leader].name : 'No leader'))))],
      foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel')],
    }));
  }

  dlg_hire(pid) {
    const st = this.state, pr = st.provinces[pid];
    return modal(close => ({
      title: 'Hire a company',
      body: h('div.target-grid', ...hireOptions(st, pid).map(o => {
        const c = COMPANIES[o.type];
        return h('button.target', { disabled: !!o.disabled, title: o.disabled || c.note || '', onclick: () => close({ type: 'hire', province: pid, company: o.type }) },
          h('img', { src: art(c.sprite), style: { width: '100%', height: '70px', objectFit: 'contain', filter: o.locked ? 'grayscale(1)' : '' } }),
          h('div.nm', c.name, c.flying ? ' 🪽' : ''), h('div.meta', `${c.size} strong · atk ${c.atk} def ${c.def}${c.range > 1 ? ' · range ' + c.range : ''}`),
          h('div.meta', o.locked ? '🔒 ' + o.disabled : `${o.cost}g, then ${o.wage ? o.wage + 'g/month' : 'no wages'}`),
          c.note ? h('div.meta', { style: { fontStyle: 'italic' } }, c.note) : null);
      })),
      foot: [h('span.hint', { style: { marginRight: 'auto' } }, `Treasury: ${pr.gold} gold`), h('button.btn', { onclick: () => close(null) }, 'Cancel')],
    }), { wide: true, backdrop: ORDER_BACKDROP.hire });
  }

  dlg_march(pid) {
    const st = this.state, pr = st.provinces[pid];
    const mo = marchOptions(st, pid);
    const attackSet = new Set(mo.targets.attack), sea = new Set(mo.targets.seaLanes);
    const targets = [...mo.targets.attack, ...mo.targets.transfer];
    let to = null;
    // default: the 4 strongest units with their leaders
    let units = [...mo.units].sort((a, b) => b.power - a.power).slice(0, mo.maxUnits).map(u => u.uid);
    let extra = [];                      // vassals marching without leading a unit
    let fifth = null;                    // 'company' | 'spirit' | null
    this.app.map.setHighlights(targets);
    const leadersOf = ids => ids.map(id => mo.units.find(u => u.uid === id)?.leader).filter(Boolean);
    return modal(close => {
      const compare = h('div');
      const warn = h('div');
      const foodR = h('input', { type: 'range', min: 0, max: pr.food, step: 10, value: Math.min(pr.food, 60) });
      const foodOut = h('output', foodR.value);
      foodR.addEventListener('input', () => { foodOut.textContent = foodR.value; });
      const go = h('button.btn.primary', { disabled: true }, 'March');
      const unitBox = h('div.pick-list'), vasBox = h('div.pick-list'), fifthBox = h('div.target-grid');

      const drawUnits = () => {
        unitBox.innerHTML = '';
        for (const u of mo.units) {
          const on = units.includes(u.uid);
          const input = h('input', { type: 'checkbox', checked: on });
          input.addEventListener('change', () => {
            if (input.checked) {
              if (units.length >= mo.maxUnits) { input.checked = false; toast(`An army takes at most ${mo.maxUnits} units (plus the 5th slot).`, true); return; }
              units.push(u.uid);
            } else units = units.filter(x => x !== u.uid);
            extra = extra.filter(v => !leadersOf(units).includes(v));
            sync();
          });
          unitBox.append(h('label.pick', input,
            u.leader ? portrait(u.leader, { size: 40 }) : h('img', { src: art(TROOPS[u.type]?.sprite || 63), style: { width: '40px', height: '40px', objectFit: 'contain' } }),
            h('div', h('div.nm', { style: { fontWeight: 600 } }, `${u.name} · ${u.soldiers}`),
              h('div.hint', { style: { fontStyle: 'normal' } }, (u.leader ? `Led by ${VASSAL_BY_ID[u.leader].name}` : 'No leader') + ` · training ${u.training} · power ${fmt(u.power)}`))));
        }
        if (!mo.units.length) unitBox.append(h('p.hint', 'No troop units here.'));
      };
      const drawVassals = () => {
        vasBox.innerHTML = '';
        const leading = new Set(leadersOf(units));
        const free = mo.vassals.filter(v => !leading.has(v.id));
        for (const v of mo.vassals.filter(v => leading.has(v.id))) {
          vasBox.append(h('div.pick', h('span', '✓'), portrait(v.id, { size: 32 }), h('div', h('div.nm', VASSAL_BY_ID[v.id].name), h('div.hint', { style: { fontStyle: 'normal' } }, 'Marches with the unit they lead'))));
        }
        for (const v of free) {
          const input = h('input', { type: 'checkbox', checked: extra.includes(v.id) });
          input.addEventListener('change', () => { extra = input.checked ? [...extra, v.id] : extra.filter(x => x !== v.id); sync(); });
          vasBox.append(h('label.pick', input, portrait(v.id, { size: 32 }), h('div', h('div.nm', VASSAL_BY_ID[v.id].name),
            h('div.hint', { style: { fontStyle: 'normal' } }, v.leads ? 'Leads a unit that stays behind' : 'Not leading a unit: commands the army'))));
        }
        if (!mo.vassals.length) vasBox.append(h('p.hint', 'No vassal is here.'));
      };
      const drawFifth = () => {
        fifthBox.innerHTML = '';
        const anyVassal = leadersOf(units).length + extra.length > 0;
        const opt = (k, title, meta, pic, disabled) => {
          const b = h('button.target' + (fifth === k ? '.on' : ''), { disabled: !!disabled, title: disabled || '', onclick: () => { fifth = k; sync(); } },
            pic || null, h('div.nm', title), h('div.meta', disabled || meta));
          fifthBox.append(b);
        };
        opt(null, 'None', 'Four units only');
        const comp = mo.fifth.find(f => f.kind === 'company');
        if (comp) opt('company', COMPANIES[comp.type].name, `Hired company · ${comp.soldiers}`, h('img', { src: art(COMPANIES[comp.type].sprite), style: { width: '100%', height: '54px', objectFit: 'contain' } }));
        else opt('company', 'Company', '', null, 'No company is hired here.');
        const sp = mo.fifth.find(f => f.kind === 'spirit');
        const spirits = mo.spirits || [];
        if (sp) {
          const S = SPIRITS[sp.id], U = SPIRIT_UNIT[sp.id];
          const b = h('button.target' + (fifth === 'spirit' ? '.on' : ''), { disabled: !anyVassal, title: anyVassal ? '' : 'A vassal must march to summon it.', onclick: () => { fifth = 'spirit'; sync(); } },
            h('img', { src: art(S.art), style: { width: '100%', height: '54px', objectFit: 'cover', borderRadius: '4px', boxShadow: `0 0 10px ${S.color}` } }),
            h('div.nm', S.name), h('div.meta', anyVassal ? `Summon · atk ${U.atk} def ${U.def} · ${S.spell}` : 'A vassal must march to summon it.'),
            chargeMeter(spirits.find(x => x.id === sp.id) || { id: sp.id, charge: CHARGE_MAX, gain: chargeGain(st, st.player), ready: true }),
            h('div.meta', 'Spends the whole charge, win or lose.'));
          fifthBox.append(b);
        }
        for (const x of spirits.filter(x => !sp || x.id !== sp.id)) {
          const S = SPIRITS[x.id];
          fifthBox.append(h('button.target', { disabled: true, title: x.reason || '' },
            h('img', { src: art(S.art), style: { width: '100%', height: '54px', objectFit: 'cover', borderRadius: '4px', filter: 'saturate(.4) brightness(.7)' } }),
            h('div.nm', S.name), chargeMeter(x), h('div.meta', x.reason || '')));
        }
        if (!sp && !spirits.length) opt('spirit', 'Spirit', '', null, 'You hold no Lantern Shard.');
        if (fifth === 'spirit' && (!sp || !anyVassal)) fifth = null;
        if (fifth === 'company' && !comp) fifth = null;
      };
      const sync = () => {
        drawUnits(); drawVassals(); drawFifth();
        const vassals = [...new Set([...leadersOf(units), ...extra])];
        compare.innerHTML = ''; warn.innerHTML = '';
        const hasForce = units.length || vassals.length || fifth;
        go.disabled = to == null || !hasForce;
        if (to == null) return;
        const tp = st.provinces[to];
        if (!attackSet.has(to)) {
          go.textContent = 'Move';
          compare.append(h('p.hint', `Move to ${PROVINCES[to].name}${sea.has(to) ? ' by sea' : ''} (room for ${Math.max(0, MAX_UNITS_PER_PROVINCE - tp.units.length)} more units).`));
          return;
        }
        go.textContent = 'Attack';
        if (!vassals.length) {
          go.disabled = true;
          warn.append(h('p.warn', '⚠ An attack needs at least one vassal in command. Pick a unit with a leader, or add a vassal.'));
        }
        const ours = units.reduce((a, id) => a + (mo.units.find(u => u.uid === id)?.power || 0), 0) +
          (fifth === 'company' && pr.company ? companyPower(pr.company) : 0) +
          (fifth === 'spirit' ? spiritPower(mo.fifth.find(f => f.kind === 'spirit')?.id) : 0);
        const seen = canSee(st, st.player, to);
        const theirs = seen ? provinceDefence(st, to) : null;
        compare.append(h('div.compare',
          h('div', h('div.hint', 'Your army'), h('div.side-v', fmt(Math.round(ours)))),
          h('div', '⚔'),
          h('div', h('div.hint', PROVINCES[to].name + (sea.has(to) ? ' (by sea)' : '')), h('div.side-v', theirs == null ? '?' : fmt(Math.round(theirs))))));
        if (theirs != null) {
          const r = ours / Math.max(1, theirs);
          compare.append(h('p.hint', { style: { textAlign: 'center' } }, r > 1.6 ? 'Your captains are confident.' : r > 1.05 ? 'An even fight, slightly in your favour.' : r > 0.7 ? 'A risky battle.' : 'Your captains urge caution.'));
        }
      };
      const tg = h('div.target-grid', ...targets.map(t => {
        const tp = st.provinces[t];
        const b = h('button.target', { '--hc': houseColor(tp.owner), onclick: () => { to = t; tg.querySelectorAll('.target').forEach(x => x.classList.remove('on')); b.classList.add('on'); this.app.map.select(t); sync(); } },
          h('div.nm', PROVINCES[t].name, sea.has(t) ? ' ⛵' : ''), h('div.meta', tp.owner === st.player ? 'Your province' : (tp.owner ? HOUSE_BY_ID[tp.owner].short : 'Free hold')));
        return b;
      }));
      // provinces at peace are not attack targets; show them disabled for clarity
      const peaceful = adjacentOwnOrPeace(st, pid, targets);
      for (const t of peaceful) tg.append(h('button.target', { disabled: true }, h('div.nm', PROVINCES[t].name), h('div.meta', 'At peace')));
      go.addEventListener('click', () => close({ type: 'march', from: pid, province: pid, to, units, vassals: [...new Set([...leadersOf(units), ...extra])], fifth, food: +foodR.value }));
      setTimeout(sync);
      return {
        title: 'March from ' + PROVINCES[pid].name,
        body: [h('div.field', h('label', 'Destination'), tg),
          h('div.field', h('label', `Units (up to ${mo.maxUnits})`), unitBox),
          h('div.field', h('label', 'Vassals'), vasBox),
          h('div.field', h('label', '5th slot'), fifthBox),
          h('div.field', h('label', 'Food carried'), h('div.range-row', foodR, foodOut)), warn, compare],
        foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel'), go],
      };
    }, { wide: true }).finally(() => { this.app.map.setHighlights(null); this.app.map.select(this.selected); });
  }

  // Grain market: buy or sell food at this month's price (free action, needs a Market building).
  dlg_trade(pid) {
    const st = this.state, pr = st.provinces[pid];
    const q = quote(st), room = tradeRoom(st, pid), m = st.market;
    return modal(close => {
      const maxSell = Math.min(room, pr.food), maxBuy = Math.min(room, Math.floor(pr.gold / q.buy * 100));
      const slider = h('input', { type: 'range', min: -Math.floor(maxSell / 10) * 10, max: Math.floor(maxBuy / 10) * 10, step: 10, value: 0 });
      const out = h('output');
      const go = h('button.btn.primary', { disabled: true }, 'Trade');
      const upd = () => {
        const f = +slider.value;
        out.textContent = !f ? 'Slide left to sell, right to buy' : f > 0 ? `Buy ${f} food for ${Math.ceil(f * q.buy / 100)} gold`
          : `Sell ${-f} food for ${Math.floor(-f * q.sell / 100)} gold`;
        go.disabled = !f;
      };
      slider.addEventListener('input', upd); upd();
      go.onclick = () => close({ type: 'trade', province: pid, food: +slider.value });
      // Price chart: the last months, with the season under each bar.
      // Past prices, then the seasonal outlook for the rest of the year (faint bars).
      const hist = (m?.history || []).slice(-6);
      const ahead = [];
      for (let k = 1; hist.length + ahead.length < 12; k++) {
        const mo = (st.month + k) % 12;
        ahead.push({ month: mo, price: Math.round(BASE_PRICE * SEASON_FACTOR[mo] * 10) / 10, outlook: true });
      }
      const bars = [...hist, ...ahead];
      const hi = Math.max(...bars.map(x => x.price), q.mid) * 1.1;
      const chart = h('div.price-chart', ...bars.map((x, i) => h('div.pc-bar' + (i === hist.length - 1 ? '.now' : x.outlook ? '.outlook' : ''),
        { style: { height: `${Math.round(x.price / hi * 100)}%` }, title: x.outlook ? `${MONTHS[x.month]}: usually about ${x.price}` : `${MONTHS[x.month]}: ${x.price} gold per 100 food` },
        h('span', MONTHS[x.month].slice(0, 3)))));
      const season = SEASON_FACTOR[st.month] > 1.15 ? 'Grain is dear: the lean months before the harvest.' :
        SEASON_FACTOR[st.month] < 0.85 ? 'Grain is cheap: the harvest is in.' : 'Prices are middling.';
      return {
        title: `Grain market · ${PROVINCES[pid].name}`,
        body: [
          h('div.trade-quote', h('div', h('small', 'Buy'), h('b', `${q.buy}`), h('small', 'gold / 100 food')),
            h('div', h('small', 'Sell'), h('b', `${q.sell}`), h('small', 'gold / 100 food'))),
          h('p.hint', `${season} ${q.news ? q.news + ' ' : ''}Prices follow the seasons, with random swings; heavy buying raises next month's price and selling lowers it. Trading does not use the month's order.`),
          chart,
          h('p.hint', 'Bright: this month. Faint: the usual price in the months ahead.'),
          h('p.hint', `This province's markets can handle ${room} more food this month (${TRADE_PER_MARKET} per working Market). Stores: ${fmt(pr.food)} food, ${fmt(pr.gold)} gold.`),
          h('div.field', h('label', 'Sell ◀ ▶ Buy'), h('div.range-row', slider)), h('p', out),
        ],
        foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel'), go],
      };
    }, { backdrop: ORDER_BACKDROP.market });
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
        if (kind === 'wanderer') {
          const cands = wanderersNear(st, pid);
          if (!cands.some(v => v.id === vassal)) vassal = cands[0]?.id ?? null;
          targetsBox.append(h('div.pick-list', ...cands.map(v => h('button.target' + (v.id === vassal ? '.on' : ''), { style: { display: 'grid', gridTemplateColumns: '44px 1fr', gap: '10px', alignItems: 'center' }, onclick: () => { vassal = v.id; sync(); } },
            portrait(v.id, { size: 40 }), h('div', h('div.nm', VASSAL_BY_ID[v.id].name), h('div.meta', `${VASSAL_BY_ID[v.id].title} · in ${PROVINCES[v.location].name} · Might ${v.might} Wits ${v.wits} Charm ${v.charm}${v.band ? ` · brings ${v.band} ${TROOPS[v.troop]?.name.toLowerCase() || ''}` : ''}`))))));
          if (!cands.length) targetsBox.append(h('p.hint', 'No wanderer is in or next to this province.'));
          if (vassal) info.append(h('p.hint', `Chance ${pct(wandererChance(st, st.player, envoy, st.vassals[vassal]))}. Costs ${DIPLOMACY.wanderer.cost} gold in gifts. Each refusal makes the next offer likelier.`));
          send.disabled = !vassal;
        } else if (kind === 'bribe') {
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

  // --------------------------------------------------------------- research
  researchPanel() {
    const st = this.state, me = st.player;
    const t = techState(st, me);
    const frag = h('div');
    const pts = researchPoints(st, me);
    const focus = t.focus && canResearch(st, me, t.focus) ? TECH_BY_ID[t.focus] : null;
    frag.append(h('div.research-head', h('h2', { style: { fontSize: '18px' } }, 'Research'),
      h('span.pts', `+${pts} points a month from markets · ${t.researched.length}/${TECHS.length} known`)));
    frag.append(h('p.hint', `Click a tech to study it next. Markets earn points every month; a Study order adds ${studyPoints(0)}–${studyPoints(100)} more (the province's best Wits helps).`));
    const detail = h('div.tech-detail');
    const showDetail = tech => {
      detail.innerHTML = '';
      const known = hasTech(st, me, tech.id), cost = techCost(st, me, tech.id), prog = Math.floor(t.progress[tech.id] || 0);
      detail.append(h('div', { style: { fontWeight: 600, color: BRANCHES[tech.branch].color } }, `${BRANCHES[tech.branch].icon} ${tech.name}`),
        h('div', tech.text),
        h('div.hint', known ? 'Known.' : `${prog}/${cost} points` + (tech.requires.length ? ` · needs ${tech.requires.map(r => TECH_BY_ID[r].name).join(' and ')}` : '') +
          (!known && pts > 0 ? ` · about ${Math.ceil((cost - prog) / pts)} months from markets alone` : '')));
    };
    for (const b of BRANCH_IDS) {
      const B = BRANCHES[b];
      const box = h('div.branch');
      box.append(h('div.branch-title', { '--bc': B.color }, `${B.icon} ${B.name}`, h('small', B.blurb)));
      const graph = h('div.tech-graph');
      for (let tier = 0; tier < 5; tier++) {
        const col = h('div.tech-col');
        for (const tech of techsOf(b).filter(x => x.tier === tier)) {
          const known = hasTech(st, me, tech.id), avail = canResearch(st, me, tech.id);
          const cost = techCost(st, me, tech.id), prog = t.progress[tech.id] || 0;
          const cls = known ? '.known' : avail ? '.avail' : '.locked';
          col.append(h('button.tech-node' + cls + (focus && focus.id === tech.id ? '.focus' : ''), {
            '--bc': B.color, title: tech.text,
            onmouseenter: () => showDetail(tech),
            onclick: () => {
              showDetail(tech);
              if (!avail) return;
              const r = setResearch(st, me, tech.id);
              toast(r.msg, !r.ok); sfx('click'); this.render();
            },
          }, h('div.tn', tech.name), h('div.tc', known ? '✓ known' : avail ? `${Math.floor(prog)}/${cost}` : '🔒 ' + tech.requires.map(r => TECH_BY_ID[r].name).join(', ')),
          !known && prog > 0 ? h('div.tp', h('i', { style: { width: Math.min(100, prog / cost * 100) + '%' } })) : null));
        }
        graph.append(col);
      }
      box.append(graph);
      frag.append(box);
    }
    if (focus) showDetail(focus); else detail.append(h('div.hint', 'No research chosen: your scholars pick for you. Hover a tech for details.'));
    frag.append(h('div.section-title', focus ? 'Studying' : 'Details'), detail);
    return frag;
  }

  dlg_study(pid) {
    const st = this.state, me = st.player;
    const vs = provinceVassals(st, pid);
    const best = vs.reduce((a, v) => Math.max(a, v.wits), 0);
    const p = vs.length ? studyPoints(best) : 6;
    const t = techState(st, me);
    return modal(close => ({
      title: 'Study',
      body: [h('p.hint', `Scholars of ${PROVINCES[pid].name} add ${p} research points${vs.length ? ` (best Wits ${best})` : ' (no vassal here to guide them)'}.`),
        h('div.target-grid',
          ...(t.focus && canResearch(st, me, t.focus) ? [h('button.target.on', { onclick: () => close({ type: 'study', province: pid, tech: t.focus }) },
            h('div.nm', TECH_BY_ID[t.focus].name), h('div.meta', 'Current research'))] : []),
          ...BRANCH_IDS.map(b => {
            const n = nextInBranch(st, me, b);
            return h('button.target', { disabled: !n, '--hc': BRANCHES[b].color, onclick: () => close({ type: 'study', province: pid, branch: b }) },
              h('div.nm', `${BRANCHES[b].icon} ${BRANCHES[b].name}`), h('div.meta', n ? `Next: ${n.name} (${Math.floor(t.progress[n.id] || 0)}/${techCost(st, me, n.id)})` : 'Branch complete'));
          }))],
      foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel')],
    }), { backdrop: ORDER_BACKDROP.council });
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
          h('div.meta', alive ? `${t.provinces} provinces · ${t.units ?? 0} units · ${t.vassals} vassals · ${fmt(t.soldiers)} soldiers` : 'Fallen'),
          alive ? h('div.power-bar', h('i', { style: { width: (t.power / max * 100) + '%' } })) : null,
          t.shards.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: '3px' } }, ...shardStatus(st, hs.id).map(x => chargeMeter(x))) : null),
        h('div.rel', hs.id === st.player ? '' : relation(st, st.player, hs.id) || '')));
    }
    // Shard charge explained
    const mine = shardStatus(st, st.player);
    if (mine.length) {
      const avg = Math.round(averageLoyalty(st, st.player));
      frag.append(h('div.section-title', 'Your shards'));
      frag.append(h('p.hint', `A spirit can be summoned only with a full charge, and the summon spends it. Shards recharge each month from the average loyalty of all your provinces: (loyalty − ${CHARGE_LOYALTY_FLOOR}) ÷ 2${hasTech(st, st.player, 'attunement') ? ', +50% from Shard Attunement' : ''}. Taxes, mustering and hunger slow your spirits.`));
      for (const x of mine) {
        const S = SPIRITS[x.id];
        frag.append(h('div.charge-card', h('img', { src: art(S.art), style: { boxShadow: `0 0 10px ${S.color}` } }),
          h('div', h('div.nm', S.name, h('span', { style: { color: 'var(--muted)', fontSize: '12px', marginLeft: '6px' } }, `in ${PROVINCES[x.province].name}`)),
            chargeMeter(x), h('div.meta', x.ready ? 'Ready to summon.' : x.gain > 0 ? `Ready in about ${x.months} month${x.months > 1 ? 's' : ''}.` : `Not recharging: average loyalty ${avg} is too low.`))));
      }
      frag.append(h('p.hint', `Average loyalty ${avg} → +${chargeGain(st, st.player)} charge a month.`));
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
      list.append(h('div.log-item.' + (e.kind || 'info'), h('div.t', `${MONTHS[(e.turn) % 12]}, year ${(st.startYear || 412) + Math.floor(e.turn / 12)}`), e.text));
    }
    return list;
  }
}

// A glowing charge meter for a shard ({ id, charge, gain, ready }).
function chargeMeter(x, compact = false) {
  const S = SPIRITS[x.id];
  const tip = `${S.name}: ${x.charge}/${CHARGE_MAX}` + (x.ready ? ' · ready to summon' : x.gain > 0 ? ` · +${x.gain}/month` : ' · not recharging (loyalty too low)');
  return h('span.charge' + (x.ready ? '.ready' : ''), { '--sc': S.color, title: tip },
    h('span.gl', '◆'), h('span.cm', h('i', { style: { width: Math.min(100, x.charge / CHARGE_MAX * 100) + '%' } })),
    compact ? null : h('span', x.ready ? 'ready' : `${x.charge}/${CHARGE_MAX}${x.gain > 0 ? ` +${x.gain}/mo` : ''}`));
}

function res(k, v, d, extra) {
  return h('div.res', h('div.k', k), h('div.v', fmt(v)),
    d != null ? h('div.d' + (d > 0 ? '.pos' : d < 0 ? '.neg' : ''), (d > 0 ? '+' : '') + d + '/mo') : null,
    extra ? h('div.d', extra) : null);
}

function unitRow(st, pid, u, onAssign) {
  const t = TROOPS[u.type];
  const l = leaderOf(st, u);
  return h('div.vassal.unit-row',
    l ? portrait(l.id, { size: 48 }) : h('div.no-leader', h('img', { src: art(t?.sprite || 63), alt: '' })),
    h('div',
      h('div.nm', `${unitName(u)}`, h('span.count', u.soldiers)),
      h('div.ti', l ? `Led by ${VASSAL_BY_ID[l.id].name}` : 'No leader'),
      h('div.mini',
        h('span', 'Trn ', h('b', u.training)),
        h('span', 'Power ', h('b', fmt(Math.round(troopPower(st, u))))),
        h('div.bar.strength', h('i', { style: { width: Math.round(u.soldiers / MAX_SOLDIERS * 100) + '%' } })))),
    onAssign ? h('button.btn.small', { onclick: onAssign, title: 'Free action' }, l ? 'Change' : 'Assign') : null);
}

function vassalRow(st, v, leads) {
  const V = VASSAL_BY_ID[v.id];
  const ruler = st.houses[v.house]?.ruler === v.id;
  return h('div.vassal' + (ruler ? '.ruler' : ''),
    portrait(v.id, { size: 48 }),
    h('div',
      h('div.nm', V.name),
      h('div.ti', V.title),
      h('div.mini',
        h('span', leads ? `Leads ${unitName(leads).toLowerCase()} (${leads.soldiers})` : h('i', 'Unassigned')),
        h('span', 'Loy ', h('b', v.loyalty)),
        h('span', { title: 'Might / Wits / Charm' }, h('b', `${v.might}/${v.wits}/${v.charm}`)))));
}

// Neighbouring provinces of houses at peace with the player (shown disabled in the march dialog).
function adjacentOwnOrPeace(st, pid, already) {
  const have = new Set(already);
  return ADJ[pid].filter(t => !have.has(t) && st.provinces[t].owner && st.provinces[t].owner !== st.player &&
    atPeace(st, st.player, st.provinces[t].owner));
}

export function relation(st, a, b) {
  if (!b || a === b) return '';
  const m = st.marriages.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
  if (m && m[2] > st.turn) return `Marriage pact (${m[2] - st.turn} mo)`;
  const t = st.truces[pairKey(a, b)];
  if (t && t > st.turn) return `Truce (${t - st.turn} mo)`;
  return '';
}
