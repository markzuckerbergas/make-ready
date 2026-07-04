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
  window.__touchMove = { x: 0, y: 0 }; // never resume into a stuck stick
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

// ---- touch controls ------------------------------------------------------------
// Virtual stick writes a vector the scene reads alongside the keyboard;
// buttons call the same handlers the keys do. Shown only on touch devices.
window.__touchMove = { x: 0, y: 0 };
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  const ui = document.getElementById('touchUI');
  if (ui) {
    ui.hidden = false;
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stickKnob');
    const setStick = (dx, dy) => {
      const len = Math.hypot(dx, dy);
      const max = 45;
      const cl = len > max ? max / len : 1;
      knob.style.left = `${35 + dx * cl}px`;
      knob.style.top = `${35 + dy * cl}px`;
      window.__touchMove = len < 12 ? { x: 0, y: 0 }
        : { x: (dx * cl) / max, y: (dy * cl) / max };
    };
    const onTouch = e => {
      e.preventDefault();
      const r = stick.getBoundingClientRect();
      const t = e.touches[0];
      setStick(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
    };
    stick.addEventListener('touchstart', onTouch, { passive: false });
    stick.addEventListener('touchmove', onTouch, { passive: false });
    stick.addEventListener('touchend', e => { e.preventDefault(); setStick(0, 0); }, { passive: false });
    stick.addEventListener('touchcancel', () => setStick(0, 0)); // notification shade etc.

    const ACTS = {
      shoot: sc => sc.touchShoot(),
      sword: sc => sc.player.swing(),
      reload: sc => sc.player.reload(),
      ready: sc => sc.makeReady(),
      volley: sc => sc.volley(),
      behind: sc => sc.command('behind', 'BEHIND ME!'),
      will: sc => sc.command('free', 'FIRE AT WILL!'),
      charge: sc => sc.command('charge', 'CHAAARGE!'),
      cover: sc => sc.command('cover', 'COVER ME!'),
      shop: sc => sc.toggleShop(),
    };
    ui.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('touchstart', e => {
        e.preventDefault();
        const sc = scene();
        if (sc && !sc.userPaused && !sc.defeated) ACTS[btn.dataset.act]?.(sc);
      }, { passive: false });
    });
  }
}

// ---- feedback form (Web3Forms) -----------------------------------------------
// Submitted with fetch so the player never leaves the game. While typing,
// the game's keyboard is suspended — SPACE should type a space, not swing
// a sword — and Phaser's key capture is released so keys reach the field.
const fbForm = document.getElementById('fbForm');
if (fbForm) {
  const setTyping = typing => {
    const sc = scene();
    if (!sc?.input?.keyboard) return;
    sc.input.keyboard.enabled = !typing;
    if (typing) sc.input.keyboard.disableGlobalCapture();
    else sc.input.keyboard.enableGlobalCapture();
  };
  fbForm.addEventListener('focusin', () => setTyping(true));
  fbForm.addEventListener('focusout', () => setTyping(false));

  fbForm.addEventListener('submit', async e => {
    e.preventDefault();
    const status = document.getElementById('fbStatus');
    status.textContent = 'sending…';
    try {
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        body: new FormData(fbForm),
      });
      const data = await res.json();
      if (data.success) {
        status.textContent = 'received — thank you! ✔';
        fbForm.reset();
      } else {
        status.textContent = 'that misfired — try again in a moment';
      }
    } catch {
      status.textContent = 'no courier available — check your connection';
    }
  });
}
