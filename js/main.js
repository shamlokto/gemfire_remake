// Lanternfall: boot, screen router, save/load, month flow.
import { HOUSES, HOUSE_BY_ID } from './data/houses.js';
import { PROVINCES, MONTHS, SEASONS, seasonOf } from './data/world.js';
import { SPIRITS } from './data/spirits.js';
import { VASSAL_BY_ID } from './data/vassals.js';
import { TROOPS, COMPANIES } from './data/units.js';
import { STORY } from './data/events.js';
import { SCENARIOS, SCENARIO_BY_ID } from './data/scenarios.js';
import { art, loadArtManifest, ENDING, BATTLE_BACKDROP, ORDER_BACKDROP } from './data/art.js';
import { newGame, ownedProvinces, houseTotals, withRng, setBeta, betaTopUp } from './realm/state.js';
import { applyLoot } from './realm/landhooks.js';
import { applyOrder } from './realm/orders.js';
import { endMonth } from './realm/turn.js';
import { MapView } from './ui/mapview.js';
import { RealmUI } from './ui/panels.js';
import { h, portrait, crestImg, houseColor } from './ui/portraits.js';
import { modal, eventCard, toast, confirmBox, monthCurtain, hideCurtain, wait } from './ui/events.js';
import { initAudio, playMusic, playSting, stopMusic, sfx, musicForSeason, setMusicVolume, setSfxVolume, setMuted, getAudioSettings } from './ui/audio.js';

const SAVE_KEY = n => `lanternfall.save.${n}`;
const AUTO_KEY = 'lanternfall.autosave';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const app = {
  state: null,
  screens: {},
  map: null,
  ui: null,
  busy: false,

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('active', k === name);
    this.current = name;
    if (this.map) this.map.active = name === 'realm';
  },

  select(pid) { this.map.select(pid); this.ui.select(pid); },

  refresh() { this.map.setState(this.state); this.ui.render(); },

  apply(order) {
    order.house = this.state.player;
    const r = applyOrder(this.state, order);
    if (!r.ok) { sfx('error'); toast(r.msg, true); return r; }
    sfx(order.type === 'march' ? 'march' : order.type === 'develop' || order.type === 'build' || order.type === 'hire' ? 'coin' : 'click');
    toast(r.msg, r.success === false);
    if (r.report) showSpyReport(r.report);
    this.refresh();
    return r;
  },

  async endMonth() {
    if (this.busy) return;
    const st = this.state;
    const idle = ownedProvinces(st, st.player).filter(p => !p.ordered).length;
    if (idle && !(await confirmBox('End the month?', `${idle} of your provinces have not acted. End the month anyway?`, 'End month', 'Keep ordering'))) return;
    this.busy = true;
    try {
      sfx('chime');
      await monthCurtain(`${MONTHS[st.month]} ends`, 'The houses make their moves…', 700);
      const summary = await endMonth(st, { resolveBattle: (input, s, ctx) => this.fight(input, ctx) });
      autosave();
      hideCurtain();
      if (this.current !== 'realm') this.show('realm');
      // Events
      const evs = st.pendingEvents.splice(0);
      for (const ev of evs) {
        if (ev.kind === 'loot') {
          // Sack a conquered province or spare it (js/realm/landhooks.js applyLoot).
          const choice = await eventCard({ ...ev, choices: [{ label: 'Loot it', value: 'loot' }, { label: 'Spare it', value: 'spare' }] });
          if (choice === 'loot' && st.provinces[ev.province].owner === st.player) {
            const r = withRng(st, rng => applyLoot(st, ev.province, rng));
            sfx('coin');
            await eventCard({ art: 316, title: 'Sacked', text: `Your soldiers carry off ${r.gold} gold from ${PROVINCES[ev.province].name}. Markets, houses and granaries lie in ruin, and the people will not forget.` });
          }
          continue;
        }
        await eventCard(ev);
      }
      if (st.winner || st.defeated) { this.endGame(); return; }
      await monthCurtain(MONTHS[st.month], `${SEASONS[seasonOf(st.month)]}, year ${st.year}`, 1000);
      hideCurtain();
      playMusic(musicForSeason(st.month));
      this.refresh();
    } catch (e) {
      console.error(e);
      hideCurtain();
      toast('Something went wrong: ' + e.message, true, 6000);
      this.refresh();
    } finally {
      this.busy = false;
    }
  },

  // Called by turn.js for battles involving the player.
  async fight(input, ctx) {
    const st = this.state;
    const playerSide = input.attacker.house === st.player ? 'attacker' : 'defender';
    hideCurtain();
    playMusic(playerSide === 'attacker' ? 'battle_attack' : 'battle_defend', { fade: 0.8 });
    sfx('battle');
    const root = this.screens.battle;
    root.innerHTML = '';
    root.style.backgroundImage = `url(${art(BATTLE_BACKDROP[input.terrain] || 107)})`;
    this.show('battle');
    let result;
    try {
      const bv = await import('./ui/battleview.js');
      result = await bv.runBattle(root, input, { seed: ctx.seed, playerSide, houses: HOUSE_BY_ID, onLog: () => {} });
    } catch (e) {
      console.warn('battle view unavailable, auto-resolving', e);
      result = await autoBattleShim(input, ctx.seed, playerSide, root);
    }
    const won = result.winner === playerSide;
    playSting(won ? 'battle_won' : 'battle_lost');
    root.innerHTML = '';
    this.show('realm');
    await monthCurtain(won ? 'Victory' : 'Defeat', `${PROVINCES[input.provinceId].name}`, 1200);
    return result;
  },

  endGame() {
    const st = this.state;
    const won = st.winner === st.player;
    store.del(AUTO_KEY);
    const scr = this.screens.end;
    scr.innerHTML = '';
    const slot = won ? (ENDING[st.player] || STORY.victory.art) : st.winner ? STORY.defeat.art : STORY.defeat.art;
    const title = won ? STORY.victory.title : STORY.defeat.title;
    const text = won ? STORY.victory.text.replace('{house}', HOUSE_BY_ID[st.player].name)
      : st.winner ? `${HOUSE_BY_ID[st.winner].name} has taken Varenhold. Your house bends the knee.`
        : STORY.defeat.text.replace('{house}', HOUSE_BY_ID[st.player].short);
    scr.append(h('div.bgimg', { style: { backgroundImage: `url(${art(slot)})` } }),
      h('div.end-inner', crestImg(st.player, 90), h('h1', title), h('p', text),
        won ? h('p', { style: { fontStyle: 'italic' } }, STORY.ending.text) : null,
        h('p', { style: { color: 'var(--muted)' } }, `Year ${st.year}, ${MONTHS[st.month]} · ${ownedProvinces(st, st.player).length} provinces`),
        h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '18px' } },
          h('button.btn.primary.big', { onclick: () => toTitle() }, 'Return to title'))));
    this.show('end');
    playMusic(won ? 'victory' : 'defeat', { fade: 0.5 });
  },

  openSettings() { openSettings(); },
  openBeta() { openBeta(); },
  openMenu() { openMenu(); },
};

