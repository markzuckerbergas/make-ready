# music/

The three composed songs of the soundtrack, as playable `.strudel` files
(open them at <https://strudel.cc> or in the Strudel VS Code extension).
These are the composition sources — the game plays JavaScript ports
(village & field: the `-simple` versions; battle: the full composition) in
[`src/music.js`](../src/music.js), which adds the zone-crossfade and
per-song playhead logic.

| Song | Zone | Length |
|------|------|--------|
| `village-song.strudel` | the homestead | ~2:10 loop |
| `departure-song.strudel` | the open field | ~1:40 loop |
| `battle.strudel` | enemies engaged | ~2:20 loop |

All three run at 96 BPM so transitions crossfade beat-locked.

One substitution in the game port: the celesta layers (`gm_celesta` is a GM
soundfont, not available in `@strudel/web`) are played by quiet piano an
octave up instead.

Samples: Salamander Grand Piano by Alexander Holm (CC-BY 3.0),
VCSL orchestral percussion (CC0, Versilian Studios), Dirt-Samples.
