import { initStrudel } from '@strudel/web';

// ---------------------------------------------------------------------------
// MusicDirector v5 — the FULL compositions, crossfaded on the phrase grid.
//
// Zone changes COMMIT on the outgoing song's phrase grid (4 cycles calm,
// 1 cycle when battle/boss is involved), then postgain faders ease the two
// songs across each other — beat-locked, and grid alignment keeps the
// shared Cm/Ab loop consonant during calm crossfades.
//
// Playheads: village & field resume (snapped to the 4-cycle phrase grid);
// battle & boss always enter from the top — their openings are the ramp.
//
// The playhead clock is the AudioContext clock itself (the same clock the
// scheduler runs on), so pause/suspend can never desync it and there is no
// drift between clock domains.
// ---------------------------------------------------------------------------

const CPS = .5;            // @strudel/web scheduler default (120 BPM @ 4/cycle)
const SLOW = 1.25;         // slows the whole stack to 96 BPM
const RATE = CPS / SLOW;   // song-cycles per second (one cycle = 2.5 s)
const LEN = { village: 52, field: 40, battle: 56, boss: 16 };
const MASTER = { village: 1, field: .85, battle: 1.1, boss: .6 };
const SONGS = ['village', 'field', 'battle', 'boss'];
const urgent = z => z === 'battle' || z === 'boss';

