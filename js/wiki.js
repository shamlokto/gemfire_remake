// Lanternfall wiki: everything below is generated from the game's own data modules, so the
// wiki stays in step with the game. Rules text follows docs/DESIGN.md.
import { PROVINCES, ADJACENCY, MAP_W, MAP_H, PROVINCE_DEFAULTS, NEUTRAL_MILITIA, SEASONS, MONTHS, START_YEAR, SEA_LANES, isSeaLane, VICTORY_PROVINCES } from './data/world.js';
import { landShapes, LAND_PALETTE, LAND_EDGES } from './ui/landshape.js';
import { HOUSES, HOUSE_BY_ID, HOUSE_START } from './data/houses.js';
import { VASSALS, WANDERERS, HEIRS } from './data/vassals.js';
import { TECHS, TECH_BY_ID, BRANCHES, BRANCH_IDS, TECH_COST, TECH_INFLATION, techsOf } from './data/tech.js';
import { SCENARIOS } from './data/scenarios.js';
import { CHARGE_MAX, CHARGE_LOYALTY_FLOOR, CHARGE_RATE, MARKET_PER_POINT, studyPoints } from './realm/tech.js';
import { DIPLOMACY } from './realm/diplomacy.js';
import { TROOPS, COMPANIES, MILITIA, MAX_SOLDIERS, MAX_VASSALS_PER_PROVINCE, MAX_UNITS_PER_PROVINCE, MAX_UNITS_PER_ARMY, ROUT_LED, ROUT_LEADERLESS } from './data/units.js';
import { SPIRITS, SPIRIT_UNIT } from './data/spirits.js';
import { RANDOM_EVENTS, STORY } from './data/events.js';
import { TERRAIN, RESOURCE, BUILDING, PROJECT, Y as LY, potential } from './land/land.js';
import { generateLand } from './land/landgen.js';
import { SLOTS, loadArtManifest, art, hasArt, pad3, CREST, ENDING, PROVINCE_VIGNETTE, CLASH_CUTIN, SPIRIT_CUTIN, LAND_MOMENT, BATTLE_MOMENT2, HOUSE_CHARGE, LAND_BUILDING } from './data/art.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pname = id => PROVINCES[id]?.name ?? '?';
const plink = id => `<a href="#prov-${id}">${esc(pname(id))}</a>`;
const pct = x => `${Math.round(x * 100)}%`;
const signed = n => (n > 0 ? '+' : '') + n;

// Starting owner of each province.
const OWNER = Array(PROVINCES.length).fill(null);
for (const h of HOUSES) for (const p of h.provinces) OWNER[p] = h.id;

// ---------- image helper: framed <img> that degrades to an empty labelled frame ----------
function img(slot, { cls = '', style = '', alt = '', contain = false } = {}) {
  return `<figure class="frame ${contain ? 'contain' : ''} ${cls}" style="${style}" data-slot="${pad3(slot)}">` +
    `<img src="${art(slot)}" alt="${esc(alt)}" loading="lazy" onerror="this.parentNode.classList.add('broken')"></figure>`;
}

// ---------- table of contents ----------
const TOC = [];
// Painted banner behind each section heading: the first installed slot in the list wins;
// sections without art keep a plain heading.
const BANNER = {
  story: [99, 1], scenarios: [2, 1], turn: [4, 5], orders: [192, 2], economy: [313, 90], loyalty: [94, 93],
  diplomacy: [96, 180], research: [2, 91], battle: [225, 345], damage: [345, 201], winning: [222, 221],
  clashes: [205, 203], houses: [8, 185], characters: [186, 187], provinces: [317, 100], land: [317, 313],
  troops: [346, 204], companies: [359, 207], militia: [213, 94], spirits: [353, 214], events: [90, 92],
  'story-events': [97, 95], art: [1, 2],
};
const bannerSlot = id => (BANNER[id] || []).find(n => hasArt(n));
const sec = (id, title, group) => {
  TOC.push({ id, title, group });
  const b = bannerSlot(id);
  if (!b) return `<h2 id="${id}">${esc(title)}</h2>`;
  return `<div class="sec-banner"><img src="${art(b)}" alt="" loading="lazy"><h2 id="${id}">${esc(title)}</h2></div>`;
};

function buildToc() {
  let html = '', opts = '', group = null;
  for (const t of TOC) {
    if (t.group !== group) {
      group = t.group;
      html += `<div class="h">${esc(group)}</div>`;
      if (opts) opts += '</optgroup>';
      opts += `<optgroup label="${esc(group)}">`;
    }
    html += `<a href="#${t.id}" data-id="${t.id}">${esc(t.title)}</a>`;
    opts += `<option value="${t.id}">${esc(t.title)}</option>`;
  }
  $('toc').innerHTML = html;
  $('tocMobile').innerHTML = `<option value="">Contents…</option>${opts}</optgroup>`;
  $('tocMobile').addEventListener('change', e => {
    if (e.target.value) location.hash = e.target.value;
    e.target.value = '';
  });
  // highlight the section in view
  const links = new Map([...$('toc').querySelectorAll('a')].map(a => [a.dataset.id, a]));
  const io = new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) {
      links.forEach(a => a.classList.remove('on'));
      links.get(en.target.id)?.classList.add('on');
    }
  }, { rootMargin: '0px 0px -75% 0px' });
  TOC.forEach(t => { const el = $(t.id); if (el) io.observe(el); });
}

