import Phaser from 'phaser';
import { WORLD_W, PLAY, SAFE_EDGE, dangerAt, dscale, clamp, dist } from './world.js';
import { Player, Ally, Enemy, Battalion, Giant } from './entities.js';
import { sfx } from './sfx.js';
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

    // banked treasure survives death/restart; carried is lost if you fall
    this.banked = this.registry.get('banked') ?? 0;
    this.carried = 0;
    this.spawnT = 2;
    this.clearedT = 0;   // spawn-suppression countdown after clearing an area
    this.clearedX = 0;   // where the area was cleared
    this.engaged = false;   // currently in a fight?
    this.combatPeak = 0;    // biggest enemy count of the current engagement
    this.villageT = 0;      // time spent resting in the village
    this.defeated = false;
    this.battalions = [];
    this.giant = null;
    this.giantDefeated = false;
    // frozen until the START button; a restart inherits the global pause
    this.userPaused = !window.__mrStarted || !!window.__mrPaused;

    this.cameras.main.setBounds(0, 0, WORLD_W, 540);

    this.setupInput();
    this.buildHud();
  }

  setupInput() {
    this.keys = this.input.keyboard.addKeys(
      'W,A,S,D,UP,LEFT,DOWN,RIGHT,SPACE,R,Q,E,X,TAB,ONE,TWO,THREE,FOUR,ENTER');
    this.input.keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT,TAB');

    this.input.on('pointerdown', pointer => {
      if (this.defeated || this.userPaused) return;
      const a = Math.atan2(pointer.worldY - (this.player.y - 12), pointer.worldX - this.player.x);
      this.player.attack(a);
    });

    const cmd = (key, fn) => this.input.keyboard.on(`keydown-${key}`, fn);
    cmd('SPACE', () => { if (!this.defeated) this.player.swing(); });
    cmd('R', () => { if (!this.defeated) this.player.reload(); });
    cmd('X', () => { if (!this.defeated) this.player.switchWeapon(); });
    cmd('TAB', () => { if (!this.defeated) this.player.switchWeapon(); });
    cmd('ONE', () => {
      if (this.player.moving) { this.toast('hold still to form a line'); return; }
      this.command('line', 'FORM LINE!');
    });
    cmd('TWO', () => this.command('behind', 'BEHIND ME!'));
    cmd('THREE', () => this.command('free', 'FIRE AT WILL!'));
    cmd('FOUR', () => this.command('charge', 'CHAAARGE!'));
    cmd('Q', () => this.makeReady());
    cmd('E', () => this.volley());
    cmd('ENTER', () => {
      if (this.defeated && !this.userPaused) { music.setDefeated(false); this.scene.restart(); }
    });
  }

  // -------------------------------------------------------------------------
  // Commands to the allies
  // -------------------------------------------------------------------------
  command(mode, shout) {
    if (this.defeated) return;
    for (const a of this.allies) { if (a.alive) { a.mode = mode; a.readied = false; } }
    this.announce(shout);
  }

  // MAKE READY is the whole drill in one order: everyone reloads (including
  // the player, if the rifle is in hand) and the allies brace for a volley.
  makeReady() {
    if (this.defeated) return;
    let any = false;
    for (const a of this.allies) {
      if (a.alive && a.mode !== 'charge') { a.readied = true; a.orderReload(); any = true; }
    }
    if (this.player.alive && this.player.weapon === 'rifle') this.player.reload();
    if (any) this.announce('MAKE READY!');
  }

  volley() {
    if (this.defeated) return;
    const able = this.allies.filter(a => a.alive && a.loaded);
    if (!able.length) {
      this.toast(this.allies.some(a => a.alive) ? 'muskets empty — Q to make ready!' : 'no one left to fire…');
      return;
    }
    // spread the volley: each ally aims at a DIFFERENT enemy when possible
    const targets = this.enemies
      .filter(e => e.alive && dist(e, this.player) < 880)
      .sort((a, b) => dist(a, this.player) - dist(b, this.player));
    if (!targets.length) { this.toast('no targets in range'); return; }
    this.announce('FIRE!');
    able.forEach((a, i) =>
      this.time.delayedCall(i * 90, () => a.volleyAt(this, targets[i % targets.length])));
  }

  // -------------------------------------------------------------------------
  // Combat helpers (used by entities)
  // -------------------------------------------------------------------------
  shoot(unit, angle, spreadDeg, dmg, hostile = false, life = .8) {
    const spread = (Math.random() - .5) * 2 * spreadDeg * (Math.PI / 180);
    const a = angle + spread;
    const ds = dscale(unit.y);
    const mx = unit.x + Math.cos(a) * 16 * ds;
    const my = unit.y - 13 * ds + Math.sin(a) * 6;
    const img = this.add.image(mx, my, 'bullet').setRotation(a).setDepth(unit.y);
    this.bullets.push({ x: mx, y: my, vx: Math.cos(a) * 950, vy: Math.sin(a) * 950, dmg, life, img, hostile });
    this.muzzleFx(mx, my);
    sfx.shot();
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
    sfx.sword();
    const arc = this.add.arc(x, y, 26, Phaser.Math.RadToDeg(angle) - 45,
      Phaser.Math.RadToDeg(angle) + 45, false, color, .7).setDepth(9000);
    this.tweens.add({ targets: arc, alpha: 0, scale: 1.5, duration: 160, onComplete: () => arc.destroy() });
  }

  // Formation slots relative to the player's facing: "line" extends
  // perpendicular to it, "behind" is opposite to it. Slots are assigned to
  // whichever ally is CLOSEST (minimal total travel), not by fixed index —
  // so when the player spins around, allies swap slots instead of crossing
  // each other's path diagonally.
  assignFormationSlots() {
    const alive = this.allies.filter(a => a.alive && (a.mode === 'line' || a.mode === 'behind'));
    if (!alive.length) return;
    const p = this.player;
    const fx = p.faceX, fy = p.faceY;
    const px = -fy, py = fx; // perpendicular to facing
    const mode = alive[0].mode;
    const mk = (bx, by, sx, sy) => ({
      x: clamp(bx + sx, PLAY.left, PLAY.right),
      y: clamp(by + sy, PLAY.top, PLAY.bottom),
    });
    const slots = mode === 'behind'
      ? [mk(p.x - fx * 60, p.y - fy * 60, px * -35, py * -35),
         mk(p.x - fx * 60, p.y - fy * 60, px * 35, py * 35)]
      : [mk(p.x, p.y, px * -70, py * -70),
         mk(p.x, p.y, px * 70, py * 70)];

    if (alive.length === 1) {
      const a = alive[0];
      a.targetSlot = dist(a, slots[0]) <= dist(a, slots[1]) ? slots[0] : slots[1];
      return;
    }
    const [a0, a1] = alive;
    const straight = dist(a0, slots[0]) + dist(a1, slots[1]);
    const swapped = dist(a0, slots[1]) + dist(a1, slots[0]);
    if (swapped < straight) { a0.targetSlot = slots[1]; a1.targetSlot = slots[0]; }
    else { a0.targetSlot = slots[0]; a1.targetSlot = slots[1]; }
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

  // Like nearestEnemy, but only counts enemies the player can actually SEE —
  // allies never charge off toward something beyond the camera.
  nearestVisibleEnemy(unit, range) {
    const cx = this.cameras.main.scrollX;
    let best = null, bd = range;
    for (const e of this.enemies) {
      if (!e.alive || e.x < cx - 40 || e.x > cx + 1000) continue;
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
    if (this.userPaused) return;
    const dt = Math.min(deltaMs / 1000, .05);

    const k = this.keys;
    this.player.update(dt, {
      left: k.A.isDown || k.LEFT.isDown,
      right: k.D.isDown || k.RIGHT.isDown,
      up: k.W.isDown || k.UP.isDown,
      down: k.S.isDown || k.DOWN.isDown,
    });
    // a firing line only holds while you stand still — march and it breaks
    if (this.player.moving && this.allies.some(a => a.alive && a.mode === 'line')) {
      for (const a of this.allies) if (a.alive && a.mode === 'line') a.mode = 'behind';
      this.toast('line broken — on me!');
    }
    this.assignFormationSlots();
    for (const a of this.allies) a.update(dt, this);
    for (const b of this.battalions) b.update(dt);
    this.battalions = this.battalions.filter(b => !b.dead);
    for (const e of this.enemies) e.update(dt, this);
    this.enemies = this.enemies.filter(e => !e.removed);
    this.separateUnits();
    this.updateGiant();

    this.updateCamera(dt);
    this.updateSky();
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
      // solid cover: a round that crosses a trunk or boulder stops there
      for (const o of this.obstacles) {
        if (Math.abs(b.x - o.x) < o.r * .85 && b.y > o.y - o.blockH && b.y < o.y + 3) {
          b.life = 0;
          const puff = this.add.circle(b.x, b.y, 4, 0x9aa38a, .7).setDepth(9000);
          this.tweens.add({ targets: puff, alpha: 0, scale: 2, duration: 250, onComplete: () => puff.destroy() });
          break;
        }
      }
      if (b.life <= 0) { b.img.destroy(); b.dead = true; continue; }
      const targets = b.hostile ? [this.player, ...this.allies] : this.enemies;
      for (const u of targets) {
        if (!u.alive) continue;
        if (Math.hypot(u.x - b.x, (u.y - 13 * dscale(u.y)) - b.y) < 15 * dscale(u.y)) {
          u.takeDamage(b.dmg);
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
    this.clearedT = Math.max(0, this.clearedT - dt);
    this.spawnT -= dt;
    if (this.spawnT > 0 || this.defeated) return;
    this.spawnT = .9;

    // a cleared area stays quiet for a while — pushing deeper (or wandering
    // far from where you cleared) ends the respite
    if (this.clearedT > 0 && Math.abs(this.player.x - this.clearedX) < 450) return;

    const danger = dangerAt(this.player.x);
    if (this.player.x < SAFE_EDGE + 100 || danger <= 0) return;
    // the deep east belongs to the giant
    if (this.giant?.alive || (this.player.x > 4300 && !this.giantDefeated)) return;

    const alive = this.enemies.filter(e => e.alive).length;
    const maxEnemies = Math.floor(1 + danger * 9);
    if (alive >= maxEnemies) return;
    if (Math.random() > .25 + danger * .4) return;

    const band = this.enemyBand(danger);
    const spawnX = () => clamp(this.player.x + 560 + Math.random() * 260,
      SAFE_EDGE + 250, PLAY.right); // always from the east
    const spawnY = () => PLAY.top + Math.random() * (PLAY.bottom - PLAY.top);

    if (band[0] === 'battalion') {
      // battalions arrive whole — one at a time, when there's room
      if (!this.battalions.some(b => !b.dead) && alive + 4 <= maxEnemies + 2) {
        this.battalions.push(new Battalion(this, spawnX(), spawnY()));
        this.spawnT = 5;
      }
      return;
    }

    const pack = 1 + Math.floor(Math.random() * (1 + danger * 2.5));
    for (let i = 0; i < Math.min(pack, maxEnemies - alive); i++) {
      this.enemies.push(new Enemy(this, spawnX(), spawnY(),
        band[Math.floor(Math.random() * band.length)]));
    }

    // drop enemies the player has long outrun (never the boss)
    for (const e of this.enemies) {
      if (e.alive && !e.isBoss && Math.abs(e.x - this.player.x) > 1700) {
        e.alive = false;
        e.destroy();
      }
    }
  }

  // The enemy escalation is SEQUENTIAL bands along the danger gradient:
  // grunts -> skirmishers -> both -> battalions -> runners -> marksmen ->
  // marksmen+runners -> veterans (and past them, the giant's ground).
  enemyBand(d) {
    if (d < .12) return ['grunt'];
    if (d < .24) return ['skirmisher'];
    if (d < .36) return ['grunt', 'skirmisher'];
    if (d < .5)  return ['battalion'];
    if (d < .62) return ['runner'];
    if (d < .75) return ['marksman'];
    if (d < .87) return ['marksman', 'runner'];
    return ['veteran'];
  }

  // No superimposing: push overlapping units apart (circle vs circle).
  separateUnits() {
    const units = [this.player, ...this.allies, ...this.enemies].filter(u => u.alive);
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i], b = units[j];
        const min = ((a.bodyR ?? 7) + (b.bodyR ?? 7)) * dscale((a.y + b.y) / 2);
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < .001) { b.x += 2; continue; }
        const push = (min - d) / 2;
        dx /= d; dy /= d;
        a.x -= dx * push; a.y -= dy * push;
        b.x += dx * push; b.y += dy * push;
      }
    }
  }

  // ---- the giant --------------------------------------------------------
  updateGiant() {
    if (!this.giant && !this.giantDefeated && this.player.x > 4350) {
      this.giant = new Giant(this, Math.min(this.player.x + 650, PLAY.right - 60), 360);
      this.enemies.push(this.giant);
      this.announce('the ground shakes… THE GIANT WAKES!', '#e05252');
    }
  }

  onGiantSlain() {
    this.giantDefeated = true;
    this.giant = null;
    this.carried += 2000;
    this.announce('THE GIANT FALLS! +2000 treasure — carry it home!', '#ffd35a');
  }

  throwRock(giant, target) {
    const ds = dscale(giant.y);
    const a = Math.atan2((target.y - 13 * dscale(target.y)) - (giant.y - 20 * ds), target.x - giant.x);
    const img = this.add.image(giant.x, giant.y - 20 * ds, 'rock').setScale(ds * .9).setDepth(9000);
    this.bullets.push({
      x: giant.x, y: giant.y - 20 * ds,
      vx: Math.cos(a) * 330, vy: Math.sin(a) * 330,
      dmg: 24, life: 2.6, img, hostile: true,
    });
    sfx.sword(); // heave grunt stand-in
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
    let y = PLAY.top + 20 + Math.random() * (PLAY.bottom - PLAY.top - 40);
    for (let tries = 0; tries < 8; tries++) {
      if (!this.obstacles.some(o => Math.hypot(x - o.x, y - o.y) < o.r + 16)) break;
      y = PLAY.top + 20 + Math.random() * (PLAY.bottom - PLAY.top - 40);
    }
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
        this.carried += l.rarity.value;
        this.announce(`${l.rarity.name} artifact! +${l.rarity.value} — carry it home`,
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
    if (this.carried > 0) {
      this.banked += this.carried;
      this.registry.set('banked', this.banked);
      this.announce(`treasure secured: +${this.carried}`, '#ffd35a');
      this.carried = 0;
    }
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
      this.add.text(480, 292,
        `carried treasure lost: ${this.carried} — banked at home: ${this.banked}`,
        { fontSize: 18, color: '#ffd35a' })
        .setOrigin(.5).setDepth(9999).setScrollFactor(0);
      this.add.text(480, 322, 'press ENTER to rally the line again', { fontSize: 16, color: '#ccc' })
        .setOrigin(.5).setDepth(9999).setScrollFactor(0);
    }
  }

  musicSnapshot() {
    const near = this.enemies.filter(e => e.alive && dist(e, this.player) < 950).length;
    if (near > 0) {
      this.engaged = true;
      this.combatPeak = Math.max(this.combatPeak, near);
    }
    if (this.engaged && near === 0) {
      this.engaged = false;
      this.combatPeak = 0;
      this.clearedT = 30;              // ~30s of quiet after clearing an area
      this.clearedX = this.player.x;
      this.toast('area clear — it should stay quiet for a bit');
    }
    // which song should be playing: boss > battle > village > field.
    const zone = (this.giant?.alive && dist(this.giant, this.player) < 1200) ? 'boss'
      : near > 0 ? 'battle'
      : this.player.x < 950 ? 'village' : 'field';
    return { zone };
  }

  // -------------------------------------------------------------------------
  // Feedback text
  // -------------------------------------------------------------------------
  announce(msg, color = '#ffe9a0') {
    const t = this.add.text(480, 150, msg, { fontSize: 26, color, fontStyle: 'bold' })
      .setOrigin(.5).setDepth(9500).setScrollFactor(0);
    this.tweens.add({ targets: t, y: 120, alpha: 0, duration: 1400, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  enemyShout(unit, msg) {
    if (!unit) return;
    const t = this.add.text(unit.x, unit.y - 52, msg, { fontSize: 15, color: '#ff9a8a', fontStyle: 'bold' })
      .setOrigin(.5).setDepth(9500);
    this.tweens.add({ targets: t, y: t.y - 20, alpha: 0, duration: 1300, onComplete: () => t.destroy() });
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
  }

  updateHudText() {
    const p = this.player;
    const rifle = p.loaded ? 'LOADED'
      : p.reloadT > 0 ? `reloading ${Math.max(0, p.reloadT).toFixed(1)}s` : 'EMPTY — press R';
    const arm = p.weapon === 'rifle' ? `rifle in hand (${rifle})` : `sword in hand · rifle: ${rifle}`;
    const mode = this.allies.find(a => a.alive)?.mode ?? '-';
    const readied = this.allies.some(a => a.alive && a.readied) ? ' · READIED' : '';
    const reloading = this.allies.some(a => a.alive && !a.loaded && a.reloadT > 0) ? ' · reloading…' : '';
    const empty = this.allies.some(a => a.alive && !a.loaded && a.reloadT <= 0 && a.mode !== 'free') ? ' · muskets empty (Q)' : '';
    const carry = this.carried ? ` (+${this.carried} carried)` : '';
    this.hudLeft.setText(`${arm}\nallies: ${mode}${readied}${reloading}${empty}\ntreasure: ${this.banked}${carry}`);

    const danger = dangerAt(p.x);
    const near = this.enemies.filter(e => e.alive).length;
    const zone = p.x < 520 ? 'village — safe'
      : `danger ${(danger * 100).toFixed(0)}%`;
    const status = near ? `enemies: ${near}`
      : this.clearedT > 0 && Math.abs(p.x - this.clearedX) < 450
        ? `area clear (${Math.ceil(this.clearedT)}s)`
        : 'go east for treasure →';
    this.hudRight.setText(`${zone}\n${status}`);
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
      if (u.reloadTime && u.reloadT > 0) {
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

    // Two views per soldier: 'side' (face visible) and 'up' (walking away
    // from the camera — you see HAIR under the hat, and whatever is slung
    // on the back). When the sword is drawn, the rifle shows on the back.
    const soldier = (key, coat, trim, weapon, view) => {
      const g = this.make.graphics({ add: false });
      const up = view === 'up';
      g.fillStyle(0x2a2118); g.fillRect(4, 0, 8, 3);        // hat
      if (up) { g.fillStyle(0x4a3320); g.fillRect(5, 3, 6, 4); }  // hair (back of head)
      else { g.fillStyle(0xd9a066); g.fillRect(5, 3, 6, 4); }     // face
      g.fillStyle(coat); g.fillRect(3, 7, 10, 10);          // coat
      g.fillStyle(trim); g.fillRect(3, 7, 10, 2);           // shoulder trim
      g.fillStyle(0x1d1d24); g.fillRect(4, 17, 3, 5); g.fillRect(9, 17, 3, 5); // legs
      if (weapon === 'rifle') {
        if (up) { g.fillStyle(0x555); g.fillRect(12, 1, 2, 9); }  // barrel over the shoulder
        else { g.fillStyle(0x555); g.fillRect(12, 8, 6, 2); }     // rifle held level
      } else if (weapon === 'sword') {
        if (up) {
          g.fillStyle(0x555); g.fillRect(7, 8, 2, 9);       // rifle slung across the back
          g.fillStyle(0xc9d4e0); g.fillRect(13, 1, 2, 8);   // blade up
        } else {
          g.fillStyle(0x555); g.fillRect(1, 5, 2, 10);      // rifle on the back
          g.fillStyle(0xc9d4e0); g.fillRect(13, 1, 2, 9);   // blade up
          g.fillStyle(0x8a6d3b); g.fillRect(12, 10, 4, 2);  // guard
        }
      }
      g.generateTexture(key, 18, 22);
      g.destroy();
    };
    soldier('soldier_blue_rifle', 0x2e5ea8, 0x9fc4ff, 'rifle', 'side');
    soldier('soldier_blue_rifle_up', 0x2e5ea8, 0x9fc4ff, 'rifle', 'up');
    soldier('soldier_blue_sword', 0x2e5ea8, 0x9fc4ff, 'sword', 'side');
    soldier('soldier_blue_sword_up', 0x2e5ea8, 0x9fc4ff, 'sword', 'up');
    soldier('soldier_green', 0x2f7a4d, 0xa8e6bd, 'rifle', 'side');
    soldier('soldier_green_up', 0x2f7a4d, 0xa8e6bd, 'rifle', 'up');
    // enemy liveries — coat color tells you what you're facing
    soldier('enemy_grunt', 0x9c2f2f, 0xe0a0a0, 'sword', 'side');
    soldier('enemy_grunt_up', 0x9c2f2f, 0xe0a0a0, 'sword', 'up');
    soldier('enemy_skirmisher', 0xa8642f, 0xe0b98a, 'rifle', 'side');
    soldier('enemy_skirmisher_up', 0xa8642f, 0xe0b98a, 'rifle', 'up');
    soldier('enemy_runner', 0xc23a3a, 0xf0c0c0, 'sword', 'side');
    soldier('enemy_runner_up', 0xc23a3a, 0xf0c0c0, 'sword', 'up');
    soldier('enemy_marksman', 0x6e2f5e, 0xc79ab8, 'rifle', 'side');
    soldier('enemy_marksman_up', 0x6e2f5e, 0xc79ab8, 'rifle', 'up');
    soldier('enemy_veteran', 0x2a2a30, 0xd9b45a, 'sword', 'side');
    soldier('enemy_veteran_up', 0x2a2a30, 0xd9b45a, 'sword', 'up');
    soldier('enemy_battalion', 0xa8452f, 0xe8e3d0, 'rifle', 'side');
    soldier('enemy_battalion_up', 0xa8452f, 0xe8e3d0, 'rifle', 'up');

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

    // the giant: a hulking silhouette with a club
    g = this.make.graphics({ add: false });
    g.fillStyle(0x6a705c); g.fillRect(8, 8, 18, 22);        // massive torso
    g.fillStyle(0x7a8069); g.fillRect(11, 0, 12, 10);       // head
    g.fillStyle(0x4a4f40); g.fillRect(12, 3, 10, 3);        // brow
    g.fillStyle(0x6a705c); g.fillRect(4, 10, 5, 14); g.fillRect(25, 10, 5, 14); // arms
    g.fillStyle(0x5a4632); g.fillRect(28, 2, 5, 20);        // club
    g.fillStyle(0x3d4034); g.fillRect(10, 30, 6, 10); g.fillRect(19, 30, 6, 10); // legs
    g.generateTexture('enemy_giant', 34, 40); g.destroy();

    const house = (key, w, h, wall, roof) => {
      const gr = this.make.graphics({ add: false });
      gr.fillStyle(0x4a3a2a); gr.fillRect(w * .66, h * .06, w * .1, h * .34);  // chimney
      gr.fillStyle(wall); gr.fillRect(0, h * .4, w, h * .6);
      gr.fillStyle(roof); gr.fillTriangle(w / 2, 0, -2, h * .45, w + 2, h * .45);
      gr.fillStyle(0x3d3226); gr.fillRect(0, h * .4, w, 2);                    // eave line
      gr.fillStyle(0x2a2118); gr.fillRect(w * .42, h * .65, w * .16, h * .35); // door
      gr.fillStyle(0x8a6d3b); gr.fillRect(w * .42, h * .63, w * .16, 2);       // lintel
      gr.fillStyle(0xffd35a); gr.fillRect(w * .15, h * .55, w * .14, w * .14); // lit window
      gr.fillStyle(0xffd35a); gr.fillRect(w * .72, h * .55, w * .14, w * .14); // second window
      gr.generateTexture(key, w + 4, h);
      gr.destroy();
    };
    house('house_big', 64, 54, 0x6d5a43, 0x8a3d2e);
    house('house_small', 44, 40, 0x60503c, 0x7a4a33);
    house('house_stone', 54, 46, 0x7a7568, 0x5a6a70);

    // barn: wide body, tall roof, big double door
    g = this.make.graphics({ add: false });
    g.fillStyle(0x7a3d2c); g.fillRect(0, 24, 86, 40);
    g.fillStyle(0x8f4834); g.fillTriangle(43, 0, -3, 26, 89, 26);
    g.fillStyle(0x4a2418); g.fillRect(31, 34, 24, 30);          // double door
    g.fillStyle(0xd9c9a0); g.fillRect(42, 34, 2, 30);           // door split
    g.fillStyle(0xd9c9a0); g.fillRect(6, 30, 10, 10);           // hayloft window
    g.generateTexture('barn', 90, 64); g.destroy();

    // well: stone ring, two posts, little roof
    g = this.make.graphics({ add: false });
    g.fillStyle(0x8a3d2e); g.fillTriangle(13, 0, 0, 9, 26, 9);
    g.fillStyle(0x5a4632); g.fillRect(3, 7, 3, 14); g.fillRect(20, 7, 3, 14);
    g.fillStyle(0x6b6f78); g.fillEllipse(13, 22, 24, 10);
    g.fillStyle(0x23262e); g.fillEllipse(13, 21, 14, 5);
    g.generateTexture('well', 26, 28); g.destroy();

    // market stall: striped canopy over a counter
    g = this.make.graphics({ add: false });
    for (let i = 0; i < 6; i++) { g.fillStyle(i % 2 ? 0xe8e3d0 : 0xc94f4f); g.fillRect(i * 6, 0, 6, 7); }
    g.fillStyle(0x5a4632); g.fillRect(2, 7, 3, 16); g.fillRect(31, 7, 3, 16);
    g.fillStyle(0x6d5230); g.fillRect(0, 16, 36, 7);
    g.fillStyle(0x9fdcb2); g.fillRect(5, 12, 6, 4);  // wares
    g.fillStyle(0xffd35a); g.fillRect(24, 12, 6, 4);
    g.generateTexture('stall', 36, 24); g.destroy();

    // haystack
    g = this.make.graphics({ add: false });
    g.fillStyle(0xc9a04a); g.fillEllipse(13, 12, 26, 14);
    g.fillStyle(0xdbb765); g.fillEllipse(11, 8, 16, 9);
    g.generateTexture('haystack', 26, 19); g.destroy();

    // lamp post
    g = this.make.graphics({ add: false });
    g.fillStyle(0x3a332a); g.fillRect(3, 4, 3, 24);
    g.fillStyle(0xffe9a0); g.fillRect(1, 0, 7, 6);
    g.generateTexture('lamp', 9, 28); g.destroy();
  }

  // Render a real gradient into a canvas texture once, then stretch it —
  // perfectly smooth, one draw call, works on WebGL and Canvas alike.
  gradTexture(key, w, h, stops, horizontal = false) {
    if (this.textures.exists(key)) return key;
    const tex = this.textures.createCanvas(key, w, h);
    const c = tex.getContext();
    const g = c.createLinearGradient(0, 0, horizontal ? w : 0, horizontal ? 0 : h);
    for (const [pos, col] of stops) g.addColorStop(pos, col);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    tex.refresh();
    return key;
  }

  drawBackground() {
    // layer 1: sky — fixed to the camera; three smooth gradients (day, dusk,
    // night) whose alphas crossfade with how far east the player stands
    const sky = (key, stops, depth) =>
      this.add.image(0, 0, this.gradTexture(key, 32, 150, stops))
        .setOrigin(0, 0).setDisplaySize(960, 150).setDepth(depth).setScrollFactor(0);
    this.skyDay = sky('skyDay', [[0, '#6fb7d9'], [.45, '#a9d6ea'], [.8, '#d3d3b8'], [1, '#e8c187']], -122);
    this.skyDusk = sky('skyDusk', [[0, '#1b2340'], [.45, '#374260'], [.8, '#54506b'], [1, '#8a5f5a']], -121);
    this.skyNight = sky('skyNight', [[0, '#04060d'], [.5, '#0d1120'], [1, '#1d2236']], -120);
    this.skyDusk.setAlpha(0);
    this.skyNight.setAlpha(0);

    // layer 2: distant mountains — slow parallax
    const mts = this.add.graphics().setDepth(-110).setScrollFactor(.35);
    const mtsW = 960 + (WORLD_W - 960) * .35 + 200;
    mts.fillStyle(0x141a2c);
    for (let x = -60; x < mtsW; x += 300) {
      const h = 60 + ((x * 7919) % 50);
      mts.fillTriangle(x, 150, x + 170, 150 - h, x + 360, 150);
    }
    mts.fillStyle(0xc98a5a, .5).fillRect(0, 146, mtsW, 4);

    // layer 3: ground — one smooth vertical gradient, light at the horizon
    // to dark at the near edge (the depth cue the old bands approximated)
    this.add.image(0, 150, this.gradTexture('groundGrad', 32, 410,
      [[0, '#55654a'], [.35, '#43512f'], [.7, '#313c26'], [1, '#1f2718']]))
      .setOrigin(0, 0).setDisplaySize(WORLD_W, 410).setDepth(-100);

    // village ground: warm worn earth, fading out toward the palisade
    this.add.image(0, 150, this.gradTexture('villageGrad', 256, 32,
      [[0, 'rgba(74,64,48,.55)'], [.7, 'rgba(74,64,48,.45)'], [1, 'rgba(74,64,48,0)']], true))
      .setOrigin(0, 0).setDisplaySize(SAFE_EDGE - 40, 410).setDepth(-99);

    // night falls toward the east: one smooth horizontal veil over the world
    // (above entities, below HUD) — day at the village, night out deep
    this.add.image(800, PLAY.horizon, this.gradTexture('nightGrad', 512, 32,
      [[0, 'rgba(10,12,30,0)'], [.5, 'rgba(10,12,30,.16)'], [1, 'rgba(10,12,30,.5)']], true))
      .setOrigin(0, 0).setDisplaySize(WORLD_W - 800, 560 - PLAY.horizon).setDepth(8000);
  }

  // crossfade the fixed sky with how far east the player stands
  updateSky() {
    const t = clamp(this.player.x / WORLD_W, 0, 1);
    const ramp = (a, b) => clamp((t - a) / (b - a), 0, 1);
    this.skyDusk.setAlpha(ramp(.08, .4));   // day fades into dusk
    this.skyNight.setAlpha(ramp(.5, .85));  // dusk sinks into night
  }

  buildVillage() {
    this.obstacles = [];

    // worn dirt path winding from the houses out to the palisade gate
    const path = this.add.graphics().setDepth(-98);
    path.fillStyle(0x5a4c36, .45);
    for (let x = 50; x < SAFE_EDGE + 40; x += 24) {
      path.fillEllipse(x, 430 + Math.sin(x / 85) * 22, 38, 13);
    }

    // fences along the village bounds (each row depth-sorted at its own y)
    for (const fy of [208, 508]) {
      const fence = this.add.graphics().setDepth(fy);
      fence.fillStyle(0x5a4632);
      for (let fx = 44; fx < SAFE_EDGE - 90; fx += 22) fence.fillRect(fx, fy - 10, 3, 12);
      fence.fillRect(44, fy - 7, SAFE_EDGE - 134, 2);
    }

    // buildings & props: [x, y, texture, solid radius, lift]
    const props = [
      [140, 262, 'house_big', 40, 20],
      [305, 232, 'house_small', 30, 16],
      [455, 272, 'house_stone', 34, 18],
      [82, 345, 'house_small', 30, 16],
      [548, 246, 'barn', 52, 24],
      [238, 342, 'well', 13, 8],
      [352, 470, 'stall', 18, 8],
      [500, 500, 'haystack', 13, 5],
      [590, 452, 'haystack', 13, 5],
      [186, 412, 'lamp', 0, 12],
      [432, 442, 'lamp', 0, 12],
    ];
    for (const [x, y, key, r, lift] of props) {
      const ds = dscale(clamp(y, PLAY.top, PLAY.bottom));
      this.add.image(x, y - lift * ds, key).setScale(ds * 1.3).setDepth(y);
      this.add.image(x, y, 'shadow').setScale(ds * (r ? r / 9 : 1)).setAlpha(.22).setDepth(y - .1);
      if (r) this.obstacles.push({ x, y, r: r * ds, blockH: 44 * ds });
      if (key === 'lamp') {
        this.add.circle(x, y - 24 * ds, 24, 0xffd35a, .1).setDepth(y + .1);
      }
    }

    // campfire on the green
    const fx = 262, fy = 424;
    const fire = this.add.circle(fx, fy - 6, 6, 0xff9a3d).setDepth(fy);
    this.add.circle(fx, fy, 9, 0x3a2a18).setDepth(fy - .2);
    this.add.circle(fx, fy - 6, 30, 0xff9a3d, .08).setDepth(fy + .1);
    this.tweens.add({ targets: fire, scale: { from: .8, to: 1.25 }, alpha: { from: .8, to: 1 }, yoyo: true, repeat: -1, duration: 260 });

    // chimney smoke drifting from the houses
    const chimneys = [[158, 208], [317, 190], [469, 222], [94, 305]];
    this.time.addEvent({
      delay: 700, loop: true, callback: () => {
        const [cx, cy] = chimneys[Math.floor(Math.random() * chimneys.length)];
        const puff = this.add.circle(cx + Math.random() * 4, cy, 3, 0xd8d3c8, .3).setDepth(500);
        this.tweens.add({
          targets: puff, y: cy - 26 - Math.random() * 10, x: cx + 8 + Math.random() * 8,
          alpha: 0, scale: 2.4, duration: 2600, onComplete: () => puff.destroy(),
        });
      },
    });

    this.add.text(230, 190, 'HOMESTEAD — safe ground', { fontSize: 12, color: '#9fdcb2' })
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
    // Trees and rocks are SOLID: units can't walk through them and their
    // body stops bullets — cover works for you and against you.
    this.obstacles ??= [];
    for (let i = 0; i < 46; i++) {
      const x = 500 + Math.random() * (WORLD_W - 560);
      const y = PLAY.top + Math.random() * (PLAY.bottom - PLAY.top);
      const key = Math.random() < .6 ? 'tree' : 'rock';
      const ds = dscale(y);
      this.add.image(x, y - (key === 'tree' ? 18 : 4) * ds, key).setScale(ds * 1.4).setDepth(y);
      this.add.image(x, y, 'shadow').setScale(ds * (key === 'tree' ? 1.4 : .9)).setAlpha(.25).setDepth(y - .1);
      this.obstacles.push({
        x, y,
        r: (key === 'tree' ? 10 : 12) * ds,        // footprint (movement)
        blockH: (key === 'tree' ? 40 : 12) * ds,   // how tall it stands (bullets)
      });
    }
  }

  // Push a unit out of any obstacle footprint it overlaps — walking into a
  // tree slides you around it instead of through it.
  resolveObstacles(unit) {
    if (!this.obstacles) return;
    for (const o of this.obstacles) {
      const dx = unit.x - o.x, dy = unit.y - o.y;
      const min = o.r + 6 * dscale(unit.y);
      const d = Math.hypot(dx, dy);
      if (d < min && d > .001) {
        unit.x = o.x + (dx / d) * min;
        unit.y = o.y + (dy / d) * min;
      }
    }
  }
}
