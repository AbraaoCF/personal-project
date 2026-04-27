# Iteration 9 — Playtest Report

Reviewer: playtester. Method: static trace of `game.js`, `index.html`, `style.css`. Iter 8 shipped the sparring pivot. This report stress-tests the rhythm, the cat/mouse closure, and the corner-pin endgame against concrete numbers.

---

## P0 — BLOCKER: TDZ ReferenceError on load

`game.js` lines 64–75 build the `opponent` object literal:
```
stateTimer: SHIELD_OPEN,
```
`SHIELD_OPEN` is declared at line 106 with `const`. The object literal evaluates eagerly during the IIFE body. Between line 74 and line 106, `SHIELD_OPEN` is in the **temporal dead zone** — accessing it throws `ReferenceError: Cannot access 'SHIELD_OPEN' before initialization`.

Effect: the IIFE never returns. `toMenu()` is never called. Nothing renders. The page is black. **The game is currently un-runnable.**

Fix-direction (no patch per spec): move the five `SHIELD_*` / `EVASION_*` constants above the `opponent` object literal, OR initialise `stateTimer: 0` and let the cycle tick set it on frame 1. The latter is safer (single source of truth) but changes initial-frame behaviour negligibly (one frame of `'open'` with stateTimer=0 → flips to shielding immediately on frame 1). Better: hoist the constants.

This must be fixed before any of the gameplay traces below can be confirmed empirically. The traces are based on the *intended* behaviour the code expresses.

---

## 1. Shield timing — predict-and-strike rhythm

Cycle is fully deterministic: `'open'` 0.6s → `'shielding'` 1.4s → repeat. Period 2.0s. Duty cycle 30% open. No randomness. Two cycles is enough for a player to internalise: **wait 1.4s, attack** (or just watch the `(+)` glyph — it disappears = punch).

Trace, typical engagement (player 100 px from opp, opp at patrol):
- Player crosses EVASION_RANGE=90 → opp begins fleeing.
- Player closes at 192−130 = 62 px/s. From 100 → PUNCH_REACH=38 → 62 px to traverse → 1.0s of chase.
- During that 1.0s the cycle has already advanced. Worst case: player arrives the instant shield closes → must wait 1.4s before next open. Best case: arrives at start of open → 0.6s window.
- Average wait between strike attempts: ≈ 1.0s closure + 0.7s expected-wait-for-open = 1.7s, then ~0.6s open window.

After a *successful* hit, opp re-enters `'shielding'` for 1.4s and `opponent.knockback = 360 * facing` pushes it ~20 px away. Player must re-close (~0.32s at 62 px/s closure assuming evasion re-engages immediately). Then wait 1.4s.

**Strikes per round at near-perfect play:** ~13 hits × ~2.2s/hit ≈ 28–30s per round.

Verdict: rhythm reads cleanly. Risk: it's *too* clean — no variance, no fakes, no reads. After 2 cycles the game is metronome-following. Iter 12+ "fake openings" can't come soon enough.

---

## 2. K.O. count — pacing

Opp HP 100 / PUNCH_DAMAGE 8 = 12.5 → 13 standing punches to KO (last hit deals 4 effective). With UPPER_DAMAGE 10, mixing in uppercuts brings it to ~10 hits.

Per-hit cycle (after first hit):
- 1.4s forced shielding
- ~0.32s re-close after 20-px knockback (evasion + flee)
- ~0.6s open window (use the first 0.3s)
- Effective: ~2.0–2.3s per hit

13 × 2.2s ≈ 29s. Best of 3 → up to 87s match if both go full. Realistically the player loses no rounds (opp has zero offence apart from CONTACT_DAMAGE — see §10), so matches are 2 rounds → ~58s.

Verdict: 30s/round is on the edge of "sluggish" for a metronome with no offence. Compared to iter-7 (where opp threatened the player), this is much less tense. The cat/mouse evasion is what saves it from being trivial — see §3.

---

## 3. Evasion math — closure feel

EVASION_SPEED 130 < WALK_SPEED 192. Player closes at 62 px/s (32% of full speed). From EVASION_RANGE=90 to PUNCH_REACH=38: (90−38)/62 = **0.84s** of pure chase per engagement.

This is **linear closure**, not cat/mouse. Cat/mouse implies non-monotonic distance — circling, baiting, double-back. Here distance only ever decreases (until the player stops or releases the key) at a fixed rate. The opp has no manoeuvre other than "flee straight away from player along x".