// ---------- sections ----------
function overview() {
  const p = STORY.prologue;
  return `<h1 id="top">Lanternfall</h1>
  <p class="lede">An original fantasy grand-strategy game: six houses fight over the ${PROVINCES.length} provinces of
  Varenhold and the five Lantern Shards that bind its spirits.</p>
  <figure class="frame hero" data-slot="001"><img src="${art(1)}" alt="Lanternfall key art" onerror="this.parentNode.classList.add('broken')">
  <figcaption>${esc(p.title)}</figcaption></figure>
  ${sec('story', 'The story', 'Varenhold')}
  <div class="prose-card"><p>${esc(p.text)}</p></div>
  <p>Each house starts with two provinces and a handful of vassals. Five houses hold a shard, kept in their capital; the
  Vey Marsh League has none and must take one. ${PROVINCES.length - HOUSES.reduce((a, h) => a + h.provinces.length, 0)} provinces are free holds, defended only by militia
  (${NEUTRAL_MILITIA.min}–${NEUTRAL_MILITIA.max} soldiers). Lanterncross, where the High Lantern stood, lies at the
  heart of the realm.</p>
  <p>Varenhold is a land of chokepoints. The Vey marsh peninsula touches the mainland only at Lanterncross; the Frost
  Isles, the Isle of Gulls, the Sunder Isles and Westreach are reached by a single sea lane or causeway each. Whoever
  holds the landing holds the island.</p>
  <p><b>Victory:</b> rule ${VICTORY_PROVINCES} of the ${PROVINCES.length} provinces, or hold all five shards. <b>Defeat:</b> lose your last province.</p>
  <div class="prose-card"><p><b>Beta tester mode.</b> For a breezy first playthrough, switch on <i>Beta tester</i> on the scenario or house
  screen (or in the in-game settings): your house gets unlimited gold, and unlimited food unless you turn it off, so you can muster, build, hire and
  research freely while you learn the game. Rival houses play by the normal rules. A <i>Beta</i> badge shows in the top bar, and the setting is kept in your save.</p></div>
  <figure class="frame hero" data-slot="100" style="aspect-ratio:16/6"><img src="${art(100)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('broken')">
  <figcaption>${esc(STORY.ending.title)}</figcaption></figure>`;
}

function howToPlay() {
  const months = MONTHS.map((m, i) => `<li>${esc(m)} <span style="color:var(--w-muted)">· ${SEASONS[Math.floor(i / 3)]}</span></li>`).join('');
  return `${sec('turn', 'The realm turn', 'How to play')}
  <p>One turn is one month; twelve months make a year and three months a season. The game begins in ${esc(MONTHS[0])},
  year ${START_YEAR}.</p>
  <ul class="pills">${months}</ul>
  <p>Each month you give <b>one order to every province you own</b>. Building on the land, mustering, training and
  governing need no vassal; diplomacy, spying and attacks do. Then every rival house gives its orders, marches are fought out as battles (houses take turns, starting
  from a different house each month), and finally the economy ticks: income, upkeep, the harvest and random events.</p>

  ${sec('orders', 'Orders', 'How to play')}
  <div class="xwrap"><table class="xtable">
  <tr><th>Order</th><th>What it does</th><th>Cost</th></tr>
  <tr><td><b>Build</b></td><td>Start one building or project on the province's <a href="#land">land</a> (farm, houses, market, mill, granary, temple, walls…, clearing forest, draining marsh), or raise the dikes.</td><td>20–70 gold</td></tr>
  <tr><td><b>Muster</b></td><td>Raise a new troop unit of any type, or reinforce one (max ${MAX_SOLDIERS} soldiers per unit, ${MAX_UNITS_PER_PROVINCE} units per province). New units have no leader.</td><td>troop cost per 10 soldiers; loyalty −2</td></tr>
  <tr><td><b>Train</b></td><td>Drill one unit or the whole garrison: training +10 + leader's Might / 10 (+8 with no leader), up to 100. Training multiplies damage.</td><td>—</td></tr>
  <tr><td><b>Assign leader</b></td><td>Put a vassal at the head of a unit, or take them off it. <i>Free: does not use the month's order.</i></td><td>—</td></tr>
  <tr><td><b>Disband</b></td><td>Send a unit home; loyalty +2.</td><td>—</td></tr>
  <tr><td><b>Hire / Dismiss</b></td><td>Hire one company for the province (or send it away). Some need a tech (Black Powder).</td><td>hire fee, then a monthly wage</td></tr>
  <tr><td><b>March</b></td><td>Send up to ${MAX_UNITS_PER_ARMY} units, their leaders, any other vassals, and a 5th slot (the hired company or a summoned spirit) with food to a neighbouring province, over land or by sea lane. Your own province: a transfer. Anyone else's: an attack, which needs at least one vassal in command. At most ${MAX_VASSALS_PER_PROVINCE} vassals per province.</td><td>food carried</td></tr>
  <tr><td><b>Supply</b></td><td>Send food and gold to a neighbouring province you own.</td><td>—</td></tr>
  <tr><td><b>Govern</b></td><td>Feast: 20 food for loyalty +8. Tax: gold equal to Market, loyalty −10.</td><td>food / loyalty</td></tr>
  <tr><td><b>Diplomacy</b></td><td>Truce, demand tribute, marriage pact, bribe an enemy vassal, or <a href="#wanderers">invite a wanderer</a> standing in or next to the province.</td><td>gold</td></tr>
  <tr><td><b>Study</b></td><td>Scholars add ${studyPoints(0)}–${studyPoints(100)} <a href="#research">research</a> points (best Wits in the province helps) to a branch or your current research.</td><td>—</td></tr>
  <tr><td><b>Spy</b></td><td>Reveal a province's stats and garrison.</td><td>—</td></tr>
  <tr><td><b>Recruit</b></td><td>Try to win over a captive vassal.</td><td>—</td></tr>
  <tr><td><b>Rest</b></td><td>Do nothing this month.</td><td>—</td></tr>
  </table></div>

  ${sec('economy', 'Economy, seasons and harvest', 'How to play')}
  <p>Every province earns gold each month and food once a year, at the harvest (month 7, ${esc(MONTHS[6])}).
  Loyal people work harder:</p>
  <code class="formula">gold per month  = land gold × 0.6 × (0.5 + loyalty / 200)     (taxes, markets, mines…)
harvest food    = land harvest × (0.5 + loyalty / 200)        (farms, orchards, fisheries…)
food upkeep     = Σ soldiers × troop upkeep / 100     (every month)
company wages   = paid in gold every month</code>
  <p>If food runs out, troops lose 10% of their soldiers and loyalty drops by 10. If gold runs out, hired companies
  desert. Winter is when hungry provinces break: plan the harvest to last until next autumn. At the start of winter,
  food beyond what the province can store (150, plus 200 per granary) partly spoils.</p>
  <p>New provinces start with Fields ${PROVINCE_DEFAULTS.fields}, Market ${PROVINCE_DEFAULTS.market},
  Dikes ${PROVINCE_DEFAULTS.dikes}, loyalty ${PROVINCE_DEFAULTS.loyalty}, ${PROVINCE_DEFAULTS.food} food and
  ${PROVINCE_DEFAULTS.gold} gold; each house's own provinces start better (see <a href="#houses">Houses</a>).</p>

  ${sec('loyalty', 'Loyalty and revolts', 'How to play')}
  <p>A province's loyalty drifts each month toward <code>40 + governor's Charm / 4</code>. Feasts raise it; taxes,
  mustering and hunger lower it. Below 20, the people may <a href="#ev-revolt">revolt</a>, burning half the gold
  and a third of the food.</p>
  <p>Vassals have their own loyalty to the house. A vassal below 40 may defect when an enemy bribes them, or when their
  house keeps losing battles. Rulers never defect.</p>

  ${sec('diplomacy', 'Diplomacy and captives', 'How to play')}
  <p><b>Truce</b>: neither house attacks the other for a time. <b>Tribute</b>: demand gold from a weaker neighbour.
  <b>Marriage pact</b>: a long peace, bound by a wedding. <b>Bribe</b>: buy an enemy vassal's banner.
  A diplomat's Charm decides the odds.</p>
  <p>When a province falls, its surviving defenders retreat to a neighbouring province of their house, or are captured
  if there is none. Captives can be recruited, ransomed or exiled. If a ruler is captured, the house's best vassal takes
  the throne. A house with no provinces is gone, and its vassals become the conqueror's captives.</p>`;
}

