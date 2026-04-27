# Iteration 9 — Synthesis (WALL-RUN / 3-SURFACE ARENA)

Iter-8 landed the sparring pivot: shield rhythm (`game.js:287-294`), evasion (`game.js:296-315`), `(+)` indicator (`game.js:619-625`). Playtest confirms the rhythm reads cleanly but flags two design problems: linear cat/mouse closure and a trivial corner-pin endgame. Iter-9's keystone — wall-run — addresses both: a cornered opponent climbs the wall instead of clamping, and the player gets a vertical traversal verb that turns chase into pursuit.

**Iter-9 ships sides only (floor + left-wall + right-wall).** Ceiling defers to iter-10's gravity flip — the `surface` enum is the load-bearing primitive both iterations share.

The TDZ ReferenceError flagged by playtest (P0) is **already fixed** in commit bb74c6b — constants now precede the opponent literal at `game.js:106-110`.

---

## Picks (6 changes, ~62 LOC)

| # | Change | LOC | Source |
|---|---|---|---|
| 1 | Surface enum scaffold + axes table | ~8 | inspiration §scaffold |
| 2 | Mega Man X wall-stick + slide + wall-jump | ~22 | inspiration #1 |
| 3 | Cat/mouse opponent climbs wall when cornered | ~10 | inspiration §cat/mouse, playtest §4 |
| 4 | Smoothness trio (HP tail darken + shield pulse + fleeVx easing) | ~12 | smoothness picks 1–3 |
| 5 | Quick-fix bundle (dive-bounce landingLag, drop CONTACT_DAMAGE, controls text) | ~3 | playtest §7, §10.6, §10.2 |
| 6 | drawStick rotation for wall-stuck fighters | ~7 | inspiration #1 render |

**Total: ~62 LOC**, under the 80-LOC cap.

---

## Change 1 — Surface enum scaffold + axes table

**What.** Add a `surface` field on player and opponent (`'floor' | 'left' | 'right'`), plus a constant axis-rotation table.

**Why.** Load-bearing for iter-9 wall-run and iter-10 gravity flip. The axes table tells gravity which direction is "down" relative to a fighter's surface; tells render layer how to rotate the stick figure. Inspiration §scaffold makes this required.

**Where.** `game.js` — declarations near top, after `EVASION_SPEED` (line 110).

**Spec.**

Add after line 110:
```js
// Surface enum: which face of the arena a fighter is stuck to.
// 'floor' = standing on GROUND_Y; 'left' = clinging to ARENA_LEFT wall; 'right' = clinging to ARENA_RIGHT wall.
// Iter-10 will add 'ceiling'. Each surface defines its own gravityDir (which way "down" pulls).
const SURFACE_GRAVITY = {
  floor: { gx: 0, gy: 1 },     // gravity pulls +y (toward GROUND_Y)
  left:  { gx: -1, gy: 0.4 },  // pulls into wall, plus mild slide-down
  right: { gx: 1,  gy: 0.4 },  // pulls into wall, plus mild slide-down
};
const WALL_SLIDE_VY = 120;     // px/s — terminal slide speed on a wall
const WALL_JUMP_VX = 360;      // px/s — horizontal kick off a wall
const WALL_STICK_VX_MIN = 80;  // px/s — minimum |vx| into wall to stick
```

Add `surface: 'floor'` to player init (line 41–62) and opponent init (line 64–75). Add to `resetRound` (line 112–139): `player.surface = 'floor'; opponent.surface = 'floor';`.

**Edge cases.** `SURFACE_GRAVITY.left.gy` = 0.4 isn't strictly needed (we'll clamp `vy` to `WALL_SLIDE_VY` directly in Change 2), but keeping the table symmetrical means iter-10's gravity-flip code can iterate over it without special cases. Floor's `gx=0` means horizontal walking is unaffected by gravity — preserves current behavior.

**Test in head.** Reading the table: `floor.gy = 1` matches existing `GRAVITY * dt` direction (+y down). `left.gx = -1` means while on left wall, gravity pulls fighter into the wall (correct stick). `right.gx = 1` mirrors. Iter-10 can add `ceiling: { gx: 0, gy: -1 }` and flip the floor entry to drive gravity-flip.

**LOC.** ~8.

---

## Change 2 — Wall-stick + wall-slide + wall-jump (Mega Man X)

