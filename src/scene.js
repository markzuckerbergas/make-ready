import Phaser from 'phaser';
import { WORLD_W, PLAY, SAFE_EDGE, dangerAt, dscale, clamp, dist } from './world.js';
import { Player, Ally, Enemy } from './entities.js';
import { music } from './music.js';

const RARITIES = [
  { min: 0,   name: 'common',    value: 50,   tint: 0xb8bcc4 },
  { min: .3,  name: 'rare',      value: 150,  tint: 0x6fb7ff },
  { min: .55, name: 'epic',      value: 400,  tint: 0xb98aff },
  { min: .8,  name: 'legendary', value: 1000, tint: 0xffd35a },
];

export class BattleScene extends Phaser.Scene {
  constructor() { super('battle'); }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------
  create() {
    this.makeTextures();
    this.drawBackground();
    this.buildVillage();
    this.placeScenery();

    this.player = new Player(this, 260, 400);
    this.allies = [new Ally(this, 200, 400, 0), new Ally(this, 320, 400, 1)];
    this.enemies = [];
    this.bullets = [];
    this.placeLoot();

    this.treasure = 0;
    this.spawnT = 2;
    this.engaged = false;   // currently in a fight?
    this.villageT = 0;      // time spent resting in the village
    this.defeated = false;

    this.cameras.main.setBounds(0, 0, WORLD_W, 540);

    this.setupInput();
    this.buildHud();
    music.attach(this);
  }

  setupInput() {
    this.keys = this.input.keyboard.addKeys(
      'W,A,S,D,UP,LEFT,DOWN,RIGHT,SPACE,R,Q,E,X,TAB,ONE,TWO,THREE,FOUR,ENTER');
    this.input.keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT,TAB');

    this.input.on('pointerdown', pointer => {
      if (this.defeated) return;
      const a = Math.atan2(pointer.worldY - (this.player.y - 12), pointer.worldX - this.player.x);
      this.player.attack(a);
    });

    const cmd = (key, fn) => this.input.keyboard.on(`keydown-${key}`, fn);
    cmd('SPACE', () => { if (!this.defeated) this.player.swing(); });
    cmd('R', () => { if (!this.defeated) this.player.reload(); });
    cmd('X', () => { if (!this.defeated) this.player.switchWeapon(); });
    cmd('TAB', () => { if (!this.defeated) this.player.switchWeapon(); });
    cmd('ONE', () => this.command('line', 'FORM LINE!'));
    cmd('TWO', () => this.command('behind', 'BEHIND ME!'));
    cmd('THREE', () => this.command('free', 'FIRE AT WILL!'));
    cmd('FOUR', () => this.command('charge', 'CHAAARGE!'));
    cmd('Q', () => this.makeReady());
    cmd('E', () => this.volley());
    cmd('ENTER', () => { if (this.defeated) { music.setDefeated(false); this.scene.restart(); } });
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

    this.updateCamera(dt);
    this.updateBullets(dt);
    this.updateSpawner(dt);
    this.updateLoot();
    this.updateVillage(dt);
    this.checkDefeat();
    this.drawBars();
    this.updateHudText();

    music.update(dt, this.musicSnapshot());
  }

