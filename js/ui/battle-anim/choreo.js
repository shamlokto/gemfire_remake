// Clash choreography: a deterministic timeline stepped at a fixed 60 Hz. It decides every frame
// where each figure is, what it is doing, and when strikes land, shots fly, figures fall and
// sounds play. The renderer (clashfx.js) only draws what this hands it and interpolates
// positions between steps; nothing here touches a canvas.
//
//   const sc = new ClashScene(cfg);  each 1/60 s: sc.step(); events = sc.drain();
//   sc.actors / sc.shots / sc.counts(alpha) / sc.done
//
// cfg = { seed, short, terrain, weather, season,
//   att: { type, kind, spirit, before, after, leader }, def: { ... },
//   hit: { killed, ranged, rout }, counter: { killed, rout } | null }
// Scene space: 480 x 200, ground rows at y 150 (back) and 170 (front); attackers on the left.

import { MOUNTED, RANGED, POWDER, attackAct } from './figures.js';

export const SW = 480, SH = 200;
const FRONT_Y = 172, BACK_Y = 150;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function squadCount(u) {
  if (u.kind === 'spirit') return 1;
  if (u.type === 'siege' || u.type === 'bombards' || u.type === 'golem') return 1;
  if (u.type === 'wyvern') return u.before >= 30 ? 2 : 1;
  if (MOUNTED.has(u.type)) return clamp(Math.round(u.before / 30), 2, 7);
  return clamp(Math.round(u.before / 22), 3, 12);
}

export class ClashScene {
  constructor(cfg) {
    this.cfg = cfg;
    this.r = rng(cfg.seed || 1);
    this.f = 0;
    this.out = [];
    this.actors = [];
    this.shots = [];
    this.done = false;
    this.short = !!cfg.short;
    const A = cfg.att, D = cfg.def;
    this.aRanged = !!cfg.hit.ranged;
    this.aSpirit = A.kind === 'spirit';
    this.dSpirit = D.kind === 'spirit';
    this.aMounted = MOUNTED.has(A.type) || A.type === 'wyvern';
    this.dHolds = RANGED.has(D.type) || D.type === 'siege' || D.type === 'bombards';
    // contact lines
    this.contactA = this.dHolds ? 286 : (this.aMounted ? 238 : 226);
    this.contactD = this.dHolds ? 316 : (this.aMounted ? 262 : 254);
    const T = this.short ? 0.55 : 1;
    this.T = T;
    // timeline (frames)
    const tl = {};
    if (this.aRanged) {
      if (A.type === 'siege' || A.type === 'bombards') {
        tl.fire = [Math.round(30 * T)];
        tl.flight = A.type === 'bombards' ? 18 : 36;
      } else {
        tl.fire = this.short ? [Math.round(18 * T)] : [40, 92];
        tl.flight = POWDER.has(A.type) ? 8 : 26;
      }
      tl.firstHit = tl.fire[0] + tl.flight + (A.type === 'siege' ? 18 : 0);
      tl.fightEnd = tl.fire[tl.fire.length - 1] + tl.flight + (A.type === 'siege' ? 18 : 0) + 14;
    } else {
      tl.contact = Math.round((this.aMounted ? 52 : 62) * T);
      tl.fightEnd = tl.contact + Math.round(56 * T);
    }
    tl.counterStart = tl.fightEnd + 4;
    tl.counterEnd = cfg.counter ? tl.counterStart + Math.round(42 * T) : tl.fightEnd;
    tl.end = tl.counterEnd + Math.round((cfg.hit.rout || cfg.counter?.rout ? 40 : 28) * (this.short ? 0.7 : 1));
    this.tl = tl;
    this.length = tl.end;
    this.build('attacker', A); this.build('defender', D);
    this.plan();
  }