function battles() {
  const terr = [['Grass', 1, 1], ['Road', 1, 1], ['Forest', 1.25, 1], ['Hills', 1.3, 1], ['Village', 1.2, 1],
    ['Castle wall', 1.8, 1], ['Gate', 1.4, 1], ['Water / marsh', 0.8, 2], ['Mountain', '—', 'impassable (except flyers)']];
  return `${sec('battle', 'The battlefield', 'Battles')}
  <p>A battle is fought on a <b>16 × 12</b> grid drawn from the province's terrain: woods, hills, a river with a bridge,
  a road. The defender holds a 3 × 3 keep with a gate on the right; the attacker deploys on the left columns.</p>
  <p>Each side fields <b>${MAX_UNITS_PER_ARMY} troop units plus a 5th slot</b>. The 5th slot is the province's hired company,
  or a <b>summoned spirit</b> if the house holds its shard, the shard is <a href="#charge">fully charged</a>, and a vassal is present.
  A defender with more than ${MAX_UNITS_PER_ARMY} units fields its strongest ${MAX_UNITS_PER_ARMY}. Free holds defend with
  one to three bands of militia, with no leader.</p>
  <p><b>Leaders.</b> A unit led by a vassal adds the leader's Might to its blows and its defence, and Wits to its
  archery. A unit with no leader fights at base strength and breaks sooner.</p>
  <p>The battle lasts <b>15 rounds</b>. Each round the attacker moves all its units, then the defender. A unit may move
  and then strike an adjacent enemy, or shoot at one within range; archers and engines cannot move and shoot in the same
  round.</p>

  ${sec('damage', 'Damage and terrain', 'Battles')}
  <code class="formula">killed = soldiers × atk × (1 + Might/200) × (0.7 + training/333) × bonus × (0.85…1.15)
         ÷ (def × terrain defence × 10)</code>
  <p>The defender of a melee attack strikes back at half strength. Some troops have a <i>bonus</i> against others,
  such as pikes against horse.</p>
  <div class="xwrap"><table class="xtable"><tr><th>Terrain</th><th>Defence ×</th><th>Move cost</th></tr>
  ${terr.map(([n, d, m]) => `<tr><td>${n}</td><td class="num">${d}</td><td>${m}</td></tr>`).join('')}</table></div>

  ${sec('winning', 'Routing and taking the keep', 'Battles')}
  <p>A unit led by a vassal routs when it falls below ${Math.round(ROUT_LED * 100)}% of the soldiers it started with;
  a unit with no leader routs below ${Math.round(ROUT_LEADERLESS * 100)}%. Routed units leave the field. Vassals whose
  units are destroyed may be captured even if their army escapes. The attacker wins by
  holding the keep's centre square for a full round, or by routing every defender. If neither happens in 15 rounds,
  the defender wins.</p>
  ${sec('clashes', 'Clashes and summons', 'Battles')}
  <p>When two units meet, a cut-in shows the attacker's troop type; when a spirit is called, its summoning fills the screen.</p>
  <div class="places">${Object.entries(CLASH_CUTIN).map(([k, slot]) => {
    const name = TROOPS[k]?.name ?? COMPANIES[k]?.name ?? (k === 'militia' ? MILITIA.name : k);
    return `<figure class="place" style="margin:0">${img(slot, { alt: name + ' clash' })}<span>${esc(name)}</span></figure>`;
  }).join('')}</div>
  <div class="places" style="margin-top:12px">${Object.entries(SPIRIT_CUTIN).map(([k, slot]) =>
    `<a class="place" href="#spirit-${k}">${img(slot, { alt: SPIRITS[k].name + ' summoned' })}<span style="color:${SPIRITS[k].color}">${esc(SPIRITS[k].name)}</span> <i>${esc(SPIRITS[k].spell)}</i></a>`).join('')}</div>`;
}

function housesSec() {
  const cards = HOUSES.map(h => {
    const ruler = VASSALS.find(v => v.id === h.ruler);
    const st = HOUSE_START[h.id];
    const sp = h.shard ? SPIRITS[h.shard] : null;
    const count = VASSALS.filter(v => v.house === h.id).length;
    const cover = [HOUSE_CHARGE[h.id], ENDING[h.id]].find(n => hasArt(n));
    return `<div class="card house-card" id="house-${h.id}" style="--hc:${h.color}">
      ${cover ? `<div class="card-cover"><img src="${art(cover)}" alt="" loading="lazy"></div>` : ''}
      <header>${img(ruler.portrait, { style: 'width:96px;height:120px', alt: ruler.name })}
      <div style="flex:1;min-width:0"><h3><span class="swatch" style="background:${h.color}"></span>${esc(h.name)}</h3>
      <p class="motto">“${esc(h.motto)}”</p>
      <p class="role">Ruled by <a href="#v-${ruler.id}">${esc(ruler.name)}</a></p></div>
      ${img(CREST[h.id], { cls: 'crest', contain: true, alt: h.name + ' crest' })}</header>
      <p>${esc(h.blurb)}</p>
      <div class="facts"><span><b>Capital</b> ${plink(h.capital)}</span>
      <span><b>Lands</b> ${h.provinces.map(plink).join(', ')}</span>
      <span><b>Shard</b> ${sp ? `<a href="#spirit-${h.shard}">${esc(sp.name)}</a>` : 'none'}</span>
      <span><b>Vassals</b> ${count}</span></div>
      <div class="facts" style="color:var(--w-muted)"><span>Fields ${st.fields}</span><span>Market ${st.market}</span>
      <span>Food ${st.food}</span><span>Gold ${st.gold}</span><span>Loyalty ${st.loyalty}</span></div>
    </div>`;
  }).join('');
  return `${sec('houses', 'Houses', 'The realm')}<div class="cards">${cards}</div>`;
}

