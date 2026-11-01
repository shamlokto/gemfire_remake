# Lanternfall: image shot list (100 images)

Generate each image with the xAI image API and save it as `NNN.jpg` (or .png), for example `001.jpg` … `100.jpg`. Upload them all; `tools/process_art.py` crops, resizes and cuts them out (sizes are listed in `js/data/art.js`). Any aspect ratio works, but keep the subject centred.

Put this **style prefix** before every prompt: *"Painterly high-fantasy illustration, rich
jewel-tone colours, soft rim light, detailed but readable, storybook oil-painting style, no text,
no watermark."* Sprites (F) use *"…single figure, three-quarter top-down view, centred, full body,
flat pale grey background"*. Portraits use *"…bust portrait, facing slightly left, dark
vignette background"*.

**A. Title and UI (9)**
1 Key art: a shattered glowing lantern floating over a realm of castles and rivers at dusk, five spirit silhouettes in the light
2 Menu backdrop: a war-council table with a map, candles, scattered coloured gem shards, viewed from above
3 Aged parchment texture, warm, even lighting, seamless, no marks
4 Spring banner: blossoming orchard valley with a castle
5 Summer banner: golden wheat fields under a big sky
6 Autumn banner: harvest carts and red forests
7 Winter banner: a snowbound keep under aurora
8 Victory: a ruler raising a reassembled radiant lantern on a castle balcony, crowds below
9 Defeat: a fallen banner in the rain before a burning keep

**B. World map (6)**
10 Top-down fantasy map of a realm, 24 regions: rivers from northern mountains, central plains, eastern coast, southern marshes, western highlands, painted like an illuminated atlas, no labels
11 The same style of map in winter snow (I will align it to 10)
12 Drifting clouds and fog over a dark map, for fog of war
13 Castle token: a small stone keep on a round base
14 Army token: a cluster of banners and spears on a round base
15 Compass rose and decorative map border corner

**C. Portraits (36)** — 6 rulers, then 30 vassals (5 per house)
16 Aldmere ruler: silver-haired river lord, blue mantle, otter clasp
17 Corvane ruler: gaunt northern queen, black feathered cloak, iron crown
18 Isolde ruler: shrewd merchant prince, teal silks, rings, harbour behind
19 Hrothgar ruler: broad red-bearded clan chief, fur and bronze torc
20 Seraphine ruler: serene high priestess, white and gold robes, halo-like headdress
21 Vey ruler: young marsh warden, green leather, reed crown, bow on shoulder
22–26 Aldmere vassals: veteran knight in blue plate; young scholar-tactician; female archer captain; scarred ferryman-turned-general; old steward with spectacles
27–31 Corvane vassals: raven-masked spymaster; hulking axeman; frost-witch advisor; grim young heir; one-eyed cavalry marshal
32–36 Isolde vassals: privateer admiral; elegant diplomat; alchemist; harbour-guard captain; gambler duelist
37–41 Hrothgar vassals: shieldmaiden; hill druid; boar-helmed berserker; wise grandmother chieftain; young horse-tamer
42–46 Seraphine vassals: templar paladin; blind oracle; healer nun; zealous inquisitor; pilgrim knight
47–51 Vey vassals: swamp ranger; herbalist; stilt-village elder; eel-fisher brute; masked smuggler

**D. Spirits (5)**
52 Ember Stag: a giant stag of living flame, antlers of embers, ash falling
53 Tide Serpent: a coiling sea serpent made of glowing water
54 Gale Owl: a storm owl with lightning in its wings, clouds swirling
55 Stone Warden: a mossy stone giant with glowing runes
56 Dusk Moth: a huge violet moth with eye-patterned wings, shadow trailing

**E. Companies (6)** — sprite style
57 Wolfrider 58 Clay golem 59 Wyvern 60 Ghost knight 61 Bandit with crossbow 62 Druid with staff

**F. Troop sprites (12)** — sprite style, neutral grey-and-white heraldry so I can recolour it
63 Footman, sword and shield 64 Pikeman 65 Archer 66 Crossbowman 67 Light horseman 68 Heavy knight
69 Battering ram crew 70 Catapult 71 Mounted vassal general 72 Banner bearer 73 Supply wagon 74 Militia peasant with pitchfork

**G. Battle terrain (10)** — *"seamless top-down game texture tile, flat lighting"*
75 Grass meadow 76 Dense forest canopy 77 Rolling hills 78 Rocky mountain 79 River water 80 Wooden bridge over a river 81 Dirt road 82 Castle stone wall 83 Castle gate 84 Thatched village rooftops

**H. Spell effects (5)** — on a pure black background (I will screen-blend them)
85 Wall of fire 86 Crashing wave 87 Forked lightning 88 Rising stone wall 89 Swirling violet shadow mist

**I. Event scenes (11)** — wide cinematic
90 Bumper harvest festival 91 Famine: empty granary, thin villagers 92 River flood over farms
93 Plague doctors in a grey town 94 Peasant revolt with torches 95 A vassal's betrayal at a feast
96 Royal marriage pact 97 A siege at night with fire arrows 98 Winter blizzard over a marching army
99 The High Lantern shattering (prologue) 100 The five spirits at peace around a restored lantern (ending)

