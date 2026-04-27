# Iteration 11 — Playtest report

Iter-10 shipped: 8 s gravity flip, ceiling surface (`CEIL_Y=60`), generalised
physics (`gravityDir` multiplier), `renderAngle` ease, HUD countdown +
ceiling-dash pulse telegraph, wall-run stabilisation, opp wall-perch lowered
to `H*0.6=300`. This is iter 11 of 15. Game traced from `game.js` lines 1–880.

---

## §1 Flip timing vs shield rhythm

`FLIP_COOLDOWN=8.0 s`, shield cycle = `SHIELD_OPEN+SHIELD_CLOSED = 0.6+1.4 = 2.0 s`.
Per ~50 s round: ~6 flips, ~25 shield cycles. 8 / 2 = 4.0 — flips align to
shield-cycle boundaries when no hits land. Round opens with `state='open'`,
`stateTimer=0.6`. At t=8, the natural cycle has ticked 4 full periods and
returns to the same boundary. Flip then forces `state='open'`, `stateTimer=0.6`
— replacing the natural open-window with itself. No phase smear.

If opponent eats hits between flips, `state` is force-reset to `shielding`
mid-cycle, desyncing from the 2 s grid. Flip can then fire mid-shield-window.
Even so, the flip *always* opens the shield — so this *helps* the player
rather than confuses reads. ✓

## §2 Flip-window trick

Every 8 s, guaranteed `SHIELD_OPEN=0.6 s` window (lines 239–240). 0.6 s ≥
ground punch cycle (`PUNCH_DURATION+COOLDOWN = 0.5 s`) → one free hit if
positioned. Capitalisation by player state:

- **Active floor, in range**: free PUNCH_DAMAGE=8.
- **Wall**: hit-test still world-x (§8); whiffs at distance.
- **Mid-air buffered punch**: fistY arithmetic uses player.y; only lands if
  player happens to be near opp's vertical band.
- **Diving**: per-frame divepunch hit-check; 9 free dmg if it connects.

0.6 s is short enough that out-of-position players eat the 8 s wait — that's
the intended Fall-Guys risk. ✓

## §3 Ceiling combat

Both fighters at `y=60`:

| attack   | fistY = player.y + Δ | opp band (opp.y - hi, -lo) | in band? |
|----------|----------------------|-----------------------------|----------|
| punch    | 60-50 = 10           | (-5, 55)                    | ✓        |
| uppercut | x-only               | x-only                      | ✓        |
| dive     | 60-30 = 30           | (-20, 40)                   | ✓        |

All three connect on shared ceiling. Divepunch trigger needs
`vy * gravityDir >= 0`. On ceiling under `gravityDir=-1`, jumped-off vy=+720,
gravity decelerates (-2160 px/s²), apex at t=0.333 s when vy crosses 0 —
divepunch becomes available past apex. ✓

Knockback `360 * player.facing` adds to `opponent.x` directly; sign matches
world-facing regardless of surface. ✓

## §4 Cross-surface combat — reachability GAP

Floor → ceiling via wall-jump: vy=-720, vx=±360. Apex `t=0.333 s`,
altitude gain `720²/(2·2160)=120 px`. From floor y=420, apex y=300 — **240
px short of CEIL_Y=60**.

Horizontal arc: 360·0.667=240 px. Arena width ARENA_RIGHT-ARENA_LEFT = 852 px.
Player crosses ~28% of arena. Opposite wall is 820 px away — no re-stick.
Falls back to floor at x≈620.

**Cross-surface punching is locked to the 8-s flip.** The synthesis claim
"player must wall-jump up to ceiling" is geometrically false: needs
WALL_JUMP_VX ≈ 625 px/s to cross arena in one arc (currently 360). Either
retune or accept the flip as the only cross-surface mechanic.

## §5 Mid-air during flip

Trigger guard `f.surface === 'floor' && f.onGround` (line 233) skips
airborne fighters. Trace: jump at t=0, y=420, vy=-720. At t=0.1 s:
y=358.8, vy=-504. Flip fires, gravityDir=-1, surface unchanged. Now
`vy += 2160 * -1 * dt`: vy decreases, player accelerates upward.

Solve `358.8 - 504t - 1080t² = 60` → t=0.342 s. Lands on ceiling via
`onSurface(y)` branch `gravityDir===-1 ? y<=60 : ...`. ✓

**Emergent technique**: pre-flip jump teleports player to ceiling ~half a
beat earlier than the snap-flip equivalent. Reasonable.

## §6 Wall-stuck during flip