function bar(label, v, color) {
  return `<span>${label}</span><i style="--v:${v}%;--bc:${color}"></i><em>${v}</em>`;
}

function charactersSec() {
  const groups = HOUSES.map(h => {
    const list = VASSALS.filter(v => v.house === h.id);
    const people = list.map(v => {
      const t = TROOPS[v.troop];
      return `<div class="person" id="v-${v.id}">
        ${img(v.portrait, { style: 'width:72px;height:90px', alt: v.name })}
        <div class="who"><b>${esc(v.name)}</b>${v.id === h.ruler ? '<span class="ruler-tag">RULER</span>' : ''}
        <div class="role">${esc(v.title)}</div>
        <div class="bars">${bar('Might', v.might, '#d9614a')}${bar('Wits', v.wits, '#5aa0e0')}${bar('Charm', v.charm, '#d9a94a')}${bar('Loyalty', v.loyalty, h.color)}</div>
        <div class="troop">Starts leading ${v.soldiers} ${esc(t?.name ?? v.troop)} · at ${plink(v.at)}</div></div></div>`;
    }).join('');
    return `<details class="group" open><summary><span class="swatch" style="background:${h.color}"></span><b>${esc(h.name)}</b>
      <span>${list.length} characters</span></summary><div class="body"><div class="people">${people}</div></div></details>`;
  }).join('');
  const person = (v, extra) => `<div class="person" id="v-${v.id}">
        ${img(v.portrait, { style: 'width:72px;height:90px', alt: v.name })}
        <div class="who"><b>${esc(v.name)}</b>
        <div class="role">${esc(v.title)}</div>
        <div class="bars">${bar('Might', v.might, '#d9614a')}${bar('Wits', v.wits, '#5aa0e0')}${bar('Charm', v.charm, '#d9a94a')}</div>
        <div class="troop">${extra}</div></div></div>`;
  const wand = WANDERERS.map(v => person(v, `Wanders ${plink(v.at)} with ${v.soldiers} ${esc(TROOPS[v.troop]?.name ?? v.troop)}`)).join('');
  const heirs = HEIRS.map(v => person(v, `Heir of ${esc(HOUSE_BY_ID[v.house].short)} · comes of age in year ${START_YEAR + v.years} (scenario year + ${v.years}) with ${v.soldiers} ${esc(TROOPS[v.troop]?.name ?? v.troop)}`)).join('');
  return `${sec('characters', 'Characters', 'The realm')}
  <p>Might adds to attack and defence in battle; Wits drives development, spying, research and tactics; Charm sways diplomacy and the
  loyalty of the province a vassal governs; Loyalty is how firmly they serve their house.</p>${groups}
  ${sec('wanderers', 'Wanderers and heirs', 'The realm')}
  <p><b>Wanderers</b> are free swords with no house: ${WANDERERS.length} of them roam the free holds, and each January some drift to a
  neighbouring province. Invite one by Diplomacy (${DIPLOMACY.wanderer.cost} gold in gifts) from the province they stand in or a neighbour: the
  envoy's Charm decides, and each refusal makes the next offer likelier. When a province falls, the wanderers in it may offer their service to
  the conqueror. A wanderer who joins brings their band as a unit they lead.</p>
  <details class="group" open><summary><b>Wanderers</b><span>${WANDERERS.length} characters</span></summary><div class="body"><div class="people">${wand}</div></div></details>
  <p><b>Heirs</b>: each house has an heir who comes of age some years into the game and appears at the capital with a unit. If the house has
  fallen by then, the heir takes to the roads as a wanderer.</p>
  <details class="group"><summary><b>Heirs</b><span>${HEIRS.length} characters</span></summary><div class="body"><div class="people">${heirs}</div></div></details>`;
}

function researchSec() {
  const branches = BRANCH_IDS.map(b => {
    const B = BRANCHES[b];
    const rows = techsOf(b).map(t => `<tr id="tech-${t.id}"><td><b>${esc(t.name)}</b></td><td class="num">${TECH_COST[t.tier]}</td>
      <td>${t.requires.length ? t.requires.map(r => `<a href="#tech-${r}">${esc(TECH_BY_ID[r].name)}</a>`).join(', ') : '—'}</td><td>${esc(t.text)}</td></tr>`).join('');
    return `<details class="group" open><summary><span class="swatch" style="background:${B.color}"></span><b>${B.icon} ${esc(B.name)}</b><span>${esc(B.blurb)}</span></summary>
      <div class="body"><div class="xwrap"><table class="xtable"><thead><tr><th>Tech</th><th>Base cost</th><th>Needs</th><th>Effect</th></tr></thead><tbody>${rows}</tbody></table></div></div></details>`;
  }).join('');
  return `${sec('research', 'Research', 'How to play')}
  <p>Each house researches ${TECHS.length} techs in four branches. Every month its markets earn 1 point per ${MARKET_PER_POINT} Market across all its
  provinces, and a <b>Study</b> order adds ${studyPoints(0)}–${studyPoints(100)} more. Points go into the tech you chose on the Research tab (or one
  your scholars pick). A tech's cost is its base cost × (1 + ${TECH_INFLATION} × techs already known), so later techs cost more.</p>${branches}`;
}

function scenariosSec() {
  const cards = SCENARIOS.map(sc => {
    const lands = Object.entries(sc.owners || {}).map(([h, ps]) => `${esc(HOUSE_BY_ID[h].short)} ${ps.length}`).join(', ');
    return `<div class="card ev" id="sc-${sc.id}">${img(sc.art, { alt: sc.name })}<div><h3>${esc(sc.name)}</h3>
      <p class="role">Year ${sc.year} · ${esc(sc.difficulty || '')}</p><p>${esc(sc.blurb)}</p>
      ${lands ? `<p class="note">Changed lands: ${lands}.</p>` : ''}${sc.techs ? `<p class="note">Starting techs: ${Object.entries(sc.techs).map(([h, ts]) => `${esc(HOUSE_BY_ID[h].short)} (${ts.map(t => TECH_BY_ID[t].name).join(', ')})`).join('; ')}.</p>` : ''}
      ${sc.marriages ? `<p class="note">${sc.marriages.length} marriage pacts bind the alliances for ${sc.marriages[0][2]} months.</p>` : ''}</div></div>`;
  }).join('');
  return `${sec('scenarios', 'Scenarios', 'Varenhold')}
  <p>New Game offers ${SCENARIOS.length} starting moments of the war. Every scenario uses the same rules and victory conditions.</p>
  <div class="cards" style="grid-template-columns:minmax(0,1fr)">${cards}</div>`;
}

