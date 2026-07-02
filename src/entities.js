import { PLAY, SAFE_EDGE, dangerAt, dscale, clamp, dist } from './world.js';
import { sfx } from './sfx.js';

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
    this.facing = 1;   // sprite flip: 1 = right, -1 = left
    this.dirUp = false; // walking away from camera -> back view (hair!)
    this.baseTex = texture;
    this.flashT = 0;
    this.shadow = scene.add.image(x, y, 'shadow').setAlpha(.3);
    this.sprite = scene.add.image(x, y, texture);
  }

  // Which texture matches the current pose. Subclasses may override
  // (the player also picks by weapon in hand).
  currentTexture() {
    return `${this.baseTex}${this.dirUp ? '_up' : ''}`;
  }

  moveToward(tx, ty, dt, speedMul = 1) {
    const d = Math.hypot(tx - this.x, ty - this.y);
    if (d < 3) return true;
    const s = Math.min(d, this.speed * speedMul * dscale(this.y) * dt);
    const dx = tx - this.x, dy = ty - this.y;
    this.x += (dx / d) * s;
    this.y += (dy / d) * s;
    if (Math.abs(dx) > 2) this.facing = dx > 0 ? 1 : -1;
    this.dirUp = Math.abs(dy) > Math.abs(dx) && dy < 0;
    return d < 8;
  }

  clampToField() {
    this.scene.resolveObstacles?.(this); // trees & rocks are solid
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
    if (this.alive) {
      const want = this.currentTexture();
      if (this.sprite.texture.key !== want) this.sprite.setTexture(want);
    }
    // ramrod bob: anyone working a reload pumps up and down a little
    const bob = (this.alive && this.loaded === false && this.reloadT > 0)
      ? Math.sin(this.scene.time.now / 55) * 1.4 * ds : 0;
    this.sprite.setPosition(this.x, this.y - 13 * ds + bob)
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
    this.baseTex = 'soldier_blue';
    this.weapon = 'rifle';    // 'rifle' | 'sword'
    this.switchT = 0;         // >0 while stowing/drawing
    this.loaded = true;
    this.reloadT = 0;
    this.reloadTime = 2.2;
    this.swordCd = 0;
    this.faceX = 1; this.faceY = 0; // facing vector (last committed direction)
    this.moving = false;
    this.pendingDir = null;  // candidate facing (octant key)
    this.pendingT = 0;       // how long it's been held
  }

  update(dt, input) {
    if (!this.alive) return;
    let dx = 0, dy = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    this.moving = !!(dx || dy);
    if (this.moving) {
      const n = Math.hypot(dx, dy);
      const s = this.speed * dscale(this.y) * dt;
      this.x += (dx / n) * s;
      this.y += (dy / n) * s;
      this.clampToField();
      // Commit facing only after the direction is HELD briefly. Without this,
      // releasing two keys of a diagonal a frame apart snaps the facing to a
      // cardinal — diagonals could never stick for formations or the sword.
      const key = `${Math.sign(dx)},${Math.sign(dy)}`;
      if (key === this.pendingDir) this.pendingT += dt;
      else { this.pendingDir = key; this.pendingT = 0; }
      if (this.pendingT >= .06) {
        this.faceX = dx / n; this.faceY = dy / n;
        if (dx) this.facing = dx > 0 ? 1 : -1;
        this.dirUp = Math.abs(dy) > Math.abs(dx) && dy < 0;
      }
    } else {
      this.pendingDir = null; this.pendingT = 0;
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.loaded = true; sfx.reloadDone(); this.scene.toast('rifle loaded'); }
    }
    if (this.switchT > 0) this.switchT -= dt;
    this.swordCd = Math.max(0, this.swordCd - dt);
    this.updateVisual(dt);
  }

  faceAngle() { return Math.atan2(this.faceY, this.faceX); }

  currentTexture() {
    return `soldier_blue_${this.weapon}${this.dirUp ? '_up' : ''}`;
  }

  // X / TAB: stow one weapon, draw the other. Takes a moment — mid-switch
  // you can't attack, and the sprite swaps halfway through.
  switchWeapon() {
    if (!this.alive || this.switchT > 0) return;
    this.switchT = .5;
    const next = this.weapon === 'rifle' ? 'sword' : 'rifle';
    this.scene.toast(next === 'sword' ? 'stowing rifle… sword out!' : 'sheathing sword… rifle up!');
    this.scene.tweens.add({ targets: this.sprite, angle: { from: -12, to: 0 }, duration: 480, ease: 'Back.easeOut' });
    this.scene.time.delayedCall(250, () => { this.weapon = next; });
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
      sfx.reloadStart();
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
      const t = scene.nearestVisibleEnemy(this, 2000);
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
      // fire-at-will holds its ground — only formation modes track the player
      if (!this.readied && this.mode !== 'free') {
        this.moveToward(this.targetSlot.x, this.targetSlot.y, dt);
      }
      if (enemy) this.facing = enemy.x > this.x ? 1 : -1;
      if (this.mode === 'free') {
        this.orderReload(); // fire-at-will soldiers reload themselves
        if (enemy && this.loaded && this.fireCd <= 0) {
          this.fireCd = .4 + Math.random() * .6;
          this.shoot(scene, enemy, 11, 38); // wildest fire in the game
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
// Enemies: five types, unlocked as the ground gets more dangerous.
//   grunt      — melee, slow          (everywhere)
//   skirmisher — rifle, wild aim      (danger > 12%)
//   runner     — melee, fast          (danger > 30%)
//   marksman   — rifle, deadly aim    (danger > 50%)
//   veteran    — rifle at range, sword up close (danger > 70%)
// Rifle enemies keep their distance, fire hostile bullets and take time to
// reload (their reload bar shows — that's your window to close in).
// They will NOT cross into the village: at the safe edge they give up,
// linger, and eventually slink away.
// ---------------------------------------------------------------------------
export const ENEMY_TYPES = {
  grunt:      { tex: 'enemy_grunt',      hp: 60, speed: 62,  melee: { dmg: 8,  cd: .85 } },
  skirmisher: { tex: 'enemy_skirmisher', hp: 50, speed: 78,  rifle: { range: 430, spread: 13, dmg: 9,  reload: 3.6 } },
  runner:     { tex: 'enemy_runner',     hp: 45, speed: 160, melee: { dmg: 7,  cd: .6 } },
  marksman:   { tex: 'enemy_marksman',   hp: 55, speed: 74,  rifle: { range: 580, spread: 3,  dmg: 16, reload: 3.4 } },
  veteran:    { tex: 'enemy_veteran',    hp: 95, speed: 105, melee: { dmg: 12, cd: .7 },
                                                             rifle: { range: 470, spread: 6,  dmg: 12, reload: 3 } },
};

export class Enemy extends Unit {
  constructor(scene, x, y, type = 'grunt') {
    const spec = ENEMY_TYPES[type];
    super(scene, x, y, spec.tex, {
      hp: Math.round(spec.hp * (1 + dangerAt(x) * .4)), // deep-east ones are hardier
      speed: spec.speed,
    });
    this.type = type;
    this.spec = spec;
    this.atkCd = 0;
    this.loaded = !!spec.rifle;
    this.reloadT = 0;
    this.reloadTime = spec.rifle?.reload ?? 0;
    this.idleT = 0; // time spent with no reachable target
  }

  update(dt, scene) {
    if (!this.alive) return;
    this.atkCd = Math.max(0, this.atkCd - dt);
    if (this.spec.rifle && !this.loaded && this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.loaded = true;
    }
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
      const spec = this.spec;
      const meleeRange = 27 * dscale(this.y);
      // veterans switch to steel up close; pure riflemen always prefer distance
      const useRifle = spec.rifle && (!spec.melee || d > 140);

      if (useRifle) {
        if (d > spec.rifle.range * .85) {
          this.moveToward(t.x, t.y, dt);
        } else if (d < spec.rifle.range * .35) {
          this.moveToward(this.x + (this.x - t.x), this.y + (this.y - t.y), dt, .55); // give ground
        } else {
          this.facing = t.x > this.x ? 1 : -1;
        }
        if (this.loaded && this.atkCd <= 0 && d <= spec.rifle.range) {
          this.atkCd = .5;
          this.loaded = false;
          this.reloadT = spec.rifle.reload;
          const a = Math.atan2((t.y - 13 * dscale(t.y)) - (this.y - 13 * dscale(this.y)), t.x - this.x);
          scene.shoot(this, a, spec.rifle.spread, spec.rifle.dmg, true);
        }
      } else if (spec.melee) {
        if (d > meleeRange) {
          this.moveToward(t.x, t.y, dt);
        } else if (this.atkCd <= 0) {
          this.atkCd = spec.melee.cd;
          t.takeDamage(spec.melee.dmg);
          scene.slashFx(this.x, this.y - 10, Math.atan2(t.y - this.y, t.x - this.x), 0xff8866);
        }
      }
      if (this.x < SAFE_EDGE) this.x = SAFE_EDGE; // even retreating, never into the village
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