**What.** When the player is airborne and `vx` carries them into a side wall, auto-stick to the wall. While stuck: `vy` is clamped to a slow downward slide. Pressing jump while stuck launches the player off the wall in a fixed arc; touching the floor detaches normally.

**Why.** Inspiration #1, the iter-9 keystone. Vertical mobility lets the player chase a wall-climbing opponent (Change 3). Eliminates the corner-pin trivialisation flagged by playtest §4 — the endgame becomes "opponent flees onto wall, player wall-jumps to keep up" instead of "opponent clamps, player metronomes."

**Where.** `game.js` — modify the airborne / gravity block at lines 233–247, plus the jump-key handler at lines 228–232.

**Spec.**

Replace lines 233–247 (the `if (!player.onGround) { … }` block) with:
```js
// Surface-aware airborne update.
if (player.surface !== 'floor') {
  // Wall-stuck: slow slide, gravity already "pressed" us against the wall.
  player.vy = Math.min(player.vy + GRAVITY * 0.25 * dt, WALL_SLIDE_VY);
  player.y += player.vy * dt;
  // Detach when feet hit the ground.
  if (player.y >= GROUND_Y) {
    player.y = GROUND_Y;
    player.vy = 0;
    player.surface = 'floor';
    player.onGround = true;
    player.vx = 0;
  }
  // Detach off the top — fall back into normal airborne arc.
  if (player.y < 60) {
    player.surface = 'floor';
  }
} else if (!player.onGround) {
  player.vy += GRAVITY * dt;
  player.y += player.vy * dt;
  // Auto-stick on wall contact while airborne and moving into wall fast enough.
  if (player.vy >= 0 && Math.abs(player.vx) >= WALL_STICK_VX_MIN) {
    if (player.x <= ARENA_LEFT + 16 && player.vx < 0) {
      player.surface = 'left';
      player.x = ARENA_LEFT + 16;
      player.vx = 0;
      player.vy = Math.min(player.vy, WALL_SLIDE_VY * 0.5);
    } else if (player.x >= ARENA_RIGHT - 16 && player.vx > 0) {
      player.surface = 'right';
      player.x = ARENA_RIGHT - 16;
      player.vx = 0;
      player.vy = Math.min(player.vy, WALL_SLIDE_VY * 0.5);
    }
  }
  if (player.y >= GROUND_Y) {
    player.y = GROUND_Y;
    player.vy = 0;
    player.onGround = true;
    if (player.diving) {
      player.diving = false;
      player.vx = 0;
      if (!player.diveHit) player.landingLag = LANDING_LAG;
      player.diveHit = false;
    }
  }
}
```

Replace the jump key handler at lines 228–232 with:
```js
const wantJump = keysPressed.has('w') || keysPressed.has('arrowup');
if (wantJump) {
  if (player.surface === 'left') {
    // Wall-jump off left wall: launch up and to the right.
    player.vy = JUMP_VELOCITY;
    player.vx = WALL_JUMP_VX;
    player.facing = 1;
    player.surface = 'floor';
    player.whiffLock = 0;  // refresh aerials per inspiration #1
  } else if (player.surface === 'right') {
    player.vy = JUMP_VELOCITY;
    player.vx = -WALL_JUMP_VX;
    player.facing = -1;
    player.surface = 'floor';
    player.whiffLock = 0;
  } else if (player.onGround && !player.crouching && player.whiffLock <= 0 && player.landingLag <= 0) {
    player.vy = JUMP_VELOCITY;
    player.onGround = false;
  }
}
```

**Also touch line 219 (player.x clamp).** Currently `player.x` is clamped after the move-step. With wall-stick, when `player.surface !== 'floor'` we want `player.x` *fixed* at the wall edge — already handled inside the stick branch. But the unconditional clamp at line 219 still runs. Add an early-out: change line 219 to:
```js
if (player.surface === 'floor') {
  player.x = Math.max(ARENA_LEFT + 16, Math.min(ARENA_RIGHT - 16, player.x));
  if (player.x === ARENA_LEFT + 16 || player.x === ARENA_RIGHT - 16) player.vx = 0;
}
```