function provinceMap() {
  const pal = LAND_PALETTE[1];
  const { circles, polys } = landShapes();
  const layer = (grow, color) => `<g fill="${color}" stroke="${color}" stroke-linejoin="round">` +
    circles.map(c => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${(c.r + grow).toFixed(1)}"/>`).join('') +
    polys.map(p => `<polygon points="${p.pts.map(q => `${q.x},${q.y}`).join(' ')}" stroke-width="${grow * 2}"/>`).join('') + '</g>';
  const roads = LAND_EDGES.map(([a, b]) => `<line x1="${PROVINCES[a].x}" y1="${PROVINCES[a].y}" x2="${PROVINCES[b].x}" y2="${PROVINCES[b].y}" stroke="#6b5a40" stroke-width="3" stroke-dasharray="8 6"/>`).join('');
  const lanes = SEA_LANES.map(([a, b]) => {
    const A = PROVINCES[a], B = PROVINCES[b];
    const mx = (A.x + B.x) / 2 + (A.y - B.y) * 0.18, my = (A.y + B.y) / 2 + (B.x - A.x) * 0.18;
    return `<path d="M${A.x} ${A.y} Q${mx} ${my} ${B.x} ${B.y}" stroke="#eaf6ff" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round" fill="none"/>` +
      `<text x="${(A.x + 2 * mx + B.x) / 4}" y="${(A.y + 2 * my + B.y) / 4 + 6}" text-anchor="middle" class="ship">⛵</text>`;
  }).join('');
  const nodes = PROVINCES.map(p => {
    const h = OWNER[p.id] ? HOUSE_BY_ID[OWNER[p.id]] : null;
    const cap = h && h.capital === p.id;
    return `<a href="#prov-${p.id}"><g>
      <circle cx="${p.x}" cy="${p.y}" r="${cap ? 20 : 15}" fill="${h ? h.color : '#4a4033'}" stroke="${cap ? '#f3d27a' : '#1a1510'}" stroke-width="${cap ? 4 : 3}"/>
      ${cap && h.shard ? `<circle cx="${p.x}" cy="${p.y}" r="6" fill="${SPIRITS[h.shard].color}"/>` : ''}
      <text x="${p.x}" y="${p.y + 36}" text-anchor="middle">${esc(p.name)}</text></g></a>`;
  }).join('');
  const legend = HOUSES.map(h => `<span><span class="swatch" style="background:${h.color}"></span>${esc(h.short)}</span>`).join('') +
    `<span><span class="swatch" style="background:#4a4033"></span>Free hold</span><span>Gold ring: capital (dot: its shard)</span><span>⛵ dotted line: sea lane</span>`;
  return `<div class="mapbox"><svg viewBox="0 0 ${MAP_W} ${MAP_H}" role="img" aria-label="Map of Varenhold">
    <rect width="${MAP_W}" height="${MAP_H}" fill="${pal.sea[1]}" rx="10"/>
    ${layer(14, 'rgba(160,210,220,0.18)')}${layer(5, pal.coast)}${layer(3, pal.beach)}${layer(0, pal.land)}
    ${roads}${lanes}${nodes}</svg>
    <div class="legend">${legend}</div></div>`;
}

const exitsOf = id => ADJACENCY[id].length;
function routeNote(id) {
  const sea = ADJACENCY[id].filter(n => isSeaLane(id, n));
  const parts = [];
  if (exitsOf(id) === 1) parts.push('dead end');
  if (sea.length) parts.push(`sea lane to ${sea.map(n => PROVINCES[n].name).join(', ')}`);
  return parts.join(' · ');
}

function provincesSec() {
  const rows = PROVINCES.map(p => {
    const h = OWNER[p.id] ? HOUSE_BY_ID[OWNER[p.id]] : null;
    const cap = h && h.capital === p.id;
    return `<tr id="prov-${p.id}"><td class="num">${p.id}</td><td><b>${esc(p.name)}</b>${cap ? ' ★' : ''}</td><td>${p.terrain}</td>
      <td>${h ? `<span class="swatch" style="background:${h.color}"></span>${esc(h.short)}` : '<span style="color:var(--w-muted)">free hold</span>'}</td>
      <td>${cap && h.shard ? esc(SPIRITS[h.shard].name) : ''}</td>
      <td class="num">${exitsOf(p.id)}</td><td>${ADJACENCY[p.id].map(plink).join(', ')}${routeNote(p.id) ? ` <i class="dim">(${routeNote(p.id)})</i>` : ''}</td></tr>`;
  }).join('');
  return `${sec('provinces', 'Provinces', 'The realm')}${provinceMap()}
  <div class="xwrap"><table class="xtable sortable"><thead><tr><th data-k="n">#</th><th data-k="s">Province</th><th data-k="s">Terrain</th>
  <th data-k="s">Start owner</th><th data-k="s">Shard</th><th data-k="n">Exits</th><th>Neighbours</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note" style="color:var(--w-muted)">★ capital. <b>Exits</b> is the number of neighbouring provinces: a province
  with one exit is a dead end, easy to hold and easy to trap. Click a column header to sort.</p>
  <details class="group" open><summary><b>Places of Varenhold</b><span>${PROVINCES.length} vignettes</span></summary>
  <div class="body"><div class="places">${PROVINCES.map(p => {
    const h = OWNER[p.id] ? HOUSE_BY_ID[OWNER[p.id]] : null;
    return `<a class="place" href="#prov-${p.id}">${img(PROVINCE_VIGNETTE(p.id), { alt: p.name })}
      <span><span class="swatch" style="background:${h ? h.color : '#4a4033'}"></span>${esc(p.name)} <i>${p.terrain}</i></span></a>`;
  }).join('')}</div></div></details>`;
}

function bonusText(b) {
  if (!b) return '';
  return Object.entries(b).map(([k, v]) => `×${v} vs ${k}`).join(', ');
}

// Unit thumbnail: its clash painting when installed, else its sprite.
function unitThumb(key, u) {
  const c = CLASH_CUTIN[key];
  return c && hasArt(c) ? img(c, { cls: 'clash-thumb', alt: u.name }) : img(u.sprite, { cls: 'sprite', contain: true, alt: u.name });
}

function troopsSec() {
  const trow = Object.entries(TROOPS).map(([k, t]) => `<tr>
    <td>${unitThumb(k, t)}</td><td><b>${esc(t.name)}</b></td>
    <td class="num">${t.atk}</td><td class="num">${t.def}</td><td class="num">${t.move}</td><td class="num">${t.range}</td>
    <td class="num">${t.cost}</td><td class="num">${t.upkeep}</td><td>${esc(bonusText(t.bonusVs))}</td><td>${esc(t.note)}</td></tr>`).join('');
  const crow = Object.entries(COMPANIES).map(([k, c]) => {
    const traits = [bonusText(c.bonusVs), c.flying && 'flies over mountains', c.ignoresTerrain && 'ignores terrain',
      c.heals && `heals ${pct(c.heals)} of nearby troops per round`, c.requires && `needs ${TECH_BY_ID[c.requires].name}`,
      c.monster && 'monster (cheaper with Beast-Taming)', c.terrainBonus && Object.entries(c.terrainBonus).map(([t, m]) => `×${m} attack in ${t}`).join(', '),
      c.loyaltyHit && `loyalty −${c.loyaltyHit} when hired`, !c.wage && 'no wages'].filter(Boolean).join('; ');
    return `<tr><td>${unitThumb(k, c)}</td><td><b>${esc(c.name)}</b></td>
    <td class="num">${c.atk}</td><td class="num">${c.def}</td><td class="num">${c.move}</td><td class="num">${c.range}</td>
    <td class="num">${c.size}</td><td class="num">${c.hire}</td><td class="num">${c.wage}</td><td>${esc(traits)}</td></tr>`;
  }).join('');
  const m = MILITIA;
  return `${sec('troops', 'Troops', 'Armies')}
  <p>A troop unit holds up to ${MAX_SOLDIERS} soldiers and may be led by one vassal (or by no one). Cost is gold per 10 soldiers mustered; upkeep is food
  per 100 soldiers per month. Range 1 is melee.</p>
  <div class="xwrap"><table class="xtable sortable"><thead><tr><th></th><th data-k="s">Troop</th><th data-k="n">Atk</th><th data-k="n">Def</th><th data-k="n">Move</th>
  <th data-k="n">Range</th><th data-k="n">Cost</th><th data-k="n">Upkeep</th><th>Bonus</th><th>Notes</th></tr></thead><tbody>${trow}</tbody></table></div>
  ${sec('companies', 'Companies', 'Armies')}
  <p>Companies are hired for gold, one per province, and fight beside its vassals. Their size is fixed. Leave their
  wages unpaid and they desert.</p>
  <div class="xwrap"><table class="xtable sortable"><thead><tr><th></th><th data-k="s">Company</th><th data-k="n">Atk</th><th data-k="n">Def</th><th data-k="n">Move</th>
  <th data-k="n">Range</th><th data-k="n">Size</th><th data-k="n">Hire</th><th data-k="n">Wage</th><th>Traits</th></tr></thead><tbody>${crow}</tbody></table></div>
  ${sec('militia', 'Militia', 'Armies')}
  <div class="card" style="flex-direction:row;align-items:center;max-width:640px">${hasArt(CLASH_CUTIN.militia) ? img(CLASH_CUTIN.militia, { style: 'width:200px;aspect-ratio:16/7', alt: 'Militia' }) : img(m.sprite, { style: 'width:72px;height:72px', contain: true, alt: 'Militia' })}
  <p><b>${esc(m.name)}</b>: Atk ${m.atk}, Def ${m.def}, Move ${m.move}, melee. Peasants with pitchforks who defend the free
  holds, ${NEUTRAL_MILITIA.min}–${NEUTRAL_MILITIA.max} strong.</p></div>`;
}

function spiritsSec() {
  const cards = Object.entries(SPIRITS).map(([k, s]) => {
    const holder = HOUSES.find(h => h.shard === k);
    const cover = hasArt(SPIRIT_CUTIN[k]) ? SPIRIT_CUTIN[k] : null;
    return `<div class="card spirit-card${cover ? ' has-cover' : ''}" id="spirit-${k}" style="--sc:${s.color}">
      ${cover ? `<div class="card-cover"><img src="${art(cover)}" alt="" loading="lazy"></div>` : ''}
      ${img(s.art, { alt: s.name })}
      <div><h3>${esc(s.name)}</h3><p class="role">${esc(s.element)} · spell: <b>${esc(s.spell)}</b></p>
      <p>${esc(s.text)}</p>
      <p class="note">As a unit: Atk ${SPIRIT_UNIT[k].atk} · Def ${SPIRIT_UNIT[k].def} · Move ${SPIRIT_UNIT[k].move} · Range ${SPIRIT_UNIT[k].range} · essence ${SPIRIT_UNIT[k].soldiers}${SPIRIT_UNIT[k].flying ? ' · flies' : ''}</p>
      <p class="note">Shard held by ${holder ? `<a href="#house-${holder.id}">${esc(holder.name)}</a> in ${plink(holder.capital)}` : 'no one'}.</p></div>
      ${img(s.fx, { style: 'width:72px;height:72px;margin-left:auto', alt: s.spell + ' effect' })}</div>`;
  }).join('');
  return `${sec('spirits', 'Spirits', 'Armies')}
  <p>A house holding a spirit's shard can summon the spirit into a battle as the army's <b>5th unit</b>, if one of its vassals fights there.
  The spirit fights on the board like any unit, casts its spell once in that battle, and is banished (leaves the field) if its essence falls too low.
  A shard sits in its province: take the province and you take the shard. Spirits are usually stronger than hired companies, with a few rivals.</p>
  <h3 id="charge" style="margin:14px 0 6px">Shard charge</h3>
  <p>Each shard holds a <b>charge</b> from 0 to ${CHARGE_MAX}. Summoning its spirit needs a full charge and spends all of it, whether the battle is won or
  lost. Every month each shard a house holds recharges by <code>(average loyalty of all its provinces − ${CHARGE_LOYALTY_FLOOR}) × ${CHARGE_RATE}</code>:
  at loyalty 75 that is +20 a month (a summon every five months), at 55 it is +10, and at ${CHARGE_LOYALTY_FLOOR} or below the spirits sleep. Taxes,
  mustering and hunger all lower loyalty, so a house that squeezes its people loses its spirits. A captured shard starts empty.
  <a href="#tech-attunement">Shard Attunement</a> recharges 50% faster; <a href="#tech-lantern_lore">Lantern Lore</a> adds essence and leaves 20 charge after a summon;
  an enemy's <a href="#tech-warding">Warding</a> weakens your spirit against them.</p>
  <div class="cards">${cards}</div>`;
}

function effectText(e, ev) {
  const parts = [];
  const lab = { foodPct: 'food', goldPct: 'gold', soldiersPct: 'soldiers' };
  for (const [k, v] of Object.entries(e)) {
    if (lab[k]) parts.push(`${lab[k]} ${signed(Math.round(v * 100))}%`);
    else parts.push(`${k} ${signed(v)}`);
  }
  if (ev.floodable) parts.push('reduced by Dikes');
  return parts.join(', ');
}

function eventsSec() {
  const items = RANDOM_EVENTS.map(ev => `<div class="card ev" id="ev-${ev.id}">
    ${img(ev.art, { alt: ev.title })}
    <div><h3>${esc(ev.title)}</h3>
    <p class="role">${ev.chance ? `${pct(ev.chance)} per province per month in ${ev.seasons.map(s => SEASONS[s]).join(', ')}` : 'triggered when loyalty falls below 20'}</p>
    <p>${esc(ev.text.replace('{province}', 'the province'))}</p>
    <p class="note">${esc(effectText(ev.effect, ev))}</p></div></div>`).join('');
  const story = Object.entries(STORY).filter(([k]) => k !== 'prologue').map(([k, s]) => `<div class="card ev">
    ${img(s.art, { alt: s.title })}<div><h3>${esc(s.title)}</h3><p>${esc(s.text.replace(/\{(\w+)\}/g, (_, w) => `<${w}>`))}</p></div></div>`).join('');
  return `${sec('events', 'Random events', 'Chronicle')}<div class="cards" style="grid-template-columns:minmax(0,1fr)">${items}</div>
  ${sec('story-events', 'Story moments', 'Chronicle')}<div class="cards" style="grid-template-columns:minmax(0,1fr)">${story}</div>`;
}

// ---------- art gallery from docs/SHOTLIST.md ----------
const KIND_LABEL = { title: 'Title', texture: 'Texture', season: 'Season banner', scene: 'Scene', map: 'World map', fog: 'Fog',
  token: 'Map token', portrait: 'Portrait', cutin: 'Cut-in', ui: 'Battle UI', crest: 'Crest', backdrop: 'Backdrop', vignette: 'Vignette', spirit: 'Spirit', sprite: 'Sprite', terrain: 'Terrain tile', fx: 'Effect', isosprite: 'Land sprite' };

function parseShotlist(md) {
  const prompts = {}, sections = [];
  let cur = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const head = line.match(/^\*\*([A-Z][0-9]?)\. (.+?)\*\*\s*(.*)$/);
    if (head) { cur = { letter: head[1], title: head[2], note: head[3].replace(/^[—:-]\s*/, ''), slots: [] }; sections.push(cur); continue; }
    if (!cur || !/^\d/.test(line)) continue;
    const range = line.match(/^(\d+)[–-](\d+)\s+([^:]+):\s*(.+)$/);
    if (range) {
      const a = +range[1], b = +range[2];
      const items = range[4].split(range[4].includes(';') ? ';' : ',').map(s => s.trim());
      for (let i = a; i <= b; i++) { prompts[i] = `${range[3]}: ${items[i - a] ?? ''}`; cur.slots.push(i); }
      continue;
    }
    // one or more "NN text" segments on a line
    const re = /(\d{1,3})\s+(.+?)(?=\s+\d{1,3}\s+[A-Z]|$)/g;
    let m;
    while ((m = re.exec(line))) { prompts[+m[1]] = m[2].trim(); cur.slots.push(+m[1]); }
  }
  return { prompts, sections };
}