Worse: evasion re-evaluates every frame off `dxToPlayer`. There is no inertia. The instant the player turns around (e.g. opp pinned to right wall, player walks left for a moment), opp flips `fleeDir = 1` and chases the player rightward — possibly catching the player from behind for CONTACT_DAMAGE.

Verdict: closure feels mechanical, not predatory. Suggested polish (deferred): add small lateral hops, brief "freeze" after backing into a wall, or evasion only in 0.4s bursts with cooldown.

---

## 4. Corner-pin endgame — trivial

ARENA_RIGHT−16 = 884−16 = **868** (W=900, WALL_THICKNESS=24). Wait — re-tracing: `ARENA_RIGHT = W − WALL_THICKNESS = 900 − 24 = 876`. Opponent clamp: `Math.min(ARENA_RIGHT − 16, opponent.x)` = 860. So opp's hard right wall is x=860. (The synthesis doc's "860" was correct.)

Scenario: player approaches from the left. dxToPlayer > 0 → fleeDir = 1 → opp moves right at 130 px/s. opp.x rises until clamped at 860. Once pinned:
- Player keeps walking right, dist drops below 90 → opp tries to flee right → hits clamp → opp.x stays 860.
- patrolDir is set to 1 each frame, but patrol is gated behind `else` of evasion → never runs while pinned.
- Result: opp is stuck at x=860. Player can stand at x=822 (38 px away) and metronome punches every 2.0s.

**Trivialisation confirmed.** The 0.84s closure cost is paid *once*. After that it's pure rhythm timing. With ~13 hits at 2.0s each = 26s, perfectly safe.

Mitigation ideas (deferred): patrolDir-flip on wall contact even during evasion; reverse and dash through the player; jump out (no jump implemented). Iter 12+ wall-stick / wall-run pivots away from this naturally — very corner pin becomes a wall-run setup instead.

---

## 5. Shield bounce feel

SHIELD_BOUNCE = 360 → `player.knockbackVx = -360 * facing`. Decay `*= pow(0.7, dt*60)`. Per-frame at 60fps: factor 0.7. Distance integral ≈ 360 × dt / (1 − 0.7) ≈ 360 × 0.0167 / 0.3 = ~20 px before threshold (|kbVx|<6). Confirmed ≈20 px of pushback.

Hitstop on bounce: `HITSTOP_DURATION * 0.5 = 0.0333s` — that's 2 frames. Shake derived from `(hitstop/HITSTOP_DURATION)*4 = 2`. Tiny shake. Player-flash: not set on bounce (only `opponent.hitFlash` is). Player gets no visual confirmation they bounced — only the knockback motion.

Verdict: weight-of-bounce is **borderline-too-light**. 20 px is the same as a normal landed hit's knockback (360 also). The player can't tell from feedback alone whether they hit shield or hit flesh — only the HP bar moving (or not) reveals it. Suggested signal: brief blue flash on player on bounce, or a short `'tink'` `(+)` ripple on opponent. (Deferred.)

---

## 6. Successful-hit → forced-shielding loop

Trace: player lands a punch on `'open'` opp at frame N.
- Frame N: hp -= 8, hitFlash set, knockback=360*facing, state='shielding', stateTimer=1.4, hitstop=0.0667s, punchTimer truncated to 0.4 × 0.2 = 0.08s.
- Frames N+1..N+4 (≈0.067s): hitstop freezes update — opp doesn't move, stateTimer doesn't tick (because `update` early-returns when hitstop>0).
- Frame N+5 onward: knockback decays over ~10 frames (~0.17s), opp slides ~20 px right (assuming player faces right).
- stateTimer at end of knockback: ~1.4 − 0.17 = 1.23s remaining.
- Player closes 20 px at 62 px/s = 0.32s. stateTimer at arrival: ~0.91s.
- Player waits 0.91s. Open window starts. Player attacks within ~0.3s for safety.
- Total per-cycle: 0.067 + 0.17 + 0.32 + 0.91 + 0.3 = **1.77s**

13 hits × 1.77s = **23s**. Slightly faster than the §2 estimate (which ignored hitstop overlap). Round still ~25s.

**Frame-edge bug check (synthesis raised it):** at the moment of hit, stateTimer is set to 1.4. Next update frame: stateTimer ticks down to 1.4−dt ≈ 1.383. The cycle check `state === 'shielding' && stateTimer <= 0` is false — won't flip. Safe. ✓

---

## 7. Divepunch vs shielding

