import { initStrudel } from '@strudel/web';

// ---------------------------------------------------------------------------
// MusicDirector — one Strudel stack, started once, never re-evaluated.
//
// The game writes a snapshot every frame; the director eases five mood
// variables toward targets derived from it. Every layer's gain (and some
// filters) is a Strudel signal() reading those variables, so the soundtrack
// follows the battle continuously (same architecture as the adaptive-strudel
// POC, but with a full mood cycle):
//
//   calm ──(enemies spawn)──▶ combat ──(intensity: enemy count + squad hp)
//     ▲                          │
//     │                          ▼ (enemies almost gone)
//   (victory fades out) ◀── victory ◀── hopeful
//
// Everything is diatonic to C major / A minor so any crossfade between moods
// stays musical.
// ---------------------------------------------------------------------------
class MusicDirector {
  constructor() {
    this.mood = { combat: 0, intensity: 0, hope: 0, victory: 0 };
    this.victoryHold = 0;
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

  onWaveCleared() {
    if (this.defeated) return;
    this.victoryHold = 6; // seconds of fanfare before drifting back to calm
  }

  // Linear ease toward a target at a per-second rate — slow rates make the
  // long transitions (combat tail, victory fade) feel gradual.
  ease(key, target, rate, dt) {
    const c = this.mood[key];
    const d = target - c;
    const step = rate * dt;
    this.mood[key] = Math.abs(d) <= step ? target : c + Math.sign(d) * step;
  }

  update(dt, snap) {
    this.victoryHold = Math.max(0, this.victoryHold - dt);
    const inCombat = snap.enemies > 0 && !this.defeated;

    this.ease('combat', inCombat ? 1 : 0, inCombat ? .4 : .15, dt);

    const enemyFactor = Math.min(1, snap.enemies / Math.max(4, snap.waveMax || 4));
    const hurtFactor = 1 - snap.avgHealth;
    const intensityTarget = inCombat
      ? Math.min(1, .25 + .55 * enemyFactor + .6 * hurtFactor) : 0;
    this.ease('intensity', intensityTarget, .3, dt);

    const hopeful = inCombat && snap.spawningDone && snap.enemies <= 2;
    this.ease('hope', hopeful ? 1 : 0, hopeful ? .5 : .35, dt);

    const victoryTarget = this.victoryHold > 0 && !this.defeated ? 1 : 0;
    this.ease('victory', victoryTarget, victoryTarget ? 1.2 : .12, dt);
  }

  buildTrack() {
    // initStrudel() registered all pattern functions on globalThis
    const { note, sound, stack, signal } = globalThis;
    const m = this.mood;
    const sig = fn => signal(fn);
    const calm = () => (1 - m.combat) * (1 - m.victory);

    return stack(
      // ---- CALM: wandering, no danger --------------------------------------
      // slow warm chords (Am F C G), one every two cycles
      note('<[a2,c3,e3] [f2,a2,c3] [c3,e3,g3] [g2,b2,d3]>/2')
        .sound('triangle').attack(.6).release(1.2).room(.6)
        .lpf(sig(() => 900 + m.hope * 900))
        .gain(sig(() => calm() * .42)),
      // gentle melody over it
      note('a3 ~ [c4 e4] ~ g4 ~ e4 ~').slow(2)
        .sound('triangle').room(.5).delay(.25)
        .gain(sig(() => calm() * .3)),
      // soft tick
      sound('hh*4').gain(sig(() => calm() * .1)),

      // ---- COMBAT: the war machine -----------------------------------------
      // marching kick
      sound('bd ~ ~ bd ~ ~ bd ~').gain(sig(() => m.combat * .85)),
      // military snare pattern
      sound('~ sd ~ [sd sd]').gain(sig(() => m.combat * .55)),
      // snare roll — only surfaces when the fight gets desperate
      sound('sd*16').gain(sig(() => m.combat * m.intensity * m.intensity * .3)),
      // driving second kick at high intensity
      sound('bd*4').gain(sig(() => m.combat * m.intensity * .5)),
      // bass ostinato, opens up with intensity
      note('[a1 a1 e1 g1]*2').sound('sawtooth')
        .lpf(sig(() => 350 + m.intensity * 1300))
        .gain(sig(() => m.combat * .5)),
      // tense inner line — yields to the hopeful lead as the tide turns
      note('[a3 b3 c4 b3]*2').sound('sawtooth').lpf(2000)
        .gain(sig(() => m.combat * (1 - m.hope) * .28)),
      // chord stabs + drive hats at high intensity
      note('~ [a3,c4,e4] ~ [a3,c4,e4]').sound('sawtooth').lpf(1800)
        .gain(sig(() => m.combat * m.intensity * .25)),
      sound('hh*8').gain(sig(() => m.combat * m.intensity * .3)),

      // ---- HOPEFUL: the enemy is almost broken ------------------------------
      note('[c4 e4 g4 c5]*2').sound('triangle').delay(.3).room(.4)
        .gain(sig(() => m.hope * .35)),
      note('<[e4 g4] [c5 b4] [a4 g4] [e4 ~]>').sound('triangle').room(.5)
        .gain(sig(() => m.hope * .3)),

      // ---- VICTORY: fanfare, then it decays into calm -----------------------
      note('<[c4 c4 c4 e4] [g4 g4 ~ e4] [g4 ~ c5 ~] [c5 ~ ~ ~]>')
        .sound('sawtooth').lpf(2500).delay(.25).room(.4)
        .gain(sig(() => m.victory * .5)),
      note('[c3,e3,g3,c4]').sound('sawtooth').attack(.4).release(1)
        .lpf(1600).room(.5)
        .gain(sig(() => m.victory * .3)),
    ).slow(1.25); // default 0.5 cps = 120 BPM @ 4 beats/cycle -> 96 BPM
  }
}

// One instance for the whole app — survives scene restarts so the music
// never cuts when the player retries.
export const music = new MusicDirector();