Wall-stuck untouched by flip-snap. Wall-slide accel
`vy += GRAVITY * 0.25 * gravityDir * dt`. Pre-flip terminal vy=+120; post-flip
acceleration becomes -540 px/s². Reverses sign in 240/540=0.444 s. Settles
at vy=-120 (sliding up).

From mid-wall y=300 to ceiling y=60: ~240 px at 120 px/s ≈ 2.0 s plus 0.44 s
ramp = ~2.4 s. The wall-stuck branch `player.y <= CEIL_Y && gravityDir===-1`
fires at y=60 → snaps to ceiling. ✓

Caveat: wall-camping eats the 0.6 s flip-window since slide-reversal alone
takes 0.44 s — fair tradeoff.

## §7 Camera shake on flip

`shake=7` on flip, decay `pow(0.85, dt*60)` ≈ 0.85/frame at 60 Hz.
Trace: 7 → 5.95 → 5.06 → 4.30 → 3.66 → 3.11 → 2.64 → 2.25 → 1.91 → 1.62 →
1.38 → 1.17 → 1.00 → 0.85 → 0.72 → 0.61 → 0.52. Reaches subtle (~0.5) in
~16 frames ≈ 267 ms. Visible spike ~150 ms, trailing wobble ~120 ms. Pairs
with HUD countdown's 1 s pulse. ✓

## §8 Persisting issues from prior iters

- **KO pose**: still missing.
- **Pip / HP-label proximity**: pips at y=12, HP bar at y=20 with 12 px font;
  visual butt against HP bar. Cosmetic.
- **Wall-stuck punch hit-test**: still world-x. Left-wall (x=40) facing right
  → fistX=78. Right-wall opp x=860 → |78-860|=782 ≫ 28. Wall-vs-wall punch
  always whiffs.

## §9 NEW bugs introduced by gravity flip

### 9a. flipTimer freezes during intermission ✓

Early-return at line 217 prevents `flipTimer -= dt`. resetRound sets
flipTimer=8.0. Each round opens with full 8 s wait. Intentional, not a bug.

### 9b. HUD countdown visible during STATE.OVER

Line 768: `if (flipTimer < 1 && roundPhase === 'fighting' && (state === STATE.PLAY || state === STATE.OVER))`.
toGameOver() never sets roundPhase to intermission, so on game-over with
flipTimer < 1 at KO, countdown can pulse over the K.O. screen. The flip
itself won't fire (update early-returns when state !== PLAY) but the render
does. Cosmetic. Fix: add `state === STATE.PLAY` guard.

### 9c. Shield `(+)` glyph off-screen during ceiling combat — CRITICAL

Line 826: `ctx.fillText('(+)', opponent.x, opponent.y - 78)` in WORLD space,
NOT inside rotated frame. Opp on ceiling (y=60) → glyph at world y=-18,
**off-screen above canvas**. Player gets zero shield telegraph during
ceiling combat. They whiff into shield, eat 360 px/s knockback with no
warning.

On walls (already iter-9 broken), at least y-78 from ~300=222 stays visible.
Ceiling pushes it off-screen entirely. Was a "deferred polish" item; ceiling
promotes it to gameplay-critical.

### 9d. Stick figure dive pose under 180° rotation

drawStick draws `\O` at y-30 (head) with horizontal displacement matching
facing. Rotated π via renderAngle, glyph itself rotates 180°: `\O` becomes
mirrored upside-down. With facing=1, the dive's "facing arm" displacement
flips world-direction. Mild visual confusion only — no opp divepunch
exists (sparring AI). Acceptable.

### 9e. Surface-aware wall-jump in flipped gravity ✓

Right-wall + gravityDir=-1, jump: `vy=JUMP_VELOCITY * gravityDir = +720`,
`vx=-360`. From wall-perch y=200, after 0.667 s round-trip: peak y=320,
back to y=200 at x=620. Then keeps falling toward ceiling-floor (vy
becomes negative under -2160 accel), lands at y=60. Direction signs
correct (away from active surface). ✓

The visual "downward arc" under flipped gravity reads as "upward in
fighter's local frame" only because the figure has been rotated 180°. Without
arena-rotation (deferred to iter-12+), this looks geometrically wrong but
is mechanically correct.

### 9f. Opp-flee wall-climb in flipped gravity — reachability gap

Line 422: `opponent.vy = -EVASION_SPEED * gravityDir = +130` when flipped.
Opp climbs DOWN (toward floor) to wall-perch target H*0.4=200 (line 439).
Opp ends at y=200, player on ceiling-floor at y=60.

