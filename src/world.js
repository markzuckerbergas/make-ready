// The world is a long horizontal strip traversed left-to-right.
// x is west→east (the journey), y is depth (FF6 / Octopath style):
// units higher on screen are "far away", drawn smaller and behind.
//
// Far LEFT = the village (safe zone, no enemies).
// The further RIGHT you go, the more danger — and the better the loot.

export const WORLD_W = 5200;

export const PLAY = {
  left: 40,
  right: WORLD_W - 40,
  top: 195,     // farthest walkable row (just under the horizon)
  bottom: 515,  // nearest walkable row (bottom of the screen)
  horizon: 150,
};

// East of this line enemies may exist; west of it is village ground.
export const SAFE_EDGE = 650;

// 0 at the village outskirts, 1 deep in the east.
export const dangerAt = x => clamp((x - 800) / 3600, 0, 1);

// Depth scale: 0.55 at the horizon, ~1.2 at the near edge.
export const dscale = y => 0.55 + ((y - PLAY.top) / (PLAY.bottom - PLAY.top)) * 0.65;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
