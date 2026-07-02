import Phaser from 'phaser';
import { PLAY, dscale, clamp, dist } from './world.js';
import { Player, Ally, Enemy } from './entities.js';
import { music } from './music.js';

export class BattleScene extends Phaser.Scene {
  constructor() { super('battle'); }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------
  create() {
    this.makeTextures();
    this.drawBackground();
    this.placeScenery();

    this.player = new Player(this, 300, 400);
    this.allies = [new Ally(this, 230, 400, 0), new Ally(this, 370, 400, 1)];
    this.enemies = [];
    this.bullets = [];

    // wave machine: explore -> spawning -> combat -> (cleared) -> explore
    this.wave = 1;
    this.state = 'explore';
    this.stateT = 6;
    this.toSpawn = 0;
    this.spawnT = 0;
    this.waveMax = 0;
    this.spawningDone = false;
    this.defeated = false;

    this.setupInput();
    this.buildHud();
    music.attach(this);
  }

  setupInput() {
    this.keys = this.input.keyboard.addKeys(
      'W,A,S,D,UP,LEFT,DOWN,RIGHT,SPACE,R,Q,E,ONE,TWO,THREE,FOUR,ENTER');

    this.input.on('pointerdown', pointer => {
      if (this.defeated) return;
      this.player.fire(this.aimAngle(pointer));
    });

    const cmd = (key, fn) => this.input.keyboard.on(`keydown-${key}`, fn);
    cmd('SPACE', () => { if (!this.defeated) this.player.sword(this.aimAngle(this.input.activePointer)); });
    cmd('R', () => { if (!this.defeated) this.player.reload(); });
    cmd('ONE', () => this.command('line', 'FORM LINE!'));
    cmd('TWO', () => this.command('behind', 'BEHIND ME!'));
    cmd('THREE', () => this.command('free', 'FIRE AT WILL!'));
    cmd('FOUR', () => this.command('charge', 'CHAAARGE!'));
    cmd('Q', () => this.makeReady());
    cmd('E', () => this.volley());
    cmd('ENTER', () => { if (this.defeated) { music.setDefeated(false); this.scene.restart(); } });
  }

  aimAngle(pointer) {
    return Math.atan2(pointer.y - (this.player.y - 12), pointer.x - this.player.x);
  }

  // -------------------------------------------------------------------------
  // Commands to the allies
  // -------------------------------------------------------------------------
  command(mode, shout) {
    if (this.defeated) return;
    for (const a of this.allies) { if (a.alive) { a.mode = mode; a.readied = false; } }
    this.announce(shout);
  }

  makeReady() {
    if (this.defeated) return;
    let any = false;
    for (const a of this.allies) {
      if (a.alive && a.mode !== 'charge') { a.readied = true; any = true; }
    }
    if (any) this.announce('MAKE READY!');
  }

  volley() {
    if (this.defeated) return;
    this.announce('FIRE!');
    // slight ripple so the volley cracks like a line of muskets
    this.allies.forEach((a, i) =>
      this.time.delayedCall(i * 90, () => a.volley(this)));
  }

  // -------------------------------------------------------------------------
  // Combat helpers (used by entities)
  // -------------------------------------------------------------------------
  shoot(unit, angle, spreadDeg, dmg) {
    const spread = (Math.random() - .5) * 2 * spreadDeg * (Math.PI / 180);
    const a = angle + spread;
    const ds = dscale(unit.y);
    const mx = unit.x + Math.cos(a) * 16 * ds;
    const my = unit.y - 13 * ds + Math.sin(a) * 6;
    const img = this.add.image(mx, my, 'bullet').setRotation(a).setDepth(unit.y);
    this.bullets.push({ x: mx, y: my, vx: Math.cos(a) * 950, vy: Math.sin(a) * 950, dmg, life: .8, img });
    this.muzzleFx(mx, my);
  }

  muzzleFx(x, y) {
    const flash = this.add.circle(x, y, 5, 0xffe9a0).setDepth(9000);
    this.tweens.add({ targets: flash, alpha: 0, scale: 2, duration: 90, onComplete: () => flash.destroy() });
    const smoke = this.add.circle(x, y - 4, 7, 0xcccccc, .5).setDepth(9000);
    this.tweens.add({ targets: smoke, alpha: 0, scale: 2.6, y: y - 22, duration: 700, onComplete: () => smoke.destroy() });
  }

