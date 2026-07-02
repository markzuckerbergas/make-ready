# make ready — FIRE!

A musket-line action game with an **adaptive [Strudel](https://strudel.cc)
soundtrack**. You command a small firing line in a Final-Fantasy-style
2.5D field — free movement, no turns — and the music follows the battle:
calm while you wander, building combat intensity with the enemy count and
your squad's wounds, turning hopeful as the enemy breaks, a victory fanfare,
then smoothly back to calm.

**▶ Play it: <https://markzuckerbergas.github.io/make-ready/>**

Built with [Phaser](https://phaser.io) + [Vite](https://vitejs.dev) +
[`@strudel/web`](https://www.npmjs.com/package/@strudel/web). No art assets —
every sprite is generated at boot.

## How to play

You carry two weapons and your voice carries two soldiers.

| Input | Action |
|---|---|
| WASD / arrows | move (free movement — up is away from camera) |
| mouse | aim |
| click | fire the Martini-Henry (single shot!) |
| **R** | reload (takes a moment — find cover or draw steel) |
| SPACE | sword swing (melee) |

Commands to your two allies:

| Key | Order | Effect |
|---|---|---|
| **1** | FORM LINE | flank you, hold fire |
| **2** | BEHIND ME | line up behind you — you skirmish, they cover |
| **Q** | MAKE READY | allies brace and aim |
| **E** | FIRE! | volley — **readied volleys get bonus accuracy & damage** |
| **3** | FIRE AT WILL | independent fire, no ready bonus |
| **4** | CHARGE | swords out, run the enemy down |

The drill matters: `Q` then `E` is a disciplined volley (tight spread, hard
hits); fire-at-will is faster but wilder. Enemies come in growing waves with
a breather between them.

## The adaptive music

One Strudel `stack()` starts on your first click and is **never replaced**.
The game writes a snapshot every frame (enemy count, squad health, wave
state); a `MusicDirector` eases four mood variables toward targets from it,
and every layer's gain (plus some filter cutoffs) is a `signal()` reading
those variables live:

```
calm ──(enemies spawn)──▶ combat ──(intensity ~ enemies + wounds)
  ▲                          │
  │                          ▼ (enemies almost gone)
(victory fades out) ◀── victory ◀── hopeful
```

- **calm** — warm Am/F/C/G chords, gentle melody
- **combat** — marching kick and military snare; intensity adds a snare roll,
  a second kick, drive hats, and opens the bass filter
- **hopeful** — major arps bloom in as the last enemies fall, the tense inner
  line yields
- **victory** — a fanfare layer on wave clear, held ~6 s, then decaying slowly
  into calm

Everything is diatonic to C major / A minor, so any crossfade between moods
stays musical. See [`src/music.js`](./src/music.js) — the whole system is
~150 lines. The technique comes from the simpler
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