Player dives, fistY=player.y−30. On shield: `knockbackVx = -360*facing`, `vy = -300`, `hitstop *= 0.5`, `diveHit=true`.

Trace: player in air with vy ≥ 0 (descending), bounces. New vy = −300, kbVx = -360*facing. Player rises ~`300²/(2*2160) = 21 px`, then falls back. Lateral: ~20 px backward over decay. So player is shoved 20 px back, popped 21 px up — visible bounce, feels distinct from a clean dive-hit (which sets diveHit and lets gravity finish naturally).

One concern: `diveHit = true` after a shield bounce → in landing-resolution at `player.y >= GROUND_Y`, `if (!player.diveHit) landingLag = 0.4` — diveHit is true → no landing lag. So a shielded dive lets the player recover *faster* than a missed dive. That's backwards: missing should be punishing, hitting (or being shielded) should reward commitment. The current code rewards bouncing.

**Bug:** dive-bounce skips landing lag. Should diveHit be left false on shield bounce so landing lag still applies, OR introduce a separate shield-bounce-lag. (Flag for iter 10+.)

Otherwise, mid-air re-pop is visually satisfying and reads as "shield blocked, you fly back".

---

## 8. Crouch-uppercut at corner-pinned opp

Opp clamped at 860. Player must crouch + punch when at distance ≤ UPPER_HIT_TOL = 28 px. UPPER_REACH = 30, so fistX = player.x + 30. For dx = |fistX − 860| < 28: player.x ∈ [802, 858]. That's a 56-px-wide standing-room band.

Crouching zeros vx, locks pose. Buffer punch with `j` while crouched → uppercut path. If state==='shielding' → bounce (player flies left ~20 px out of the band, must re-walk in). If state==='open' → 10 dmg + opp.knockback=480 → opp pushed *into wall* (already at clamp, so 480 dissipates instantly) → opp stays at 860, immediately re-shields for 1.4s.

So uppercut at corner is the **highest DPS option** there: 10 dmg every 2.0s vs 8 dmg every 2.0s for a punch. 10 hits to KO instead of 13. Saves ~6s per round.

Working as designed. UPPER_COOLDOWN 0.5 fits within the 1.4s shielded window with margin. ✓

---

## 9. Persisting issues from iter-7/-8

- **HP-bar pip overlap with label:** pips drawn at y=12 (line 637). HP bar label `YOU 100/100` drawn at y=20−4=16 with 12px font (line 573). Pips are at y=12 in 12px font centred (textBaseline='middle'). Both occupy roughly y∈[6,18]. Label x: starts at WALL_THICKNESS+12=36. Pips x: also WALL_THICKNESS+12=36, textAlign='left'. **They overlap horizontally.** Label `YOU  100/100` is ~96 px wide; pips `* o` are ~24 px. Pips are *underneath* label. Visually: label first (alpha-stamped at 12px), then pips drawn on top in same colour `#ccc`. Mostly readable but the `o`/`*` pips smear into the `Y` of `YOU`. **Still present.** Easiest fix: move pips to y=H−32 (footer) or shift x by +110.
- **Intermission overlay snap-in:** `roundPhase = 'intermission'` triggers an immediate full-screen `rgba(10,10,10,0.7)` rect with no fade. CSS overlays have `transition: opacity 0.4s` but this is a canvas-drawn overlay, not a DOM overlay. Snap-in. **Still present.**
- **Knockdown pose:** no dedicated KO pose. When opp.hp hits 0, drawStick keeps drawing the standing pose with hitFlash colour. Stick stays upright while gameEndHold counts down 0.5s. Reads as "frozen", not "KO'd". **Still present.**
- **Lean visibility:** whiffLean (lines 502–504) shifts head/torso by ≤4 px over 0.15s. At 60fps that's <0.07 px/frame for the first frame. Still subtle. **Acceptable but minor.**

---

## 10. NEW BUGS introduced by pivot

1. **TDZ crash on load (P0)** — see header. Game does not start. Single highest-priority fix.

2. **`controls-screen` lies about S/crouch:** `index.html` line 26 still says `S or ↓ — crouch (dodge jab)`. There is no jab to dodge. Crouch's purpose is now uppercut chamber. Should read `crouch (uppercut)`.

3. **Old-state-machine stragglers:** `grep -nE "'recovery'|'windup'|'feint'|'active'|JAB_|FEINT_|jabHit|feintRoll|CROUCH_HURTBOX_DROP|windupFacing"` returns **zero matches**. Iter-8 cleanup was complete on this front. ✓

