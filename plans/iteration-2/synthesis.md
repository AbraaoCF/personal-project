# Iteration 2 — Synthesis

Picked four changes. Two are tuning/reliability (playtest), two are felt-quality (smoothness + inspiration). dt sweep is **deferred again** — see Deferred section for the shrunk-scope justification. Total budget ~70 LOC.

Order of implementation: (1) hit-zone tuning → (2) input buffer → (3) hitstop → (4) animated punch + interpolated hit-flash. Each is independent; later ones do not invalidate earlier ones.

---

## Change 1 — Separate hit-zone from contact-zone (tuning fix)

- **What.** Shrink the contact-damage trigger from `dx < 22` to `dx < 10` so the inner 12 px of the punch hit-window stops doubling as a tax-zone.
- **Why.** Playtest frustration #1: the player who lands the *closest* punches eats 4 HP for it (`dx ∈ [10, 21]` overlaps both zones). Iteration 1 picked `tolerance=28` and `contact dx<22` independently and the seam leaks.
- **Where.** `game.js:178` — the `if (contactDx < 22 && ...)` branch.
- **Spec.**
  - Replace literal `22` with a new constant `CONTACT_RANGE = 10` declared next to `CONTACT_DAMAGE` and `CONTACT_COOLDOWN_FRAMES`.
  - No other logic change. Knockback shove and cooldown unchanged.
  - Edge case: at `dx = 10`, behavior is "punch hits, no contact". At `dx = 9`, both fire — that's correct (the player is literally body-checking). The hit window's inner edge (`dx ≥ 10`) and contact's outer edge (`dx < 10`) are now flush, no overlap, no gap.
- **Test in head.** Park player at `dx = 38` (clean punch reach) → only punch dmg, no contact tick. Walk forward to `dx = 15` (was tax zone) → still only punch dmg. Walk forward to `dx = 9` (body check) → punch + contact, as designed punishment for over-commit.

LOC: ~2.

---

## Change 2 — Punch input buffer (reliability fix)

- **What.** Buffer a J/Space press for up to 6 frames so a press near the cooldown boundary fires when the cooldown clears, instead of being dropped by `keysPressed.clear()`.
- **Why.** Playtest frustration #2: edge-trigger plus `keysPressed.clear()` at end-of-frame eats any punch press during the last frames of cooldown. Players subconsciously pre-press and lose ~1/3 of their attempts. 6 frames (~100 ms) is below the threshold of feeling like autofire and above human pre-press jitter.
- **Where.** `game.js` — the punch block at lines 138–155, plus one new field on `player` (init in `player` literal and in `resetMatch`).
- **Spec.**
  - New constant: `PUNCH_BUFFER_FRAMES = 6`.
  - New field: `player.punchBuffer = 0` (added to player init around line 41 and reset in `resetMatch` around line 72).
  - At the existing `wantPunch` site (line 141): `if (wantPunch) player.punchBuffer = PUNCH_BUFFER_FRAMES;`.
  - Replace the fire condition: instead of `if (wantPunch && player.punchCooldown === 0)`, use `if (player.punchBuffer > 0 && player.punchCooldown === 0)`. On fire, set `player.punchBuffer = 0`.
  - Each frame, after using/checking, decrement: `if (player.punchBuffer > 0) player.punchBuffer--;` (place near the other timer decrements at line 138–139).
  - Edge case: holding J does NOT auto-refill the buffer — it's still edge-triggered via `keysPressed`. Only fresh presses re-arm the buffer.
  - Edge case: a buffered press during airborne / hitstop / game-over still expires harmlessly on its own; no special pruning needed because the fire condition gates on cooldown.
- **Test in head.** Press J at `punchCooldown = 1`: buffer = 6, cooldown ticks to 0 next frame, fire happens, `punchAttempts++`. Press J once and hold for 1 second: exactly one fire (because `keysPressed` only triggered once). Press J twice in a row separated by 5 frames mid-cooldown: second press refreshes buffer; only the second fires once cooldown clears, no double-fire.

LOC: ~6.

---

## Change 3 — Hitstop on punch connect (felt-quality, foundational)

