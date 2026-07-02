import { PLAY, dscale, clamp, dist } from './world.js';

// ---------------------------------------------------------------------------
// Base unit: position in world coords, hp, facing, sprite + shadow that get
// re-scaled every frame by depth (see world.js).
// ---------------------------------------------------------------------------
export class Unit {
  constructor(scene, x, y, texture, opts = {}) {
    this.scene = scene;
    this.x = x; this.y = y;
    this.hp = opts.hp ?? 100; this.maxHp = this.hp;
    this.speed = opts.speed ?? 150;
    this.alive = true;
    this.removed = false;
    this.facing = 1; // 1 = right, -1 = left
    this.flashT = 0;
    this.shadow = scene.add.image(x, y, 'shadow').setAlpha(.3);
    this.sprite = scene.add.image(x, y, texture);
  }

  moveToward(tx, ty, dt, speedMul = 1) {
    const d = Math.hypot(tx - this.x, ty - this.y);
    if (d < 3) return true;
    const s = Math.min(d, this.speed * speedMul * dscale(this.y) * dt);
    this.x += ((tx - this.x) / d) * s;
    this.y += ((ty - this.y) / d) * s;
    if (Math.abs(tx - this.x) > 2) this.facing = tx > this.x ? 1 : -1;
    return d < 8;
  }

  clampToField() {
    this.x = clamp(this.x, PLAY.left, PLAY.right);
    this.y = clamp(this.y, PLAY.top, PLAY.bottom);
  }

  takeDamage(n) {
    if (!this.alive) return;
    this.hp -= n;
    this.flashT = .12;
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }

  die() {
    this.alive = false;
    this.sprite.setAngle(90).setAlpha(.5).setTint(0x666666);
    this.shadow.setAlpha(.12);
  }

  destroy() {
    this.sprite.destroy();
    this.shadow.destroy();
    this.removed = true;
  }

  updateVisual(dt) {
    const ds = dscale(this.y);
    this.sprite.setPosition(this.x, this.y - 13 * ds)
      .setScale(ds * this.facing, ds)
      .setDepth(this.y);
    this.shadow.setPosition(this.x, this.y).setScale(ds).setDepth(this.y - .1);
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.sprite.setTintFill(0xffffff);
    } else if (this.alive) {
      this.sprite.clearTint();
    }
  }
}

// ---------------------------------------------------------------------------
// Player: free movement, sword (SPACE) and a Martini-Henry rifle —
// single shot (click), manual reload (R).
// ---------------------------------------------------------------------------
export class Player extends Unit {
  constructor(scene, x, y) {
    super(scene, x, y, 'soldier_blue', { hp: 120, speed: 175 });
    this.loaded = true;
    this.reloadT = 0;   // >0 while reloading
    this.reloadTime = 2.2;
    this.swordCd = 0;
  }

  update(dt, input) {
    if (!this.alive) return;
    let dx = 0, dy = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (dx || dy) {
      const n = Math.hypot(dx, dy);
      const s = this.speed * dscale(this.y) * dt;
      this.x += (dx / n) * s;
      this.y += (dy / n) * s;
      if (dx) this.facing = dx > 0 ? 1 : -1;
      this.clampToField();
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.loaded = true; this.scene.toast('rifle loaded'); }
    }
    this.swordCd = Math.max(0, this.swordCd - dt);
    this.updateVisual(dt);
  }

  fire(angle) {
    if (!this.alive) return;
    if (!this.loaded) { this.scene.toast(this.reloadT > 0 ? 'reloading…' : 'click! — R to reload'); return; }
    this.loaded = false;
    this.scene.shoot(this, angle, 2.5, 55);
  }

  reload() {
    if (this.alive && !this.loaded && this.reloadT <= 0) {
      this.reloadT = this.reloadTime;
      this.scene.toast('reloading…');
    }
  }

  sword(angle) {
    if (!this.alive || this.swordCd > 0) return;
    this.swordCd = .45;
    this.scene.melee(this, angle, 48, 32);
  }
}

