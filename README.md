# make ready — FIRE!

A musket-line expedition game with an **adaptive [Strudel](https://strudel.cc)
soundtrack**. Your homestead lies at the western edge of a long stretch of
wild country. The deeper east you push, the more (and stronger) enemies you
meet — and the better the artifacts you can carry home. The music follows the
journey: warm at the hearth, uneasy in deep ground, driving in combat (scaling
with enemy numbers and your squad's wounds), hopeful as the skirmish turns,
a fanfare when it's won, then smoothly back to calm.

**▶ Play it: <https://markzuckerbergas.github.io/make-ready/>**

Built with [Phaser](https://phaser.io) + [Vite](https://vitejs.dev) +
[`@strudel/web`](https://www.npmjs.com/package/@strudel/web). No art assets —
every sprite is generated at boot.

## How to play

Push east for treasure; fall back west to the village to heal and rally
fallen allies. Free movement, no turns — the camera follows you across
the world.

| Input | Action |
|---|---|
| WASD / arrows | move (facing follows your movement) |
| **X** / TAB | switch weapon — stow the rifle, draw the sword (takes a moment) |
| click | attack with the weapon in hand (rifle aims at the cursor) |
| **R** | reload the Martini-Henry (single shot, slow reload) |
| SPACE | sword swing — strikes **the direction you're facing** |

Commands to your two allies — formations are **relative to your facing**
(facing north, "behind me" is south of you):

| Key | Order | Effect |
|---|---|---|
| **1** | FORM LINE | firing line abreast of you, perpendicular to your facing |
| **2** | BEHIND ME | they line up at your back — you skirmish, they cover |
| **Q** | MAKE READY | allies brace and aim |
| **E** | FIRE! | volley — **readied volleys get bonus accuracy & damage** |
| **3** | FIRE AT WILL | independent fire, no ready bonus |
| **4** | CHARGE | swords out, run the enemy down |

### Risk & reward

- **Supply crates** heal the whole squad — scattered everywhere.
- **Artifacts** shimmer and are worth treasure: *common → rare → epic →
  legendary*, with rarity set by the danger of the ground they lie on.
  The legendary ones are only found deep east.
- There are no waves: enemy pressure is continuous and scales with how far
  east you stand. West of the palisade is safe — enemies refuse to enter,
  resting there heals you, and fallen allies rejoin after a few seconds.

## The adaptive music

One Strudel `stack()` starts on your first click and is **never replaced**.
The game writes a snapshot every frame; a `MusicDirector` eases six mood
variables toward targets from it, and every layer's gain (plus some filter
cutoffs) is a `signal()` reading those variables live:

- **home** — a music-box line that only lives near the village hearth
- **dread** — a low pulse that grows with the danger gradient, even before
  any enemy shows (the east *feels* wrong before it *is* wrong)
- **combat** — marching kick and military snare
- **intensity** — enemy count + squad wounds + depth: adds a snare roll,
  a second kick, drive hats, and opens the bass filter
- **hope** — major arps bloom in as the last enemies fall
- **victory** — a fanfare when the skirmish is won, held ~5 s, then decaying
  slowly back into calm

Everything is diatonic to C major / A minor, so any crossfade between moods
stays musical. See [`src/music.js`](./src/music.js) — the whole system is
~170 lines. The technique comes from the simpler
[adaptive-strudel](https://github.com/markzuckerbergas/adaptive-strudel) POC.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/
```

Deploys to GitHub Pages automatically on push to `main` (see
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)).

## License

**GNU AGPL-3.0** — see [LICENSE](./LICENSE). This game embeds Strudel, which
is [AGPL-3.0 licensed](https://codeberg.org/uzu/strudel/src/branch/main/LICENSE.md);
per its terms, the whole game is AGPL-3.0 open source with its source
published (this repo — the deployed page links back here). Phaser is MIT.
