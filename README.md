# make ready — FIRE!

A musket-line expedition game with an **adaptive [Strudel](https://strudel.cc)
soundtrack**. Your homestead lies at the western edge of a long stretch of
wild country. The deeper east you push, the more (and stronger) enemies you
meet — and the better the artifacts you can carry home. The music follows the
journey: warm at the hearth, uneasy in deep ground, driving in combat (scaling
with enemy numbers and your squad's wounds), hopeful as a big engagement
finally breaks, then smoothly back to calm.

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
| **Q** | MAKE READY | everyone reloads (you too, rifle in hand) and allies brace |
| **E** | FIRE! | volley — **readied volleys get bonus accuracy & damage** |
| **1** | FORM LINE | firing line abreast of you — only holds while you stand still |
| **2** | BEHIND ME | (default) they cover from your back |
| **3** | FIRE AT WILL | hold current position and keep shooting; wildest aim, self-reloading |
| **4** | CHARGE | swords out, run the enemy down |

The drill is real: after a volley the muskets stay **empty** until you order
MAKE READY. Q → E is the rhythm of the line.

### The enemy

Five types, unlocked as the ground gets more dangerous — the coat color tells
you what you're facing:

| Type | Coat | Danger | Behaviour |
|---|---|---|---|
| grunt | dark red | anywhere | melee, slow |
| skirmisher | orange | >12% | rifle, wild aim, keeps distance |
| runner | bright crimson | >30% | melee, fast |
| marksman | purple | >50% | rifle, deadly aim, long range |
| veteran | black & gold | >70% | rifle at range, sabre up close |

Rifle enemies take seconds to reload — their reload bar shows above their
heads. That's your window to charge.

### Cover

Trees and rocks are solid: units slide around them, and their trunks and
bodies stop musket balls — for both sides. Duck behind a boulder while a
marksman reloads; watch skirmishers do the same to you.

### Risk & reward

- **Supply crates** heal the whole squad — scattered everywhere.
- **Artifacts** shimmer and are worth treasure: *common → rare → epic →
  legendary*, with rarity set by the danger of the ground they lie on.
  The legendary ones are only found deep east. Loot is only **banked when
  you carry it back to the village** — fall in the field and everything
  you were carrying is lost (what's banked stays).
- There are no waves: enemy pressure is continuous and scales with how far
  east you stand — but clearing an engagement buys you ~30 seconds of quiet
  in that area to loot and reload. West of the palisade is safe — enemies
  refuse to enter, resting there heals you, and fallen allies rejoin after
  a few seconds.

## The adaptive music

One Strudel `stack()` starts on your first click and is **never replaced**.
The game writes a snapshot every frame; a `MusicDirector` eases five mood
variables toward targets from it, and every layer's gain (plus some filter
cutoffs) is a `signal()` reading those variables live:

- **home** — a music-box line that only lives near the village hearth
- **dread** — a low pulse that grows with the danger gradient, even before
  any enemy shows (the east *feels* wrong before it *is* wrong)
- **combat** — marching kick and military snare
- **intensity** — enemy count + squad wounds + depth: adds a snare roll,
  a second kick, drive hats, and opens the bass filter
- **hope** — major arps bloom in only when a *big* engagement (4+ enemies at
  its peak) collapses to its last stragglers; small skirmishes just ease
  from combat back to calm

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
