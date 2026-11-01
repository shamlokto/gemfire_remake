// Lanternfall soundtrack: original compositions, sequenced live by js/ui/music.js.
//
// TRACK FORMAT (edit freely; `node tests/music-tracks.mjs` checks every voice fills the track):
//   bpm      tempo in quarter-note beats per minute
//   beats    beats per bar (4 or 3), only used for drum/arp grouping and validation messages
//   loop     true = loops forever (music); false = plays once (fanfares, stings)
//   chords   the harmony: "Chord:beats" tokens. Chord = root (C, F#, Bb...) + quality
//            ('' major, m, 7, m7, maj7, sus4, sus2, dim, aug, add9, m7b5) + optional /bass.
//            The track's length is the total length of `chords`.
//   voices   list of parts. Each part has `inst` (lead, brass, horn, flute, bell, strings, pad,
//            harp, bass, cello, timp, snare, kick, cymbal), `vol` (0..1) and EITHER
//              notes: "Pitch:beats" tokens. Pitch = C4, F#5, Bb3 ... or r (rest).
//                     Chords inside a part: C4+E4+G4:2. Drums use x (hit) or X (accent).
//                     Repeat a group with (tokens)*N. Bar lines | are ignored.
//            OR
//              style: generated from `chords`: pad (held chords), arp4/arp8/arp16/arp3
//                     (broken chords in quarter/8th/16th/triplet notes), stab8 (staccato 8th
//                     chords), stab4, waltz (bass then two chord beats), bass (root half notes),
//                     bass4 (root quarters), bass8 (driving 8th roots with octave leaps),
//                     rootfifth (root and fifth), timp (root/fifth hits with rolls).
//              oct: octave for generated styles (default depends on the style).
//   Notes may run past a bar; only the total per part must match `chords`.