Player divepunch from ceiling: `vy = DIVE_VY_BOOST * gravityDir = -540`
(rising). Player rises away from y=60. fistY = player.y - 30. To hit opp
at y=200, need fistY ∈ (120, 180). Player rises so y decreases — going
the wrong direction. Player can't divepunch a flipped-gravity wall-perched
opp from the ceiling.

Symmetric to iter-9 §4 bug, reintroduced for the ceiling side. Synthesis
flagged this as deferred ("Ceiling-side wall-perch retune"). **Confirmed:
ceiling-side targetY needs to be H*0.6=300 (mirror of floor-side), not
H*0.4=200.** Currently the targetY logic flips with gravity, but should
stay at H*0.6 from the *active* surface — i.e. y=300 on floor, y=200 on
ceiling is wrong; should be y=300 either way (closer to player's surface).

Actually the geometry is: on ceiling, "closer to opp via dive" means opp
should be ABOVE player in fighter-frame, which is BELOW in world (opp at
y > 60). Dive from ceiling-floor goes UP in screen toward the inactive
floor (y > 60). Opp at y=200 → dive needs to reach fistY > 120, i.e.
player.y > 150. Apex of dive: vy=-540, gravity=-2160 (decelerating because
both negative? No: gravity is GRAVITY*gravityDir = 2160*-1 = -2160. vy is
already -540, adding -2160·dt makes more negative → ACCELERATES upward).
Dive doesn't decelerate, just keeps rising. Player will reach opp band
fistY ∈ (120, 180) when player.y ∈ (150, 210). From start y=60, traverses
in 90px / 540 = 0.167 s. Hits.

Re-trace: at start y=60, vy=-540. After 0.1 s: y = 60 + (-540)(0.1) +
0.5(-2160)(0.01) = 60 - 54 - 10.8 = -4.8. Already off the ceiling-side of
the screen. fistY = -34.8. Out of band. Way too fast.

**Real issue: divepunch reaches opp in ~0.05 s — too brief a window.**
At y=130, vy ≈ -540-2160·0.022 = -587, fistY=100. Window opens around
y=150-210, but player blasts through in <0.1 s. Hit-test fires every frame
so it should connect, but it's a very tight visual read. Re-confirm:
divepunch from y=60 toward opp at y=200 means player must go DOWN (positive
y) but vy=-540 sends player UP (negative y). **Player goes the WRONG
direction.** Opp is below player's ceiling, dive sends player further
*above* the ceiling.

Confirmed bug: opp wall-perch in flipped gravity is on the *inactive-floor
side* of the player (player on ceiling y=60, opp at y=200 between them and
inactive floor y=420). Divepunch always goes toward active floor (away
from inactive floor) — sends player AWAY from opp. **Targety should be
H*0.6=300 always** (or at least always closer to active floor than
inactive floor). Iter-12 fix.

---

## §10 Summary & priorities

**Critical (gameplay-affecting):**

1. **§9c** — shield `(+)` glyph off-screen during ceiling combat. Player
   has no shield telegraph. Promote out of "deferred." Fix in iter-12 by
   drawing inside rotated frame or anchoring to active-floor side.
2. **§4** — cross-surface combat unreachable without flip. Either retune
   WALL_JUMP_VX (~625 px/s for arena-spanning arc) or accept flip as the
   sole cross-surface mechanic and document.
3. **§9f** — flipped-gravity wall-perch is geometrically unreachable via
   divepunch (mirror of iter-9 §4). Fix targetY: keep at H*0.6=300 always
   (closer to player's active surface), or invert to H*0.4 only when both
   fighters are on the inverted side.

**Polish (cosmetic):**

4. §9b — countdown visible during STATE.OVER. Add `state === STATE.PLAY`
   guard on line 768.
5. §9d — dive-pose mirroring under 180°. Accept or flip facing per
   rotation.
6. §8 — wall-stuck punch hit-test still world-x.
7. §8 — KO pose missing; pip / HP-label proximity.

**Working as designed:**

§1 (flip-vs-shield rhythm aligned), §2 (0.6 s open-window viable for ground
& dive), §3 (ceiling hit-tests geometrically correct), §5 (mid-air-during-
flip emergent early-ceiling-arrival), §6 (wall-stuck flip slide-reversal
in ~0.44 s), §7 (shake decay 267 ms paired with countdown), §9a (intermission
freezes flipTimer), §9e (wall-jump direction signs correct under inversion).
