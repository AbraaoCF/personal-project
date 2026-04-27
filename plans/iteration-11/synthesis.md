# Iteration 11 — Synthesis (DYNAMIC BACKGROUND)

Iter-10 shipped gravity flip + ceiling, telegraph, renderAngle ease, wall-run
stabilisation. The arena now inverts — but the canvas behind it is still flat
`#1a1a1a`. Iter-11's keystone is a 3-layer dynamic background (palette wash +
parallax motes + shield-drop pulse ring) that turns the void into a reactive
instrument. Bundled with two MUST-LAND bug fixes (shield indicator off-screen
at ceiling — folded into the rotated-frame smoothness pick — and flipped-
gravity wall-perch unreachable) and the remaining smoothness picks.

**Order of operations:** bug fixes first (1-LOC tunings, low risk), then the
smoothness/architecture pick that fixes the shield-indicator bug, then the
3-layer background keystone, then the cosmetic countdown guard.

---

## Picks (6 changes, ~55 LOC)

| # | Change                                         | LOC | Source                  |
|---|------------------------------------------------|-----|-------------------------|
| 1 | Wall-perch flipped targetY fix                 | ~1  | playtest §9f            |
| 2 | Countdown state guard                          | ~1  | playtest §9b            |
| 3 | Shield indicator inside rotated frame          | ~6  | smoothness #1 + §9c     |
| 4 | Pip y=12 → y=42                                | ~2  | smoothness #2           |
| 5 | Opp drop-back wall→active-floor ease           | ~7  | smoothness #3           |
| 6 | Dynamic background (palette + motes + pulse)   | ~38 | inspiration #2 + #4 + #3|

Total: ~55 LOC. Under 80 cap with 25 LOC slack.

---

## Change 1 — Wall-perch flipped targetY

**What.** Single literal flip on `game.js:439`.

**Why.** Playtest §9f. With `gravityDir=-1`, opp climbs to `H*0.4=200`, but
player on ceiling y=60 + jump apex 120 = y=180. Apex is *above* opp in
world-y → divepunch (which sends player toward active floor = upward in
world) goes the wrong direction. Player can't reach a wall-perched opp in
flipped gravity. Mirror of iter-9 §4.

The fix: keep targetY *closer to active floor* — opp must always be below
the player's apex (in active-floor terms). On floor, that's
`GROUND_Y - 120 = 300` (already). On ceiling, that's `CEIL_Y + 120 = 180`.
Both at exact jump apex; both reachable.

**Where.** `game.js:439`.

**Spec.**
```js
const targetY = gravityDir === 1 ? GROUND_Y - 120 : CEIL_Y + 120;
```
(Was `gravityDir === 1 ? H * 0.6 : H * 0.4`. Numerically: 300 stays 300;
200 becomes 180.)

**Test in head.** `gravityDir=1`: targetY=300, climbDir=-1 (climb up),
reached=opp.y<=300. ✓ unchanged from iter-10. `gravityDir=-1`: targetY=180,
climbDir=+1 (climb down), reached=opp.y>=180. From CEIL_Y=60, opp climbs
*down* (vy=+130) to y=180. Player on ceiling y=60, jump apex (vy=+720
under -2160 accel) reaches y=180 — at apex, divepunch fistY=150, opp band
(opp.y-80, opp.y-20)=(100,160) → fistY=150 inside band. ✓

**Watch.** climbDir derivation `gravityDir === 1 ? -1 : 1` already correct.
The literal change is the *only* line touched.

**LOC.** ~1.

---

## Change 2 — Countdown state guard

**What.** `game.js:768` — drop the `state === STATE.OVER` allowance.

**Why.** Playtest §9b. On KO with `flipTimer < 1`, countdown pulses over
the K.O. screen / game-over fade. Cosmetic.

**Where.** `game.js:768`.

**Spec.**
```js
if (flipTimer < 1 && roundPhase === 'fighting' && state === STATE.PLAY) {
```
(Was `(state === STATE.PLAY || state === STATE.OVER)`.)