export const TRACKS = {
  // ---------------------------------------------------------------- Title: stately, heroic
  title: {
    bpm: 84, beats: 4, loop: true,
    chords: 'D:4 A/C#:4 Bm:4 G:4 | Em:4 A:4 D:4 A:4 | G:4 D/F#:4 Em:4 Bm:4 | G:4 A:4 D:4 A:4',
    voices: [
      { inst: 'brass', vol: 0.5, notes:
        'A4:1.5 D5:.5 F#5:1 A5:1 | G5:1.5 F#5:.5 E5:2 | F#5:1.5 D5:.5 B4:1 D5:1 | E5:1 D5:1 B4:2 |' +
        'G4:1 B4:1 E5:1 G5:1 | F#5:1.5 E5:.5 C#5:2 | D5:1 E5:1 F#5:1 G5:1 | A5:3 r:1 |' +
        'B5:1.5 A5:.5 G5:1 B5:1 | A5:1.5 F#5:.5 D5:2 | E5:1 G5:1 B5:1 G5:1 | F#5:3 D5:1 |' +
        'E5:1 F#5:1 G5:1 B5:1 | A5:1.5 G5:.5 E5:1 C#5:1 | D5:2 A4:1 D5:1 | C#5:1 D5:1 E5:2' },
      { inst: 'horn', vol: 0.28, notes:
        'r:16 | r:16 | D4:2 E4:2 F#4:2 D4:2 G4:2 F#4:2 E4:2 D4:2 | B3:2 D4:2 E4:2 C#4:2 F#4:2 A4:2 G4:2 E4:2' },
      { inst: 'pad', vol: 0.32, style: 'pad' },
      { inst: 'harp', vol: 0.28, style: 'arp8' },
      { inst: 'bass', vol: 0.45, style: 'rootfifth' },
      { inst: 'timp', vol: 0.5, style: 'timp' },
      { inst: 'snare', vol: 0.14, notes: '((X:1 x:.5 x:.5 x:1 x:.75 x:.25)*7 X:.25 x:.25 x:.25 x:.25 x:.25 x:.25 x:.25 x:.25 X:2)*2' },
      { inst: 'cymbal', vol: 0.12, notes: '(x:32)*2' },
    ],
  },

  // ---------------------------------------------------------------- House select: gentle waltz
  select: {
    bpm: 68, beats: 3, loop: true,
    chords: 'G:3 Em:3 C:3 D:3 | G:3 Bm:3 C:3 D:3 | Em:3 C:3 G:3 D:3 | C:3 Am:3 D:3 G:3',
    voices: [
      { inst: 'flute', vol: 0.42, notes:
        'D5:2 B4:1 | E5:1.5 D5:.5 B4:1 | C5:1 E5:1 G5:1 | F#5:2 D5:1 |' +
        'G5:1.5 F#5:.5 E5:1 | D5:2 B4:1 | C5:1 E5:1 A5:1 | A5:2 r:1 |' +
        'B5:1.5 A5:.5 G5:1 | E5:2 G5:1 | D5:1 B4:1 G4:1 | A4:2 D5:1 |' +
        'E5:1.5 D5:.5 C5:1 | A4:1 C5:1 E5:1 | F#5:1.5 E5:.5 F#5:1 | G5:3' },
      { inst: 'strings', vol: 0.18, notes: 'r:24 | B4:3 G4:3 B4:3 A4:3 G4:3 E4:3 F#4:3 D4:3' },
      { inst: 'pad', vol: 0.22, style: 'pad' },
      { inst: 'harp', vol: 0.3, style: 'arp8', oct: 4 },
      { inst: 'cello', vol: 0.32, style: 'waltz' },
    ],
  },

  // ---------------------------------------------------------------- Realm, spring & summer: pastoral
  realm_spring: {
    bpm: 96, beats: 4, loop: true,
    chords: 'F:4 C/E:4 Dm:4 Bb:4 | F:4 Gm:4 C:4 C7:4 | Dm:4 Am:4 Bb:4 F:4 | Gm:4 C:4 F:4 F:4 | Bb:4 C:4 Gm:4 C:4',
    voices: [
      { inst: 'lead', vol: 0.32, notes:
        'C5:1 F5:1 A5:1.5 G5:.5 | G5:2 E5:1 C5:1 | D5:1 F5:1 A5:1 F5:1 | D5:3 r:1 |' +
        'A4:1 C5:1 F5:1.5 E5:.5 | D5:1 Bb4:1 G4:1 Bb4:1 | C5:2 E5:1 G5:1 | Bb5:2 G5:2 |' +
        'A5:1.5 G5:.5 F5:1 D5:1 | E5:1.5 D5:.5 C5:2 | D5:1 F5:1 Bb5:1 A5:1 | A5:2 F5:2 |' +
        'G5:1 Bb5:1 D6:1 Bb5:1 | C6:1.5 Bb5:.5 G5:1 E5:1 | F5:4 | r:2 C5:.5 D5:.5 E5:.5 F5:.5 |' +
        'F5:1.5 D5:.5 Bb4:2 | G5:1.5 E5:.5 C5:2 | Bb4:1 D5:1 G5:1 Bb5:1 | A5:1 G5:1 E5:1 C5:1' },
      { inst: 'flute', vol: 0.22, notes: 'r:32 | r:16 | F4:2 A4:2 C5:4 A4:2 G4:2 F4:4 | D5:4 E5:4 D5:4 E5:4' },
      { inst: 'pad', vol: 0.2, style: 'pad' },
      { inst: 'harp', vol: 0.3, style: 'arp8' },
      { inst: 'bass', vol: 0.36, style: 'rootfifth' },
      { inst: 'snare', vol: 0.06, notes: '(r:1 x:1 r:1 x:.5 x:.5)*20' },
    ],
  },

  // ---------------------------------------------------------------- Realm, autumn: warm
  realm_autumn: {
    bpm: 80, beats: 4, loop: true,
    chords: 'Eb:4 Cm:4 Ab:4 Bb:4 | Eb:4 Gm:4 Ab:4 Bb7:4 | Cm:4 Gm:4 Ab:4 Eb:4 | Fm:4 Bb:4 Eb:4 Bb:4',
    voices: [
      { inst: 'horn', vol: 0.42, notes:
        'G4:1.5 Ab4:.5 Bb4:2 | C5:1 Bb4:1 G4:2 | Ab4:1 C5:1 Eb5:1.5 D5:.5 | D5:3 r:1 |' +
        'Eb5:1.5 F5:.5 G5:2 | Bb5:1 G5:1 D5:2 | C5:1 Eb5:1 Ab5:1 G5:1 | F5:3 r:1 |' +
        'G5:1.5 F5:.5 Eb5:1 C5:1 | D5:2 Bb4:2 | C5:1 Eb5:1 Ab5:1.5 G5:.5 | G5:3 r:1 |' +
        'Ab5:1.5 G5:.5 F5:1 C5:1 | D5:1 F5:1 Bb5:2 | G5:1.5 F5:.5 Eb5:2 | D5:1 Eb5:1 F5:2' },
      { inst: 'cello', vol: 0.22, notes: 'r:16 | Bb3:4 D4:4 C4:4 D4:4 | Eb4:4 D4:4 C4:4 Bb3:4 | C4:4 D4:4 Eb4:4 F4:4' },
      { inst: 'pad', vol: 0.26, style: 'pad' },
      { inst: 'harp', vol: 0.26, style: 'arp3' },
      { inst: 'bass', vol: 0.38, style: 'bass' },
      { inst: 'timp', vol: 0.18, notes: '(Eb2:4 r:12)*4' },
    ],
  },

  // ---------------------------------------------------------------- Realm, winter: sparse, minor
  realm_winter: {
    bpm: 66, beats: 4, loop: true,
    chords: 'Am:4 F:4 Dm:4 E:4 | Am:4 G:4 F:4 E:4 | Dm:4 Am:4 Bb:4 F:4 | Dm:4 E:4 Am:4 Esus4:2 E:2',
    voices: [
      { inst: 'bell', vol: 0.34, notes:
        'E5:3 r:1 | C5:1 A4:1 r:2 | D5:2 F5:2 | E5:2 G#4:2 |' +
        'A4:1 C5:1 E5:2 | D5:3 r:1 | C5:1.5 B4:.5 A4:2 | B4:4 |' +
        'F5:2 E5:1 D5:1 | C5:3 r:1 | D5:1 F5:1 Bb5:2 | A5:3 r:1 |' +
        'A5:1 F5:1 D5:2 | E5:1.5 D5:.5 B4:2 | A4:4 | r:4' },
      { inst: 'flute', vol: 0.16, notes: 'r:32 | A4:8 G4:8 | F4:4 G#4:4 A4:8' },
      { inst: 'pad', vol: 0.24, style: 'pad', oct: 3 },
      { inst: 'harp', vol: 0.2, style: 'arp4' },
      { inst: 'cello', vol: 0.26, style: 'bass', oct: 2 },
      { inst: 'timp', vol: 0.16, notes: '(A1:16)*4' },
    ],
  },

  // ---------------------------------------------------------------- Battle (attacking): driving, minor
  battle_attack: {
    bpm: 144, beats: 4, loop: true,
    chords: 'Cm:4 Cm:4 Ab:4 Bb:4 | Cm:4 Cm:4 Ab:4 G:4 | Fm:4 Cm:4 Ab:4 Bb:4 | Fm:4 Ab:4 G:4 G7:4 |' +
            'Ab:4 Bb:4 Gm:4 Cm:4 | Ab:4 Bb:4 G:4 G:4 | Fm:4 G:4 Cm:4 Ab:4 | Fm:4 G:4 Ab:4 G:4',
    voices: [
      { inst: 'brass', vol: 0.5, notes:
        'C5:1.5 G4:.5 C5:1 Eb5:1 | D5:.5 Eb5:.5 D5:.5 C5:.5 G4:2 | Ab4:1.5 C5:.5 Eb5:1 Ab5:1 | G5:1.5 F5:.5 D5:2 |' +
        'C5:1.5 G4:.5 C5:1 Eb5:1 | G5:1.5 F5:.5 Eb5:1 D5:1 | C5:1 Eb5:1 Ab5:1 C6:1 | B5:3 r:1 |' +
        'Ab5:1.5 G5:.5 F5:1 C5:1 | Eb5:1.5 D5:.5 C5:1 G4:1 | Ab4:1 C5:1 Eb5:1 F5:1 | D5:2 Bb4:1 D5:1 |' +
        'F5:1 Ab5:1 C6:1 Ab5:1 | Eb5:1 Ab5:1 C6:1 Eb6:1 | D6:1.5 C6:.5 B5:1 G5:1 | F5:1 D5:1 B4:1 G4:1 |' +
        'Eb5:2 C5:1 Eb5:1 | F5:2 D5:1 F5:1 | G5:1.5 F5:.5 D5:1 Bb4:1 | C5:3 r:1 |' +
        'Ab5:1.5 G5:.5 Eb5:1 C5:1 | Bb5:1.5 Ab5:.5 F5:1 D5:1 | G5:1 B5:1 D6:1 B5:1 | G5:4 |' +
        'C6:1.5 Ab5:.5 F5:2 | D6:1.5 B5:.5 G5:2 | Eb6:1 D6:1 C6:1 G5:1 | Ab5:1.5 G5:.5 Eb5:2 |' +
        'F5:.5 G5:.5 Ab5:.5 C6:.5 F6:2 | D6:.5 C6:.5 B5:.5 G5:.5 D5:2 | Eb5:.5 F5:.5 Eb5:.5 C5:.5 Ab4:2 | G4:.5 B4:.5 D5:.5 F5:.5 G5:1 r:1' },
      { inst: 'horn', vol: 0.3, notes:
        'r:64 | C4:4 D4:4 Bb3:4 Eb4:4 C4:4 D4:4 D4:4 B3:4 | C4:4 D4:4 Eb4:4 Eb4:4 C4:4 D4:4 Eb4:4 D4:4' },
      { inst: 'strings', vol: 0.26, style: 'stab8' },
      { inst: 'pad', vol: 0.16, style: 'pad' },
      { inst: 'bass', vol: 0.5, style: 'bass8' },
      { inst: 'timp', vol: 0.55, style: 'timp' },
      { inst: 'snare', vol: 0.22, notes: '((X:.5 x:.25 x:.25 r:.5 x:.5 r:.5 x:.5 x:.25 x:.25 x:.5)*7 (x:.25)*8 X:1 X:1)*4' },
      { inst: 'kick', vol: 0.4, notes: '(X:1 x:1 X:1 x:.5 x:.5)*32' },
      { inst: 'cymbal', vol: 0.14, notes: '(X:16 x:16)*4' },
    ],
  },

  // ---------------------------------------------------------------- Battle (defending): grim resolve
  battle_defend: {
    bpm: 126, beats: 4, loop: true,
    chords: 'Dm:4 Dm:4 Bb:4 A:4 | Dm:4 C:4 Bb:4 A:4 | Gm:4 Dm:4 Eb:4 A:4 | Gm:4 Bb:4 A:4 A7:4 |' +
            'F:4 C:4 Dm:4 Bb:4 | Gm:4 A:4 Dm:4 Dm:4 | Bb:4 C:4 A:4 Dm:4 | Gm:4 Eb:4 A:4 A:4',
    voices: [
      { inst: 'lead', vol: 0.36, notes:
        'D5:2 A4:1 D5:1 | F5:1.5 E5:.5 D5:2 | D5:1 F5:1 Bb5:1.5 A5:.5 | A5:2 E5:2 |' +
        'F5:1 E5:1 D5:1 A4:1 | G5:1.5 F5:.5 E5:1 C5:1 | D5:1 F5:1 G5:1 Bb5:1 | A5:3 r:1 |' +
        'Bb5:1.5 A5:.5 G5:1 D5:1 | F5:1.5 E5:.5 D5:2 | G5:1 Bb5:1 Eb6:1 D6:1 | C#6:3 r:1 |' +
        'D6:1 Bb5:1 G5:1 Bb5:1 | F5:1 D5:1 Bb4:1 D5:1 | E5:1 C#5:1 A4:1 C#5:1 | E5:1 G5:1 Bb5:1 C#6:1 |' +
        'C6:2 A5:1 F5:1 | G5:2 E5:1 C5:1 | D5:1 F5:1 A5:1 D6:1 | D6:3 r:1 |' +
        'Bb5:1.5 A5:.5 G5:1 Bb5:1 | A5:1.5 G5:.5 E5:1 C#5:1 | D5:4 | r:4 |' +
        'F5:1.5 G5:.5 F5:1 D5:1 | E5:1.5 F5:.5 G5:2 | A5:1 C#6:1 E6:1 C#6:1 | D6:3 r:1 |' +
        'G5:1 Bb5:1 D6:1 Bb5:1 | G5:1 Bb5:1 Eb6:2 | E6:2 C#6:1 A5:1 | E5:1 C#5:1 A4:2' },
      { inst: 'brass', vol: 0.32, notes:
        'r:16 | r:16 | G4:4 F4:4 G4:4 E4:4 | D4:4 F4:4 E4:4 E4:4 |' +
        'A4:4 G4:4 F4:4 F4:4 | D4:4 E4:4 F4:4 A4:4 | F4:4 G4:4 E4:4 F4:4 | D4:4 G4:4 E4:4 C#4:4' },
      { inst: 'strings', vol: 0.24, style: 'arp16', oct: 3 },
      { inst: 'pad', vol: 0.2, style: 'pad' },
      { inst: 'cello', vol: 0.4, style: 'bass8' },
      { inst: 'timp', vol: 0.5, style: 'timp' },
      { inst: 'snare', vol: 0.16, notes: '((x:1 X:1 x:1 X:.5 x:.25 x:.25)*7 (x:.25)*8 X:2)*4' },
      { inst: 'kick', vol: 0.36, notes: '(X:2 x:1.5 x:.5)*32' },
    ],
  },

  // ---------------------------------------------------------------- Victory fanfare (campaign won)
  victory: {
    bpm: 112, beats: 4, loop: false,
    chords: 'C:2 F:1 G:1 C:2 Am:1 F:1 G:2 G:2 C:6',
    voices: [
      { inst: 'brass', vol: 0.55, notes: 'G4:.5 C5:.5 E5:1 F5:.5 A5:.5 G5:.5 B4:.5 C5:.75 E5:.25 G5:1 A5:1 F5:1 D5:1.5 E5:.5 F5:1 D5:1 C6:6' },
      { inst: 'horn', vol: 0.3, notes: 'E4:2 F4:1 D4:1 E4:2 E4:1 C4:1 D4:2 B3:2 G4:6' },
      { inst: 'pad', vol: 0.28, style: 'pad' },
      { inst: 'harp', vol: 0.3, style: 'arp16' },
      { inst: 'bass', vol: 0.45, style: 'bass4' },
      { inst: 'timp', vol: 0.6, notes: 'C2:2 F2:1 G2:1 C2:2 A1:1 F1:1 (G1:.25)*16 C2:6' },
      { inst: 'cymbal', vol: 0.2, notes: 'r:12 X:6' },
    ],
  },

  // ---------------------------------------------------------------- Defeat lament
  defeat: {
    bpm: 58, beats: 4, loop: false,
    chords: 'Am:2 F:2 Dm:2 E:2 Am:6',
    voices: [
      { inst: 'flute', vol: 0.4, notes: 'E5:1.5 D5:.5 C5:1 A4:1 D5:1 F5:1 E5:1 G#4:1 A4:6' },
      { inst: 'strings', vol: 0.26, style: 'pad' },
      { inst: 'cello', vol: 0.34, style: 'bass' },
      { inst: 'timp', vol: 0.3, notes: 'A1:8 A1:6' },
    ],
  },

  // ---------------------------------------------------------------- Stings
  summon: {
    bpm: 100, beats: 4, loop: false,
    chords: 'Ab:1 Bb:1 Cm:1 D:1 Eb:4',
    voices: [
      { inst: 'harp', vol: 0.4, style: 'arp16', oct: 4 },
      { inst: 'bell', vol: 0.35, notes: 'Eb5:1 F5:1 G5:1 A5:1 Bb5:4' },
      { inst: 'pad', vol: 0.35, style: 'pad' },
      { inst: 'brass', vol: 0.32, notes: 'r:4 Eb4+G4+Bb4:4' },
      { inst: 'timp', vol: 0.5, notes: '(Eb2:.125)*32 Eb2:4' },
      { inst: 'cymbal', vol: 0.22, notes: 'r:4 X:4' },
    ],
  },
  battle_won: {
    bpm: 132, beats: 4, loop: false,
    chords: 'F:1 G:1 C:4',
    voices: [
      { inst: 'brass', vol: 0.55, notes: 'C5:.33 F5:.33 A5:.34 D5:.33 G5:.33 B5:.34 C6:4' },
      { inst: 'horn', vol: 0.3, notes: 'A4:1 B4:1 E5:4' },
      { inst: 'pad', vol: 0.25, style: 'pad' },
      { inst: 'bass', vol: 0.4, style: 'bass4' },
      { inst: 'timp', vol: 0.55, notes: 'F2:1 G2:1 (C2:.125)*8 C2:3' },
      { inst: 'cymbal', vol: 0.18, notes: 'r:2 X:4' },
    ],
  },
  battle_lost: {
    bpm: 76, beats: 4, loop: false,
    chords: 'Ab:2 G:2 Cm:4',
    voices: [
      { inst: 'horn', vol: 0.45, notes: 'Eb5:1 C5:1 D5:1 B4:1 C5:4' },
      { inst: 'strings', vol: 0.26, style: 'pad' },
      { inst: 'cello', vol: 0.36, style: 'bass' },
      { inst: 'timp', vol: 0.4, notes: 'Ab1:2 G1:2 C2:4' },
    ],
  },
};

// Music for each screen / season. Seasons: 0 spring, 1 summer, 2 autumn, 3 winter.
export const SEASON_TRACK = ['realm_spring', 'realm_spring', 'realm_autumn', 'realm_winter'];