async function gallerySec() {
  let parsed = { prompts: {}, sections: [] };
  try {
    const texts = await Promise.all(['docs/SHOTLIST.md', 'docs/SHOTLIST-EXTRA.md'].map(async f => {
      const r = await fetch(f, { cache: 'no-cache' });
      return r.ok ? r.text() : '';
    }));
    parsed = parseShotlist(texts.join('\n'));
  } catch { /* offline: labels from slot kinds */ }
  if (!parsed.sections.length) parsed.sections = [{ letter: '', title: 'All slots', note: '', slots: SLOTS.map(s => s.slot) }];
  const seen = new Set(parsed.sections.flatMap(s => s.slots));
  const missing = SLOTS.map(s => s.slot).filter(n => !seen.has(n));
  if (missing.length) parsed.sections.push({ letter: '', title: 'Other slots', note: '', slots: missing });
  const filledCount = SLOTS.filter(s => hasArt(s.slot)).length;
  const bySlot = Object.fromEntries(SLOTS.map(s => [s.slot, s]));
  const html = parsed.sections.map(s => `<h3>${s.letter ? s.letter + '. ' : ''}${esc(s.title)}</h3>
    ${s.note ? `<p class="note" style="color:var(--w-muted)">${esc(s.note)}</p>` : ''}
    <div class="gallery">${s.slots.map(n => {
      const meta = bySlot[n];
      return `<div class="shot ${hasArt(n) ? 'filled' : ''}" id="art-${n}">${img(n, { contain: meta?.mode === 'cutout' || meta?.mode === 'fx' })}
      <div class="cap"><b>${pad3(n)}</b> <span class="dim">${esc(KIND_LABEL[meta?.kind] ?? '')}${meta ? ` · ${meta.w}×${meta.h}` : ''}</span><br>
      ${esc(parsed.prompts[n] ?? '')}</div></div>`;
    }).join('')}</div>`).join('');
  return `${sec('art', 'Art gallery', 'Behind the scenes')}
  <p>The game's ${SLOTS.length} images, with the prompt each one was made from (shot lists: <a href="docs/SHOTLIST.md">1–100</a>, <a href="docs/SHOTLIST-EXTRA.md">101–${SLOTS.length}</a>).
  ${filledCount} of ${SLOTS.length} slots have their final art; the rest show placeholders.</p>
  <div class="gallery-sec">${html}</div>`;
}