**Edge cases.**
- **Sticking during dive:** the dive sets `vx = DIVE_VX * facing = 320`, `vy = 540`. 320 ≥ 80 (`WALL_STICK_VX_MIN`), so a dive into a wall sticks. That's intentional — dive-into-wall is a valid wall-stick entry. The dive resets via the floor-touch branch on `surface === 'floor'`; if it sticks first, `surface` flips to `'left'/'right'` and dive-state quietly persists until floor contact (next slide-down or wall-jump). The divepunch hit-check at line 372 uses `player.diving`, not `player.surface`, so a stuck-mid-dive fighter still hit-checks; that's a feature (stick-and-stab).
- **Walking off arena edge while grounded:** never happens — line 219 clamp prevents it on `floor`.
- **Wall-jump while crouching:** `crouching` requires `onGround`, so wall-stuck fighters can't be crouching. The branch is naturally exclusive.
- **vy clamp on stick entry:** `Math.min(vy, WALL_SLIDE_VY * 0.5) = 60` — a high-velocity descender entering the wall is decelerated to a gentle slide (not snapped to zero, which would feel like hitting flypaper).
- **Detach-off-top at y < 60:** prevents stuck-at-ceiling-edge artifacts; falls back into a normal airborne arc which can re-stick on descent.
- **Player immobilised by `whiffLock` or `landingLag`:** these gate `move` (line 205) and the old jump check. The new wall-jump branch is unconditional on `surface !== 'floor'` — that's intentional. Wall-jumping while whiff-locked is the recovery option (you whiffed into the wall, bouncing off is your escape).

**Test in head.**
- Player walks right at WALK_SPEED 192, jumps at x = ARENA_RIGHT - 100. vx = 192. Mid-air, vx persists (no input change). Arrives at ARENA_RIGHT - 16 with vy ≥ 0 (apex passed). Sticks: `surface = 'right'`, `vx = 0`, `vy ≤ 60`. Slides down at WALL_SLIDE_VY = 120. Reaches GROUND_Y in (GROUND_Y − apex_y)/120 ≈ a few hundred ms. Press W mid-slide: `vy = -720`, `vx = -360`, `surface = 'floor'`. Player launches up-and-left. ✓
- Player at floor, presses W. Lands in old branch (`surface === 'floor' && onGround`). vy = JUMP_VELOCITY. Identical to current behaviour. ✓
- Player walks left into left wall at vx = -192. Apex of jump descending → sticks. W → vx = +360, vy = -720, facing = +1. ✓
- Edge: player jumps straight up against the wall (vx = 0). `Math.abs(vx) >= 80` fails. No stick. Falls normally. ✓ (Wall-stick requires intent to engage the wall.)

**LOC.** ~22 (replace block + jump handler + clamp guard, mostly net-new lines).

---

## Change 3 — Cat/mouse opponent: climb the wall when cornered

**What.** When opponent is fleeing horizontally and reaches `patrolMin` or `patrolMax`, transition to wall-stuck state and start climbing upward. While wall-stuck, opponent sits at mid-height as a moving target. Player wall-jump or divepunch is the answer.

**Why.** Playtest §4 trivialises the corner pin. Inspiration §cat/mouse extends evasion to the wall. Combined with Change 2, this turns the endgame into a vertical chase: opponent flees onto wall → climbs → player wall-jumps the opposite wall → divepunch from above.

**Where.** `game.js` — extend the evasion branch at lines 296–315.

**Spec.**