- **What.** When a punch lands, freeze world updates for 4 frames; render still runs. Universal 2–6 frame impact pause used by every fighter.
- **Why.** Inspiration #5 — flagged as biggest felt-quality win per LOC. Playtest #5 also notes the "moment of impact" reads as a tick rather than a hit. Hitstop addresses both with one global counter and composes with every future hit (opponent jab, dive-punch, etc.).
- **Where.** `game.js` — top of `update()` (line 106), the punch-hit branch (line 149), and the connect site for opponent contact damage (line 178) so the system is symmetric.
- **Spec.**
  - Module-scope: `let hitstop = 0;` declared near `state` (around line 17).
  - In `resetMatch`: `hitstop = 0;`.
  - At top of `update()`, after the `state !== STATE.PLAY` early-return: `if (hitstop > 0) { hitstop--; keysPressed.clear(); return; }`. Clearing `keysPressed` keeps held-key behavior consistent (a press during hitstop is still a press; a hold is still a hold — but new edge-presses captured during hitstop frames will be cleared on the same frame as the freeze, which is fine since the player can't act during hitstop anyway). **Important:** also still clear `keysPressed` at the end of normal frames (existing line 188), no change there.
  - On player-punch-hit (line 154 area, inside the `if (Math.abs(fistX...))` block): `hitstop = 4;`.
  - On contact-damage hit to player (line 183 area, inside the `if (contactDx < CONTACT_RANGE...)` block): `hitstop = 4;` — symmetric so future opponent attacks compose.
  - Edge case: hitstop set on a connect freezes the *current* frame's remaining work? No — the connect fires in `update()`, sets `hitstop=4`, and the rest of *this* frame's update continues normally (we set the counter; we don't early-return mid-frame). The freeze applies to the *next* 4 frames. This is correct: the hit's own frame still resolves (knockback applied, hp deducted, hitFlash set), then time stops on the visual.
  - Edge case: `punchTimer` does not advance during hitstop, so the punch pose holds during the freeze — the frozen pose is exactly the moment of contact. Same for `hitFlash` (red holds for the full 4-frame freeze). This is the intended effect.
  - Edge case: K.O. detection (lines 185–186) — leave it inside the normal update path. A killing hit sets hitstop, then on the same frame `toGameOver()` fires, flipping `state` to OVER. The hitstop early-return next frame still works (state check comes first; hitstop is moot once state changes). Slight asymmetry but harmless: the K.O. doesn't get its hitstop pause. Acceptable for iteration 2; iteration 3+ can extend hitstop *before* the state flip if desired.
- **Test in head.** Land a punch: opponent flashes red, punch arm extended, both hold visually for 4 frames (~67 ms at 60 Hz), then motion resumes. Take a contact tick: same freeze, player flashes red, opponent's patrol pauses mid-stride. Mash punches against air: no hitstop ever fires (whiffs don't connect). Two near-simultaneous hits in same frame (player punch + contact): both set hitstop = 4, no stacking, single freeze.

LOC: ~8.

---

## Change 4 — Animated punch + interpolated hit-flash (felt-quality bundle)

- **What.** Replace the binary `'===='` pop with an eased fist-X offset across the 12-frame punch, and replace the binary red flip with a fade from base color toward red over the hitFlash window.
- **Why.** Smoothness #2 + #3, called out as the loudest visual defect after iteration 1's eased walk. They share a "discrete state on contact" failure and bundle naturally — together they make the impact moment continuous. Hitstop (Change 3) holds the *peak* frames; the easing makes the surrounding 8 frames read as motion.
- **Where.** `game.js` — `drawStick()` (lines 227–247), and the two `color:` ternaries in `render()` (lines 280, 284).
- **Spec.**

  *Animated punch:*
  - Pass `punchT` (0..1) into `drawStick` opts instead of just boolean `punching`. Compute at the call site: `const punchT = player.punchTimer > 0 ? 1 - player.punchTimer / PUNCH_DURATION : -1;` (-1 = not punching).
  - Inside `drawStick`, replace the `punching` boolean branch with: if `punchT >= 0`, compute fist offset:
    - windup `t < 0.20`: `off = -4 * (t / 0.20)` — fist pulls back 0–4 px
    - extend `t < 0.55`: `tt = (t - 0.20) / 0.35`; `off = -4 + (PUNCH_REACH + 4) * (1 - Math.pow(1 - tt, 3))` — easeOutCubic from -4 to PUNCH_REACH
    - hold `t < 0.80`: `off = PUNCH_REACH`
    - retract `t <= 1.0`: `tt = (t - 0.80) / 0.20`; `off = PUNCH_REACH * (1 - tt)` — linear back to 0
  - Draw the `'===='` glyph at `x + facing * (8 + off - PUNCH_REACH + PUNCH_REACH)` — i.e., `x + facing * (8 + off)`? Simpler: keep glyph anchored at fist tip. Use `ctx.fillText('====', x + facing * Math.max(0, off), y - 50)` with `textAlign = facing === 1 ? 'left' : 'right'`. When `off <= 0` (windup), suppress the glyph (no arm extended yet); torso renders as `|\` / `/|` once `t >= 0.20` to match.
  - Existing call sites pass `punching: player.punchTimer > 0` — replace with `punchT`. Render-side check `punchTimer > 0` stays equivalent.
  - Note: hitstop (Change 3) freezes `punchTimer`, so during the 4-frame freeze the fist is held at whatever `t` was when the hit landed. With the windup/extend/hold curve above, hits land in the extend/hold band (`t ≈ 0.55`), so the freeze holds the fist visibly extended on the opponent's head — exactly what we want.

  *Interpolated hit-flash:*
  - New helper `function lerpColor(baseHex, flashHex, k)` returning `rgb(...)` — `k = hitFlash / 8`. Use small inline parser: `parseInt(baseHex.slice(1,3), 16)` etc., or hardcode the two pairs since there are only two base colors (`#9ad9ff` player, `#eeeeee` opponent) and one flash color (`#ff8888`). Hardcoding is simpler:
    - `function flashColor(base, flash)` returning a closure that takes `k` and returns interpolated rgb. Or, even simpler, a single helper that takes 6 channel ints + k and returns a string.
  - At lines 280, 284, replace `player.hitFlash > 0 ? '#ff8888' : '#9ad9ff'` with `flashColor([0x9a,0xd9,0xff], [0xff,0x88,0x88], player.hitFlash / 8)` and the opponent equivalent with base `[0xee,0xee,0xee]`.
  - Edge case: `hitFlash` is decremented in `update()`, so by render time the value is 0..8 inclusive on first hit-frame, 0..7 thereafter. Clamp `k = Math.max(0, Math.min(1, hitFlash / 8))`. At k=0, returns base — same as before. At k=1, returns full red — same peak.
  - Hitstop holds `hitFlash` value across the freeze, so the red peak persists for 4 frames then fades cleanly over the next 8.

- **Test in head.**
  - Walk + punch: figure glides (existing easing), arm visibly retracts ~4 px, then sweeps out smoothly to PUNCH_REACH over ~5 frames, holds, returns. No more pop.
  - Land a hit: arm at extended hold pose. Hitstop freezes everything for 4 frames; opponent visibly red. Then arm retracts and red fades to white-ish over 8 frames rather than snapping.
  - Whiff: same animation, no flash, no freeze. Reads as a missed swing rather than a confused twitch.

LOC: ~30 (drawStick rewrite ~20, color helper + 2 call sites ~10).

---

## Total LOC budget check

| Change | LOC |
|---|---|
| 1. CONTACT_RANGE constant | 2 |
| 2. Input buffer | 6 |
| 3. Hitstop | 8 |
| 4. Animated punch + flash lerp | 30 |
| **Total** | **~46** |

Comfortably under 80. Leaves headroom if Change 4's draw math is fiddlier than expected.

---

## Deferred

- **dt frame-rate independence sweep.** Smoothness #1 estimates 30–40 LOC and warns every later iteration drifts further from the foundation. Deferring once more is defensible only because *iteration 2's gameplay changes are all integer-frame counters with the same shape as iteration 1's* — the dt sweep can convert them all in one pass at iteration 3 with no relitigation. **Hard commit:** dt is iteration 3's first pick or it pays a tax. Scope-shrink rationale: the smoothness reviewer says ~30–40 LOC, not 60+, so iteration 3 has clear runway. Adding more frame-counted features here without the dt sweep would push the iter-3 cost.
- **Wall-corner trap fix (playtest #4).** Real bug, but the fix-shape is unclear (zero contact-damage shove if it would push into a wall? push perpendicular? bounce opponent off the player instead?) and any fix interacts with the upcoming dt sweep's knockback handling. Defer to iteration 3, after dt and once a separate `player.knockbackVx` exists (smoothness #8).
- **Jump rehab (playtest #3, inspiration #4).** Strictly-worse jump is real, but fixing it means either widening the vertical hit window or introducing dive-punch — both are gameplay additions, not the playtest+smoothness focus this iteration sticks to. Hitstop (Change 3) is foundational for dive-punch when it arrives.
- **HP bar lerp + walk-cycle + opponent turn easing (smoothness #4, #5, #6).** All worth doing; all are pure smoothness; all want dt first so the lerp constants don't have to be re-tuned. Bundle with iteration 3.
