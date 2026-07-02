import Phaser from 'phaser';
import { BattleScene } from './scene.js';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 540,
  parent: 'app',
  pixelArt: true,
  backgroundColor: '#0e0f13',
  scene: [BattleScene],
});
