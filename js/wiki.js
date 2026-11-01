// Lanternfall wiki: everything below is generated from the game's own data modules, so the
// wiki stays in step with the game. Rules text follows docs/DESIGN.md.
import { PROVINCES, ADJACENCY, MAP_W, MAP_H, PROVINCE_DEFAULTS, NEUTRAL_MILITIA, SEASONS, MONTHS, START_YEAR } from './data/world.js';
import { HOUSES, HOUSE_BY_ID, HOUSE_START } from './data/houses.js';
import { VASSALS } from './data/vassals.js';
import { TROOPS, COMPANIES, MILITIA, MAX_SOLDIERS, MAX_VASSALS_PER_PROVINCE } from './data/units.js';
import { SPIRITS } from './data/spirits.js';
import { RANDOM_EVENTS, STORY } from './data/events.js';
import { SLOTS, loadArtManifest, art, hasArt, pad3, CREST, PROVINCE_VIGNETTE, CLASH_CUTIN, SPIRIT_CUTIN } from './data/art.js';

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
const sec = (id, title, group) => { TOC.push({ id, title, group }); return `<h2 id="${id}">${esc(title)}</h2>`; };

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
  Vey Marsh League has none and must take one. Twelve provinces are free holds, defended only by militia
  (${NEUTRAL_MILITIA.min}–${NEUTRAL_MILITIA.max} soldiers). Lanterncross, where the High Lantern stood, lies at the
  heart of the realm.</p>
  <p><b>Victory:</b> rule 18 provinces, or hold all five shards. <b>Defeat:</b> lose your last province.</p>
  <figure class="frame hero" data-slot="100" style="aspect-ratio:16/6"><img src="${art(100)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('broken')">
  <figcaption>${esc(STORY.ending.title)}</figcaption></figure>`;
}

function howToPlay() {
  const months = MONTHS.map((m, i) => `<li>${esc(m)} <span style="color:var(--w-muted)">· ${SEASONS[Math.floor(i / 3)]}</span></li>`).join('');
  return `${sec('turn', 'The realm turn', 'How to play')}
  <p>One turn is one month; twelve months make a year and three months a season. The game begins in ${esc(MONTHS[0])},
  year ${START_YEAR}.</p>
  <ul class="pills">${months}</ul>
  <p>Each month you give <b>one order to every province you own</b>. A province with no vassal in it can only Develop
  or Govern. Then every rival house gives its orders, marches are fought out as battles (houses take turns, starting
  from a different house each month), and finally the economy ticks: income, upkeep, the harvest and random events.</p>

  ${sec('orders', 'Orders', 'How to play')}
  <div class="xwrap"><table class="xtable">
  <tr><th>Order</th><th>What it does</th><th>Cost</th></tr>
  <tr><td><b>Develop</b></td><td>Raise Fields (food), Market (gold) or Dikes (flood defence) by 4 + governor's Wits / 20, up to 100.</td><td>30 gold</td></tr>
  <tr><td><b>Muster</b></td><td>Add soldiers to a vassal's troop (max ${MAX_SOLDIERS} per vassal).</td><td>troop cost per 10 soldiers; loyalty −2</td></tr>
  <tr><td><b>Train</b></td><td>Training +10 + Might / 10, up to 100. Training multiplies damage.</td><td>—</td></tr>
  <tr><td><b>Hire / Dismiss</b></td><td>Hire one company for the province (or send it away).</td><td>hire fee, then a monthly wage</td></tr>
  <tr><td><b>March</b></td><td>Move vassals (and the company) with food to a neighbouring province. Your own province: a transfer. Anyone else's: an attack. At most ${MAX_VASSALS_PER_PROVINCE} vassals per province.</td><td>food carried</td></tr>
  <tr><td><b>Supply</b></td><td>Send food and gold to a neighbouring province you own.</td><td>—</td></tr>
  <tr><td><b>Govern</b></td><td>Feast: 20 food for loyalty +8. Tax: gold equal to Market, loyalty −10.</td><td>food / loyalty</td></tr>
  <tr><td><b>Diplomacy</b></td><td>Truce, demand tribute, marriage pact, or bribe an enemy vassal.</td><td>gold</td></tr>
  <tr><td><b>Spy</b></td><td>Reveal a province's stats and garrison.</td><td>—</td></tr>
  <tr><td><b>Recruit</b></td><td>Try to win over a captive vassal.</td><td>—</td></tr>
  <tr><td><b>Rest</b></td><td>Do nothing this month.</td><td>—</td></tr>
  </table></div>

  ${sec('economy', 'Economy, seasons and harvest', 'How to play')}
  <p>Every province earns gold each month and food once a year, at the harvest (month 7, ${esc(MONTHS[6])}).
  Loyal people work harder:</p>
  <code class="formula">gold per month  = Market × 0.6 × (0.5 + loyalty / 200)
