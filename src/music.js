import { initStrudel } from '@strudel/web';

// ---------------------------------------------------------------------------
// MusicDirector v3 — village & field play their SIMPLE versions; battle
// plays the FULL composition (see ../music/).
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
// Tab hidden -> the game pauses and so does the music: we SUSPEND the
// AudioContext. Its currentTime freezes, which freezes Strudel's scheduler
// with it — no background scheduling, no crackle. Our playhead clock is
// shifted by the paused duration on resume, so everything stays in sync.
// ---------------------------------------------------------------------------

const CPS = .5;            // @strudel/web scheduler default (120 BPM @ 4/cycle)
const SLOW = 1.25;         // slows the whole stack to 96 BPM
const RATE = CPS / SLOW;   // song-cycles per second (one cycle = 2.5 s)
const LEN = { village: 16, field: 16, battle: 56 };

class MusicDirector {
  constructor() {
    this.w = { village: 1, field: 0, battle: 0 };          // crossfade weights
    this.zone = 'village';
    this.pending = null;
    this.commitAt = null;
    this.off = { village: 0, field: null, battle: null };  // playhead offsets
    this.pos = { village: 0, field: 0, battle: 0 };        // parked playheads
    this.startedAt = null;
    this.started = false;
    this.userVol = .6;   // page slider; default keeps overall level modest
    this.pausedAt = null; // tab hidden
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
  setVolume(v) { this.userVol = v; }

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
        // any transition involving battle is urgent — next whole cycle;
        // village<->field wait for the 4-cycle grid so harmony lines up
        const grid = (want === 'battle' || this.zone === 'battle') ? 1 : 4;
        this.commitAt = Math.ceil(now / grid) * grid;
      }
      if (this.nowCycles() >= this.commitAt - .02) this.commit(want);
    } else {
      this.pending = null;
      this.commitAt = null;
    }

    // battle enters and leaves faster than the calm songs swap
    const IN = { village: .4, field: .4, battle: .55 };
    const OUT = { village: .3, field: .3, battle: .5 };
    for (const k of ['village', 'field', 'battle']) {
      const target = k === this.zone ? 1 : 0;
      const rate = target ? IN[k] : OUT[k];
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
    const vol = () => this.userVol;
    stack(
      // per-song masters (1 / .85 / .6) folded into the faders
      buildVillage().late(this.off.village ?? 0)
        .postgain(signal(() => w.village * vol())),
      buildField().late(this.off.field ?? 0)
        .postgain(signal(() => w.field * .85 * vol())),
      buildBattle().late(this.off.battle ?? 0)
        .postgain(signal(() => w.battle * .6 * vol())),
    ).slow(SLOW).analyze(1).play();
  }

  // Tab hidden -> suspend the whole audio engine (a true pause: the pattern
  // clock freezes). Resume shifts our playhead clock by the paused duration.
  watchVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (!this.started) return;
      const ctx = globalThis.getAudioContext?.();
      if (document.hidden) {
        if (this.pausedAt === null) {
          this.pausedAt = performance.now();
          ctx?.suspend();
        }
      } else if (this.pausedAt !== null) {
        this.startedAt += performance.now() - this.pausedAt;
        this.pausedAt = null;
        ctx?.resume();
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

  const theme = o => note(`<
    [ab${o} g${o} eb${o} c${o}]*4
    [g${o} f${o} eb${o} bb${o - 1}]*4
    [bb${o} a${o} g${o} d${o}]*4
    [c${o + 1} bb${o} a${o} f${o}]*4
  >/2`);

  const rhTheme = theme(3).sound('piano').room(.1).gain('[.78 .55 .66 .55]*4');
  const rhFar = theme(3).sound('piano').lpf(1300).room(.45).gain('[.38 .26 .32 .26]*4');
  const rhMid = theme(3).sound('piano').room(.15).gain('[.5 .35 .42 .35]*4');
  const sparkMid = theme(4).sound('piano').room(.4).gain(.13);
  const rhHigh = theme(4).sound('piano').room(.12).gain(.32);

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
  const taikoFill = sound('<~ [~ ~ [~ framedrum:15] [framedrum:13 framedrum:16]]>')
    .speed(rand.range(.95, 1.05)).gain(.9);

  const snareVoice = p => sound(p)
    .n('[18 19 17 19 16 19 18 19]').speed(rand.range(.97, 1.03));
  const snareCallA = snareVoice(`<
    [[snare_low*4] snare_low ~ [~ snare_low]]
    [[snare_low*4] snare_low [snare_low*4] [snare_low snare_low]]
  >`).gain('[.95 1.35 1.05 1.25]');
  const snareCallB = snareVoice(`<
    [[snare_low*4] snare_low [snare_low*4] snare_low]
    [[snare_low*4] [snare_low snare_low] [snare_low*4] [snare_low snare_low snare_low]]
  >`).gain('[1 1.3 1.05 1.25]');
  const snareCallC = snareVoice(`<
    [snare_low [snare_low*4] [~ snare_low] [snare_low*4]]
    [[snare_low*4] [snare_low*4] snare_low [snare_low snare_low snare_low]]
  >`).gain('[1.35 1.05 1.25 1.1]');

  const drumsCore = stack(taiko, taikoFill, snareCallA);
  const drumsClash = stack(taiko, taikoFill, snareCallB);
  const drumsSurge = stack(
    taiko, taikoFill, snareCallC,
    sound('snare_low*16').n(13).gain('[.35 .22 .27 .22]*4'),
    sound('[~ tambourine]*4').gain(.22),
  );
  const drumsEye = stack(
    sound('bassdrum1 ~ bassdrum1 ~').n('[5 6]').speed(rand.range(.95, 1.05)).gain(.9),
    snareVoice(`<
      [[snare_low*4] snare_low ~ [~ snare_low]]
      [[snare_low*4] snare_low [snare_low*4] [snare_low snare_low]]
    >`).gain('[.6 .85 .65 .8]').room(.4),
    sound('<~ timpani_roll:2 ~ timpani_roll:5>').gain(.3),
    sound('<sus_cymbal ~ ~ ~>').gain(.16),
  );

  const lhEye = note('<[f2 c3 ab2 c3]*2 [db2 ab2 f2 ab2]*2>/2')
    .sound('piano').room(.3).gain(.5);
  const rhEye = note('<[ab3 ~ g3 ~] [f3 ~ ab3 ~]>/2')
    .sound('piano').room(.35).gain(.42);

  return arrange(
    [8, stack(bassSaw, ostinato, drumsCore)],
    [8, stack(bassSaw, ostinato, drumsCore, rhFar)],
    [8, stack(bassSaw, ostinato, drumsClash, rhMid, sparkMid)],
    [8, stack(lhDrive, rhTheme, ostinato, bassSaw, drumsSurge)],
    [8, stack(lhEye, rhEye, drumsEye)],
    [8, stack(lhDrive, rhTheme, rhHigh, ostinato, bassSaw, drumsSurge)],
    [8, stack(bassSaw, ostinato, drumsCore, rhFar)],
  );
}

// One instance for the whole app — survives scene restarts so the music
// never cuts when the player retries.
export const music = new MusicDirector();