**Test in head.** During play: identical. On `toGameOver()`: state=OVER,
guard fails, countdown invisible. ✓

**LOC.** ~1.

---

## Change 3 — Shield indicator inside rotated frame

**What.** Move the `(+)` glyph out of `render()` (`game.js:812-827`) into
`drawStickOnSurface` via `opts`, painted at local `(0, -78)` *inside* the
rotation block.

**Why.** Smoothness #1 / playtest §9c. Today the glyph paints at world
`(opponent.x, opponent.y - 78)`. With opp on ceiling (y=60), glyph is at
y=-18 — **off-screen**. Player has zero shield telegraph during ceiling
combat → whiffs into shield, eats 360 px/s knockback with no warning. Same
broken on walls (was iter-9 known limit; ceiling promotes it to combat-
critical). This pick is architectural: pass shield state into `drawStick-
OnSurface` opts, paint inside the save/translate/rotate block, glyph
inherits renderAngle for free.

**Where.**
- `game.js:806-810` — opts payload (the existing opp `drawStickOnSurface`
  call site).
- `game.js:643-650` — `drawStickOnSurface` body, after `drawStick(0,0,opts)`
  and before `ctx.restore()`.
- `game.js:812-827` — strip the world-space `(+)` block.

**Spec.**

Render call site (replace existing `drawStickOnSurface(opponent…)` opts):
```js
drawStickOnSurface(opponent.x, opponent.y, opponent.surface, {
  facing: -1,
  color: flashColor(OPPONENT_RGB, FLASH_RGB, opponent.hitFlash / HIT_FLASH_DURATION),
  renderAngle: opponent.renderAngle,
  shielding: opponent.state === 'shielding',
  shieldRemaining: opponent.stateTimer,
});
```

In `drawStickOnSurface` (after `drawStick(0, 0, opts);`):
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

Delete `game.js:812-827` (the existing `if (opponent.state === 'shielding')`
block).

**Test in head.**
- Floor: angle=0, glyph at world (opp.x, opp.y-78) — identical to iter-10.
- Ceiling: angle=π, glyph local (0,-78) rotates to world (opp.x, opp.y+78)
  — appears *below* the ceiling-stuck head, on-screen. ✓
- Right wall: angle=-π/2, glyph at world (opp.x-78, opp.y) — off the wall
  to the left, into the arena. ✓
- During flip ease: glyph eases with the head, no snap.

**Watch.** The glyph's font/textAlign/textBaseline reset is fine since
`drawStick` already sets them inside the save/restore. The opp-only call
site is the only one touched (player has no shield indicator).

**LOC.** ~6 (1 in render call site, 5 in drawStickOnSurface, minus 16 deleted).

---

## Change 4 — Pip y=12 → y=42

**What.** Round-pips below the HP bar instead of overlapping the label.

**Why.** Smoothness #2. HP label (12-px font, alphabetic baseline at y=16)
ascender ends ~y=6; pips (middle baseline at y=12) span y=6..18. Visible
glyph kerning collision when HP shows e.g. "100/100".

**Where.** `game.js:838-842`.

**Spec.** Change two y literals: `12` → `42`. HP bar bottom is y+h=34;
8-px gap puts pips at y=42, clear of bar edge caps. Flip-countdown lives
at W/2,y=48 — pips at outer canvas edges, no overlap.

**Test in head.** Pips at y=42, baseline=middle: glyphs span y=36..48. HP
bar ends at y=34. Gap of 2 px between bar bottom and pip top — clean.
Countdown glyph (36-px bold, top baseline) starts y=48 — pips end y=48
exactly; same y-edge alignment, no overlap because horizontal positions
differ (pips at outer edges, countdown centred).

**LOC.** ~2.

---

## Change 5 — Opp drop-back wall→active-floor ease

**What.** Replace the instant `opp.y = GROUND_Y / CEIL_Y` snap on wall-
detach (`game.js:451-455`) with a short lerp toward target.