// ------------------------------------------------------------------ fallback battle
async function autoBattleShim(input, seed, playerSide, root) {
  const { autoResolve } = await import('./battle/auto.js');
  const result = await autoResolve(input, seed);
  const won = result.winner === playerSide;
  root.append(h('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.6)' } },
    h('div.modal', { style: { padding: '20px' } }, h('h2', won ? 'Victory' : 'Defeat'),
      h('p', `The battle for ${PROVINCES[input.provinceId].name} is decided in ${result.rounds} rounds.`))));
  await wait(1500);
  return result;
}

function showSpyReport(r) {
  const P = PROVINCES[r.province];
  modal(close => ({
    title: `Spies report: ${P.name}`,
    body: [h('p', `${r.owner ? HOUSE_BY_ID[r.owner].name : 'Free hold'} · gold ${r.gold} · food ${r.food} · loyalty ${r.loyalty}`),
      (Array.isArray(r.militia) ? r.militia.length : r.militia) ? h('p', `Militia: ${Array.isArray(r.militia) ? r.militia.join(' + ') : r.militia}`) : null,
      ...(r.units || []).map(u => h('div.vassal', u.leader ? portrait(u.leader, { size: 40 }) : h('div', { style: { width: '40px', textAlign: 'center' } }, '⚔'),
        h('div', h('div.nm', `${TROOPS[u.type]?.name || u.type} · ${u.soldiers}`), h('div.mini', `training ${u.training} · ${u.leader ? 'led by ' + (VASSAL_BY_ID[u.leader]?.name || '') : 'no leader'}`)))),
      r.company ? h('p', `Company: ${COMPANIES[r.company.type]?.name || r.company.type} (${r.company.soldiers})`) : null,
      r.shard ? h('p', `It holds the ${SPIRITS[r.shard].name} shard.`) : null,
      ...r.vassals.map(v => h('div.vassal', portrait(v.id, { size: 40 }), h('div', h('div.nm', VASSAL_BY_ID[v.id]?.name || ''), h('div.mini', `Might ${v.might} · Wits ${v.wits} · loyalty ${v.loyalty}`))))],
    foot: [h('button.btn.primary', { onclick: () => close() }, 'Close')],
  }), { backdrop: ORDER_BACKDROP.spy });
}

