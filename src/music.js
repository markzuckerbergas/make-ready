import { initStrudel } from '@strudel/web';

// ---------------------------------------------------------------------------
// MusicDirector v2 — three composed songs (see ../music/*.strudel):
//   village (52 cycles) · field/departure (40) · battle (56)
//
// The game reports a ZONE each frame; the director crossfades between songs
// with postgain faders (signals — they scale a song without disturbing its
// internal mix) and keeps a PLAYHEAD per song:
//   * the first time a song is entered it starts from its beginning
//   * returning to a zone resumes its song roughly where it left off,
//     snapped to a 4-cycle phrase so the resume lands musically
// All three songs share 96 BPM, so crossfades stay beat-locked.
// ---------------------------------------------------------------------------

const CPS = .5;            // @strudel/web scheduler default (120 BPM @ 4/cycle)
const SLOW = 1.25;         // slows the whole stack to 96 BPM
const RATE = CPS / SLOW;   // song-cycles per second (one cycle = 2.5 s)
const LEN = { village: 52, field: 40, battle: 56 };

class MusicDirector {
  constructor() {
    this.w = { village: 1, field: 0, battle: 0 };          // crossfade weights
    this.zone = 'village';
    this.off = { village: 0, field: null, battle: null };  // playhead offsets
    this.pos = { village: 0, field: 0, battle: 0 };        // parked playheads
    this.startedAt = null;
    this.started = false;
    this.defeated = false;
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
  }

  setDefeated(v) { this.defeated = v; }

  nowCycles() {
    return this.startedAt === null ? 0
      : ((performance.now() - this.startedAt) / 1000) * RATE;
  }

  // Zone change: park the leaving song's playhead, aim the entering song so
  // it resumes (or starts at 0 on first entry), and hot-swap the stack —
  // safe because the entering song is still ~silent when its offset jumps.
  setZone(zone) {
    if (zone === this.zone) return;
    if (!this.started || this.startedAt === null) { this.zone = zone; return; }
    const now = this.nowCycles();
    const leaving = this.zone;
    if (this.off[leaving] !== null) {
      this.pos[leaving] = (now - this.off[leaving]) % LEN[leaving];
    }
    const p = (Math.floor((this.pos[zone] ?? 0) / 4) * 4) % LEN[zone];
    this.off[zone] = now - p;
    this.zone = zone;
    this.rebuild();
  }

  update(dt, snap) {
    this.setZone(this.defeated ? 'village' : snap.zone);
    for (const k of ['village', 'field', 'battle']) {
      const target = k === this.zone ? 1 : 0;
      const rate = target ? .5 : .35; // fade in a touch faster than out
      const d = target - this.w[k];
      const step = rate * dt;
      this.w[k] = Math.abs(d) <= step ? target : this.w[k] + Math.sign(d) * step;
    }
  }

  rebuild() {
    const { stack, signal } = globalThis;
    const w = this.w;
    stack(
      // per-song masters (village 1 / field .85 / battle .6) are folded
      // into the crossfade faders
      buildVillage().late(this.off.village ?? 0)
        .postgain(signal(() => w.village)),
      buildField().late(this.off.field ?? 0)
        .postgain(signal(() => w.field * .85)),
      buildBattle().late(this.off.battle ?? 0)
        .postgain(signal(() => w.battle * .6)),
    ).slow(SLOW).play();
  }
}

// ---------------------------------------------------------------------------
// The songs — JS ports of ../music/*.strudel (celesta layers play as quiet
// piano an octave up: @strudel/web has no GM soundfonts).
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

  const theme = octave => note(`<
    [ab${octave} g${octave} eb${octave} c${octave}]*4
    [g${octave} f${octave} eb${octave} bb${octave - 1}]*4
    [bb${octave} a${octave} g${octave} d${octave}]*4
    [c${octave + 1} bb${octave} a${octave} f${octave}]*4
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