// ---------------------------------------------------------------------------
// Ally: obeys formation + fire commands.
//   modes: 'line' (flank the player), 'behind' (line up behind the player),
//          'free' (fire at will), 'charge' (swords out, run at the enemy).
//   readied: set by MAKE READY — the next volley gets bonus accuracy/damage.
// ---------------------------------------------------------------------------
export class Ally extends Unit {
  constructor(scene, x, y, idx) {
    super(scene, x, y, 'soldier_green', { hp: 100, speed: 150 });
    this.idx = idx;
    this.mode = 'line';
    this.readied = false;
    this.loaded = true;
    this.reloadT = 0;
    this.reloadTime = 2.8;
    this.swordCd = 0;
    this.fireCd = 0; // small human delay in fire-at-will mode
  }

  slot(player) {
    const off = this.idx === 0 ? -70 : 70;
    if (this.mode === 'behind') {
      return { x: player.x + off * .6, y: clamp(player.y + 55, PLAY.top, PLAY.bottom) };
    }
    return { x: player.x + off, y: player.y };
  }

  update(dt, scene) {
    if (!this.alive) return;
    if (!this.loaded) { this.reloadT -= dt; if (this.reloadT <= 0) this.loaded = true; }
    this.swordCd = Math.max(0, this.swordCd - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);

    if (this.mode === 'charge') {
      const t = scene.nearestEnemy(this, 2000);
      if (t) {
        const d = dist(this, t);
        if (d > 34 * dscale(this.y)) this.moveToward(t.x, t.y, dt, 1.25);
        else if (this.swordCd <= 0) {
          this.swordCd = .7;
          scene.melee(this, Math.atan2(t.y - this.y, t.x - this.x), 40, 26);
        }
      } else {
        this.mode = 'line'; // battle's over — fall back in
      }
    } else {
      const enemy = scene.nearestEnemy(this, 780);
      if (!this.readied) {
        const s = this.slot(scene.player);
        this.moveToward(s.x, s.y, dt);
      }
      if (enemy) this.facing = enemy.x > this.x ? 1 : -1;
      if (this.mode === 'free' && enemy && this.loaded && this.fireCd <= 0) {
        this.fireCd = .4 + Math.random() * .6;
        this.shoot(scene, enemy, 7, 40); // no bonus when firing at will
      }
    }
    this.clampToField();
    this.updateVisual(dt);
  }

  shoot(scene, target, spreadDeg, dmg) {
    this.loaded = false;
    this.reloadT = this.reloadTime;
    this.readied = false;
    scene.shoot(this, Math.atan2(target.y - this.y, target.x - this.x), spreadDeg, dmg);
  }

  volley(scene) {
    const t = scene.nearestEnemy(this, 880);
    if (this.alive && this.loaded && t) {
      // MAKE READY -> FIRE pays off: tighter spread, harder hit
      this.shoot(scene, t, this.readied ? 1.5 : 6, this.readied ? 58 : 40);
    }
  }
}

// ---------------------------------------------------------------------------
// Enemy: sword infantry — runs at the nearest squad member and slashes.
// ---------------------------------------------------------------------------
export class Enemy extends Unit {
  constructor(scene, x, y, wave) {
    super(scene, x, y, 'soldier_red', { hp: 70, speed: Math.min(150, 88 + wave * 5) });
    this.atkCd = 0;
  }

  update(dt, scene) {
    if (!this.alive) return;
    this.atkCd = Math.max(0, this.atkCd - dt);
    const t = scene.nearestSquad(this);
    if (t) {
      const d = dist(this, t);
      if (d > 27 * dscale(this.y)) {
        this.moveToward(t.x, t.y, dt);
      } else if (this.atkCd <= 0) {
        this.atkCd = .8;
        t.takeDamage(9);
        scene.slashFx(this.x, this.y - 10, Math.atan2(t.y - this.y, t.x - this.x), 0xff8866);
      }
    }
    this.clampToField();
    this.updateVisual(dt);
  }

  die() {
    super.die();
    this.scene.tweens.add({ targets: [this.sprite, this.shadow], alpha: 0, delay: 900, duration: 500 });
    this.scene.time.delayedCall(1500, () => this.destroy());
  }
}