  build(side, u) {
    const n = squadCount(u);
    const dir = side === 'attacker' ? 1 : -1;
    const big = u.kind === 'spirit' || u.type === 'siege' || u.type === 'bombards' || u.type === 'golem' || u.type === 'wyvern';
    const startFront = side === 'attacker'
      ? (this.short ? (this.aRanged ? 140 : this.contactA - 46) : (this.aRanged ? 120 : -10))
      : (this.short ? (this.dHolds ? this.contactD : this.contactD + 30) : (this.dHolds ? this.contactD : 330));
    for (let i = 0; i < n; i++) {
      const rank = big ? 0 : i % 2, file = big ? i : (i >> 1);
      const gap = MOUNTED.has(u.type) ? 46 : big ? 80 : 26;
      const x = side === 'attacker' ? startFront - file * gap - rank * 10 : startFront + file * gap + rank * 10;
      const y = (u.type === 'wyvern' ? 150 : rank ? BACK_Y : FRONT_Y) + (this.r() - 0.5) * 4;
      this.actors.push({
        id: `${side[0]}${i}`, side, type: u.kind === 'spirit' ? 'spirit' : u.type, spirit: u.spirit, kind: u.kind,
        x, y, px: x, py: y, homeX: x, tx: x, rank, file, facing: dir, s: u.kind === 'spirit' ? 92 : (u.type === 'siege' || u.type === 'bombards') ? 58 : 40,
        walk: this.r() * 6, moving: false, run: false, act: 'idle', actF0: 0, actLen: 1,
        dead: false, deadF: 0, flee: false, fleeF: 0, alpha: 1, glow: 0,
      });
    }
  }

  // Decide who falls when, strike times and shots, from the rules' numbers.
  plan() {
    const { att, def, hit, counter } = this.cfg;
    const A = this.actors.filter(a => a.side === 'attacker'), D = this.actors.filter(a => a.side === 'defender');
    const deaths = (list, killed, before, after, rout) => {
      if (!killed) return 0;
      if (after <= 0) return list.length;
      const n = Math.round(list.length * killed / Math.max(1, before));
      return clamp(n, 1, rout ? list.length - 1 : list.length - 1 || 1);
    };
    const order = list => list.slice().sort((p, q) => (p.rank - q.rank) || (p.file - q.file));   // front rank first
    this.dDeaths = order(D).slice(0, deaths(D, hit.killed, def.before, def.after, hit.rout));
    this.aDeaths = counter ? order(A).slice(0, deaths(A, counter.killed, att.before, att.after, counter.rout)) : [];
    const tl = this.tl;
    // advance targets
    for (const a of A) {
      if (this.aRanged) { a.tx = a.homeX; continue; }
      const off = a.homeX - Math.max(...A.map(q => q.homeX));
      a.tx = this.contactA + off;
    }
    for (const d of D) {
      if (this.dHolds || this.aRanged) { d.tx = d.homeX; continue; }
      const off = d.homeX - Math.min(...D.map(q => q.homeX));
      d.tx = this.contactD + off;
    }
    // falls spread across the exchange
    const spread = (list, f0, f1) => list.forEach((a, i) => { a.fallAt = Math.round(f0 + (f1 - f0) * (list.length === 1 ? 0.35 : i / (list.length - 1))); });
    if (this.aRanged) {
      const hits = this.cfg.att.type === 'siege' || this.cfg.att.type === 'bombards'
        ? [tl.firstHit] : tl.fire.map(f => f + tl.flight);
      this.dDeaths.forEach((d, i) => { d.fallAt = hits[i % hits.length] + 2 + (i * 3) % 9; });
    } else spread(this.dDeaths, tl.contact + 10 * this.T, tl.fightEnd - 6 * this.T);
    if (counter) spread(this.aDeaths, tl.counterStart + 10 * this.T, tl.counterEnd - 4 * this.T);
    // strikes: front fighters swing in a staggered rhythm
    this.strikes = [];
    const fighters = (list, n) => order(list).filter(a => !(a.type === 'siege' || a.type === 'bombards')).slice(0, n);
    if (!this.aRanged) {
      for (const a of fighters(A, 8)) {
        let f = tl.contact - 6 + Math.floor(this.r() * 12);
        while (f < tl.fightEnd - 8) { this.strikes.push({ f, actor: a }); f += 22 + Math.floor(this.r() * 14); }
      }
    }
    if (counter && !this.dHolds) {
      for (const d of fighters(D, 8)) {
        let f = tl.counterStart + Math.floor(this.r() * 10);
        while (f < tl.counterEnd - 6) { this.strikes.push({ f, actor: d }); f += 20 + Math.floor(this.r() * 14); }
      }
    }
    this.strikes.sort((p, q) => p.f - q.f);
    this.routFlee = hit.rout && def.after > 0 ? 'defender' : counter?.rout && att.after > 0 ? 'attacker' : null;
    this.routF = this.routFlee === 'defender' ? (this.aRanged ? tl.fightEnd : tl.fightEnd + 2) : tl.counterEnd + 2;
    if (hit.rout && def.after <= 0) this.wipe = 'defender';
    if (counter?.rout && att.after <= 0) this.wipe = 'attacker';
  }

