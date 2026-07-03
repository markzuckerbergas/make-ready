import Phaser from 'phaser';
import { BattleScene } from './scene.js';
import { music } from './music.js';
import { sfx } from './sfx.js';

// volume sliders (persisted)
const hook = (id, key, def, apply) => {
  const el = document.getElementById(id);
  if (!el) return;
  const saved = Number(localStorage.getItem(key) ?? def);
  el.value = saved;
  apply(saved / 100);
  el.addEventListener('input', () => {
    localStorage.setItem(key, el.value);
    apply(el.value / 100);
  });
};
hook('musicVol', 'makeready.musicVol', 60, v => music.setVolume(v));
hook('sfxVol', 'makeready.sfxVol', 80, v => sfx.setVolume(v));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 540,
  parent: 'app',
  pixelArt: true,
  backgroundColor: '#0e0f13',
  scene: [BattleScene],
});

// ---- start & pause ---------------------------------------------------------
// The START button is the audio-unlock gesture. Pausing suspends the whole
// AudioContext (no background scheduling = no speaker glitches) and freezes
// the scene; blur/hidden auto-pause, resume is always MANUAL.
const scene = () => game.scene.getScene('battle');
const startOverlay = document.getElementById('startOverlay');
const pauseOverlay = document.getElementById('pauseOverlay');
let paused = false;

function pauseGame() {
  if (paused || !window.__mrStarted) return;
  paused = true;
  window.__mrPaused = true;
  music.pause();
  const sc = scene(); if (sc) sc.userPaused = true;
  pauseOverlay.hidden = false;
}
function resumeGame() {
  if (!paused) return;
  paused = false;
  window.__mrPaused = false;
  music.resume();
  const sc = scene(); if (sc) sc.userPaused = false;
  pauseOverlay.hidden = true;
}

document.getElementById('startBtn').addEventListener('click', () => {
  window.__mrStarted = true;
  music.start();
  startOverlay.hidden = true;
  const sc = scene(); if (sc) sc.userPaused = false;
});
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
window.addEventListener('blur', pauseGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && window.__mrStarted) (paused ? resumeGame() : pauseGame());
});
