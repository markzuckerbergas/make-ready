import { initStrudel } from '@strudel/web';

// ---------------------------------------------------------------------------
// MusicDirector — one Strudel stack, started once, never re-evaluated.
//
// The game writes a snapshot every frame; the director eases five mood
// variables toward targets derived from it. Every layer's gain (and some
// filters) is a Strudel signal() reading those variables, so the soundtrack
// follows the journey continuously:
//
//   home    — inside the village: warm, safe
//   dread   — how deep into dangerous ground you are (even with no enemies,
//             the east feels uneasy)
//   combat  — enemies engaged nearby
//   intensity — how bad the fight is (enemy count + squad wounds)
//   hope    — a big engagement is nearly won (enemy count collapsed to ~5%
//             of its peak); small skirmishes just ease combat -> calm
//
// Everything is diatonic to C major / A minor so any crossfade stays musical.
// ---------------------------------------------------------------------------
class MusicDirector {
  constructor() {
    this.mood = { home: 1, dread: 0, combat: 0, intensity: 0, hope: 0 };
    this.defeated = false;
    this.started = false;
    this.ready = Promise.resolve(
      initStrudel({ prebake: () => globalThis.samples('github:tidalcycles/dirt-samples') }),
    );
  }

  // Call from the scene: hooks the (required) first user gesture to start audio.
  attach(scene) {
    if (this.started) return;
    const start = () => this.start();
    scene.input.once('pointerdown', start);
    scene.input.keyboard.once('keydown', start);
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.ready;
    this.buildTrack().play();
  }

  setDefeated(v) { this.defeated = v; }

  // Linear ease toward a target at a per-second rate — slow rates make the
  // long transitions (like the combat tail back to calm) feel gradual.
  ease(key, target, rate, dt) {
    const c = this.mood[key];
    const d = target - c;
    const step = rate * dt;
    this.mood[key] = Math.abs(d) <= step ? target : c + Math.sign(d) * step;
  }

  update(dt, snap) {
    const inCombat = snap.enemies > 0 && !this.defeated;

    this.ease('home', snap.home ? 1 : 0, .4, dt);
    this.ease('dread', snap.danger, .25, dt);
    this.ease('combat', inCombat ? 1 : 0, inCombat ? .45 : .15, dt);

    const enemyFactor = Math.min(1, snap.enemies / 6);
    const hurtFactor = 1 - snap.avgHealth;
    const intensityTarget = inCombat
      ? Math.min(1, .2 + .5 * enemyFactor + .45 * snap.danger + .5 * hurtFactor) : 0;
    this.ease('intensity', intensityTarget, .3, dt);

    // hopeful only when a BIG engagement is nearly won: the enemy count
    // peaked high and has collapsed to ~5% of that peak. Small skirmishes
    // skip it and just ease combat -> calm.
    const nearlyWon = snap.enemies <= Math.max(1, Math.round(snap.peak * .05));
    const hopeful = inCombat && snap.peak >= 4 && nearlyWon;
    this.ease('hope', hopeful ? 1 : 0, hopeful ? .6 : .3, dt);
  }

  buildTrack() {
    // initStrudel() registered all pattern functions on globalThis
    const { note, sound, stack, signal } = globalThis;
    const m = this.mood;
    const sig = fn => signal(fn);
    const calm = () => 1 - m.combat;

    return stack(
      // ---- CALM: wandering ---------------------------------------------------
      // slow warm chords (Am F C G), one every two cycles
      note('<[a2,c3,e3] [f2,a2,c3] [c3,e3,g3] [g2,b2,d3]>/2')
        .sound('triangle').attack(.6).release(1.2).room(.6)
        .lpf(sig(() => 900 + m.hope * 900 - m.dread * 350))
        .gain(sig(() => calm() * .42)),
      // gentle melody over it — thins out as dread creeps in
      note('a3 ~ [c4 e4] ~ g4 ~ e4 ~').slow(2)
        .sound('triangle').room(.5).delay(.25)
        .gain(sig(() => calm() * (1 - m.dread * .6) * .3)),
      // soft tick
      sound('hh*4').gain(sig(() => calm() * .1)),

      // ---- HOME: the village hearth ------------------------------------------
      // music-box line that only lives near the campfire
      note('e5 c5 g4 c5 e5 g5 e5 c5').slow(2)
        .sound('triangle').room(.7).delay(.3)
        .gain(sig(() => calm() * m.home * .22)),

      // ---- DREAD: deep ground, no fight yet ----------------------------------
      // low pulse that grows the further east you walk
      note('a1 ~ ~ ~').sound('sawtooth').lpf(320).attack(.05).release(.6)
        .gain(sig(() => m.dread * (1 - m.combat) * .3)),
      note('[a2 ~ ab2 ~]/2').sound('sawtooth').lpf(500).room(.4)
        .gain(sig(() => m.dread * (1 - m.combat) * .14)),

      // ---- COMBAT: the war machine -------------------------------------------
      sound('bd ~ ~ bd ~ ~ bd ~').gain(sig(() => m.combat * .85)),
      sound('~ sd ~ [sd sd]').gain(sig(() => m.combat * .55)),
      // snare roll — surfaces when the fight gets desperate
      sound('sd*16').gain(sig(() => m.combat * m.intensity * m.intensity * .3)),
      sound('bd*4').gain(sig(() => m.combat * m.intensity * .5)),
      note('[a1 a1 e1 g1]*2').sound('sawtooth')
        .lpf(sig(() => 350 + m.intensity * 1300))
        .gain(sig(() => m.combat * .5)),
      note('[a3 b3 c4 b3]*2').sound('sawtooth').lpf(2000)
        .gain(sig(() => m.combat * (1 - m.hope) * .28)),
      note('~ [a3,c4,e4] ~ [a3,c4,e4]').sound('sawtooth').lpf(1800)
        .gain(sig(() => m.combat * m.intensity * .25)),
      sound('hh*8').gain(sig(() => m.combat * m.intensity * .3)),

      // ---- HOPEFUL: the skirmish is almost won --------------------------------
      note('[c4 e4 g4 c5]*2').sound('triangle').delay(.3).room(.4)
        .gain(sig(() => m.hope * .35)),
      note('<[e4 g4] [c5 b4] [a4 g4] [e4 ~]>').sound('triangle').room(.5)
        .gain(sig(() => m.hope * .3)),

    ).slow(1.25); // default 0.5 cps = 120 BPM @ 4 beats/cycle -> 96 BPM
  }
}

// One instance for the whole app — survives scene restarts so the music
// never cuts when the player retries.
export const music = new MusicDirector();
