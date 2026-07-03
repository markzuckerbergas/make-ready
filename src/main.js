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

new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 540,
  parent: 'app',
  pixelArt: true,
  backgroundColor: '#0e0f13',
  scene: [BattleScene],
});