  emit(e) { this.out.push(e); }
  drain() { const o = this.out; this.out = []; return o; }

  act(a, act, len) { a.act = act; a.actF0 = this.f; a.actLen = len; }
  pose(a, alpha = 0) {
    const k = clamp((this.f + alpha - a.actF0) / a.actLen, 0, 1);
    return { act: a.flee ? 'flee' : a.dead ? 'fall' : a.act, k: a.dead ? clamp((this.f + alpha - a.deadF) / 50, 0, 1) : k,
      walk: a.moving || a.flee ? a.walk : null, run: a.run || a.flee, t: (this.f + alpha) / 60 };
  }

  // Front-most living actor of a side, used to aim shots and place contact sparks.
  front(side) {
    const live = this.actors.filter(a => a.side === side && !a.dead && !a.flee);
    if (!live.length) return null;
    return live.reduce((p, q) => (side === 'attacker' ? (q.x > p.x ? q : p) : (q.x < p.x ? q : p)));
  }

  step() {
    if (this.done) return;
    const f = ++this.f, tl = this.tl, A = this.cfg.att;
    for (const a of this.actors) { a.px = a.x; a.py = a.y; }
    // movement
    const startMove = this.short ? 2 : (this.aMounted ? 10 : 14);
    for (const a of this.actors) {
      if (a.dead) continue;
      if (a.flee) {
        a.moving = true; a.run = true; a.walk += 0.42;
        const sp = 3.6;
        a.x += a.facing * sp; a.y += Math.sin(a.walk * 0.3) * 0.1;
        if (f % 6 === 0) this.emit({ k: 'dust', x: a.x, y: a.y, n: 1 });
        continue;
      }
      if (f < startMove) continue;
      const dx = a.tx - a.x;
      if (Math.abs(dx) > 0.5) {
        const fast = a.side === 'attacker' && this.aMounted;
        const sp = (fast ? 5.2 : this.aSpirit && a.side === 'attacker' ? 4.4 : 2.6) * (this.short ? 1.6 : 1);
        const stepX = clamp(dx, -sp, sp);
        a.x += stepX; a.moving = true; a.run = Math.abs(stepX) > 3; a.walk += Math.abs(stepX) * 0.11;
        if (fast && f % 3 === 0) this.emit({ k: 'dust', x: a.x - a.facing * 10, y: a.y, n: 2 });
        if (!fast && a.rank === 0 && f % 11 === 0 && a.file === 0) this.emit({ k: 'step', x: a.x, y: a.y });
      } else a.moving = false;
    }
    // cavalry / spirit impact moment
    if (!this.aRanged && f === tl.contact) {
      const fr = this.front('attacker'), fd = this.front('defender');
      const x = fd && fr ? (fr.x + fd.x) / 2 : 240, y = 160;
      if (this.aSpirit) this.emit({ k: 'spiritHit', spirit: A.spirit, x, y });
      else if (this.aMounted) { this.emit({ k: 'charge', x, y }); this.emit({ k: 'sfx', name: 'clash' }); }
      else this.emit({ k: 'sfx', name: 'clash' });
      if (this.aMounted || this.aSpirit) for (const d of this.actors) if (d.side === 'defender' && !d.dead) d.kick = 1;
    }
    // melee strikes
    for (const s of this.strikes) {
      if (s.f === f && !s.actor.dead && !s.actor.flee) {
        const a = s.actor;
        const act = a.type === 'spirit' ? 'swing' : attackAct(a.type) === 'draw' ? 'swing' : attackAct(a.type);
        this.act(a, act, 26);
        s.hitF = f + 12;
      }
      if (s.hitF === f && !s.actor.dead) {
        const a = s.actor;
        const x = a.x + a.facing * (MOUNTED.has(a.type) ? 30 : 18), y = a.y - (MOUNTED.has(a.type) ? 26 : 18);
        this.emit({ k: 'clash', x, y, power: MOUNTED.has(a.type) || a.type === 'golem' ? 0.9 : 0.5, side: a.side });
        if (f % 2 === 0) this.emit({ k: 'sfx', name: a.type === 'golem' ? 'hit' : 'clash', quiet: true });
        // the opponents in reach flinch/block
        for (const d of this.actors) if (d.side !== a.side && !d.dead && Math.abs(d.x - x) < 26 && d.act === 'idle' && !d.flee) this.act(d, 'block', 14);
      }
    }
    // ranged volleys
    if (this.aRanged) {
      const shooters = this.actors.filter(a => a.side === 'attacker' && !a.dead);
      const engine = A.type === 'siege' || A.type === 'bombards';
      for (const fireF of tl.fire) {
        const drawLen = engine ? (A.type === 'siege' ? 44 : 24) : POWDER.has(A.type) ? 20 : 26;
        if (f === fireF - Math.round(drawLen * (engine ? 0.4 : 1))) for (const s of shooters) this.act(s, engine ? 'loose' : 'draw', drawLen);
        if (f === fireF) {
          const targets = this.actors.filter(a => a.side === 'defender' && !a.dead);
          if (engine) {
            const s = shooters[0], tgt = targets.length ? targets.slice().sort((p, q) => p.x - q.x)[Math.floor(targets.length / 2)] : null;
            const tx = tgt ? tgt.x + 8 : 320, ty = tgt ? tgt.y : FRONT_Y;
            const from = { x: s.x + 14, y: s.y - (A.type === 'siege' ? 42 : 14) };
            const flight = A.type === 'siege' ? 54 : tl.flight;
            this.shots.push({ kind: A.type === 'siege' ? 'stone' : 'ball', x0: from.x, y0: from.y, x1: tx, y1: ty - 6, f0: f, f1: f + flight, arc: A.type === 'siege' ? 64 : 14 });
            this.emit({ k: 'sfx', name: 'catapult' });
            if (A.type === 'bombards') this.emit({ k: 'muzzle', x: from.x + 10, y: from.y, big: true });
          } else {
            const per = shooters.length < 5 ? 2 : 1;
            shooters.forEach((s, i) => {
              this.act(s, 'loose', 14);
              for (let j = 0; j < per; j++) {
                const tgt = targets.length ? targets[Math.floor(this.r() * targets.length)] : null;
                const tx = (tgt ? tgt.x : 320) + (this.r() - 0.5) * 22, ty = (tgt ? tgt.y : FRONT_Y) - this.r() * 18;
                const from = { x: s.x + 14, y: s.y - 24 };
                const powder = POWDER.has(A.type);
                const fl = tl.flight + Math.floor(this.r() * (powder ? 3 : 6)) + j * 2;
                this.shots.push({ kind: powder ? 'bullet' : A.type === 'druids' ? 'thorn' : A.type === 'bandits' ? 'bolt' : 'arrow', x0: from.x, y0: from.y, x1: tx, y1: ty,
                  f0: f + j * 3 + (i % 3), f1: f + j * 3 + (i % 3) + fl, arc: powder ? 2 : 40 + this.r() * 30 });
                if (powder) this.emit({ k: 'muzzle', x: from.x + 8, y: from.y, at: f + j * 3 + (i % 3) });
              }
            });
            this.emit({ k: 'sfx', name: POWDER.has(A.type) ? 'catapult' : 'arrows' });
          }
        }
      }
    }
    // shots landing
    for (const sh of this.shots) {
      if (f === sh.f1) {
        if (sh.kind === 'stone' || sh.kind === 'ball') { this.emit({ k: 'explode', x: sh.x1, y: sh.y1, size: sh.kind === 'stone' ? 1.3 : 1.1 }); this.emit({ k: 'sfx', name: 'hit' }); }
        else this.emit({ k: 'land', x: sh.x1, y: sh.y1, kind: sh.kind });
      }
    }
    this.shots = this.shots.filter(sh => f < sh.f1 + 2);
    // falls
    for (const a of this.actors) {
      if (!a.dead && a.fallAt === f && (this.dDeaths.includes(a) || this.aDeaths.includes(a))) {
        a.dead = true; a.deadF = f; a.moving = false;
        this.emit({ k: 'fall', side: a.side, x: a.x, y: a.y, spirit: a.type === 'spirit' ? a.spirit : null });
      }
    }
    // the rest of a broken unit turns and flees
    if (this.routFlee && f === this.routF) {
      for (const a of this.actors) if (a.side === this.routFlee && !a.dead) { a.flee = true; a.facing = this.routFlee === 'defender' ? 1 : -1; a.walk = 0; a.fleeF = f; }
      this.emit({ k: 'rout', side: this.routFlee });
    }
    if (this.wipe && f === (this.wipe === 'defender' ? tl.fightEnd : tl.counterEnd)) this.emit({ k: 'wipe', side: this.wipe });
    // decay knock-back
    for (const a of this.actors) if (a.kick) { a.x += -a.facing * a.kick * 2.4; a.kick *= 0.82; if (a.kick < 0.05) a.kick = 0; }
    if (f >= this.length) this.done = true;
  }