// ---------- sortable tables ----------
function makeSortable(root) {
  for (const table of root.querySelectorAll('table.sortable')) {
    const ths = [...table.querySelectorAll('thead th')];
    ths.forEach((th, col) => {
      if (!th.dataset.k) return;
      th.addEventListener('click', () => {
        const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
        ths.forEach(t => delete t.dataset.dir);
        th.dataset.dir = dir;
        const body = table.tBodies[0];
        const rows = [...body.rows];
        const val = r => r.cells[col].textContent.trim();
        rows.sort((a, b) => {
          const x = val(a), y = val(b);
          const c = th.dataset.k === 'n' ? (parseFloat(x) || 0) - (parseFloat(y) || 0) : x.localeCompare(y);
          return dir === 'asc' ? c : -c;
        });
        rows.forEach(r => body.appendChild(r));
      });
    });
  }
}

// ---------- the land (js/land) ----------
function landSec() {
  const pots = PROVINCES.map(p => {
    const runs = [1, 2, 3].map(seed => potential(generateLand(p.id, seed, { start: false })));
    const food = Math.round(runs.reduce((a, r) => a + r.food, 0) / runs.length);
    const gold = Math.round(runs.reduce((a, r) => a + r.gold, 0) / runs.length);
    return { p, food, gold };
  }).sort((a, b) => b.food - a.food);
  const q = f => (f >= 900 ? 'breadbasket' : f >= 500 ? 'fertile' : f >= 250 ? 'modest' : 'barren');
  const soils = TERRAIN.map(t => `<tr><td>${esc(t.name)}</td><td class="num">${t.soil ? '×' + t.soil : '—'}</td></tr>`).join('');
  const blds = BUILDING.filter(b => b.key !== 'none').map(b => `<tr><td>${LAND_BUILDING[b.key] && hasArt(LAND_BUILDING[b.key]) ? img(LAND_BUILDING[b.key], { cls: 'iso-thumb', contain: true, alt: b.name }) : ''}</td><td><b>${esc(b.name)}</b></td><td class="num">${b.cost || '—'}</td><td class="num">${b.time || '—'}</td><td class="num">${b.labour || 0}</td><td>${esc(b.text)}</td></tr>`).join('');
  const projs = Object.values(PROJECT).map(pr => `<tr><td><b>${esc(pr.name)}</b></td><td class="num">${pr.cost}</td><td class="num">${pr.time}</td><td>${esc(pr.text)}</td></tr>`).join('');
  const res = RESOURCE.filter(r => r.key !== 'none').map(r => `<li><b>${esc(r.name)}</b>: ${esc(r.text)}</li>`).join('');
  const rows = pots.map(({ p, food, gold }) => `<tr><td><a href="#prov-${p.id}">${esc(p.name)}</a></td><td>${p.terrain}</td><td class="num">${food}</td><td class="num">${gold}</td><td><span class="lq q-${q(food)}">${q(food)}</span></td></tr>`).join('');
  return `${sec('land', 'The land', 'The realm')}
  <p>Every province has its own land: a 12 × 9 grid of soil, forest, hills, rock, marsh, rivers and sea, with a few special
  resources. What a province yields comes from <b>what is built on its land</b>, so good land matters: a fully farmed river
  plain feeds several times what a rocky isle can. Each month a province may start <b>one building or project</b> (the
  <i>Build</i> order, from the <b>⚒ Land</b> button); construction takes one to three months.</p>
  <ul>
    <li><b>Farms</b> grow ${LY.farm} food × the soil; next to a river or lake they are irrigated (+${LY.irrigation * 100}%), next to a mill +${LY.millBoost * 100}%.</li>
    <li><b>People</b> come from houses (${LY.housesPop} each) and the keep. Every building needs hands: short of people, <i>all</i> the land works slower. People pay taxes and set how many soldiers one muster can raise (a third of ${LY.musterBase} + ${LY.musterPerPop} per person).</li>
    <li><b>Markets</b> earn more next to houses; beyond three, trade is saturated. <b>Granaries</b> keep food safe through winter (unstored food spoils). <b>Temples</b> raise loyalty, which drives every yield and the shards' charge.</li>
    <li><b>Keep and walls</b> make defenders fight harder (+10% for the keep, +5% per wall near it, up to +50%). <b>Pastures</b> make horse and knights cheaper, rich <b>ore</b> makes siege engines cheaper, <b>barracks</b> drill the troops every month.</li>
    <li><b>War scars the land.</b> When a province falls, the fighting damages buildings (sieges worse; farms burn first), and the conqueror may <b>loot</b> it: gold at once, but markets, houses and granaries are wrecked and loyalty falls by 25. Damaged buildings produce nothing until repaired.</li>
  </ul>
  <div class="xwrap"><table class="xtable"><tr><th>Soil</th><th>Farm ×</th></tr>${soils}</table></div>
  <div class="xwrap"><table class="xtable"><tr><th></th><th>Building</th><th>Gold</th><th>Months</th><th>Hands</th><th>Effect</th></tr>${blds}</table></div>
  <div class="xwrap"><table class="xtable"><tr><th>Project</th><th>Gold</th><th>Months</th><th>Effect</th></tr>${projs}</table></div>
  <p><b>Special resources</b></p><ul>${res}</ul>
  <h3 style="margin-top:14px">Breadbaskets and barren land</h3>
  <p>The most a province's land could grow if every soil tile were farmed (average of three maps), and the gold its
  mines, vineyards and pearl beds could add. Conquer the river plains for bread; the barren peaks and isles pay in ore.</p>
  <div class="xwrap"><table class="xtable sortable"><thead><tr><th data-k="s">Province</th><th data-k="s">Terrain</th><th data-k="n">Food potential</th><th data-k="n">Gold potential</th><th data-k="s">Land</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function main() {
  await loadArtManifest();
  const parts = [overview(), scenariosSec(), howToPlay(), researchSec(), battles(), housesSec(), charactersSec(), provincesSec(),
    landSec(), troopsSec(), spiritsSec(), eventsSec(), await gallerySec()];
  const article = $('wiki');
  article.innerHTML = parts.join('\n');
  makeSortable(article);
  buildToc();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

main().catch(err => {
  $('wiki').innerHTML = `<p>Could not build the wiki: ${esc(err.message)}</p>`;
  console.error(err);
});