// ------------------------------------------------------------------ save / load
function saveMeta(st) {
  return { house: st.player, year: st.year, month: st.month, turn: st.turn, provinces: ownedProvinces(st, st.player).length, scenario: st.scenario || 'eclipse', savedAt: Date.now() };
}
function writeSave(key, st) {
  return store.set(key, JSON.stringify({ meta: saveMeta(st), state: st }));
}
function readSave(key) {
  const raw = store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function autosave() { if (app.state && !app.state.winner && !app.state.defeated) writeSave(AUTO_KEY, app.state); }

function slotLabel(meta) {
  if (!meta) return 'Empty';
  const hs = HOUSE_BY_ID[meta.house];
  const sc = meta.scenario && meta.scenario !== 'eclipse' ? ` · ${SCENARIO_BY_ID[meta.scenario]?.name || meta.scenario}` : '';
  return `${hs ? hs.short : meta.house}${sc} · ${MONTHS[meta.month]} ${meta.year} · ${meta.provinces} provinces · ${new Date(meta.savedAt).toLocaleString()}`;
}

function saveLoadDialog(mode) {
  return modal(close => {
    const rows = [];
    const keys = mode === 'load' ? [AUTO_KEY, SAVE_KEY(1), SAVE_KEY(2), SAVE_KEY(3)] : [SAVE_KEY(1), SAVE_KEY(2), SAVE_KEY(3)];
    for (const k of keys) {
      const s = readSave(k);
      const name = k === AUTO_KEY ? 'Autosave' : 'Slot ' + k.slice(-1);
      rows.push(h('div.save-slot', h('div', h('div.display', name), h('div.meta', slotLabel(s?.meta))),
        mode === 'load'
          ? h('button.btn' + (s ? '.primary' : ''), { disabled: !s, onclick: () => close(s.state) }, 'Load')
          : h('button.btn.primary', { onclick: () => { if (writeSave(k, app.state)) { toast('Saved to ' + name); close(true); } else toast('Could not save (storage blocked).', true); } }, 'Save')));
    }
    return { title: mode === 'load' ? 'Load game' : 'Save game', body: rows, foot: [h('button.btn', { onclick: () => close(null) }, 'Cancel')] };
  });
}

// ------------------------------------------------------------------ beta tester mode
// Like the Earth Light expansion's beta switch: on by default for new games, remembered per browser.
const BETA_PREF = 'lanternfall.beta';
function betaPref() {
  try { const v = JSON.parse(localStorage.getItem(BETA_PREF) || 'null'); if (v && typeof v === 'object') return { gold: !!v.gold, food: !!v.food }; } catch { /* storage blocked */ }
  return { gold: true, food: true };
}
function saveBetaPref(v) { try { localStorage.setItem(BETA_PREF, JSON.stringify(v)); } catch { /* storage blocked */ } }
function betaToggles(get, set) {
  const v = get();
  const g = h('input', { type: 'checkbox', checked: v.gold });
  const f = h('input', { type: 'checkbox', checked: v.food, disabled: !v.gold });
  g.addEventListener('change', () => { f.disabled = !g.checked; if (!g.checked) f.checked = false; else if (!get().gold) f.checked = true; set({ gold: g.checked, food: g.checked && f.checked }); });
  f.addEventListener('change', () => set({ gold: g.checked, food: g.checked && f.checked }));
  return h('div.beta-box',
    h('label.beta-row', g, h('span', h('b', 'Beta tester'), ' — unlimited gold for your house: muster, build, hire and research freely.')),
    h('label.beta-row.sub', f, h('span', 'Unlimited food too')));
}

// ------------------------------------------------------------------ menus
function openMenu() {
  modal(close => ({
    title: 'Menu',
    body: h('div.menu', { style: { margin: '0 auto' } },
      h('button.btn', { onclick: async () => { close(); await saveLoadDialog('save'); } }, 'Save game'),
      h('button.btn', { onclick: async () => { close(); const s = await saveLoadDialog('load'); if (s) startGame(s); } }, 'Load game'),
      h('button.btn', { onclick: () => { close(); openSettings(); } }, 'Sound settings'),
      h('button.btn', { onclick: () => { close(); openBeta(); } }, 'Beta tester…'),
      h('a.btn', { href: 'wiki.html', target: '_blank', rel: 'noopener', style: { textAlign: 'center', textDecoration: 'none' } }, 'Open the wiki'),
      h('button.btn', { onclick: async () => { close(); if (await confirmBox('Quit to title?', 'Your progress is autosaved each month.')) toTitle(); } }, 'Quit to title')),
    foot: [h('button.btn.primary', { onclick: () => close() }, 'Resume')],
  }));
}

function openBeta() {
  const st = app.state;
  modal(close => ({
    title: 'Beta tester',
    body: [h('p.hint', 'For a breezy playthrough: your treasury (and granaries) never run dry. Costs are still shown. Computer houses play by the normal rules.'),
      betaToggles(() => ({ gold: !!st.beta?.gold, food: !!st.beta?.food }), v => { setBeta(st, v.gold, v.food); saveBetaPref(v); app.refresh(); })],
    foot: [h('button.btn.primary', { onclick: () => close() }, 'Done')],
  }));
}

function openSettings() {
  const s = getAudioSettings();
  modal(close => {
    const row = (label, val, set) => {
      const r = h('input', { type: 'range', min: 0, max: 100, value: Math.round(val * 100) });
      const o = h('output', Math.round(val * 100));
      r.addEventListener('input', () => { o.textContent = r.value; set(r.value / 100); });
      return h('div.settings-row', h('label', label), r, o);
    };
    const mute = h('input', { type: 'checkbox', checked: s.muted });
    mute.addEventListener('change', () => setMuted(mute.checked));
    return {
      title: 'Sound',
      body: [row('Music', s.music, setMusicVolume), row('Effects', s.sfx, v => { setSfxVolume(v); sfx('click'); }),
        h('label.pick', { style: { gridTemplateColumns: 'auto 1fr' } }, mute, 'Mute all sound')],
      foot: [h('button.btn.primary', { onclick: () => close() }, 'Done')],
    };
  });
}

// ------------------------------------------------------------------ screens
function buildTitle() {
  const scr = app.screens.title;
  const hasAuto = !!readSave(AUTO_KEY);
  scr.innerHTML = '';
  scr.append(
    h('div.title-bg', { style: { backgroundImage: `url(${art(1)})` } }),
    h('div.title-inner',
      h('div.logo', 'Lanternfall'),
      h('div.tagline', 'Six houses. Five bound spirits. One shattered lantern.'),
      h('div.menu',
        h('button.btn.primary.big', { onclick: () => { sfx('click'); buildScenarios(); app.show('scenario'); playMusic('select'); } }, 'New Game'),
        h('button.btn.big', { disabled: !hasAuto, onclick: () => { const s = readSave(AUTO_KEY); if (s) startGame(s.state); } }, 'Continue'),
        h('button.btn.big', { onclick: async () => { const s = await saveLoadDialog('load'); if (s) startGame(s); } }, 'Load'),
        h('button.btn.ghost', { onclick: () => openSettings() }, 'Sound settings'))),
    h('div.title-foot', h('a', { href: 'wiki.html' }, 'Wiki'), '·', h('span', 'An original game of the Varenhold realm')));
}

// Scenario select: New Game -> scenario -> house.
function buildScenarios() {
  const scr = app.screens.scenario;
  scr.innerHTML = '';
  const grid = h('div.scenario-grid');
  for (const sc of SCENARIOS) {
    const big = Object.entries(sc.owners || {}).sort((a, b) => b[1].length - a[1].length).slice(0, 3)
      .map(([id, ps]) => h('span.chip', { style: { borderColor: HOUSE_BY_ID[id].color } }, HOUSE_BY_ID[id].short, ' ', h('b', ps.length)));
    grid.append(h('button.scenario-card', { onclick: () => { sfx('click'); buildSelect(sc.id); app.show('select'); }, onmouseenter: () => sfx('hover') },
      h('div.sc-art', { style: { backgroundImage: `url(${art(sc.art)})` } }, h('span.sc-year', `Year ${sc.year}`)),
      h('div.sc-body',
        h('h3', sc.name),
        h('div.sc-diff', sc.difficulty || ''),
        h('p.blurb', sc.blurb),
        big.length ? h('div.facts', ...big) : null)));
  }
  scr.append(h('div.bgimg', { style: { backgroundImage: `url(${art(2)})` } }),
    h('div.select-inner', h('h2', 'Choose a scenario'), h('p.sub', 'The same realm at different moments of the war.'), grid,
      betaToggles(betaPref, saveBetaPref),
      h('div.select-actions', h('button.btn', { onclick: () => toTitle() }, 'Back'))));
}

function buildSelect(scenarioId = 'eclipse') {
  const sc = SCENARIO_BY_ID[scenarioId] || SCENARIOS[0];
  const scr = app.screens.select;
  scr.innerHTML = '';
  const grid = h('div.house-grid');
  for (const hs of HOUSES) {
    const shard = hs.shard ? SPIRITS[hs.shard] : null;
    const lands = sc.owners?.[hs.id] || hs.provinces;
    grid.append(h('button.house-card', { '--hc': hs.color, onclick: () => chooseHouse(hs.id, sc.id), onmouseenter: () => sfx('hover') },
      h('div', { style: { position: 'relative' } }, portrait(hs.ruler, { size: 120 }),
        h('div', { style: { position: 'absolute', right: '-8px', bottom: '-8px' } }, crestImg(hs.id, 44))),
      h('div',
        h('h3', hs.name),
        h('div.motto', `“${hs.motto}”`),
        h('p.blurb', hs.blurb),
        h('div.facts',
          h('span.chip', 'Seat ', h('b', PROVINCES[hs.capital].name)),
          h('span.chip', 'Lands ', h('b', lands.length > 3 ? `${lands.length} provinces` : lands.map(p => PROVINCES[p].name).join(', '))),
          h('span.chip', { style: shard ? { borderColor: shard.color } : {} }, shard ? ['◆ ', h('b', shard.name)] : 'No shard')))));
  }
  scr.append(h('div.bgimg', { style: { backgroundImage: `url(${art(2)})` } }),
    h('div.select-inner', h('h2', 'Choose your house'), h('p.sub', `${sc.name}, year ${sc.year}. ${sc.id === 'eclipse' ? 'Each house begins with two provinces and its own strengths.' : sc.difficulty}`), grid,
      betaToggles(betaPref, saveBetaPref),
      h('div.select-actions', h('button.btn', { onclick: () => { buildScenarios(); app.show('scenario'); } }, 'Back'))));
}

async function chooseHouse(id, scenarioId = 'eclipse') {
  sfx('click');
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const st = newGame(id, seed, scenarioId);
  const b = betaPref();
  if (b.gold) setBeta(st, true, b.food);
  startGame(st);
}

function startGame(st) {
  app.state = st;
  app.show('realm');
  if (!app.map) {
    app.ui = new RealmUI(app.screens.realm, app);
    app.map = new MapView(app.ui.mapwrap, { onSelect: pid => { sfx('click'); app.select(pid); } });
  }
  app.ui.selected = null;
  app.map.select(null);
  app.refresh();
  const cap = st.houses[st.player].capital;
  setTimeout(() => { app.map.fit(); if (window.innerWidth < 820) app.map.centerOn(cap); app.select(cap); }, 60);
  playMusic(musicForSeason(st.month));
  autosave();
  // Pending events (prologue on a new game)
  (async () => {
    await wait(500);
    const evs = st.pendingEvents.splice(0);
    for (const ev of evs) await eventCard(ev);
  })();
}

function toTitle() {
  buildTitle();
  app.show('title');
  playMusic('title');
}

// ------------------------------------------------------------------ boot
async function boot() {
  const root = document.getElementById('app');
  for (const name of ['title', 'scenario', 'select', 'realm', 'battle', 'end']) {
    const el = h(`section.screen.${name}-screen`);
    root.append(el);
    app.screens[name] = el;
  }
  app.screens.battle.style.backgroundSize = 'cover';
  app.screens.battle.style.backgroundPosition = 'center';
  await loadArtManifest();
  initAudio();
  buildTitle();
  app.show('title');
  playMusic('title');
  document.addEventListener('click', e => { if (e.target.closest('.btn')) sfx('click'); }, true);
  window.lanternfall = app;   // for debugging and tests
}

boot();
