# Iteration 8 — Playtest Report

Reviewer: playtester
Source verified: `game.js` (746 LOC), `index.html`, `style.css`. Iter-7 keystone (rounds + hold + fade + shake + lean + landingLag-crouch fix) all present.

---

## 1. Round flow & timing trace

KO of opponent in round 1, traced frame-by-frame at 60 fps (dt ≈ 0.01667 s):

- **Frame 0 (hit lands).** `update` runs through line 446 — opponent hp ≤ 0 → `hitstop = HITSTOP_DURATION * 2 = 0.1334 s`. Same frame: line 446 sets `shake = (0.1334/0.0667)*4 = 8 px`. K.O. branch (line 455) skipped this frame because `hitstop > 0`.
- **Frames 1–7 (~0.117 s).** Hitstop early-return at line 210. Stick figures frozen mid-pose. Render still runs, shake decays 0.85/frame (8 → 6.8 → 5.78 → … → 2.72 by frame 7).
- **Frame 8 (~0.133 s elapsed).** Hitstop drops to ≤0; early-return doesn't fire next frame. Update body runs; line 456: `gameEndHold = 0.5`.
- **Frames 9–38 (~0.5 s).** `gameEndHold` decrements; opponent locked at idle pose (state was set to idle by hit), HP-bar tail finishes draining (slowLerp 0.06/frame at 60 → ~26 frames to reach within 1 hp of target — fits inside the 0.5 s).
- **Frame 39 (~0.633 s post-hit).** `gameEndHold ≤ 0`; `playerWins = 1`; `roundPhase = 'intermission'`; `intermissionTimer = 1.5`; `roundNumber = 2`.
- **Frames 40–129 (1.5 s).** Intermission overlay (rgba(10,10,10,0.7)) drawn over canvas; "ROUND 2" + "1 : 0" centered. `update` early-returns at line 197.
- **Frame 130.** `intermissionTimer ≤ 0` → `resetRound()` (HP=100, positions reset; pip state preserved). `roundPhase = 'fighting'`.

**Total round-end → round-start: ~2.13 s.** Pacing reads as deliberate, not laggy. The 0.633 s "K.O. moment" is long enough to register the killing pose, short enough not to drag. Intermission's 1.5 s is goldilocks for a best-of-3.

**Concern:** the opponent stays in the `idle` pose post-KO (the hit branch at line 378 forces `state='idle'`). No knockdown/slumped animation. Cosmetic only — the dimmed overlay during intermission obscures it.

---

## 2. Match length

- Per-round perfect-play: ~14.6 s claimed. Realistic best case: opponent jab cycle = JAB_WINDUP (0.5) + JAB_ACTIVE (0.12) + JAB_RECOVERY (0.35) + JAB_COOLDOWN (1.2) = 2.17 s; player needs ~8–9 PUNCH_DAMAGE hits or counters to drain 100 hp. ~12–18 s feels right.
- Between-round overhead per round-end: 0.633 s K.O. + 1.5 s intermission = ~2.13 s. Match-end adds 0.633 s + 0.4 s fade ≈ 1 s.
- **Min match (2-0):** 2 × 14.6 + 2.13 (intermission after R1) + 1.0 (match-end) ≈ 32 s.
- **Max match (3-2):** 5 × 14.6 + 4 × 2.13 + 1.0 ≈ 83 s.

Range 32–83 s. Reasonable for a single-screen browser fight. Min match is on the short side; ties to iter-9+ adversarial scaling (heavy jab, step-back) to lengthen perfect-play rounds without padding.

---

## 3. Score readout (pips)

Lines 705–709 trace cleanly:
- After round 1 player win: `playerWins=1, opponentWins=0`.
- Left pip string: `(1>=1?'*':'o') + ' ' + (1>=2?'*':'o')` = `* o`. ✓
- Right pip string: `(0>=1?'*':'o') + ' ' + (0>=2?'*':'o')` = `o o`. ✓

**Layout concern:** pips drawn at `y=12` with `textBaseline='middle'`, 12 px font — bottom of glyph at ~y=18. HP bar starts at `y=20` with `y-4=16` for label baseline (`textBaseline='alphabetic'`). The pip glyph and the "YOU 100/100" label coexist within ~2–4 px vertical separation at the same x. **They will visually crowd or overlap.** Worth a 4–6 px upward bump for pips OR a left-shift of pips to start before the HP bar's left edge. Iter-9 nit.

Symbol legibility: `*` vs `o` is clear in monospace at 12 px. Glyph difference (filled vs hollow asterisk-like) reads even at peripheral glance.

---

## 4. Intermission overlay

Lines 717–727: `rgba(10,10,10,0.7)` full-canvas fill, then "ROUND N" + "X : Y" text. Behind the overlay, all gameplay was drawn first (player, opponent at end-of-round positions, HP bars, pips, walls, ground).

At 0.7 alpha, gameplay is ~30% visible — figures and bars are silhouettes, not legible. **Acceptable for a between-round beat** (player wants the score, not the play state). The pips through the dim are the primary readout reinforcement.