**Why.** Smoothness #3. Wall-stuck opp drops back to active floor with a
visible teleport. With iter-11's bg motes inheriting opp position (no, they
don't — but the principle stands: smoothing sim-state pays back any visual
that reads off it). Drop-back ease reads as "letting go and falling along
the wall face."

**Where.** `game.js:449-455` — restructure to put drop-back check before
the climb logic, so once dropping, it doesn't fight the climb.

**Spec.** Replace the entire wall-stuck branch (`game.js:435-455`) with
the drop-back-first ordering:
```js
} else {
  // Wall-stuck. If player walks away, ease back to active floor; else climb.
  const playerNearWall = (opponent.surface === 'left' && player.x < 200)
                      || (opponent.surface === 'right' && player.x > W - 200);
  const dropBack = !playerNearWall && Math.abs(player.x - opponent.x) > EVASION_RANGE * 2;
  if (dropBack) {
    const dropTargetY = gravityDir === 1 ? GROUND_Y : CEIL_Y;
    opponent.y += (dropTargetY - opponent.y) * (1 - Math.pow(1 - 0.18, dt * 60));
    if (Math.abs(opponent.y - dropTargetY) < 2) {
      opponent.y = dropTargetY;
      opponent.surface = gravityDir === 1 ? 'floor' : 'ceiling';
      opponent.vy = 0;
    }
  } else {
    const targetY = gravityDir === 1 ? GROUND_Y - 120 : CEIL_Y + 120;
    const climbDir = gravityDir === 1 ? -1 : 1;
    const reached = climbDir === -1 ? opponent.y <= targetY : opponent.y >= targetY;
    if (!reached) {
      opponent.y += (opponent.vy || climbDir * EVASION_SPEED) * dt;
    } else {
      opponent.y = targetY;
      opponent.vy = 0;
    }
  }
}
```
This bundles Change 1 (the targetY literal) into the same block — count
LOC for this change as ~7 net (the climb body is unchanged, the drop-
back lerp is new, the targetY literal lives here too).

**Watch.**
- During the ease, `opponent.surface` stays `'left'`/`'right'` until the
  snap-on-arrival. RenderAngle keeps the wall-perpendicular pose during
  the slide — reads as falling-along-the-wall. When surface flips to
  `'floor'`/`'ceiling'`, renderAngle eases ~6 frames to unwind. Hides the
  seam.
- Flip mid-tween: gravityDir flips → dropTargetY flips. Opp eases toward
  the new active floor naturally. ✓
- Hit-tests during ease: branches at `game.js:478,505,538` reset surface
  on hit — overrides the ease cleanly.
- Patrol code is gated on `surface === 'floor' || surface === 'ceiling'`,
  so wall-stuck branch handles both climb + drop-back here. ✓

**Test in head.** Player corners opp on right wall, opp climbs to y=300.
Player walks left to x=200. Trigger fires (`!playerNearWall` and
`|x-x|>180`). Lerp factor at 60 fps ~0.18, so 240→GROUND_Y in ~12 frames
≈ 200 ms. Smooth slide down to floor. ✓ Flipped: lerp factor unchanged,
240→CEIL_Y in same time. ✓

**LOC.** ~7.

---

## Change 6 — Dynamic background (palette wash + motes + pulse ring)

**What.** Three composing layers on the canvas behind everything else:
(a) palette wash — gravityDir-driven RGB lerp filling clearRect; (b)
parallax motes — 24 pre-allocated drifting dots, gravityDir-inverting
horizontal drift; (c) shield-drop pulse ring — single ring spawned when
opp transitions `'shielding' → 'open'`, expands and fades.

**Why.** Inspiration #2 + #4 + #3. Recommended composition (~36 LOC).
The flat `#1a1a1a` arena currently has no atmosphere, no aftermath state
readout (flip event is loud, post-flip looks identical), no rhythm reverb
for the shield drop. This bundle answers all three.

**Where.**
- Module state: near `let shake = 0;` (`game.js:20`).
- Init (motes pre-allocation): module top, after constants.
- `resetRound`: reset palette + pulse ring.
- `update(dt)`: tick palette lerp, mote positions, pulse ring timer; spawn
  pulse on shield-drop transition.