Replace the evasion block (lines 296–315) with:
```js
if (!knockbackActive && opponent.hp > 0 && player.hp > 0) {
  if (opponent.surface === 'floor') {
    const dxToPlayer = player.x - opponent.x;
    const dist = Math.abs(dxToPlayer);
    if (dist < EVASION_RANGE) {
      const targetVx = (dxToPlayer > 0 ? -1 : 1) * EVASION_SPEED;
      opponent.fleeVx += (targetVx - opponent.fleeVx) * (1 - Math.pow(1 - 0.18, dt * 60));
      opponent.x += opponent.fleeVx * dt;
      opponent.patrolDir = opponent.fleeVx < 0 ? -1 : 1;
      // Cornered? Climb the wall.
      if (opponent.x <= ARENA_LEFT + 16 + 4) {
        opponent.surface = 'left';
        opponent.x = ARENA_LEFT + 16;
        opponent.vy = -EVASION_SPEED;
      } else if (opponent.x >= ARENA_RIGHT - 16 - 4) {
        opponent.surface = 'right';
        opponent.x = ARENA_RIGHT - 16;
        opponent.vy = -EVASION_SPEED;
      }
    } else {
      opponent.fleeVx = 0;
      opponent.x += opponent.patrolDir * OPPONENT_SPEED * dt;
      if (opponent.x <= opponent.patrolMin) { opponent.x = opponent.patrolMin; opponent.patrolDir = 1; }
      else if (opponent.x >= opponent.patrolMax) { opponent.x = opponent.patrolMax; opponent.patrolDir = -1; }
    }
  } else {
    // Wall-stuck: climb up to ~mid-height, then hold position.
    const targetY = H * 0.45;
    if (opponent.y > targetY) opponent.y += (opponent.vy || -EVASION_SPEED) * dt;
    else { opponent.y = targetY; opponent.vy = 0; }
    // If player isn't on the same wall and is far away, drop back to floor.
    const playerNearWall = (opponent.surface === 'left' && player.x < 200)
                        || (opponent.surface === 'right' && player.x > W - 200);
    if (!playerNearWall && Math.abs(player.x - opponent.x) > EVASION_RANGE * 2) {
      opponent.surface = 'floor';
      opponent.y = GROUND_Y;  // graceful drop — instant for now, polish later
      opponent.vy = 0;
    }
  }
}
opponent.x = Math.max(ARENA_LEFT + 16, Math.min(ARENA_RIGHT - 16, opponent.x));
```

Add `opponent.vy = 0; opponent.fleeVx = 0;` to opponent init (line 64) and `resetRound` (line 132). `fleeVx` is also required by Change 4 (smoothness pick 3) — declare once.

**Edge cases.**
- **Wall-stuck opponent + player divepunch from above:** divepunch hit-check (line 372) uses `fistY > opponent.y - 80 && fistY < opponent.y - 20`. Wall-stuck opponent at y = 225 (H*0.45). Player divepunching from x ≈ wall, y descending. Should land — fistY around opponent.y - 30 reads through the existing geometry. ✓
- **Opponent dropping back to floor:** instant snap is acceptable for iter-9; smoothing is paint-job. Polish deferred.
- **Player wall-jumps to same wall as opponent:** Change 2 doesn't snap player to opponent's wall — player sticks to whichever wall they hit. They can stick to the same wall and the punch hit-check still fires (uses x/y geometry, not surface). Wall punches feel right.
- **Knockback while wall-stuck:** `knockbackActive` still gates this branch. If a wall-stuck opponent gets hit, `opponent.knockback` accumulates and the next frame's knockback-active branch shoves them — but they're still `surface = 'wall'` and the y-clamp doesn't reset. Add: in the punch-resolution branches that apply knockback (lines 336, 358, 386), if `opponent.surface !== 'floor'`, set `opponent.surface = 'floor'; opponent.y = GROUND_Y; opponent.vy = 0;` before applying the horizontal kick. This is a 3-line sub-patch — count it inside this Change 3. (This makes "punch the climbing opponent" satisfying — they fall to the floor.)

**Test in head.** Player closes; opponent flees right; opponent.x rises until ≥ ARENA_RIGHT - 20; opponent.surface = 'right', opponent.vy = -130. Next frames: y decreases at 130 px/s; reaches H*0.45 = 225 in ~1.5s; opponent holds at y = 225 on right wall. Player wall-jumps off right wall → flies up-and-left → can wall-jump left to climb back. Or player divepunches from elevated start. ✓

**LOC.** ~10 + 3-line knockback sub-patch ≈ ~13. (Slight overrun, acceptable within budget.)

---

## Change 4 — Smoothness trio

Three smoothness picks composed at once, ~12 LOC total. All three are documented in detail in `smoothness.md` — spec is identical, summary here.

**4a. HP bar tail darken (1 LOC).** `game.js:559`: `'#8a4a4a'` → `'#5a2a2a'`. Tail reads as drained-not-recently-occupied space.

**4b. Shield indicator pulse (~6 LOC).** Replace `game.js:619-625` per `smoothness.md` Pick 2 spec — alpha pulse driven by `opponent.stateTimer`, urgency flicker in last 0.25s before drop. Field = none new, uses existing `stateTimer`.

**4c. Evasion patrolDir easing via `opponent.fleeVx` (~5 LOC).** Already folded into Change 3 above (the `fleeVx` lerp toward `targetVx`). The field is declared once and used in both Change 3 and Change 4c. Net: 0 additional LOC — Change 3 spec already includes the easing.