  updateCamera() {
    // horizontal follow only — vertical is fixed so depth movement
    // doesn't bob the whole screen
    const cam = this.cameras.main;
    const target = clamp(this.player.x - 480, 0, WORLD_W - 960);
    cam.scrollX += (target - cam.scrollX) * .12;
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
      if (b.life <= 0 || b.y < PLAY.horizon - 40 || b.y > 560) {
        b.img.destroy();
        b.dead = true;
      }
    }
    this.bullets = this.bullets.filter(b => !b.dead);
  }

  // Continuous danger-gradient spawner: no waves. The further east the
  // player is, the more (and stronger) enemies keep the pressure on.
  updateSpawner(dt) {
    this.spawnT -= dt;
    if (this.spawnT > 0 || this.defeated) return;
    this.spawnT = .9;

    const danger = dangerAt(this.player.x);
    if (this.player.x < SAFE_EDGE + 100 || danger <= 0) return;

    const alive = this.enemies.filter(e => e.alive).length;
    const maxEnemies = Math.floor(1 + danger * 9);
    if (alive >= maxEnemies) return;
    if (Math.random() > .25 + danger * .4) return;

    const pack = 1 + Math.floor(Math.random() * (1 + danger * 2.5));
    for (let i = 0; i < Math.min(pack, maxEnemies - alive); i++) {
      // spawn just off-screen, biased to the east (deeper = ambushes behind you)
      const side = Math.random() < (.8 - danger * .25) ? 1 : -1;
      const ex = clamp(this.player.x + side * (560 + Math.random() * 260),
        SAFE_EDGE + 250, PLAY.right);
      this.enemies.push(new Enemy(this, ex, PLAY.top + Math.random() * (PLAY.bottom - PLAY.top)));
    }

    // drop enemies the player has long outrun
    for (const e of this.enemies) {
      if (e.alive && Math.abs(e.x - this.player.x) > 1700) {
        e.alive = false;
        e.destroy();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Loot: supply crates heal the squad; artifacts are the reason to go east —
  // rarity and value scale with the danger where they lie.
  // -------------------------------------------------------------------------
  placeLoot() {
    this.loot = [];
    for (let i = 0; i < 16; i++) {
      const x = 700 + Math.random() * (WORLD_W - 900);
      this.addLoot('supply', x);
    }
    for (let i = 0; i < 18; i++) {
      // pow < 1 biases artifact placement eastward, where the danger is
      const x = 900 + Math.pow(Math.random(), .7) * (WORLD_W - 1100);
      this.addLoot('artifact', x);
    }
  }

  addLoot(type, x) {
    const y = PLAY.top + 20 + Math.random() * (PLAY.bottom - PLAY.top - 40);
    const ds = dscale(y);
    const img = this.add.image(x, y - 6 * ds, type === 'supply' ? 'crate' : 'artifact')
      .setScale(ds).setDepth(y);
    let rarity = null;
    if (type === 'artifact') {
      const d = dangerAt(x);
      rarity = RARITIES.filter(r => d >= r.min).pop();
      img.setTint(rarity.tint);
      this.tweens.add({
        targets: img, scale: { from: ds * .85, to: ds * 1.15 },
        yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut',
      });
    }
    this.loot.push({ type, x, y, img, rarity, taken: false });
  }

  updateLoot() {
    for (const l of this.loot) {
      if (l.taken || dist(l, this.player) > 26) continue;
      l.taken = true;
      l.img.destroy();
      if (l.type === 'supply') {
        for (const u of [this.player, ...this.allies]) {
          if (u.alive) u.hp = Math.min(u.maxHp, u.hp + 25);
        }
        this.toast('+25 hp — supplies shared');
      } else {
        this.treasure += l.rarity.value;
        this.announce(`${l.rarity.name} artifact! +${l.rarity.value}`,
          '#' + l.rarity.tint.toString(16).padStart(6, '0'));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Village: safe ground. Resting there heals the squad and rallies fallen
  // allies back to your side.
  // -------------------------------------------------------------------------
  updateVillage(dt) {
    if (this.player.x >= 520 || !this.player.alive) { this.villageT = 0; return; }
    for (const u of [this.player, ...this.allies]) {
      if (u.alive) u.hp = Math.min(u.maxHp, u.hp + 5 * dt);
    }
    this.villageT += dt;
    if (this.villageT > 3) {
      this.villageT = 0;
      const down = this.allies.find(a => !a.alive);
      if (down) {
        down.revive(50);
        down.x = this.player.x + 40;
        down.y = this.player.y;
        this.announce('an ally rejoins the line!', '#9fdcb2');
      }
    }
  }

  checkDefeat() {
    if (!this.player.alive && !this.defeated) {
      this.defeated = true;
      music.setDefeated(true);
      this.add.rectangle(480, 270, 960, 540, 0x000000, .55).setDepth(9998).setScrollFactor(0);
      this.add.text(480, 240, 'you fell', { fontSize: 42, color: '#e05252' })
        .setOrigin(.5).setDepth(9999).setScrollFactor(0);
      this.add.text(480, 292, `treasure recovered: ${this.treasure}`, { fontSize: 20, color: '#ffd35a' })
        .setOrigin(.5).setDepth(9999).setScrollFactor(0);
      this.add.text(480, 322, 'press ENTER to rally the line again', { fontSize: 16, color: '#ccc' })
        .setOrigin(.5).setDepth(9999).setScrollFactor(0);
    }
  }

  musicSnapshot() {
    const near = this.enemies.filter(e => e.alive && dist(e, this.player) < 950).length;
    if (near > 0) this.engaged = true;
    if (this.engaged && near === 0) {
      this.engaged = false;
      if (!this.defeated) music.onCombatWon();
    }
    const squad = [this.player, ...this.allies].filter(u => u.alive);
    const avgHealth = squad.length
      ? squad.reduce((s, u) => s + u.hp / u.maxHp, 0) / squad.length : 0;
    return {
      enemies: near,
      avgHealth,
      danger: dangerAt(this.player.x),
      home: this.player.x < 520,
      defeated: this.defeated,
    };
  }

  // -------------------------------------------------------------------------
  // Feedback text
  // -------------------------------------------------------------------------
  announce(msg, color = '#ffe9a0') {
    const t = this.add.text(480, 150, msg, { fontSize: 26, color, fontStyle: 'bold' })
      .setOrigin(.5).setDepth(9500).setScrollFactor(0);
    this.tweens.add({ targets: t, y: 120, alpha: 0, duration: 1400, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  toast(msg) {
    const t = this.add.text(this.player.x, this.player.y - 46, msg, { fontSize: 13, color: '#ddd' })
      .setOrigin(.5).setDepth(9500);
    this.tweens.add({ targets: t, y: t.y - 18, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  // -------------------------------------------------------------------------
  // HUD (fixed to the screen, not the world)
  // -------------------------------------------------------------------------
  buildHud() {
    this.bars = this.add.graphics().setDepth(9000);
    this.hudLeft = this.add.text(12, 8, '', { fontSize: 14, color: '#eee' })
      .setDepth(9400).setScrollFactor(0);
    this.hudRight = this.add.text(948, 8, '', { fontSize: 14, color: '#eee', align: 'right' })
      .setOrigin(1, 0).setDepth(9400).setScrollFactor(0);
    this.add.text(480, 528,
      'X switch weapon · click attack · R reload · SPACE sword —— 1 line · 2 behind me · 3 fire at will · 4 charge · Q make ready · E FIRE!',
      { fontSize: 12, color: '#8a8f98' }).setOrigin(.5, 1).setDepth(9400).setScrollFactor(0);
  }

  updateHudText() {
    const p = this.player;
    const rifle = p.loaded ? 'LOADED'
      : p.reloadT > 0 ? `reloading ${Math.max(0, p.reloadT).toFixed(1)}s` : 'EMPTY — press R';
    const arm = p.weapon === 'rifle' ? `rifle in hand (${rifle})` : `sword in hand · rifle: ${rifle}`;
    const mode = this.allies.find(a => a.alive)?.mode ?? '-';
    const readied = this.allies.some(a => a.alive && a.readied) ? ' · READIED' : '';
    this.hudLeft.setText(`${arm}\nallies: ${mode}${readied}\ntreasure: ${this.treasure}`);

    const danger = dangerAt(p.x);
    const near = this.enemies.filter(e => e.alive).length;
    const zone = p.x < 520 ? 'village — safe'
      : `danger ${(danger * 100).toFixed(0)}%`;
    this.hudRight.setText(`${zone}\n${near ? `enemies: ${near}` : 'go east for treasure →'}`);
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
      const friendly = u === this.player || u instanceof Ally;
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
  // Look: generated pixel textures + parallax background layers
  // -------------------------------------------------------------------------
  makeTextures() {
    if (this.textures.exists('soldier_blue_rifle')) return; // scene restart

    const soldier = (key, coat, trim, weapon) => {
      const g = this.make.graphics({ add: false });
      g.fillStyle(0x2a2118); g.fillRect(4, 0, 8, 3);        // hat
      g.fillStyle(0xd9a066); g.fillRect(5, 3, 6, 4);        // face
      g.fillStyle(coat); g.fillRect(3, 7, 10, 10);          // coat
      g.fillStyle(trim); g.fillRect(3, 7, 10, 2);           // shoulder trim
      g.fillStyle(0x1d1d24); g.fillRect(4, 17, 3, 5); g.fillRect(9, 17, 3, 5); // legs
      if (weapon === 'rifle') {
        g.fillStyle(0x555); g.fillRect(12, 8, 6, 2);        // rifle held level
      } else if (weapon === 'sword') {
        g.fillStyle(0xc9d4e0); g.fillRect(13, 1, 2, 9);     // blade up
        g.fillStyle(0x8a6d3b); g.fillRect(12, 10, 4, 2);    // guard
      } else if (weapon === 'stowed') {
        g.fillStyle(0x555); g.fillRect(1, 4, 2, 10);        // rifle on the back
      }
      g.generateTexture(key, 18, 22);
      g.destroy();
    };
    soldier('soldier_blue_rifle', 0x2e5ea8, 0x9fc4ff, 'rifle');
    soldier('soldier_blue_sword', 0x2e5ea8, 0x9fc4ff, 'sword');
    soldier('soldier_green', 0x2f7a4d, 0xa8e6bd, 'rifle');
    soldier('soldier_red', 0x9c2f2f, 0xe0a0a0, 'sword');

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

    g = this.make.graphics({ add: false });
    g.fillStyle(0x6d5230); g.fillRect(0, 0, 16, 12);
    g.fillStyle(0x8a6b41); g.fillRect(1, 1, 14, 4);
    g.fillStyle(0x3b2a18); g.fillRect(7, 0, 2, 12); // strap
    g.generateTexture('crate', 16, 12); g.destroy();

    g = this.make.graphics({ add: false });
    g.fillStyle(0xffffff); g.fillTriangle(6, 0, 0, 7, 6, 14); g.fillTriangle(6, 0, 12, 7, 6, 14);
    g.generateTexture('artifact', 12, 14); g.destroy();

    const house = (key, w, h, wall, roof) => {
      const gr = this.make.graphics({ add: false });
      gr.fillStyle(wall); gr.fillRect(0, h * .4, w, h * .6);
      gr.fillStyle(roof); gr.fillTriangle(w / 2, 0, -2, h * .45, w + 2, h * .45);
      gr.fillStyle(0x2a2118); gr.fillRect(w * .42, h * .65, w * .16, h * .35); // door
      gr.fillStyle(0xffd35a); gr.fillRect(w * .15, h * .55, w * .14, w * .14); // lit window
      gr.generateTexture(key, w + 4, h);
      gr.destroy();
    };
    house('house_big', 64, 54, 0x6d5a43, 0x8a3d2e);
    house('house_small', 44, 40, 0x60503c, 0x7a4a33);
  }

  drawBackground() {
    // layer 1: sky — fixed to the camera
    const sky = this.add.graphics().setDepth(-120).setScrollFactor(0);
    [0x1b2340, 0x252f4e, 0x374260, 0x54506b, 0x8a5f5a].forEach((c, i) => {
      sky.fillStyle(c); sky.fillRect(0, i * 30, 960, 30);
    });

    // layer 2: distant mountains — slow parallax
    const mts = this.add.graphics().setDepth(-110).setScrollFactor(.35);
    const mtsW = 960 + (WORLD_W - 960) * .35 + 200;
    mts.fillStyle(0x141a2c);
    for (let x = -60; x < mtsW; x += 300) {
      const h = 60 + ((x * 7919) % 50);
      mts.fillTriangle(x, 150, x + 170, 150 - h, x + 360, 150);
    }
    mts.fillStyle(0xc98a5a, .5).fillRect(0, 146, mtsW, 4);

    // layer 3: ground — scrolls 1:1, bands get darker + taller toward camera
    const g = this.add.graphics().setDepth(-100);
    const groundCols = [0x51603f, 0x4a5939, 0x445234, 0x3d4a2f, 0x37432a, 0x313c26, 0x2b3521, 0x252e1d];
    let y = 150;
    groundCols.forEach((c, i) => {
      const h = 18 + i * 14;
      g.fillStyle(c); g.fillRect(0, y, WORLD_W, h);
      y += h;
    });
    g.fillStyle(0x20281a); g.fillRect(0, y, WORLD_W, 560 - y);
    // village ground is warmer, worn earth
    g.fillStyle(0x4a4030, .55); g.fillRect(0, 150, SAFE_EDGE - 90, 410);
  }

  buildVillage() {
    const spots = [
      [90, 260, 'house_big'], [230, 225, 'house_small'], [150, 350, 'house_small'],
      [320, 300, 'house_big'], [70, 450, 'house_small'],
    ];
    for (const [x, y, key] of spots) {
      const ds = dscale(clamp(y, PLAY.top, PLAY.bottom));
      this.add.image(x, y - 20 * ds, key).setScale(ds * 1.3).setDepth(y);
    }
    // campfire
    const fx = 250, fy = 420;
    const fire = this.add.circle(fx, fy - 6, 6, 0xff9a3d).setDepth(fy);
    this.add.circle(fx, fy, 9, 0x3a2a18).setDepth(fy - .2);
    this.tweens.add({ targets: fire, scale: { from: .8, to: 1.25 }, alpha: { from: .8, to: 1 }, yoyo: true, repeat: -1, duration: 260 });
    this.add.text(200, 190, 'HOMESTEAD — safe ground', { fontSize: 12, color: '#9fdcb2' })
      .setOrigin(.5).setDepth(200);
    // palisade marking the safe edge
    const pal = this.add.graphics().setDepth(PLAY.bottom + 1);
    pal.fillStyle(0x4a3826);
    for (let py = 200; py < 520; py += 26) {
      const ds = dscale(clamp(py, PLAY.top, PLAY.bottom));
      pal.fillRect(SAFE_EDGE - 20, py - 18 * ds, 5 * ds, 20 * ds);
    }
  }

  placeScenery() {
    for (let i = 0; i < 46; i++) {
      const x = 500 + Math.random() * (WORLD_W - 560);
      const y = PLAY.top + Math.random() * (PLAY.bottom - PLAY.top);
      const key = Math.random() < .6 ? 'tree' : 'rock';
      const ds = dscale(y);
      this.add.image(x, y - (key === 'tree' ? 18 : 4) * ds, key).setScale(ds * 1.4).setDepth(y);
      this.add.image(x, y, 'shadow').setScale(ds * (key === 'tree' ? 1.4 : .9)).setAlpha(.25).setDepth(y - .1);
    }
  }
}