  melee(unit, angle, range, dmg) {
    this.slashFx(unit.x, unit.y - 10, angle, 0xd8ecff);
    const r = range * dscale(unit.y);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(unit, e);
      if (d > r) continue;
      const toward = Math.atan2(e.y - unit.y, e.x - unit.x);
      let diff = Math.abs(toward - angle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < 1.25) e.takeDamage(dmg);
    }
  }

  slashFx(x, y, angle, color) {
    const arc = this.add.arc(x, y, 26, Phaser.Math.RadToDeg(angle) - 45,
      Phaser.Math.RadToDeg(angle) + 45, false, color, .7).setDepth(9000);
    this.tweens.add({ targets: arc, alpha: 0, scale: 1.5, duration: 160, onComplete: () => arc.destroy() });
  }

  nearestEnemy(unit, range) {
    let best = null, bd = range;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(unit, e);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  nearestSquad(enemy) {
    let best = null, bd = Infinity;
    for (const u of [this.player, ...this.allies]) {
      if (!u.alive) continue;
      const d = dist(enemy, u);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------
  update(_, deltaMs) {
    const dt = Math.min(deltaMs / 1000, .05);

    const k = this.keys;
    this.player.update(dt, {
      left: k.A.isDown || k.LEFT.isDown,
      right: k.D.isDown || k.RIGHT.isDown,
      up: k.W.isDown || k.UP.isDown,
      down: k.S.isDown || k.DOWN.isDown,
    });
    for (const a of this.allies) a.update(dt, this);
    for (const e of this.enemies) e.update(dt, this);
    this.enemies = this.enemies.filter(e => !e.removed);

    this.updateBullets(dt);
    this.updateWaves(dt);
    this.checkDefeat();
    this.drawBars();
    this.updateHudText();

    music.update(dt, this.musicSnapshot());
  }

  updateBullets(dt) {
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      b.img.setPosition(b.x, b.y);
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Math.hypot(e.x - b.x, (e.y - 13 * dscale(e.y)) - b.y) < 15 * dscale(e.y)) {
          e.takeDamage(b.dmg);
          b.life = 0;
          break;
        }
      }
      if (b.life <= 0 || b.x < 0 || b.x > 960 || b.y < PLAY.horizon - 40 || b.y > 560) {
        b.img.destroy();
        b.dead = true;
      }
    }
    this.bullets = this.bullets.filter(b => !b.dead);
  }

  updateWaves(dt) {
    const alive = this.enemies.filter(e => e.alive).length;

    if (this.state === 'explore') {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.waveMax = Math.min(9, 2 + this.wave);
        this.toSpawn = this.waveMax;
        this.spawnT = 0;
        this.spawningDone = false;
        this.state = 'spawning';
        this.announce('enemy column approaching!', '#e05252');
      }
    } else if (this.state === 'spawning') {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.toSpawn > 0) {
        this.toSpawn--;
        this.spawnT = .45;
        const x = PLAY.left + 60 + Math.random() * (PLAY.right - PLAY.left - 120);
        this.enemies.push(new Enemy(this, x, PLAY.top + Math.random() * 35, this.wave));
      }
      if (this.toSpawn === 0) { this.state = 'combat'; this.spawningDone = true; }
    } else if (this.state === 'combat') {
      if (alive === 0 && !this.defeated) {
        music.onWaveCleared();
        this.announce(`wave ${this.wave} cleared!`, '#9fdcb2');
        this.wave++;
        this.state = 'explore';
        this.stateT = 13;
      }
    }
  }

  checkDefeat() {
    if (!this.player.alive && !this.defeated) {
      this.defeated = true;
      music.setDefeated(true);
      this.add.rectangle(480, 270, 960, 540, 0x000000, .55).setDepth(9998);
      this.add.text(480, 250, 'you fell', { fontSize: 42, color: '#e05252' }).setOrigin(.5).setDepth(9999);
      this.add.text(480, 300, 'press ENTER to rally the line again', { fontSize: 18, color: '#ccc' }).setOrigin(.5).setDepth(9999);
    }
  }

  musicSnapshot() {
    const squad = [this.player, ...this.allies].filter(u => u.alive);
    const avgHealth = squad.length
      ? squad.reduce((s, u) => s + u.hp / u.maxHp, 0) / squad.length : 0;
    return {
      enemies: this.enemies.filter(e => e.alive).length,
      waveMax: this.waveMax,
      spawningDone: this.spawningDone,
      avgHealth,
      defeated: this.defeated,
    };
  }

  // -------------------------------------------------------------------------
  // Feedback text
  // -------------------------------------------------------------------------
  announce(msg, color = '#ffe9a0') {
    const t = this.add.text(480, 150, msg, { fontSize: 26, color, fontStyle: 'bold' })
      .setOrigin(.5).setDepth(9500);
    this.tweens.add({ targets: t, y: 120, alpha: 0, duration: 1400, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  toast(msg) {
    const t = this.add.text(this.player.x, this.player.y - 46, msg, { fontSize: 13, color: '#ddd' })
      .setOrigin(.5).setDepth(9500);
    this.tweens.add({ targets: t, y: t.y - 18, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------
  buildHud() {
    this.bars = this.add.graphics().setDepth(9000);
    this.hudLeft = this.add.text(12, 8, '', { fontSize: 14, color: '#eee' }).setDepth(9400);
    this.hudRight = this.add.text(948, 8, '', { fontSize: 14, color: '#eee', align: 'right' })
      .setOrigin(1, 0).setDepth(9400);
    this.add.text(480, 528,
      '1 line · 2 behind me · 3 fire at will · 4 charge · Q make ready · E FIRE! —— move WASD · aim mouse · click shoot · R reload · SPACE sword',
      { fontSize: 12, color: '#8a8f98' }).setOrigin(.5, 1).setDepth(9400);
  }

  updateHudText() {
    const p = this.player;
    const rifle = p.loaded ? 'rifle: LOADED'
      : p.reloadT > 0 ? `rifle: reloading ${Math.max(0, p.reloadT).toFixed(1)}s`
      : 'rifle: EMPTY — press R';
    const mode = this.allies.find(a => a.alive)?.mode ?? '-';
    const readied = this.allies.some(a => a.alive && a.readied) ? ' · READIED' : '';
    this.hudLeft.setText(`${rifle}\nallies: ${mode}${readied}`);

    const alive = this.enemies.filter(e => e.alive).length;
    const next = this.state === 'explore' ? `next wave in ${Math.ceil(this.stateT)}s` : `enemies: ${alive}`;
    this.hudRight.setText(`wave ${this.wave}\n${next}`);
  }

  drawBars() {
    const g = this.bars;
    g.clear();
    const units = [this.player, ...this.allies, ...this.enemies];
    for (const u of units) {
      if (!u.alive) continue;
      const ds = dscale(u.y);
      const w = 26 * ds, x = u.x - w / 2, y = u.y - 34 * ds;
      g.fillStyle(0x000000, .5).fillRect(x, y, w, 3);
      const friendly = u !== this.player ? (u instanceof Ally) : true;
      g.fillStyle(u === this.player ? 0x6fb7ff : friendly ? 0x3ecf6a : 0xe05252, .9)
        .fillRect(x, y, w * (u.hp / u.maxHp), 3);
      if (u.readied) g.fillStyle(0xffe9a0, 1).fillCircle(u.x, y - 5, 2.5);
      if (u === this.player && u.reloadT > 0) {
        g.fillStyle(0x000000, .5).fillRect(x, y + 5, w, 2);
        g.fillStyle(0xe8c33a, .9).fillRect(x, y + 5, w * (1 - u.reloadT / u.reloadTime), 2);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Look: generated pixel textures + layered background for the fake-3D feel
  // -------------------------------------------------------------------------
  makeTextures() {
    if (this.textures.exists('soldier_blue')) return; // scene restart

    const soldier = (key, coat, trim) => {
      const g = this.make.graphics({ add: false });
      g.fillStyle(0x2a2118); g.fillRect(4, 0, 8, 3);        // hat
      g.fillStyle(0xd9a066); g.fillRect(5, 3, 6, 4);        // face
      g.fillStyle(coat); g.fillRect(3, 7, 10, 10);          // coat
      g.fillStyle(trim); g.fillRect(3, 7, 10, 2);           // shoulder trim
      g.fillStyle(0x1d1d24); g.fillRect(4, 17, 3, 5); g.fillRect(9, 17, 3, 5); // legs
      g.fillStyle(0x555); g.fillRect(12, 8, 6, 2);          // weapon stub
      g.generateTexture(key, 18, 22);
      g.destroy();
    };
    soldier('soldier_blue', 0x2e5ea8, 0x9fc4ff);
    soldier('soldier_green', 0x2f7a4d, 0xa8e6bd);
    soldier('soldier_red', 0x9c2f2f, 0xe0a0a0);

    let g = this.make.graphics({ add: false });
    g.fillStyle(0x000000); g.fillEllipse(10, 4, 20, 8);
    g.generateTexture('shadow', 20, 8); g.destroy();

    g = this.make.graphics({ add: false });
    g.fillStyle(0xffe9a0); g.fillRect(0, 0, 7, 2);
    g.generateTexture('bullet', 7, 2); g.destroy();

    g = this.make.graphics({ add: false });
    g.fillStyle(0x1e3325); g.fillTriangle(14, 0, 0, 34, 28, 34);
    g.fillStyle(0x24402d); g.fillTriangle(14, 8, 3, 30, 25, 30);
    g.fillStyle(0x3a2a1a); g.fillRect(11, 34, 6, 8);
    g.generateTexture('tree', 28, 42); g.destroy();

    g = this.make.graphics({ add: false });
    g.fillStyle(0x4a4f58); g.fillEllipse(9, 7, 18, 12);
    g.fillStyle(0x5c626d); g.fillEllipse(7, 5, 10, 6);
    g.generateTexture('rock', 18, 14); g.destroy();
  }

  drawBackground() {
    const g = this.add.graphics().setDepth(-100);
    // dusk sky bands
    [0x1b2340, 0x252f4e, 0x374260, 0x54506b, 0x8a5f5a].forEach((c, i) => {
      g.fillStyle(c); g.fillRect(0, i * 30, 960, 30);
    });
    // distant mountain silhouettes
    g.fillStyle(0x141a2c);
    g.fillTriangle(-40, 150, 180, 60, 400, 150);
    g.fillTriangle(240, 150, 480, 40, 760, 150);
    g.fillTriangle(600, 150, 830, 75, 1040, 150);
    // horizon glow
    g.fillStyle(0xc98a5a, .5).fillRect(0, 146, 960, 4);
    // ground: bands get darker + taller toward the camera (fake perspective)
    const groundCols = [0x51603f, 0x4a5939, 0x445234, 0x3d4a2f, 0x37432a, 0x313c26, 0x2b3521, 0x252e1d];
    let y = 150;
    groundCols.forEach((c, i) => {
      const h = 18 + i * 14;
      g.fillStyle(c); g.fillRect(0, y, 960, h);
      y += h;
    });
    g.fillStyle(0x20281a); g.fillRect(0, y, 960, 560 - y);
  }

  placeScenery() {
    // a few trees/rocks scaled by depth to sell the perspective
    const spots = [
      [110, 230, 'tree'], [840, 215, 'tree'], [170, 480, 'tree'], [880, 460, 'tree'],
      [520, 210, 'rock'], [340, 300, 'rock'], [700, 350, 'rock'], [90, 350, 'rock'],
    ];
    for (const [x, y, key] of spots) {
      const ds = dscale(clamp(y, PLAY.top, PLAY.bottom));
      this.add.image(x, y - (key === 'tree' ? 18 : 4) * ds, key).setScale(ds * 1.4).setDepth(y);
      this.add.image(x, y, 'shadow').setScale(ds * (key === 'tree' ? 1.4 : .9)).setAlpha(.25).setDepth(y - .1);
    }
  }
}
