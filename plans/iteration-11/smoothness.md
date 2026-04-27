# Iteration 11 — Smoothness Review

Iter-11 keystone is a dynamic background mechanic (~30-40 LOC, presumably layered between `clearRect` and `drawWalls`, possibly pulsing on gravity flip). Smoothness budget: ≤ 25 LOC, 2-3 picks. I'm picking the items that **compose with renderAngle / gravity flip** and **don't touch the bg layer** so the synthesis can land both bundles independently.

---

## Picks (3 changes, ~15 LOC)

| # | Change | LOC | Source |
|---|---|---|---|
| 1 | Shield `(+)` indicator inside rotated frame | ~6 | iter-10 deferred (architectural) |
| 2 | Pip / HP-label overlap fix | ~4 | iter-10 deferred (playtest §9) |
| 3 | Opp drop-back wall→floor ease | ~5 | iter-10 deferred (paint-job) |

---

## Change 1 — Shield `(+)` indicator inside rotated frame

**What.** Move the `(+)` shield glyph out of `render()` (`game.js:812-827`, drawn at `opponent.x, opponent.y - 78` in world-space) and into `drawStickOnSurface` via the `opts` payload, so it rotates with the fighter.

**Why.** Two reasons.

1. **Bug.** With `opponent.surface ∈ {left, right, ceiling}`, the glyph today floats in mid-arena, 78 px above the opponent's *world* y. On the right wall the opponent's "head" is at world `opponent.x - ~50, opponent.y` (post-rotation by `-π/2`), so a `y - 78` glyph paints 78 px above the wall-stuck body in world-space — *not* above the head. Same anti-pattern on left wall and ceiling.
2. **Architecture.** iter-10 deferred this as "per-fighter UI inside rotated transform." The renderAngle system at `game.js:643-650` is now exactly the right hook: the glyph is drawn at local `(0, -78)` *inside* the `ctx.save / translate / rotate / restore` block, so it inherits the eased rotation for free. This is the clean composition with iter-10.

**Where.**
- `game.js:812-827` — strip the in-render world-space block.
- `game.js:806-810` — pass `shieldT` (or just `shielding: opponent.state === 'shielding'`, plus `shieldRemaining: opponent.stateTimer`) into `drawStickOnSurface` opts.
- `game.js:643-650` (`drawStickOnSurface`) — after `drawStick(0, 0, opts)`, if `opts.shielding`, paint `(+)` at local `(0, -78)` with the same alpha curve currently at lines 814-821.

**Spec sketch.**

In `render()`, replace the existing `(+)` block with:

```js
drawStickOnSurface(opponent.x, opponent.y, opponent.surface, {
  facing: -1,
  color: flashColor(...),
  renderAngle: opponent.renderAngle,
  shielding: opponent.state === 'shielding',
  shieldRemaining: opponent.stateTimer,
});
```

In `drawStickOnSurface`, after `drawStick(0, 0, opts)` and before `ctx.restore()`:

```js
if (opts && opts.shielding) {
  const r = opts.shieldRemaining;
  const a = r < 0.25
    ? 0.5 + 0.5 * (Math.floor(performance.now() / 40) % 2)
    : 0.55 + 0.25 * Math.sin(performance.now() / 220);
  ctx.fillStyle = `rgba(136, 204, 238, ${a.toFixed(3)})`;
  ctx.font = 'bold 18px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('(+)', 0, -78);
}
```

**Watch.**
- Glyph is *inside* the rotation, so on a flipped frame `(0, -78)` rotates correctly to "above the head from the fighter's POV."
- `font / textAlign / textBaseline` get reset on each call — fine, they're already set inside the save/restore.
- During the renderAngle ease (~6 frames after a flip), the glyph eases too. That's correct: it should track the head, not snap.
- `gravityDir` not referenced — surface basis is already encoded in `surfaceAngle(s)` via `opts.renderAngle`.

**Composes with iter-11 bg.** No bg interaction; this is fighter-local.

**LOC.** ~6 (1 in render call site, 5 in drawStickOnSurface).

---

## Change 2 — Pip / HP-label overlap

**What.** Move round-pips below the HP bar instead of above the label.

**Why.** Today (`game.js:838-842`) pips paint at `y=12` with `textBaseline='middle'`. HP label paints at `y - 4 = 16` with `textBaseline='alphabetic'` (`drawHpBar` `game.js:754`). The HP label glyph ascender (~10 px above baseline) ends ~y=6; pip baseline at y=12 → glyphs span y=6..18. They overlap at y=6..16 with the HP label characters. Visible kerning collision when HP is at e.g. "100/100".

**Where.** `game.js:838-842`.

**Spec.**
- HP bar bottom edge: `y + h = 20 + 14 = 34`. Place pips at y=42 (8 px gap).
- Update both `ctx.fillText` calls' y from `12` to `42`.
- Optionally tighten gap by also moving pip x slightly inward (cosmetic; skip unless playtest flags).

**Watch.**
- HP bars are 240 wide, ending at `WALL_THICKNESS + 12 + 240 = 276` (left) and `W - WALL_THICKNESS - 12 - 240 = 624` (right) — pips at the bar's outer edge (x=`WALL_THICKNESS+12` and `W-WALL_THICKNESS-12`) sit *below* the bar end caps. No overlap with the bar itself.
- Flip-countdown glyph at `y=48` (`game.js:775`) is centered horizontally (`W/2`); pips are at the outer canvas edges. No conflict.
- iter-11 bg layer paints under the HUD (between `clearRect` and `drawWalls`, before the HP/pip block at `game.js:829+`). Pip y change is HUD-only — no bg conflict.