harvest food    = Fields × 6 × (0.5 + loyalty / 200)
food upkeep     = Σ soldiers × troop upkeep / 100     (every month)
company wages   = paid in gold every month</code>
  <p>If food runs out, troops lose 10% of their soldiers and loyalty drops by 10. If gold runs out, hired companies
  desert. Winter is when hungry provinces break: plan the harvest to last until next autumn.</p>
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
  a road. The defender holds a 3 × 3 keep with a gate on the right; the attacker deploys on the left columns. Each side
  brings up to five vassal-led troops, plus the province's company, plus a spirit if the house holds a shard and has not
  called it yet this season. Free holds defend with militia.</p>
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
  <p>A unit that falls below 15% of the soldiers it started with routs and leaves the field. The attacker wins by
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
    return `<div class="card house-card" id="house-${h.id}" style="--hc:${h.color}">
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
        <div class="troop">${v.soldiers} ${esc(t?.name ?? v.troop)} · at ${plink(v.at)}</div></div></div>`;
    }).join('');
    return `<details class="group" open><summary><span class="swatch" style="background:${h.color}"></span><b>${esc(h.name)}</b>
      <span>${list.length} characters</span></summary><div class="body"><div class="people">${people}</div></div></details>`;
  }).join('');
  return `${sec('characters', 'Characters', 'The realm')}
  <p>Might adds to attack and defence in battle; Wits drives development, spying and tactics; Charm sways diplomacy and the
  loyalty of the province a vassal governs; Loyalty is how firmly they serve their house.</p>${groups}`;
}

function provinceMap() {
  const lines = [];
  ADJACENCY.forEach((ns, a) => ns.forEach(b => {
    if (b > a) lines.push(`<line x1="${PROVINCES[a].x}" y1="${PROVINCES[a].y}" x2="${PROVINCES[b].x}" y2="${PROVINCES[b].y}" stroke="#6b5a40" stroke-width="3" stroke-dasharray="8 6"/>`);
  }));
  const nodes = PROVINCES.map(p => {
    const h = OWNER[p.id] ? HOUSE_BY_ID[OWNER[p.id]] : null;
    const cap = h && h.capital === p.id;
    return `<a href="#prov-${p.id}"><g>
      <circle cx="${p.x}" cy="${p.y}" r="${cap ? 22 : 16}" fill="${h ? h.color : '#4a4033'}" stroke="${cap ? '#f3d27a' : '#1a1510'}" stroke-width="${cap ? 4 : 3}"/>
      ${cap && h.shard ? `<circle cx="${p.x}" cy="${p.y}" r="6" fill="${SPIRITS[h.shard].color}"/>` : ''}
      <text x="${p.x}" y="${p.y + 40}" text-anchor="middle">${esc(p.name)}</text></g></a>`;
  }).join('');
  const legend = HOUSES.map(h => `<span><span class="swatch" style="background:${h.color}"></span>${esc(h.short)}</span>`).join('') +
    `<span><span class="swatch" style="background:#4a4033"></span>Free hold</span><span>Gold ring: capital (dot: its shard)</span>`;
  return `<div class="mapbox"><svg viewBox="0 0 ${MAP_W} ${MAP_H}" role="img" aria-label="Map of Varenhold">
    <rect width="${MAP_W}" height="${MAP_H}" fill="#2a2319" rx="10"/>${lines.join('')}${nodes}</svg>
    <div class="legend">${legend}</div></div>`;
}

