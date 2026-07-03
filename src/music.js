import { initStrudel } from '@strudel/web';

// ---------------------------------------------------------------------------
// MusicDirector v3 — plays the SIMPLE versions of the three songs
// (../music/*-simple.strudel; the full compositions live alongside them).
//
// Transition intelligence:
//  * zone changes COMMIT only on the shared 4-cycle grid — and because every
//    village/field section is built from the same 4-cycle Cm->Ab loop, any
//    grid-aligned crossfade has BOTH songs on the same chord at the same time
//  * village & field keep a playhead: first entry starts at 0, returning
//    resumes where it left off (snapped to the same 4-cycle grid)
//  * battle always enters at its alarm — that section IS the transition
//  * battle entries commit on a 1-cycle grid (combat can't wait 10 s)
//  * crossfade faders are postgain signals: in ~2.5s, out ~4s, beat-locked
//
// Background tabs throttle the scheduler and cause glitches, so the director
// pauses (hush + frozen playheads) when the tab hides and resumes on return.
// ---------------------------------------------------------------------------

const CPS = .5;            // @strudel/web scheduler default (120 BPM @ 4/cycle)
const SLOW = 1.25;         // slows the whole stack to 96 BPM
const RATE = CPS / SLOW;   // song-cycles per second (one cycle = 2.5 s)
const LEN = { village: 16, field: 16, battle: 16 };