4. **Evasion symmetry check:** synthesis's symmetric trace is correct. Player at x=300, opp at x=350: dxToPlayer = −50, fleeDir = 1, opp moves right. Player at x=400, opp at x=350: dxToPlayer = +50, fleeDir = −1, opp moves left. Symmetric. ✓

5. **Shield indicator `(+)` at y=opponent.y−78:** opponent.y = GROUND_Y = 420. Glyph at y=342 in 18px bold. Camera shake max ~4 px on hit. `(+)` jitters by ≤4 px during 0.07s after a successful hit. Still readable — shake decay is `*0.85` per frame. Within 5 frames (0.083s) shake < 1 px. Fine. ✓

6. **CONTACT_DAMAGE still active (4 dmg, 0.5s cooldown):** at corner pin, if player overshoots (player.x within 10 px of opp.x = 860 → player.x ≥ 850 → fistX = 850+30 = 880 > 860+28 → uppercut MISSES, contact triggers). Player takes 4 dmg per 0.5s while crouched ON TOP of opp. With 100 HP, that's 12.5s of survival mashing crouch-uppercut → could lose a round to a corner-pin player. Edge case, but the contact-damage mechanic is a remnant of the combat-sim era — sparring sim shouldn't have it. **Recommend removing** CONTACT_DAMAGE entirely (or zero it). Synthesis Change 1 left it as "see Change 3" but Change 3 didn't address it.

7. **Opponent `patrolDir` set to fleeDir during evasion (line 303):** when player retreats out of EVASION_RANGE, opp's `patrolDir` is whatever fleeDir was last frame. So if opp was fleeing right (player left), then player walks away left, opp's patrolDir=1 → opp continues right toward `patrolMax=800`. This is fine — opp resumes patrol heading the direction it was already moving. No bug, but worth noting it makes the patrol seem to have memory of the chase, which is a nice subtle touch.

8. **`whiffLock = 0.35s` after every shield-bounce punch:** trace — line 367 `if (!hit) player.whiffLock = WHIFF_LOCK`. But `hit` is set to true in BOTH the shield-bounce branch AND the open-hit branch (line 365). So shield bounces do NOT trigger whiffLock. ✓ Good — bouncing shouldn't be punished as harshly as missing entirely.

9. **Uppercut shield-bounce truncates `player.uppercutTimer`:** line 341 `player.uppercutTimer = UPPER_DURATION * 0.4` — wait, this is in the `'open'` branch only. Shield-bounce branch (lines 329–333) does NOT truncate uppercutTimer. So a shielded uppercut keeps the full 0.2s anim → player is locked in crouch slightly longer than a successful uppercut. Minor and probably correct (failed = punished slightly).

10. **Same-frame state flip after hit (synthesis check):** hit sets stateTimer=1.4. Cycle tick `if (opponent.stateTimer > 0) stateTimer -= dt; if (state==='shielding' && stateTimer<=0) flip`. Order in update(): cycle tick at lines 287–294 runs **before** hit resolution at lines 319–369. So on frame N+1 after a hit on frame N: stateTimer ticks 1.4 → 1.383, then hit resolution runs (no buffer this frame). Safe. The reverse order (hit-then-tick same frame) would also be safe at 1.4 ≫ dt. **No bug.** ✓

---

## Recommendation queue for iter 10

1. **P0:** fix TDZ (hoist `SHIELD_*` and `EVASION_*` constants above `opponent` literal, OR set `stateTimer: 0` initially).
2. **P1:** remove CONTACT_DAMAGE (sparring sim shouldn't penalise standing close).
3. **P1:** corner-pin de-trivialiser — when opp.x reaches clamp during evasion, force a brief patrol-direction reversal or dash-through. (Iter 9 wall-run will help, but a smaller stop-gap costs ~5 LOC.)
4. **P2:** intermission overlay fade (canvas-based, mirror CSS 0.4s).
5. **P2:** dive-bounce should still cost landing lag.
6. **P2:** update controls-screen text (`crouch (dodge jab)` → `crouch (uppercut)`).
7. **P3:** HP-bar pip x-shift to avoid label overlap.
8. **P3:** KO pose (slumped stick).

The pivot is sound on paper and the rhythm is legible. The corner pin + linear closure are the two biggest design issues; both are mitigated by the iter-9-onward wall-run / gravity-flip plan, but the TDZ crash means **nothing is testable until that one line is fixed**.