**Issue:** during intermission `update` returns early — `displayedHp` lerps stop. So if HP bars hadn't fully drained by round-end, they freeze mid-lerp through the intermission. Trace: post-KO `gameEndHold=0.5 s` runs lerps at fastLerp=0.4 + slowLerp=0.06 per-frame; in 30 frames a 100→0 transition reaches near 0 (`100 * 0.6^30 ≈ 0`). HP bar visually empty by intermission start. Fine.

---

## 5. Camera shake feel

`shake *= 0.85` per render frame, then `sx, sy ∈ ±shake/2`.

- **Normal hit (shake=4):** max jitter ±2 px. Decays 4 → 0.5 in n frames where 0.85^n = 0.125 → n ≈ 12.8 → ~13 frames ≈ 217 ms. Reads as a tight punch-thump, not a wobble. ✓
- **Counter (shake=6):** ±3 px peak, decays to <0.5 in ~16 frames ≈ 267 ms.
- **KO (shake=8):** ±4 px peak, decays to <0.5 in ~17 frames ≈ 283 ms.

Crucially, shake is set on the hit frame at line 446 — but that frame is also the first frame of hitstop. During the 8-frame hitstop freeze (16 frames for KO), update early-returns so `shake` isn't re-set, but render still decays it. So:
- Normal hit: 8 hitstop frames decay shake from 4 to `4 * 0.85^8 ≈ 1.1 px`. The post-hitstop "movement resumes" frames see only ~1 px shake — barely perceptible.
- KO: 16 hitstop frames decay shake from 8 to `8 * 0.85^16 ≈ 0.46 px`. Camera is **already settled** when gameEndHold begins.

**Verdict:** shake is most visible **during** the hitstop freeze, which is the right moment cinematically (frozen figures, jittering camera = impact). After freeze, shake is near-gone. This composition reads correctly. ✓

**Minor:** ±2 px on a 900×500 canvas at native scale is subtle. With `image-rendering: pixelated` and CSS scaling on small windows, this could read as either too small (large display) or too large (heavily downscaled). On a 1:1 desktop, feels right.

---

## 6. K.O. fade

- Hitstop freeze: 0.133 s (KO is 2× HITSTOP_DURATION).
- gameEndHold: 0.5 s (decrements only after hitstop ≤ 0; verified line 455 condition).
- CSS fade-in: `.fading-in { opacity: 0 }` removed via RAF; CSS transition `opacity 0.4s ease-out` runs.

Total cinematic for **match-end** KO: 0.133 + 0.5 + 0.4 ≈ **1.03 s**. Cinematic, not laggy. The 0.4 s fade is short enough that the player sees the result text bleed through quickly.

For **round-end** KO (not match-end): 0.133 + 0.5 + (1.5 s intermission overlay snap-on, no fade) = 2.13 s. The intermission overlay does NOT fade — it pops in instantly when `roundPhase` becomes `'intermission'`. Asymmetry: match-end fades, round-end pops. Defensible (round transitions are quicker beats; match-end is the climax) but worth noting as inconsistent polish.

---

## 7. Lean visibility

`whiffLean` peaks at `facing * 4` px after 0.15 s ramp. Stick figure font is `bold 20px ui-monospace`. The `O` head glyph occupies maybe 8–10 px wide at this size. A 4 px shift = ~40–50% of a glyph width. **Plenty visible.** ✓

LandingLag mirror: `-facing * 4 * min(1, (LANDING_LAG - landingLag) / 0.15)` — same magnitude, opposite sign. Backward stagger reads.