**Why composed here.** `fleeVx` is the surface-tangent velocity primitive that Change 3 already uses. Per smoothness.md note: "do not introduce a parallel `wallVx`." Confirmed — Change 3 reuses `fleeVx` semantically (currently horizontal; iter-10's gravity flip can rotate it into wall-tangent space).

**LOC.** ~7 net (1 + 6 + 0).

---

## Change 5 — Quick-fix bundle

Three independent 1-LOC fixes from playtest. Bundle for atomicity.

**5a. Dive-bounce skips landing lag (playtest §7).** `game.js:382`: in the divepunch shield-bounce branch, change `player.diveHit = true;` to `player.diveHit = false;`. Effect: a dive that bounces off the shield still pays LANDING_LAG on landing — bouncing no longer rewards. The hit-check guard at line 372 (`!player.diveHit`) still prevents repeat-hit on the same dive because the divepunch sets `vy = -300` (line 380) → fighter bounces upward → on next descent, fighter is in a fresh airborne arc but `diveHit` is false. Risk: re-trigger of bounce on the second descent. Mitigation: guard with `if (player.diving)` is already in place at line 372; once `diveHit = false` is set, fighter can re-dive-hit. **Better:** keep `diveHit = true` AND introduce landingLag in the bounce branch directly: at line 382, after setting `diveHit = true`, also set `player.pendingDiveBounceLag = LANDING_LAG`; in the floor-touch handler, apply lag if pending. **Simplest 1-LOC fix:** instead, in the floor-touch handler (Change 2's spec, line `if (!player.diveHit) player.landingLag = LANDING_LAG`), drop the guard: always apply landingLag on dive landing, regardless of diveHit. So change `if (!player.diveHit) player.landingLag = LANDING_LAG;` → `player.landingLag = LANDING_LAG;`. This is the 1-LOC fix. Successful dive-hit also gets lag — also fair (you committed to the dive, you pay the lag). Playtest §7 supports this read.

**5b. Drop CONTACT_DAMAGE (playtest §10.6).** Sparring sim — body contact shouldn't damage. Replace lines 398–405 (the `contactDx < CONTACT_RANGE` block) with a single line: `if (player.contactCooldown > 0) player.contactCooldown -= dt;` (still tick the cooldown for any leftover hitFlash). Or delete the block entirely and remove the field. **Cleanest:** delete lines 398–405 (the if-block body) but keep `if (player.contactCooldown > 0) player.contactCooldown -= dt;` at line 396 (which is already separate). Net delete: ~7 lines. Also remove `CONTACT_DAMAGE`, `CONTACT_COOLDOWN`, `CONTACT_RANGE` constants (lines 86–88). And `player.contactCooldown` field (line 49) and `resetRound` reference (line 119). Counts as ~1 LOC of effective change semantically (one feature removal) but ~10 lines of deletions.

**5c. Controls-screen stale text (playtest §10.2).** `index.html:26`: `crouch (dodge jab)` → `crouch (uppercut)`. 1 LOC.

**LOC.** ~3 effective (lots of deletions in 5b).

---

## Change 6 — drawStick rotation for wall-stuck fighters

**What.** When a fighter's `surface !== 'floor'`, render the stick figure rotated 90° so it stands "up" relative to its surface.

**Why.** Inspiration #1 render-side. Without rotation a wall-stuck fighter renders horizontal-laying-down, which reads as a corpse, not a wall climber. Rotation is the visual signal that "this fighter is on the wall and threatens vertically."

**Where.** `game.js` — wrap the two `drawStick` call sites (player at line 592, opponent at line 614) with a rotation transform when `surface !== 'floor'`.

**Spec.**

Add a helper near `drawStick`:
```js
function drawStickOnSurface(x, y, surface, opts) {
  if (surface === 'floor') { drawStick(x, y, opts); return; }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(surface === 'left' ? Math.PI / 2 : -Math.PI / 2);
  drawStick(0, 0, opts);
  ctx.restore();
}
```

Replace `drawStick(player.x, player.y, { … })` at line 592 with `drawStickOnSurface(player.x, player.y, player.surface, { … })`. Same for opponent at line 614.

**Edge cases.**
- **Punch arc when wall-stuck:** the existing `drawStick` punch animation extends along x in the local frame; after rotation that's vertical in screen-space — the fist points "out from the wall" toward arena center. Per inspiration §verb-table, that's the intended behavior. ✓
- **Shield indicator (Change 4b) at `opponent.x, opponent.y - 78`:** after wall-rotation, `opponent.y` is the fighter's hip in world-space, and -78 pushes the glyph up in world-space — visually it floats above the fighter's head only if they're on the floor. When wall-stuck, the glyph floats *above-screen* of the fighter, not "above-head" relative to their orientation. Acceptable for iter-9 — glyph still reads. Polish deferred.
- **Hit-test geometry stays in world-space.** `fistX = player.x + facing * PUNCH_REACH` is computed in world coords — wall-stuck punches reach horizontally, not vertically. So a wall-stuck fighter's *visual* punch is rotated, but their *hit-check* fires sideways into empty air. **Known iter-9 limitation.** Wall-stuck combat is effectively defensive only. Iter-10's gravity flip will properly rotate hit-check geometry. Documented in Deferred.

**Test in head.** Player on floor: identical render. Player wall-sticks left: drawStickOnSurface translates to player position, rotates +90° (clockwise from screen perspective — head points right into arena), draws. Visual: stick figure with head pointing into the arena, feet against the wall. ✓ Wall-jump → `surface = 'floor'` → identical-to-current render. ✓

**LOC.** ~7.

---

## Total LOC tally

| # | Change | LOC |
|---|---|---|
| 1 | Surface enum + table | ~8 |
| 2 | Wall-stick + slide + jump | ~22 |
| 3 | Opponent climbs wall | ~13 |
| 4 | Smoothness trio (HP tail + pulse + fleeVx) | ~7 |
| 5 | Quick fixes (lag + contact damage + controls) | ~3 |
| 6 | drawStick rotation | ~7 |
| **Total** | | **~60 LOC** |

Under the 80-LOC cap with 20 LOC of slack for inevitable overrun.

---

## Implementation order (orchestrator note)

1. **Change 1** first — pure scaffold, breaks nothing. Confirm game still runs.
2. **Change 5** — quick fixes; still runnable, single-line edits.
3. **Change 4a + 4b** — HP tail + shield pulse; pure render. Independent of physics.
4. **Change 2** — wall-stick. After this, player can wall-jump but opponent doesn't react. Test by walking right into the wall during a jump.
5. **Change 3 + Change 4c** — opponent climbs (which depends on `fleeVx` from 4c). Together because they share the field.
6. **Change 6** — render rotation last. Visual polish on the now-working physics.

---

## Deferred (iter-10+)

- **Ceiling surface** (`'ceiling'`) — adds 4th surface, requires gravity flip to enter. Inspiration #4 (Celeste corner-wrap). Iter-10 keystone.
- **Gravity flip** — global gravity inversion every N seconds; floor↔ceiling swap. Requires SURFACE_GRAVITY table from Change 1. Inspiration #3 abstraction.
- **Wall-stuck hit-test geometry** — punch direction should rotate with surface so wall-stuck fighters can attack into the arena. Iter-10, alongside ceiling.
- **Wall-stuck shield indicator offset** — `(+)` should anchor to fighter's "above-head" in surface-relative space.
- **Subpixel render snap** (smoothness §4) — wall-run rotation paths need their own snap pass; do it once.
- **Intermission overlay fade-in** (smoothness §5, playtest §9) — 4-surface arena will likely introduce a round-start "settle" flourish that subsumes this.
- **KO pose** (playtest §9) — slumped/falling stick on `hp ≤ 0`.
- **HP bar pip overlap with label** (playtest §9) — shift pips to footer.
- **Dynamic background** (iter-8 deferred) — parallax dots, palette pulse.
- **Cat/mouse polish** — fake openings, shield-window taunts, drop-from-wall feint.
- **Wall-stick during whiffLock** — currently allowed; if it feels exploitable, gate.
- **Knockback magnitude tuning** (smoothness §6) — wait for one playtest with the pulse indicator, then tune.
- **Shake decay dt-correction** — currently `shake *= 0.85` is frame-dependent; fix when the translate block is rewritten for surface rotation.
- **Meat Boy hold-stick + N++ wall-run momentum** (inspirations #2, #5) — alternate wall verbs; iter-12+ polish.
