// The playfield uses a fake-3D convention (FF6 / Octopath style):
// x is left-right, y is depth — units higher on screen are "far away",
// drawn smaller and behind, units lower are "near", bigger and in front.

export const PLAY = {
  left: 60,
  right: 900,
  top: 195,     // farthest walkable row (just under the horizon)
  bottom: 515,  // nearest walkable row (bottom of the screen)
  horizon: 150,
};

// Depth scale: 0.55 at the horizon, ~1.2 at the near edge.
export const dscale = y => 0.55 + ((y - PLAY.top) / (PLAY.bottom - PLAY.top)) * 0.65;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
