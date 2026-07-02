import { PLAY, SAFE_EDGE, dangerAt, dscale, clamp, dist } from './world.js';

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
    this.facing = 1; // sprite flip: 1 = right, -1 = left
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

  revive(hp) {
    this.alive = true;
    this.hp = hp;
    this.sprite.setAngle(0).setAlpha(1).clearTint();
    this.shadow.setAlpha(.3);
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
// Player: free movement, EXPLICIT weapon switching (X/TAB, with a stow/draw
// animation): the Martini-Henry (click to fire, R to reload) or the sword
// (click/SPACE swings toward the direction the character is FACING).
// Facing is an 8-way vector taken from the last movement input.
// ---------------------------------------------------------------------------
export class Player extends Unit {
  constructor(scene, x, y) {
    super(scene, x, y, 'soldier_blue_rifle', { hp: 120, speed: 175 });
    this.weapon = 'rifle';    // 'rifle' | 'sword'
    this.switchT = 0;         // >0 while stowing/drawing
    this.loaded = true;
    this.reloadT = 0;
    this.reloadTime = 2.2;
    this.swordCd = 0;
    this.faceX = 1; this.faceY = 0; // facing vector (last movement direction)
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
      this.faceX = dx / n; this.faceY = dy / n;
      if (dx) this.facing = dx > 0 ? 1 : -1;
      this.clampToField();
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.loaded = true; this.scene.toast('rifle loaded'); }
    }
    if (this.switchT > 0) this.switchT -= dt;
    this.swordCd = Math.max(0, this.swordCd - dt);
    this.updateVisual(dt);
  }

  faceAngle() { return Math.atan2(this.faceY, this.faceX); }

  // X / TAB: stow one weapon, draw the other. Takes a moment — mid-switch
  // you can't attack, and the sprite swaps halfway through.
  switchWeapon() {
    if (!this.alive || this.switchT > 0) return;
    this.switchT = .5;
    const next = this.weapon === 'rifle' ? 'sword' : 'rifle';
    this.scene.toast(next === 'sword' ? 'stowing rifle… sword out!' : 'sheathing sword… rifle up!');
    this.scene.tweens.add({ targets: this.sprite, angle: { from: -12, to: 0 }, duration: 480, ease: 'Back.easeOut' });
    this.scene.time.delayedCall(250, () => {
      this.weapon = next;
      this.sprite.setTexture(next === 'sword' ? 'soldier_blue_sword' : 'soldier_blue_rifle');
    });
  }

  attack(pointerAngle) {
    if (!this.alive || this.switchT > 0) return;
    if (this.weapon === 'rifle') {
      if (!this.loaded) { this.scene.toast(this.reloadT > 0 ? 'reloading…' : 'click! — R to reload'); return; }
      this.loaded = false;
      this.scene.shoot(this, pointerAngle, 2.5, 55);
    } else {
      this.swing();
    }
  }

  swing() {
    if (!this.alive || this.switchT > 0 || this.weapon !== 'sword') {
      if (this.weapon !== 'sword') this.scene.toast('draw your sword first (X)');
      return;
    }
    if (this.swordCd > 0) return;
    this.swordCd = .45;
    this.scene.melee(this, this.faceAngle(), 48, 32); // swings where you FACE
  }

  reload() {
    if (!this.alive || this.switchT > 0) return;
    if (this.weapon !== 'rifle') { this.scene.toast('rifle is on your back (X)'); return; }
    if (!this.loaded && this.reloadT <= 0) {
      this.reloadT = this.reloadTime;
      this.scene.toast('reloading…');
    }
  }
}

// ---------------------------------------------------------------------------
// Ally: obeys formation + fire commands. Formation slots are computed by the
// scene (relative to the player's facing, assigned to avoid crossing paths)
// and handed to the ally as `targetSlot`.
//   modes: 'behind' (default) | 'line' | 'free' (fire at will) | 'charge'
//   readied: set by MAKE READY — the next volley gets bonus accuracy/damage.
//
// Musket drill: firing empties the musket and it STAYS empty in line/behind
// modes until MAKE READY orders the reload. Fire-at-will manages its own.
// ---------------------------------------------------------------------------
export class Ally extends Unit {
  constructor(scene, x, y, idx) {
    super(scene, x, y, 'soldier_green', { hp: 100, speed: 150 });
    this.idx = idx;
    this.mode = 'behind';
    this.readied = false;
    this.loaded = true;
    this.reloadT = 0;   // reload only ticks while > 0 (started by an order)
    this.reloadTime = 2.8;
    this.swordCd = 0;
    this.fireCd = 0;
    this.targetSlot = { x, y };
  }

  orderReload() {
    if (this.alive && !this.loaded && this.reloadT <= 0) this.reloadT = this.reloadTime;
  }

  update(dt, scene) {
    if (!this.alive) return;
    if (!this.loaded && this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.loaded = true;
    }
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
        this.mode = 'behind'; // battle's over — fall back in
      }
    } else {
      const enemy = scene.nearestEnemy(this, 780);
      if (!this.readied) {
        this.moveToward(this.targetSlot.x, this.targetSlot.y, dt);
      }
      if (enemy) this.facing = enemy.x > this.x ? 1 : -1;
      if (this.mode === 'free') {
        this.orderReload(); // fire-at-will soldiers reload themselves
        if (enemy && this.loaded && this.fireCd <= 0) {
          this.fireCd = .4 + Math.random() * .6;
          this.shoot(scene, enemy, 7, 40); // no bonus when firing at will
        }
      }
    }
    this.clampToField();
    this.updateVisual(dt);
  }

  shoot(scene, target, spreadDeg, dmg) {
    this.loaded = false;
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
// Enemy: sword infantry. Spawn strength scales with the local danger level.
// They will NOT cross into the village — at the safe edge they give up,
// linger, and eventually slink away.
// ---------------------------------------------------------------------------
export class Enemy extends Unit {
  constructor(scene, x, y) {
    const danger = dangerAt(x);
    super(scene, x, y, 'soldier_red', {
      hp: Math.round(60 * (1 + danger * .9)),
      speed: 90 + danger * 50,
    });
    this.dmg = Math.round(8 * (1 + danger * .7));
    this.atkCd = 0;
    this.idleT = 0; // time spent with no reachable target
  }

  update(dt, scene) {
    if (!this.alive) return;
    this.atkCd = Math.max(0, this.atkCd - dt);
    const t = scene.nearestSquad(this);
    const reachable = t && t.x >= SAFE_EDGE;

    if (!reachable || this.x < SAFE_EDGE) {
      // never enter the village: hold at the edge, get bored, leave
      this.idleT += dt;
      if (this.x < SAFE_EDGE + 40) this.moveToward(SAFE_EDGE + 80, this.y, dt, .8);
      if (this.idleT > 6) {
        this.alive = false;
        this.scene.tweens.add({ targets: [this.sprite, this.shadow], alpha: 0, duration: 600 });
        this.scene.time.delayedCall(700, () => this.destroy());
      }
    } else {
      this.idleT = 0;
      const d = dist(this, t);
      if (d > 27 * dscale(this.y)) {
        this.moveToward(t.x, t.y, dt);
        if (this.x < SAFE_EDGE) this.x = SAFE_EDGE;
      } else if (this.atkCd <= 0) {
        this.atkCd = .8;
        t.takeDamage(this.dmg);
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