  // Soldier counts as shown in the HUD: tick down with the falls.
  counts(alpha = 0) {
    const f = this.f + alpha, { att, def, hit, counter } = this.cfg;
    const tick = (list, before, after, f0, f1) => {
      if (before === after) return before;
      if (!list.length) { const k = clamp((f - f0) / Math.max(1, f1 - f0), 0, 1); return Math.round(before + (after - before) * k); }
      const a = Math.min(...list.map(x => x.fallAt)) - 4, b = Math.max(...list.map(x => x.fallAt)) + 6;
      const k = clamp((f - a) / Math.max(1, b - a), 0, 1);
      return Math.round(before + (after - before) * k);
    };
    const tl = this.tl;
    return {
      att: tick(this.aDeaths, att.before, att.after, tl.counterStart, tl.counterEnd),
      def: tick(this.dDeaths, def.before, def.after, tl.firstHit ?? tl.contact, tl.fightEnd),
      dKilledShown: this.f >= (this.aRanged ? tl.firstHit : tl.contact + 8),
      aKilledShown: !!counter && this.f >= tl.counterStart + 8,
      hit, counter,
    };
  }

  // Shot position at fractional frame.
  shotAt(sh, f) {
    const k = clamp((f - sh.f0) / (sh.f1 - sh.f0), 0, 1);
    return { x: sh.x0 + (sh.x1 - sh.x0) * k, y: sh.y0 + (sh.y1 - sh.y0) * k - Math.sin(Math.PI * k) * sh.arc, k, live: f >= sh.f0 };
  }
}
