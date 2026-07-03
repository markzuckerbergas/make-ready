// Tiny one-shot sound effects with plain Web Audio. Strudel carries the
// adaptive MUSIC; these are the foley (shots, steel, ramrod clicks).
// The context is created lazily on first use — every trigger is
// input-driven, so we're always past the browser's gesture requirement.

let ctx;
const ac = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());
let volume = .8; // page slider

function noiseBurst(dur, filterType, freq, gainVal, sweepTo) {
  const c = ac();
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freq, c.currentTime);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, c.currentTime + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gainVal * volume, c.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, c.currentTime + dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start();
}

function click(freq, when = 0, gainVal = .12) {
  const c = ac();
  const t = c.currentTime + when;
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(gainVal * volume, t);
  g.gain.exponentialRampToValueAtTime(.001, t + .04);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + .05);
}

export const sfx = {
  setVolume(v) { volume = v; },

  // musket crack: noise burst + a low thump
  shot() {
    noiseBurst(.22, 'lowpass', 2800, .35, 400);
    const c = ac();
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(45, c.currentTime + .15);
    const g = c.createGain();
    g.gain.setValueAtTime(.4 * volume, c.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, c.currentTime + .18);
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + .2);
  },
  // steel swish: short band-swept noise
  sword() {
    noiseBurst(.12, 'bandpass', 1400, .18, 4200);
  },
  // ramrod down the barrel: click at start...
  reloadStart() {
    click(650);
  },
  // ...and a clack-clack when the round is seated
  reloadDone() {
    click(900);
    click(1200, .09);
  },
};
