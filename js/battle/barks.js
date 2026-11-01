// Short battle lines ("barks") for vassals. Original text. Lines are chosen by moment and by the
// vassal's character: a personal line by id when present, else by temperament from stats.
// bark(vassal|null, moment, seed) -> string. Moments: attack, hit, rout, win, lose, spell,
// lastStand, gate, keep, start.

const PERSONAL = {
  aldmere_0: { start: 'For the ford and the fields behind it.', win: 'The river remembers this day.' },
  aldmere_1: { attack: 'Lances low! Hold the line at the ford!' },
  aldmere_2: { attack: 'Just as I drew it on the map.' },
  aldmere_4: { attack: 'I have crossed worse water than this.' },
  corvane_0: { start: 'Let them see the ravens over the field.', win: 'Pick the bones clean.' },
  corvane_1: { attack: 'You never saw me coming.' },
  corvane_2: { attack: 'AXES!', rout: 'Not... like... this.' },
  corvane_3: { attack: 'Feel the frost in your bones.' },
  isolde_0: { start: 'A battle is only a costly bargain.', win: 'Put it on their account.' },
  isolde_1: { attack: 'Broadside! Loose!' },
  isolde_5: { attack: 'Double or nothing!', rout: 'The dice hate me today.' },
  hrothgar_0: { start: 'Stone does not kneel!', win: 'The hills are ours again.' },
  hrothgar_3: { attack: 'BLOOD FOR THE BOAR!', rout: 'I... will be back.' },
  hrothgar_4: { attack: 'I have buried better than you, child.' },
  seraphine_0: { start: 'Light before the dark.', win: 'Let mercy follow victory.' },
  seraphine_1: { attack: 'By the Light, stand and be judged!' },
  seraphine_2: { attack: 'I saw this blow a year ago.' },
  vey_0: { start: 'The reeds bend. They do not break.', win: 'Back to the marsh, and home.' },
  vey_1: { attack: 'From the reeds! Now!' },
  vey_4: { attack: 'I gut eels bigger than you.' },
  vey_5: { rout: 'Time to vanish.' },
};

const BY_TEMPER = {
  brave: {   // high might
    attack: ['Charge!', 'With me! Break them!', 'Steel and courage!', 'Push! Push!'],
    hit: ['Is that all?', 'Stand fast!', 'Close the gaps!'],
    rout: ['Fall back... regroup!', 'Too many of them!'],
    win: ['Victory!', 'The field is ours!'], lose: ['We will return.'],
    lastStand: ['To the last soldier!', 'Here we stand. Here we fall.'],
    gate: ['The gate is down! Pour in!'], keep: ['The keep is ours!'], spell: ['The spirit fights with us!'],
    start: ['Sound the horns!'],
  },
  clever: {  // high wits
    attack: ['Strike the flank.', 'Now, while they are open.', 'Exactly as planned.'],
    hit: ['A setback. Adjust.', 'Hold formation.'],
    rout: ['A tactical withdrawal.', 'Pull back to the second line.'],
    win: ['A tidy result.', 'Checkmate.'], lose: ['I miscounted.'],
    lastStand: ['If we fall, make it cost them.'],
    gate: ['The gate gives. Advance.'], keep: ['Raise our banner.'], spell: ['Now the spirit!'],
    start: ['Positions, everyone.'],
  },
  kind: {    // high charm
    attack: ['For our people!', 'Courage, friends!', 'For home!'],
    hit: ['Help the wounded!', 'Steady, all of you.'],
    rout: ['Save who you can!', 'Fall back, live to fight!'],
    win: ['Thank you, all of you.'], lose: ['Forgive me.'],
    lastStand: ['Stand with me one more time.'],
    gate: ['Through the gate, carefully!'], keep: ['It is over. Spare the rest.'], spell: ['Spirit, protect them!'],
    start: ['Stay together.'],
  },
};
const FOE_GENERIC = {
  attack: ['Forward!', 'Attack!', 'Hit them!'], hit: ['Hold!'], rout: ['Run!', 'Retreat!'],
  win: ['We won!'], lose: ['Fall back!'], lastStand: ['Hold the walls!'], gate: ['The gate!'],
  keep: ['The keep!'], spell: ['Look to the sky!'], start: ['To arms!'],
};

function temper(v) {
  if (!v) return null;
  if (v.might >= v.wits && v.might >= v.charm) return 'brave';
  if (v.wits >= v.charm) return 'clever';
  return 'kind';
}

export function bark(v, moment, seed = 0) {
  const p = v && PERSONAL[v.id] && PERSONAL[v.id][moment];
  if (p && (seed % 3 !== 2)) return p;
  const set = (BY_TEMPER[temper(v)] || FOE_GENERIC)[moment] || FOE_GENERIC[moment] || ['...'];
  return set[Math.abs(seed) % set.length];
}