- `render()`: replace `ctx.clearRect` with palette fill; draw motes after
  `ctx.translate(sx, sy)` (inside shake) but before `drawWalls()`; draw
  pulse ring after `drawGround()` and before fighters.

**Spec.**

### 6a. Palette wash (~10 LOC)

Module state (after `let flipTimer = 0;`):
```js
const PALETTE_RIGHT_UP = [20, 22, 28];   // cool dark
const PALETTE_FLIPPED  = [28, 22, 20];   // warm dark
let bgR = 20, bgG = 22, bgB = 28;
```

`resetRound` (after `flipTimer = FLIP_COOLDOWN;`):
```js
bgR = PALETTE_RIGHT_UP[0]; bgG = PALETTE_RIGHT_UP[1]; bgB = PALETTE_RIGHT_UP[2];
```

In `update(dt)` near the renderAngle ease (before `keysPressed.clear()`):
```js
const target = gravityDir === 1 ? PALETTE_RIGHT_UP : PALETTE_FLIPPED;
const k = 1 - Math.pow(1 - 0.04, dt * 60);
bgR += (target[0] - bgR) * k;
bgG += (target[1] - bgG) * k;
bgB += (target[2] - bgB) * k;
```

In `render()` — replace `ctx.clearRect(0, 0, W, H);` (`game.js:758`) with:
```js
ctx.fillStyle = `rgb(${Math.round(bgR)}, ${Math.round(bgG)}, ${Math.round(bgB)})`;
ctx.fillRect(0, 0, W, H);
```

The palette fill runs *before* `ctx.save()/translate(sx,sy)` so the bg
is shake-immune (stable horizon while world jitters). Per inspiration §2:
"asymmetry is intentional and correct."

**Edge cases.** `resetRound` snaps palette to right-side-up — each round
opens cool-dark. At each flip, target swaps; ease completes in ~1 s
(0.04/frame factor). Lerp clamping unnecessary — values stay between two
fixed RGB triples.

### 6b. Parallax motes (~14 LOC)

Module-level pre-allocation (after the `PALETTE_*` constants):
```js
const MOTES = [];
for (let i = 0; i < 24; i++) {
  MOTES.push({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: (Math.random() * 12 - 6) + (Math.random() < 0.5 ? -3 : 3),
    vy: Math.random() * 10 - 5,
    alpha: 0.05 + Math.random() * 0.10,
  });
}
```
(vx ∈ ±[3, 9] px/s; vy ∈ ±5 px/s; alpha ∈ [0.05, 0.15]. The split-bias on
vx avoids motes with near-zero horizontal drift.)

In `update(dt)` (immediately before the palette lerp):
```js
for (const m of MOTES) {
  m.x += m.vx * dt * gravityDir;
  m.y += m.vy * dt;
  if (m.x < 0) m.x += W; else if (m.x > W) m.x -= W;
  if (m.y < 0) m.y += H; else if (m.y > H) m.y -= H;
}
```
(gravityDir-inversion of horizontal drift; vertical drift is gravity-
agnostic — wraps cleanly.)

In `render()` — after `ctx.translate(sx, sy)` (`game.js:763`), before
`drawWalls()`:
```js
for (const m of MOTES) {
  ctx.fillStyle = `rgba(180, 180, 200, ${m.alpha.toFixed(3)})`;
  ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
}
```

**Edge cases.**
- No allocation per frame (fixed-size array, mutate in place).
- Motes inherit shake (drawn inside translate). ✓
- Wrap is modulo-style — handles arbitrary dt without escaping bounds.
- `gravityDir` flip reverses horizontal drift; vertical untouched. Subtle
  signal — observed by returning players, ignored by new ones.

### 6c. Shield-drop pulse ring (~12 LOC)

Module state:
```js
const pulseRing = { x: 0, y: 0, t: 0, dur: 0.6 };  // t > dur means inactive
```