**LOC.** ~4 (2 line changes; arguably 2 if I just change the y literal twice).

---

## Change 3 — Opp drop-back wall→floor ease

**What.** Replace the instant `opp.y = GROUND_Y / CEIL_Y` snap on wall-detach with a short lerp toward target.

**Why.** `game.js:451-455`: when the player walks away from a wall-clinging opp, the opp teleports back to the active floor. Visible snap, flagged by iter-10 synthesis as a paint-job. With the new background mechanic shipping in iter-11, any bg-pulse-on-position would also snap with the opp — so smoothing this also smooths the bg interaction for free.

**Where.** `game.js:451-455`.

**Spec.**
- Don't set `opponent.surface` immediately. Instead, set a target y and tween over a few frames.
- Cleanest: add `opponent.dropBack` flag + `opponent.dropTargetY`; while flag is set, lerp y toward target with the same `1 - Math.pow(1 - 0.18, dt * 60)` factor used elsewhere (`game.js:411`). When `|y - target| < 2`, snap and clear flag, then update `surface`.

```js
if (!playerNearWall && Math.abs(player.x - opponent.x) > EVASION_RANGE * 2) {
  const targetY = gravityDir === 1 ? GROUND_Y : CEIL_Y;
  opponent.y += (targetY - opponent.y) * (1 - Math.pow(1 - 0.18, dt * 60));
  if (Math.abs(opponent.y - targetY) < 2) {
    opponent.y = targetY;
    opponent.surface = gravityDir === 1 ? 'floor' : 'ceiling';
    opponent.vy = 0;
  }
}
```

**Watch.**
- During the ease, `opponent.surface` is still `'left'` or `'right'`. The renderAngle ease keeps angle on the wall-perpendicular for those frames, which means the figure rides down/up the wall *while still rotated 90°.* That actually reads fine — it's the "letting go and falling along the wall face" pose. When `surface` finally flips to `'floor'`, the renderAngle ease takes ~6 frames to unwind to 0, hiding the seam.
- Hit-tests: while `surface !== 'floor'`, `opponent` is still treated as wall-stuck for punch resolution (`game.js:478,505,538`) — those branches reset surface on hit. Fine.
- Flip mid-tween: `gravityDir` flips → `targetY` flips. Opp is mid-air, lerps to the *new* active floor. That's the right behaviour (matches Change 4 of iter-10's "mid-air fighter follows new gravity").
- Patrol code (`game.js:404-456`) is gated on `surface === 'floor' || surface === 'ceiling'`. During the ease, opp falls into the `else` branch (wall-stuck behaviour), which now does the lerp instead of the snap. The wall-climb-target check (`!reached`) above stays correct because the `dropBack` lerp short-circuits before the `targetY` climb logic? — no, look closer: the climb logic at `game.js:439-447` runs *before* the drop-back check at line 449. So during the ease, opp tries to climb to `H*0.6 / H*0.4`, then immediately the drop-back trigger pulls it toward the floor. Need to reorder: drop-back check first, with `else` around the climb. Cost: 1 LOC of restructuring (already in the budget).

**LOC.** ~5 (the lerp block + 2 lines of guard reorder).

---

## Total: ~15 LOC. Under cap with 10 LOC slack.

---

## Deferred (iter-12+)

- **Wall/ceiling-stuck punch hit-test geometry** (~10 LOC). Needs `fistX/fistY` rotated through a per-surface basis. Touches 4 punch sites (`game.js:494-495`, `game.js:469`, `game.js:525-526`, plus uppercut). Defer one more iteration: lands cleanest after a playtest of the rotated shield indicator (Change 1) confirms the rotated-frame architecture is stable, since the hit-test fix wants the same `surfaceAngle`-derived basis.
- **Intermission overlay fade** (~6 LOC). Skipping because iter-11's dynamic background may want its own intermission treatment (e.g. desaturate / settle bg under the overlay) — bundle with bg work in iter-12.
- **KO pose** (~6 LOC). Skipping because a slumped pose under arbitrary `renderAngle` (wall, ceiling, mid-flip) is finicky — wants its own playtest pass. Easy to ship in iter-12 once the rotated-UI pattern is established by Change 1.
- **Knockback magnitude tune** (~1 LOC). iter-10 synthesis already deferred until "after a flip-aware match." Iter-11 ships gravity flip + bg; revisit in iter-12 playtest with all motion in scope.
- **Dive pose mirror under 180° rotation** — wait on iter-11 playtest. Symptom-dependent.

---

## Composition with iter-11 keystone (dynamic bg)

- **Change 1** is fighter-local; bg paints behind. Zero conflict.
- **Change 2** is HUD-local (top-of-canvas pips); bg paints behind HUD. Zero conflict.
- **Change 3** is sim-state (opp.y); doesn't touch render. If bg pulses on opp position, it benefits from the smoothed y. Free synergy.
- All three picks compose cleanly with the iter-10 renderAngle ease. None re-architect surface or gravity, so the bg can hook into `gravityDir` / `flipTimer` without stepping on smoothness fixes.

---

## Implementation order

1. **Change 2** (pips). Trivial, lands first, validates HUD positions.
2. **Change 1** (shield indicator inside rotated frame). Slightly opinionated; ship before bg so the rotated-UI pattern is in place for any bg-side rotation polish.
3. **Change 3** (opp drop-back ease). Touches sim; lands last among smoothness picks.
4. **Bg keystone** layers on top.