class MusicDirector {
  constructor() {
    this.zone = 'village';
    this.w = { village: 1, field: 0, battle: 0, boss: 0 }; // crossfade weights
    this.pending = null;
    this.commitAt = null;
    this.off = { village: 0, field: null, battle: null, boss: null };
    this.pos = { village: 0, field: 0, battle: 0, boss: 0 };
    this.ctxAnchor = null;  // AudioContext time at play start — SAME clock as
                            // the scheduler, so playhead math can never drift
    this.paused = false;
    this.started = false;
    this.lastWant = 'village';
    this.wantSince = 0;
    this.nextTransOk = 0;
    this.userVol = .6;
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

  async start() {
    if (this.started) return;
    this.started = true;
    await this.ready;
    const ctx = globalThis.getAudioContext?.();
    this.ctxAnchor = ctx ? ctx.currentTime : 0;
    this.rebuild();
    if (this.paused) ctx?.suspend(); // pause was requested during the load
    this.startMeter();
  }

  // Suspending the AudioContext freezes ITS clock — which is also our
  // playhead clock — so pause needs no bookkeeping and cannot desync.
  pause() {
    if (this.paused) return;
    this.paused = true;
    globalThis.getAudioContext?.()?.suspend();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    globalThis.getAudioContext?.()?.resume();
  }

  setDefeated(v) { this.defeated = v; }
  setVolume(v) { this.userVol = v; }

  nowCycles() {
    if (this.ctxAnchor === null) return 0;
    const ctx = globalThis.getAudioContext?.();
    return ctx ? (ctx.currentTime - this.ctxAnchor) * RATE : 0;
  }

  update(dt, snap) {
    if (!this.started || this.ctxAnchor === null || this.paused) return;
    const now = this.nowCycles();
    const want = this.defeated ? 'village' : snap.zone;
    if (want !== this.lastWant) { this.lastWant = want; this.wantSince = now; }

    if (want !== this.zone) {
      // hysteresis: a zone must persist before we act on it
      const dwell = urgent(want) ? .35 : 1.2; // in cycles (~0.9s / 3s)
      if (now - this.wantSince >= dwell) {
        if (this.pending !== want) {
          this.pending = want;
          // commit on the OUTGOING song's phrase grid (its local frame)
          const grid = (urgent(want) || urgent(this.zone)) ? 1 : 4;
          const base = this.off[this.zone] ?? 0;
          this.commitAt = base + Math.ceil((now - base + .05) / grid) * grid;
        }
        if (now >= this.commitAt - .02) this.commit(want);
      }
    } else {
      this.pending = null;
      this.commitAt = null;
    }

    // battle enters and leaves faster than the calm songs swap
    const IN = { village: .4, field: .4, battle: .55, boss: .55 };
    const OUT = { village: .3, field: .3, battle: .5, boss: .5 };
    for (const k of SONGS) {
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
    // battle/boss are ramps: always from the top. Others resume, grid-snapped.
    const p = urgent(zone) ? 0
      : (Math.floor((this.pos[zone] ?? 0) / 4) * 4) % LEN[zone];
    this.off[zone] = T - p;
    this.zone = zone;
    this.pending = null;
    this.commitAt = null;
    this.rebuild(); // in-phase hot swap; the entering song is ~silent right now
  }

  rebuild() {
    const { stack, signal } = globalThis;
    const vol = () => this.userVol;
    stack(...SONGS.map(k =>
      BUILDERS[k]().late(this.off[k] ?? 0)
        .postgain(signal(() => this.w[k] * MASTER[k] * vol())),
    )).slow(SLOW).analyze(1).play();
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
      this._lvl = Math.max(lvl, this._lvl * .92);
      fill.style.width = `${(this._lvl * 100).toFixed(1)}%`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// ---------------------------------------------------------------------------
// The FULL songs (JS ports of ../music/*.strudel; celesta layers play as
// quiet piano an octave up — @strudel/web has no GM soundfonts).
// ---------------------------------------------------------------------------

function buildVillage() {
  const { note, stack, arrange } = globalThis;

  const lhA = note('<[c3 g3 c4 g3]*2 [ab2 eb3 ab3 eb3]*2>/2')
    .sound('piano').room(.1).gain(.55);
  const rhIntro = note('<[eb4 d4 bb3 g3] [c4 bb3 ab3 eb3]>/2')
    .sound('piano').room(.25).gain(.5);
  const rhTheme = note(`<
    [[eb4 d4 bb3 g3]!3 [g4 f4 d4 bb3]]
    [[c4 bb3 ab3 eb3]!3 [eb4 d4 c4 g3]]
  >/2`).sound('piano').room(.15).gain('[.72 .5 .6 .52]*4');
  const sparkle = note(`<
    [[eb5 d5 bb4 g4]!3 [g5 f5 d5 bb4]]
    [[c5 bb4 ab4 eb4]!3 [eb5 d5 c5 g4]]
  >/2`).sound('piano').room(.45).gain(.15);
  const counter = note('<[g3 ~ f3 eb3] [eb3 ~ d3 c3]>/2')
    .sound('piano').room(.25).gain(.32);
  const lhB = note('<[f2 c3 f3 c3] [bb2 f3 bb3 f3] [eb3 bb3 eb4 bb3] [g2 d3 g3 b3]>')
    .sound('piano').room(.15).gain(.55);
  const rhB = note('<[f4 g4 ab4 c5] [d5 c5 bb4 f4] [eb5 bb4 g4 bb4] [d5 b4 g4 ~]>')
    .sound('piano').room(.2).gain('[.7 .52 .6 .52]');
  const sparkleB = note('<[c5 ~ ~ ~] [f5 ~ ~ ~] [g5 ~ ~ ~] [d5 ~ b4 ~]>')
    .sound('piano').room(.45).gain(.12);

  return arrange(
    [8, stack(lhA, rhIntro)],
    [8, stack(lhA, rhTheme)],
    [8, stack(lhA, rhTheme, sparkle)],
    [8, stack(lhB, rhB, sparkleB)],
    [12, stack(lhA, rhTheme, sparkle, counter)],
    [8, stack(lhA.gain(.5), rhIntro.gain(.45), sparkle.gain(.08))],
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
  const sparkle = note(`<
    [[eb5 d5 bb4 g4]!2 [eb5 [d5 eb5] f5 g5] [bb5 g5 f5 d5]]
    [[c5 bb4 ab4 eb4]!2 [c5 [bb4 c5] d5 eb5] [g5 eb5 d5 bb4]]
  >/2`).sound('piano').room(.45).gain(.13);
  const lhUnknown = note('<[ab2 eb3 ab3 c4]*2 [bb2 f3 ab3 db4]*2>/2')
    .sound('piano').room(.25).gain(.5);
  const rhUnknown = note('<[c5 ~ bb4 ~] [ab4 ~ f4 ~]>/2')
    .sound('piano').room(.35).gain(.45);
  const lhRidge = note('<[f2 c3 f3 ab3] [eb2 bb2 eb3 g3] [bb2 f3 bb3 d4] [g2 d3 g3 b3]>')
    .sound('piano').room(.15).gain(.55);
  const rhRidge = note('<[f4 ab4 c5 ab4] [g4 bb4 eb5 bb4] [f5 d5 bb4 f4] [d5 b4 g4 b4]>')
    .sound('piano').room(.15).gain('[.7 .52 .62 .52]');

  const stepLight = stack(
    sound('framedrum:12 ~ ~ ~').gain(.7),
    sound('shaker_small*4').gain('[.25 .15]*2'),
  );
  const stepRoad = stack(
    sound('framedrum:12 ~ [~ framedrum:14] ~').gain(.7),
    sound('~ snare_rim:3 ~ snare_rim:3').gain(.4),
    sound('shaker_small*8').n('[0 2 4 1]*2').gain('[.25 .15]*4'),
    sound('~ ~ ~ tambourine').gain(.25),
  );
  const stepUnknown = stack(
    sound('bassdrum1:5 ~ ~ ~').gain(.6),
    sound('<sus_cymbal ~ ~ ~>').gain(.16),
  );
  const stepRidge = stack(
    sound('<timpani:4 timpani:9 timpani:14 timpani_roll:2>').gain(.6),
    sound('~ snare_rim:3 ~ [snare_rim:2 snare_rim:3]').gain(.4),
    sound('shaker_small*8').gain('[.28 .16]*4'),
  );
  const stepHome = stack(
    sound('framedrum:12 ~ [~ framedrum:14] ~').gain(.7),
    sound('~ snare_rim:3 ~ snare_rim:3').gain(.4),
    sound('shaker_small*8').n('[0 2 4 1]*2').gain('[.28 .16]*4'),
    sound('~ ~ ~ tambourine').gain(.28),
    sound('<timpani:4 ~ timpani:9 ~>').gain(.5),
  );

  return arrange(
    [8, stack(lhDrive, rhHalf, stepLight)],
    [8, stack(lhDrive, rhRoad, stepRoad)],
    [8, stack(lhUnknown, rhUnknown, stepUnknown)],
    [8, stack(lhRidge, rhRidge, stepRidge)],
    [8, stack(lhDrive, rhRoad, sparkle, stepHome)],
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

function buildBoss() {
  const { note, sound, stack, arrange, rand } = globalThis;
  const stomp = sound('bassdrum1 ~ ~ [~ bassdrum1]').n(7)
    .speed(rand.range(.88, .98)).gain(1.5);
  const timp = sound('<timpani:17 ~ timpani:19 ~>').gain(.9);
  const bass = note('<[f1 ~ gb1 ~] [f1 ~ e1 ~]>/2')
    .sound('sawtooth').lpf(380).gain(.55);
  const growl = note('f1').struct('x*16').sound('sawtooth').lpf(200).gain(.22);
  const piano = note('<[f4 ~ gb4 ~] [~ e4 ~ f4]>/2')
    .sound('piano').room(.3).gain(.5);
  const roll = sound('snare_low*16').n(11).gain('[.2 .12 .15 .12]*4');
  const cym = sound('<sus_cymbal ~ ~ ~>').gain(.25);
  return arrange(
    [8, stack(stomp, timp, bass, growl, piano)],
    [8, stack(stomp, timp, bass, growl, piano, roll, cym)],
  );
}

const BUILDERS = {
  village: buildVillage,
  field: buildField,
  battle: buildBattle,
  boss: buildBoss,
};

// One instance for the whole app — survives scene restarts so the music
// never cuts when the player retries.
export const music = new MusicDirector();