function provincesSec() {
  const rows = PROVINCES.map(p => {
    const h = OWNER[p.id] ? HOUSE_BY_ID[OWNER[p.id]] : null;
    const cap = h && h.capital === p.id;
    return `<tr id="prov-${p.id}"><td class="num">${p.id}</td><td><b>${esc(p.name)}</b>${cap ? ' ★' : ''}</td><td>${p.terrain}</td>
      <td>${h ? `<span class="swatch" style="background:${h.color}"></span>${esc(h.short)}` : '<span style="color:var(--w-muted)">free hold</span>'}</td>
      <td>${cap && h.shard ? esc(SPIRITS[h.shard].name) : ''}</td>
      <td>${ADJACENCY[p.id].map(plink).join(', ')}</td></tr>`;
  }).join('');
  return `${sec('provinces', 'Provinces', 'The realm')}${provinceMap()}
  <div class="xwrap"><table class="xtable sortable"><thead><tr><th data-k="n">#</th><th data-k="s">Province</th><th data-k="s">Terrain</th>
  <th data-k="s">Start owner</th><th data-k="s">Shard</th><th>Neighbours</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note" style="color:var(--w-muted)">★ capital. Click a column header to sort.</p>
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

function troopsSec() {
  const trow = Object.entries(TROOPS).map(([k, t]) => `<tr>
    <td>${img(t.sprite, { cls: 'sprite', contain: true, alt: t.name })}</td><td><b>${esc(t.name)}</b></td>
    <td class="num">${t.atk}</td><td class="num">${t.def}</td><td class="num">${t.move}</td><td class="num">${t.range}</td>
    <td class="num">${t.cost}</td><td class="num">${t.upkeep}</td><td>${esc(bonusText(t.bonusVs))}</td><td>${esc(t.note)}</td></tr>`).join('');
  const crow = Object.entries(COMPANIES).map(([k, c]) => {
    const traits = [bonusText(c.bonusVs), c.flying && 'flies over mountains', c.ignoresTerrain && 'ignores terrain',
      c.heals && `heals ${pct(c.heals)} of nearby troops per round`].filter(Boolean).join('; ');
    return `<tr><td>${img(c.sprite, { cls: 'sprite', contain: true, alt: c.name })}</td><td><b>${esc(c.name)}</b></td>
    <td class="num">${c.atk}</td><td class="num">${c.def}</td><td class="num">${c.move}</td><td class="num">${c.range}</td>
    <td class="num">${c.size}</td><td class="num">${c.hire}</td><td class="num">${c.wage}</td><td>${esc(traits)}</td></tr>`;
  }).join('');
  const m = MILITIA;
  return `${sec('troops', 'Troops', 'Armies')}
  <p>Every vassal leads one troop of up to ${MAX_SOLDIERS} soldiers. Cost is gold per 10 soldiers mustered; upkeep is food
  per 100 soldiers per month. Range 1 is melee.</p>
  <div class="xwrap"><table class="xtable sortable"><thead><tr><th></th><th data-k="s">Troop</th><th data-k="n">Atk</th><th data-k="n">Def</th><th data-k="n">Move</th>
  <th data-k="n">Range</th><th data-k="n">Cost</th><th data-k="n">Upkeep</th><th>Bonus</th><th>Notes</th></tr></thead><tbody>${trow}</tbody></table></div>
  ${sec('companies', 'Companies', 'Armies')}
  <p>Companies are hired for gold, one per province, and fight beside its vassals. Their size is fixed. Leave their
  wages unpaid and they desert.</p>
  <div class="xwrap"><table class="xtable sortable"><thead><tr><th></th><th data-k="s">Company</th><th data-k="n">Atk</th><th data-k="n">Def</th><th data-k="n">Move</th>
  <th data-k="n">Range</th><th data-k="n">Size</th><th data-k="n">Hire</th><th data-k="n">Wage</th><th>Traits</th></tr></thead><tbody>${crow}</tbody></table></div>
  ${sec('militia', 'Militia', 'Armies')}
  <div class="card" style="flex-direction:row;align-items:center;max-width:560px">${img(m.sprite, { style: 'width:72px;height:72px', contain: true, alt: 'Militia' })}
  <p><b>${esc(m.name)}</b>: Atk ${m.atk}, Def ${m.def}, Move ${m.move}, melee. Peasants with pitchforks who defend the free
  holds, ${NEUTRAL_MILITIA.min}–${NEUTRAL_MILITIA.max} strong.</p></div>`;
}

function spiritsSec() {
  const cards = Object.entries(SPIRITS).map(([k, s]) => {
    const holder = HOUSES.find(h => h.shard === k);
    return `<div class="card spirit-card" id="spirit-${k}" style="--sc:${s.color}">
      ${img(s.art, { alt: s.name })}
      <div><h3>${esc(s.name)}</h3><p class="role">${esc(s.element)} · spell: <b>${esc(s.spell)}</b></p>
      <p>${esc(s.text)}</p>
      <p class="note">Shard held by ${holder ? `<a href="#house-${holder.id}">${esc(holder.name)}</a> in ${plink(holder.capital)}` : 'no one'}.</p></div>
      ${img(s.fx, { style: 'width:72px;height:72px;margin-left:auto', alt: s.spell + ' effect' })}</div>`;
  }).join('');
  return `${sec('spirits', 'Spirits', 'Armies')}
  <p>A house holding a spirit's shard can call the spirit into one battle per season, if one of its vassals fights there.
  The spirit casts its spell once in that battle. A shard sits in its province: take the province and you take the shard.</p>
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
  token: 'Map token', portrait: 'Portrait', cutin: 'Cut-in', ui: 'Battle UI', crest: 'Crest', backdrop: 'Backdrop', vignette: 'Vignette', spirit: 'Spirit', sprite: 'Sprite', terrain: 'Terrain tile', fx: 'Spell effect' };

function parseShotlist(md) {
  const prompts = {}, sections = [];
  let cur = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const head = line.match(/^\*\*([A-Z])\. (.+?)\*\*\s*(.*)$/);
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

async function main() {
  await loadArtManifest();
  const parts = [overview(), howToPlay(), battles(), housesSec(), charactersSec(), provincesSec(),
    troopsSec(), spiritsSec(), eventsSec(), await gallerySec()];
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