class MusicDirector {
  constructor() {
    this.w = { village: 1, field: 0, battle: 0 };          // crossfade weights
    this.zone = 'village';
    this.pending = null;
    this.commitAt = null;
    this.off = { village: 0, field: null, battle: null };  // playhead offsets
    this.pos = { village: 0, field: 0, battle: 0 };        // parked playheads
    this.startedAt = null;
    this.pausedAt = null;
    this.started = false;
    this.defeated = false;
    this._lvl = 0;
    this.ready = Promise.resolve(initStrudel({
      prebake: () => Promise.all([
        globalThis.samples('github:tidalcycles/dirt-samples'),
        // Salamander Grand Piano by Alexander Holm (CC-BY 3.0)
        globalThis.samples('https://strudel.b-cdn.net/piano.json', 'https://strudel.b-cdn.net/piano/'),
        // VCSL orchestral percussion (CC0, Versilian Studios)
        globalThis.samples('https://strudel.b-cdn.net/vcsl.json', 'https://strudel.b-cdn.net/VCSL/'),
      ]),
    }));
  }

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
    this.startedAt = performance.now();
    this.rebuild();
    this.watchVisibility();
    this.startMeter();
  }

  setDefeated(v) { this.defeated = v; }

  nowCycles() {
    return this.startedAt === null ? 0
      : ((performance.now() - this.startedAt) / 1000) * RATE;
  }

  update(dt, snap) {
    if (!this.started || this.startedAt === null || this.pausedAt !== null) return;
    const want = this.defeated ? 'village' : snap.zone;

    if (want !== this.zone) {
      if (this.pending !== want) {
        this.pending = want;
        const now = this.nowCycles();
        // battle can't wait for a phrase — commit on the next whole cycle;
        // village<->field wait for the 4-cycle grid so harmony lines up
        const grid = want === 'battle' ? 1 : 4;
        this.commitAt = Math.ceil(now / grid) * grid;
      }
      if (this.nowCycles() >= this.commitAt - .02) this.commit(want);
    } else {
      this.pending = null;
      this.commitAt = null;
    }

    for (const k of ['village', 'field', 'battle']) {
      const target = k === this.zone ? 1 : 0;
      const rate = target ? .4 : .25; // ~2.5s in, ~4s out
      const d = target - this.w[k];
      const step = rate * dt;
      this.w[k] = Math.abs(d) <= step ? target : this.w[k] + Math.sign(d) * step;
    }
  }

  commit(zone) {
    const T = this.commitAt ?? this.nowCycles();
    const leaving = this.zone;
    if (this.off[leaving] !== null) {
      this.pos[leaving] = ((T - this.off[leaving]) % LEN[leaving] + LEN[leaving]) % LEN[leaving];
    }
    // battle is a ramp: always from the alarm. Others resume, grid-snapped.
    const p = zone === 'battle' ? 0
      : (Math.floor((this.pos[zone] ?? 0) / 4) * 4) % LEN[zone];
    this.off[zone] = T - p;
    this.zone = zone;
    this.pending = null;
    this.commitAt = null;
    this.rebuild(); // in-phase hot swap; the entering song is ~silent right now
  }

  rebuild() {
    const { stack, signal } = globalThis;
    const w = this.w;
    stack(
      // per-song masters (1 / .85 / .6) folded into the faders
      buildVillage().late(this.off.village ?? 0)
        .postgain(signal(() => w.village)),
      buildField().late(this.off.field ?? 0)
        .postgain(signal(() => w.field * .85)),
      buildBattle().late(this.off.battle ?? 0)
        .postgain(signal(() => w.battle * .6)),
    ).slow(SLOW).analyze(1).play();
  }

  // Pause when the tab hides: background timer throttling starves the
  // scheduler and crackles — silence beats glitches. Playheads freeze.
  watchVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (!this.started) return;
      if (document.hidden) {
        this.pausedAt = performance.now();
        globalThis.hush();
      } else if (this.pausedAt !== null) {
        this.startedAt += performance.now() - this.pausedAt;
        this.pausedAt = null;
        this.rebuild();
      }
    });
  }

  // VU meter on the page, fed by the stack's analyser
  startMeter() {
    const fill = document.getElementById('vuFill');
    if (!fill) return;
    const tick = () => {
      let lvl = 0;
      try {
        const data = globalThis.getAnalyzerData?.('time', 1);
        if (data?.length) {
          let sum = 0, n = 0;
          for (let i = 0; i < data.length; i += 8) { sum += data[i] * data[i]; n++; }
          lvl = Math.min(1, Math.sqrt(sum / n) * 2.5);
        }
      } catch { /* analyser not ready yet */ }
      this._lvl = Math.max(lvl, this._lvl * .92); // fast attack, slow release
      fill.style.width = `${(this._lvl * 100).toFixed(1)}%`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// ---------------------------------------------------------------------------
// The simple songs — JS ports of ../music/*-simple.strudel (celesta plays as
// quiet piano an octave up: @strudel/web has no GM soundfonts).
// ---------------------------------------------------------------------------

function buildVillage() {
  const { note, stack, arrange } = globalThis;
  const lhA = note('<[c3 g3 c4 g3]*2 [ab2 eb3 ab3 eb3]*2>/2')
    .sound('piano').room(.1).gain(.55);
  const rhTheme = note(`<
    [[eb4 d4 bb3 g3]!3 [g4 f4 d4 bb3]]
    [[c4 bb3 ab3 eb3]!3 [eb4 d4 c4 g3]]
  >/2`).sound('piano').room(.15).gain('[.72 .5 .6 .52]*4');
  const sparkle = note(`<
    [[eb5 d5 bb4 g4]!3 [g5 f5 d5 bb4]]
    [[c5 bb4 ab4 eb4]!3 [eb5 d5 c5 g4]]
  >/2`).sound('piano').room(.45).gain(.15);
  return arrange(
    [8, stack(lhA, rhTheme)],
    [8, stack(lhA, rhTheme, sparkle)],
  );
}

function buildField() {
  const { note, sound, stack, arrange } = globalThis;
  const lhDrive = note('<[c3 g3 eb3 g3]*4 [ab2 eb3 c3 eb3]*4>/2')
    .sound('piano').gain('[.6 .42 .5 .42]*8');
  const rhHalf = note('<[eb4 d4 bb3 g3] [c4 bb3 ab3 eb3]>/2')
    .sound('piano').room(.25).gain(.5);
  const rhRoad = note(`<
    [[eb4 d4 bb3 g3]!2 [eb4 [d4 eb4] f4 g4] [bb4 g4 f4 d4]]
    [[c4 bb3 ab3 eb3]!2 [c4 [bb3 c4] d4 eb4] [g4 eb4 d4 bb3]]
  >/2`).sound('piano').room(.12).gain('[.72 .5 .6 .52]*4');
  const stepLight = stack(
    sound('framedrum:12 ~ ~ ~').gain(.7),
    sound('shaker_small*4').gain('[.25 .15]*2'),
  );
  const stepRoad = stack(
    sound('framedrum:12 ~ [~ framedrum:14] ~').gain(.7),
    sound('~ snare_rim:3 ~ snare_rim:3').gain(.4),
    sound('shaker_small*8').n('[0 2 4 1]*2').gain('[.25 .15]*4'),
  );
  return arrange(
    [8, stack(lhDrive, rhHalf, stepLight)],
    [8, stack(lhDrive, rhRoad, stepRoad)],
  );
}

function buildBattle() {
  const { note, sound, stack, arrange, rand } = globalThis;
  const rhTheme = note(`<
    [ab3 g3 eb3 c3]*4
    [g3 f3 eb3 bb2]*4
    [bb3 a3 g3 d3]*4
    [c4 bb3 a3 f3]*4
  >/2`).sound('piano').room(.1).gain('[.78 .55 .66 .55]*4');
  const rhFar = note(`<
    [ab3 g3 eb3 c3]*4
    [g3 f3 eb3 bb2]*4
    [bb3 a3 g3 d3]*4
    [c4 bb3 a3 f3]*4
  >/2`).sound('piano').lpf(1300).room(.45).gain('[.38 .26 .32 .26]*4');
  const lhDrive = note(`<
    [f2 c3 ab2 c3]*4
    [eb2 bb2 g2 bb2]*4
    [g2 d3 bb2 d3]*4
    [f2 c3 a2 c3]*4
  >/2`).sound('piano').gain('[.6 .42 .5 .42]*8');
  const bassSaw = note('<f1 eb1 g1 f1>/2').struct('x*8')
    .sound('sawtooth').lpf(650).gain(.38);
  const ostinato = note(`<
    [f3 ab3 c4 ab3]*8
    [eb3 g3 bb3 g3]*8
    [g3 bb3 d4 bb3]*8
    [f3 a3 c4 a3]*8
  >/2`).sound('sawtooth').lpf(1400).gain(.2);
  const taiko = sound(`<
    [bassdrum1 [~ bassdrum1] bassdrum1 [bassdrum1 bassdrum1]]
    [bassdrum1 [~ bassdrum1] ~ bassdrum1]
  >`).n('[6 5 7 5 6 7 5 6]').speed(rand.range(.94, 1.06)).gain('[1.3 1 .8 1.05]');
  const snareCall = sound(`<
    [[snare_low*4] snare_low ~ [~ snare_low]]
    [[snare_low*4] snare_low [snare_low*4] [snare_low snare_low]]
  >`).n('[18 19 17 19 16 19 18 19]').speed(rand.range(.97, 1.03))
    .gain('[.95 1.35 1.05 1.25]');
  return arrange(
    [8, stack(bassSaw, ostinato, taiko, snareCall, rhFar)],
    [8, stack(lhDrive, rhTheme, bassSaw, ostinato, taiko, snareCall)],
  );
}

// One instance for the whole app — survives scene restarts so the music
// never cuts when the player retries.
export const music = new MusicDirector();