**Edge:** the legs (`/ \` / `\ /`) stay rooted at base x while head/torso shift. With a 4 px head shift on a ~20 px figure, the lean is visually unmistakable but still anatomically plausible. Better than a flat slumped pose. ✓

---

## 8. Persisting issues

**landingLag-crouch fix.** Verified at line 234: `player.crouching = player.onGround && player.whiffLock <= 0 && player.landingLag <= 0 && (...)`. Gate now requires landingLag ≤ 0. Holding S during landingLag no longer triggers `crouching=true`, so `CROUCH_HURTBOX_DROP=16` no longer applies — opp's jab band check (line 334) correctly hits the lagged player. ✓

**Match-cumulative stat counters.** `resetRound` (lines 120–149) does NOT touch `player.punchAttempts` or `player.punchesLanded`. `resetMatch` (lines 151–160) zeroes them once, then calls `resetRound`. So across a 3-round match, a player who throws 12 punches in R1, 8 in R2, 10 in R3 will see `punchAttempts=30` at game-over. ✓ Functions as designed.

**One subtle counter quirk:** `punchAttempts++` is incremented on dive initiation (line 276) AND on the buffered ground-punch resolution (line 366). A whiffed dive that triggers landingLag, plus a buffered jab attempt during recovery — wait, jab attempts during landingLag are gated (line 282 `landingLag <= 0`), so no double-count. ✓

---

## 9. NEW iter-7 interaction details

**Hitstop / gameEndHold ordering.** Lines 207–210 early-return on `hitstop > 0`. K.O. branch at line 455 requires `hitstop <= 0`. Trace: KO frame sets hitstop=0.133. Next 7 frames early-return (hitstop decrements; no gameEndHold tick). Frame 8: hitstop hits 0, decrement-and-return runs (because `hitstop > 0` was true at frame start). Frame 9: hitstop=0 at start, no early-return; line 456 sets `gameEndHold = 0.5`; same frame decrements `gameEndHold -= dt` to ~0.483. Frames 10–38 tick down. Frame 39: `gameEndHold <= 0`, branch fires.

**Total visible "K.O. moment" (hit→overlay):** ~8 frames hitstop + 30 frames hold = ~38 frames ≈ 0.633 s. ✓ Matches the spec claim. Reads as deliberate weight on the killing blow without dragging.

**Camera shake during hitstop.** `update` early-returns at line 210, so the line-446 `shake = max(...)` does NOT run during hitstop frames. Only the **hit-landing frame** sets shake (since that frame got past line 207 before triggering hitstop). Subsequent hitstop frames: `render` runs, `shake *= 0.85` decays. **This is correct behavior** — the camera shake initiates on impact, jitters through the freeze, and is mostly settled by unfreeze. Looks right; matches every fighting-game shake pattern. ✓

---

## 10. New bugs / regressions

**Round 2 startup — does `resetRound` re-trigger jab?** Trace:
- `resetRound` sets `opponent.x=640, state='idle', stateTimer=0, patrolDir=-1`. Player at `x=250`.
- First update frame (post-intermission): line 311 `dxToPlayer = |250 - 640| = 390`. Line 312 gate: `dxToPlayer < JAB_RANGE (60)` is FALSE. → No jab. Patrol kicks in (line 302), opp drifts left toward `patrolMin=480`. ✓

**Shake state across rounds.** Line 139 in `resetRound` zeros `shake = 0`. ✓ No carry-over.

**Intermission opponent state freeze.** During intermission, `update` returns at line 204 before the opp state machine runs. Opp is frozen at last pose (`state` was set to `'idle'` by the KO hit at line 378, `stateTimer=JAB_COOLDOWN*0.5=0.6`). The intermission overlay covers it at 0.7 alpha. Fine. After `resetRound`, all opp state is zeroed. ✓ Nothing weird.

**Cross-frame edge: hitstop ending and gameEndHold starting same frame.** Line 207 reads `if (hitstop > 0)`. On the frame where `hitstop` hits exactly 0 by decrement, the check at line 207 was `hitstop > 0` → TRUE (pre-decrement value), so we still return that frame. `gameEndHold` initialization deferred 1 frame. Adds 1 frame (~16 ms) latency — imperceptible. Not a bug.

**Hitstop and `keysPressed` clearing.** `keysPressed.clear()` is at line 471, after the K.O. branch. During hitstop early-return at line 210, **`keysPressed` is NOT cleared**. If a keypress happens during the freeze, it persists into the post-hitstop frame and fires immediately. Generally invisible (8-frame freeze is too short to press something deliberately), but could cause input feel-weirdness on long-freeze KOs. Iter-8+ candidate to track.

**Intermission `keysPressed.clear()` at line 203.** Confirmed — buffered punches across the intermission boundary are cleared. ✓

**Off-screen pip vs HP-bar collision** (covered in §3). Cosmetic only.

**Match-end fade vs round-end pop** (covered in §6). Stylistic asymmetry, not a bug.

**`displayedHp` lerps run during gameEndHold but NOT during intermission.** Lines 450–453 lerp before the K.O. branch and inside `roundPhase==='fighting'`. During intermission, lerps are skipped. After `resetRound` zeroes the displayed/tail to maxHp, R2 starts cleanly. ✓ No stale visual.

---

## Summary verdict

Iter-7 ships well. Round flow timing (0.633 s K.O. + 1.5 s intermission ≈ 2.13 s) is well-paced. Match length (32–83 s) is reasonable. Camera shake composes cleanly with hitstop. Lean is visibly readable. The landingLag-crouch fix is verified.

**Carryover for iter-8:**
1. Pip vs HP-bar label vertical crowding at left/right edges (4–6 px y-bump or left/right edge shift).
2. Match-end CSS fade vs round-end overlay-pop asymmetry (consider canvas-side fade for round transitions or a brief flash-to-black between rounds).
3. `keysPressed` not cleared during hitstop freeze (input buffer carries through KO freeze) — minor input-feel oddity, edge case only.
4. No knockdown pose for KO'd opponent — figure stays in `idle` pose during the 0.633 s reveal. Pure polish; iter-9+ if heavy jab/animation richness lands.
5. Min-match length (~32 s for 2-0) is slim — heavy jab / step-back jab (deferred from iter-7) would extend per-round play and are good iter-8 picks.

No critical bugs. Iter-7 is a clean addition; iter-8 can build on stable ground.