`resetRound` (with the palette reset):
```js
pulseRing.t = pulseRing.dur + 1;  // start expired
```

Spawn — modify the shield state-machine (`game.js:399-402`) to detect the
shielding→open transition:
```js
} else if (opponent.state === 'shielding' && opponent.stateTimer <= 0) {
  opponent.state = 'open';
  opponent.stateTimer = SHIELD_OPEN;
  pulseRing.x = opponent.x; pulseRing.y = opponent.y; pulseRing.t = 0;
}
```

Tick in `update(dt)` (near the palette lerp):
```js
if (pulseRing.t < pulseRing.dur) pulseRing.t += dt;
```

Render — after `drawGround()` and before the countdown / fighters
(`game.js:767`):
```js
if (pulseRing.t < pulseRing.dur) {
  const tt = pulseRing.t / pulseRing.dur;
  const radius = 30 + 200 * tt;
  const alpha = (1 - tt) * 0.4;
  ctx.strokeStyle = `rgba(136, 204, 238, ${alpha.toFixed(3)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(pulseRing.x, pulseRing.y, radius, 0, Math.PI * 2);
  ctx.stroke();
}
```

**Edge cases.**
- Single in-flight ring; new shield-drop overwrites position + resets t=0.
- Ring drawn inside shake transform — shakes with world. ✓
- Spawn at `(opponent.x, opponent.y)` regardless of surface: ring radiates
  from wall/ceiling-stuck opp naturally (per inspiration #3 §composition).
- Flip event opens both shields synchronously (`game.js:239-240`) — but
  the flip path doesn't go through the timer-driven `'shielding' → 'open'`
  branch; it forces `state='open'` directly. So the flip-induced opening
  spawns no ring. Acceptable: flip event already has shake + countdown +
  rotation — adding a ring would be visual clutter. Pulse ring stays
  scoped to the natural shield rhythm.
- KO during shielding: state-machine still ticks (timer counts down); ring
  spawns even after KO. Cosmetically fine (atmospheric), but: hitstop early-
  returns at `game.js:221` skip the spawn. After hitstop clears, if opp
  was KO'd, state-machine no-ops (state stays whatever it was). No spurious
  ring. ✓
- Ring radius caps at 30+200=230 px. From mid-arena (W/2=420), reaches
  near both wall faces — fills the visible play area, fades to 0 alpha.

**Test in head.**
- Round opens; opp.state='open', stateTimer=0.6. At 0.6 s: state→shielding,
  timer=1.4. At 2.0 s: state→open, timer=0.6, **ring spawns at opp.x/y**.
  Ring expands 30→230 over 0.6 s, alpha 0.4→0. Then opp rhythm continues;
  next ring at 2.6 s. ✓
- Player hits opp shield: knockback fires, opp.state forced to 'shielding'
  with `stateTimer = SHIELD_CLOSED`. Mid-shield-cycle force-reset desyncs
  ring spawning to player rhythm — *good*: ring becomes the "you missed,
  now wait for it" beat. ✓

### 6d. Composition

| Layer | Trigger | Where rendered | Inherits shake? |
|-------|---------|----------------|------------------|
| Palette wash | gravityDir | Before save/translate | No (stable horizon) |
| Motes | continuous | After translate, before walls | Yes |
| Pulse ring | shield-drop transition | After ground, before fighters | Yes |

The palette fill renders first (replaces clearRect); shake-immune. Motes
+ ring render inside the shake transform; jitter with world. Walls/ground
paint over motes (motes are *atmosphere*, not foreground). Ring paints
between ground and fighters — sits on the playfield, under the figures.

**Watch.**
- `bgR/bgG/bgB` initial value mismatch: declared `20, 22, 28` but if
  `resetRound` doesn't fire before first render (it does, via `startGame`
  → `resetMatch` → `resetRound`), still safe. Module init values match
  cool-dark target.
- CSS canvas background (`#1a1a1a` in `style.css:21`) becomes invisible —
  fully covered by the palette fill. Don't bother stripping the CSS rule;
  it's the resting state outside the menu.
- Mote `Math.round` in render keeps single-pixel motes pixel-aligned on
  the `image-rendering: pixelated` canvas — same pattern as figure draw.
- Pulse ring `lineWidth=2` to stay visible at outer radii where alpha is
  low.

**LOC tally for Change 6.**
- 6a palette: ~10 (3 module + 1 reset + 4 update + 2 render).
- 6b motes: ~14 (8 init + 5 update + 3 render — ~16, trim to ~14 by inlining).
- 6c pulse ring: ~12 (1 module + 1 reset + 1 spawn + 1 tick + 8 render).

Total bg: ~36-38 LOC.

---

## Total LOC tally

| # | Change                              | LOC |
|---|-------------------------------------|-----|
| 1 | Wall-perch flipped targetY          | ~1  |
| 2 | Countdown state guard               | ~1  |
| 3 | Shield indicator in rotated frame   | ~6  |
| 4 | Pip y=12 → y=42                     | ~2  |
| 5 | Opp drop-back ease                  | ~7  |
| 6 | Dynamic background (palette+motes+ring) | ~38 |
| **Total** |                          | **~55** |

Under 80-LOC cap with 25 LOC slack.

---

## Implementation order

1. **Change 1** — targetY literal. Validates flipped wall-perch reachable.
2. **Change 2** — countdown guard. Trivial; lands first to clear cosmetics.
3. **Change 4** — pip y. Trivial HUD fix.
4. **Change 5** — drop-back ease. Reorders the wall-stuck branch; bundles
   Change 1's targetY in the new structure.
5. **Change 3** — shield indicator into rotated frame. Architectural;
   ship before bg so the rotated-UI pattern is in place.
6. **Change 6a** — palette wash. Replaces clearRect; verify nothing breaks.
7. **Change 6b** — motes. Lands the ambient layer.
8. **Change 6c** — pulse ring. Lands the shield rhythm reverb.

Smoke-test after step 8: a 3-round match — observe palette warmth-shift on
each flip (~1 s ease); motes drift, reverse direction on flip; rings pulse
every ~2 s in floor combat, follow opp around walls; shield indicator
visible at ceiling and on walls; no countdown bleed into game-over;
flipped wall-perch divepunch lands.

---

## Deferred (iter-12+)

- **Cross-surface combat reach** (§4) — wall-jump can't reach ceiling
  without flip. Inspiration's "WALL_JUMP_VX ≈ 625" tune + parallel arena-
  rotation. Defer until flip-as-bridge proves stale.
- **Wall/ceiling-stuck punch hit-test geometry** (~10 LOC) — fistX/fistY
  rotated through `surfaceAngle`. Now that Change 3 establishes rotated-
  UI pattern, hit-test conversion follows the same basis. Iter-12.
- **Dive-pose mirror under 180°** (§9d) — `\O` reads inverted on ceiling.
  Cosmetic; bundle with KO-pose work.
- **KO pose under arbitrary renderAngle** — slumped silhouette across all
  4 surfaces + mid-flip. Wants its own iteration.
- **Animated arena rotation** — figures flip but arena snaps; the bg
  palette wash *is* the iter-11 answer to this. True arena rotation
  is iter-12+ if the palette signal under-reads.
- **Hit-event dot-flare layer** (inspiration #1) — bg already has 3 layers
  this iter; promote in iter-12 if hit feedback under-read.
- **Wall-climb glow column** (inspiration #5) — wall-climb already legible
  via rotated stick. Revisit if cornered state under-read.
- **Geometry Wars dot grid** — overlapping with motes; reconsider as
  *replacement* if motes prove too quiet.
- **Intermission overlay desaturate** — pair with iter-12 bg-state work.
- **Knockback magnitude tune** — iter-10 deferred "after a flip-aware
  match." Iter-12 with full palette/mote signal in scope.
- **Pip horizontal nudge** — cosmetic; only if iter-11 playtest finds
  outer-edge pips too close to bar end caps.
- **Parametric mote count / palette amplitude** — once the layers prove,
  expose for tuning.
