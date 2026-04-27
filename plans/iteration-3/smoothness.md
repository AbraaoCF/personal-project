# Iteration 3 — Smoothness Report

Scope: dt sweep is the hard-committed first pick. This report scopes that sweep precisely and flags the smoothness defects that will be loudest *after* dt lands.

Reference frame: 60 Hz. Every "per-frame" constant below is interpreted as "per (1/60 s)" and converted accordingly. `dt` everywhere below means **seconds elapsed since last frame**, clamped to `Math.min(rawDt, 1/30)` (33 ms ceiling) to avoid huge jumps after tab-out / backgrounding. A second clamp at the bottom (`Math.max(rawDt, 0)`) is sanity only.

---

## 1. Recommended pattern: variable-dt with seconds units

**Pick: convert all per-frame constants to per-second (or per-second²) and multiply by `dt`. Convert all integer-frame timers to seconds-floats and decrement by `dt`.**

Rationale vs. the fixed-tick + interpolation alternative:

- The codebase has *one* `update()` with no entity arrays, no physics broadphase, no networking. Determinism cost of variable-dt is paid in zero places that matter — there is no replay system, no rollback, no remote sync.
- Fixed-tick would require an accumulator, a render-time interpolation buffer for *every* drawn quantity (player.x, opponent.x, fist offset, hitFlash, displayedHp once it lands), and a separate "render-state" snapshot per fighter. That is strictly more LOC than variable-dt and adds an interpolation-lag artifact (one tick behind) to a game whose primary verb is a 12-frame punch where every frame matters for read.
- The only correctness risk for variable-dt here is the punch hit-test, which is an instantaneous sample at the moment `punchTimer` is set — independent of dt. Knockback decay and vx easing both have clean closed-form dt-aware expressions (see table). Gravity over variable dt has a small numerical-integration bias but at 60–144 Hz with `GRAVITY=0.6/frame²` the jump-arc drift is sub-pixel; semi-implicit Euler (apply gravity to vy *before* adding vy*dt to y) keeps it bounded. The current code is already semi-implicit-shaped (`vy += GRAVITY; y += vy`), so converting to `vy += g*dt; y += vy*dt` preserves that.
- The 33 ms clamp on dt protects every per-frame system from background-tab catchup explosions.

**Plumbing:** in `loop()`, track `prev = performance.now()`; each frame compute `const now = performance.now(); const dt = Math.min((now - prev) / 1000, 1/30); prev = now;` and call `update(dt)`. On first frame, initialize `prev = performance.now()` before the first `loop()` call and seed dt to `1/60` if needed (or just let the first frame's clamped dt be tiny — harmless).

---

## 2. Constant-conversion table (mechanical)

All "per-frame" → multiply by 60 to get per-second. All "per-frame²" (gravity only) → multiply by 60² = 3600.

### Velocities and accelerations

| Constant | game.js line | Current (frame units) | Proposed (sec units) | Apply as |
|---|---|---|---|---|
| `WALK_SPEED` | 59 | 3.2 px/frame | **192 px/s** | `targetVx = move * WALK_SPEED` (units: px/s); `player.x += player.vx * dt` (line 131) |
| `JUMP_VELOCITY` | 61 | -12 px/frame | **-720 px/s** | `player.vy = JUMP_VELOCITY` on jump (line 138); used as px/s thereafter |
| `GRAVITY` | 62 | 0.6 px/frame² | **2160 px/s²** | `player.vy += GRAVITY * dt` (line 142); `player.y += player.vy * dt` (line 143) |
| `OPPONENT_SPEED` | 63 | 1.6 px/frame | **96 px/s** | `opponent.x += opponent.patrolDir * OPPONENT_SPEED * dt` (line 182) |
| Knockback initial magnitude | 169 | `6` px/frame | **`360` px/s** | `opponent.knockback = 360 * player.facing` (replace `6 * ...`) |
| Knockback decay factor | 180 | `*= 0.7` per frame | **`*= Math.pow(0.7, dt*60)`** | `opponent.knockback *= Math.pow(0.7, dt*60); opponent.x += opponent.knockback * dt` (line 179–180) |
| Knockback decay threshold | 177 | `> 0.1` px/frame | **`> 6` px/s** | `Math.abs(opponent.knockback) > 6` (was `0.1`; preserves 60× scale) |
| Contact shove vx | 200 | `-6` px/frame | **`-360` px/s** | `player.vx = -360 * (opponent.x > player.x ? 1 : -1)` |
| `VX_LERP` | 60 | 0.25 / frame (geometric) | **time-constant form** | `player.vx += (target - vx) * (1 - Math.pow(1 - VX_LERP, dt*60))` (replaces line 129); keeps existing 60 Hz feel exactly when `dt=1/60` |
| vx dead-zone | 130 | `< 0.05` px/frame | **`< 3` px/s** | `if (Math.abs(player.vx) < 3) player.vx = 0` |

### Timers (frames → seconds)

All integer-frame counters become seconds-floats. Decrement by `dt`. Initialization: divide the frame value by 60. Conditions `> 0` and `=== 0` become `> 0` and `<= 0` respectively (use `<= 0` to absorb floating-point fuzz).

| Constant / field | Line | Current (frames) | Proposed (seconds) |
|---|---|---|---|
| `PUNCH_DURATION` | 56 | 12 | **0.2 s** (12/60) |
| `PUNCH_COOLDOWN_FRAMES` | 57 | 18 | **0.3 s** — rename to `PUNCH_COOLDOWN` |
| `CONTACT_COOLDOWN_FRAMES` | 65 | 30 | **0.5 s** — rename to `PUNCH_CONTACT_COOLDOWN` (or keep name, drop `_FRAMES` suffix) |
| `PUNCH_BUFFER_FRAMES` | 67 | 6 | **0.1 s** — rename to `PUNCH_BUFFER` |
| `HITSTOP_FRAMES` | 68 | 4 | **0.0667 s** (4/60) — rename to `HITSTOP_DURATION` |
| `player.hitFlash` (init value) | 168 | `8` | **`8/60 ≈ 0.1333 s`** — store flash *duration*, not frames |
| `opponent.hitFlash` (init) | 168 | `8` | **0.1333 s** |
| `hitFlash / 8` (render lerp k) | 330, 336 | `hitFlash / 8` | **`hitFlash / 0.1333`** — extract a `HIT_FLASH_DURATION` constant so render and update agree |
| `player.punchTimer / PUNCH_DURATION` | 325 | ratio of frames | **ratio of seconds** — formula unchanged, both sides now seconds |
| `1 - punchTimer/PUNCH_DURATION` | 325 | normalized t | unchanged formula, still 0..1 |
| `hitstop` (module scope) | 18 | int frames | float seconds |

**Decrement pattern (replaces lines 119–120, 151–153, 175, 193, 194):**

```
if (hitstop > 0) hitstop = Math.max(0, hitstop - dt);
if (player.punchCooldown > 0) player.punchCooldown -= dt;
if (player.punchTimer > 0) player.punchTimer -= dt;
if (player.punchBuffer > 0) player.punchBuffer -= dt;
if (player.contactCooldown > 0) player.contactCooldown -= dt;
if (player.hitFlash > 0) player.hitFlash -= dt;
if (opponent.hitFlash > 0) opponent.hitFlash -= dt;
```
Comparators: keep `> 0` for "is active" (floats > 0 even if tiny). For "ready to fire" (cooldown gating), use `<= 0` so a residual 1e-9 doesn't lock out the next punch indefinitely.

### Position clamps (no change needed)

| Item | Line | Current | Proposed |
|---|---|---|---|
| `player.x` clamp | 133 | `Math.max(ARENA_LEFT + 16, Math.min(ARENA_RIGHT - 16, player.x))` | **unchanged** — pixels are pixels |
| `player.x === ARENA_LEFT+16` equality check | 134 | exact float equality (works because `Math.min/max` returns the bound) | **unchanged**, but float equality on a bound after multiplying by `dt` is *still* safe — clamp guarantees `===`. Optional: rewrite to `<=` / `>=` for clarity. |
| `opponent.x` clamp | 191 | `Math.max(ARENA_LEFT + 16, Math.min(ARENA_RIGHT - 16, opponent.x))` | **unchanged** |
| `opponent.patrolMin / patrolMax` | 51–52 | 480 / 800 | **unchanged** (pixels) |

### Hit-test geometry (no change)

`PUNCH_REACH=38` (line 55), `CONTACT_RANGE=10` (line 66), `Math.abs(fistX - opponent.x) < 28` and the fistY band `> opponent.y - 65 && < opponent.y - 5` (line 166), `PUNCH_DAMAGE=8` (58), `CONTACT_DAMAGE=4` (64) — **all unchanged**. They are spatial / scalar, not rate-based.

---

## 3. Knockback decay — explicit conversion note

Current (line 180): `opponent.knockback *= 0.7;` runs once per frame. After 1 frame at 60 Hz, magnitude × 0.7. After 1 second (60 frames), × 0.7^60 ≈ 1.9e-10.

Per-second equivalent: `pow(0.7, dt * 60)`. Apply as:

```
opponent.knockback *= Math.pow(0.7, dt * 60);
opponent.x += opponent.knockback * dt;
```

Order matters slightly — applying decay *before* the position update gives the same per-frame energy as the current code when `dt = 1/60`. (Current code: position += knockback, then decay. Either order gives identical 60 Hz behavior; the recommended order keeps knockback decaying continuously regardless of dt.)

Threshold `> 0.1` (line 177) was "0.1 px per *frame*" — convert to **6 px/s** to preserve the same "below this we just stop" cutoff. Without the rescale, knockback would tail off into a sub-pixel crawl that lasts much longer in wall-clock time.

---

## 4. Loudest non-dt smoothness defects (post-dt ranking)

After dt lands, these are next. None blocks the dt sweep; all are easier to tune *with* dt in place.

### A. HP bar snaps to integer HP — impact: HIGH (now the loudest visible step function)
- Where: `game.js:296–316` (`drawHpBar`), `game.js:339–340` (call sites), `game.js:167` and `game.js:197` (HP mutations).
- Why now-loudest: hitstop holds the impact frame, fist eases out smoothly, color lerps in/out — and then the HP bar still cuts 8% in one frame. With everything else continuous, the bar reads as a counter, not a wound.
- Fix shape (iter-3 candidate, not in dt sweep): add `displayedHp` per fighter, lerp toward `hp` using the same time-constant form: `displayedHp += (hp - displayedHp) * (1 - Math.pow(1 - 0.15, dt*60))`. Draw bar from `displayedHp`. Optional ghost-bar in dimmer red with slower lerp (~0.04) for damage-tick read.

### B. Walking has no leg cycle — impact: MEDIUM-HIGH
- Where: `game.js:281` (`'/ \\'` always), `drawStick` opts have no walk-phase parameter.
- Why now-loudest: with vx eased *and* dt-correct, the figure glides perfectly — making the static legs read as a hovering puck more than ever. dt makes this worse, not better.
- Fix shape: accumulate `walkPhase += Math.abs(player.vx) * dt * SOMETHING` while grounded; alternate two leg glyphs on `Math.floor(walkPhase) % 2`. Add 1 px head bob.

### C. Opponent patrolDir flips instantly — impact: MEDIUM
- Where: `game.js:185, 188` (assignments to `patrolDir = ±1`).
- Why now-loudest: at each boundary, opponent vx step-functions from `-OPPONENT_SPEED` to `+OPPONENT_SPEED` in one tick — visible zig now that everything else is smooth.
- Fix shape: replace discrete `patrolDir` with a target boundary; lerp a continuous `opponent.vx` toward `OPPONENT_SPEED * sign(target - x)` with a slow time-constant. Or: turn-easing window (`turnTimer` decays from 0.2 s, scales speed through zero).

### D. Contact knockback writes directly to `player.vx` — impact: LOW-MEDIUM
- Where: `game.js:200`. Bypasses the easing path; player teleport-snaps to ±360 px/s.
- Fix shape: separate `player.knockbackVx` field that decays like opponent.knockback (`pow(0.7, dt*60)`), additive to position. Symmetric with how the opponent already takes hits. Already deferred from iter-2; bundles cleanly with the dt sweep since the decay-conversion is identical.

### E. Wall clamp swallows lerped vx without zeroing target — impact: LOW
- Where: `game.js:133–134`. Equality check `player.x === ARENA_LEFT+16` zeroes vx but the lerp target is still nonzero, so easing keeps "pushing" against zero while the player is held. Visually subtle; LOW.
- Fix shape: when clamped, also set `targetVx = 0` for that frame, or skip the lerp entirely on a clamped axis.

### F. Subpixel rendering with `image-rendering: pixelated` — impact: LOW
- Where: `style.css:22`. Carried from iter-1 and iter-2. With dt-correct fractional movement *every frame*, fractional positions are now the norm. Either `Math.round(x)` at draw site only, or drop `pixelated` (canvas isn't upscaled).

---

## 5. dt-sweep LOC estimate

Line-by-line touches, mechanical:

- `loop()` plumbing: +5 LOC (prev, now, dt computation, clamp, pass to update).
- `update(dt)` signature change: 1 LOC.
- 5 constants renamed/rescaled (lines 56, 57, 65, 67, 68): 5 LOC.
- Velocity/gravity/knockback constant rescales (lines 59, 61–63): 4 LOC.
- vx lerp form (line 129): 1 LOC.
- vx dead-zone threshold (line 130): 1 LOC (just a number).
- `player.x += vx * dt`, `player.vy += GRAVITY * dt`, `player.y += vy * dt`, gravity branch (lines 131, 142, 143): 3 LOC.
- 7 timer decrements `--` → `-= dt` (lines 119, 151–153, 175, 193, 194): 7 LOC.
- Knockback block (lines 177–180): rewrite to `Math.pow` form, threshold scale: ~3 LOC.
- Patrol step (line 182): `* dt`: 1 LOC.
- hitFlash init values 8 → `HIT_FLASH_DURATION` (lines 168, 198): 2 LOC + 1 LOC for the new constant.
- hitFlash render lerp denominator `/ 8` → `/ HIT_FLASH_DURATION` (lines 330, 336): 2 LOC.
- Contact shove magnitude (line 200): 1 LOC.
- punchTimer `> 0` → still `> 0` (no change), `=== 0` cooldown gates (line 158, 196) → `<= 0`: 2 LOC.

**Subtotal: ~35 LOC touched.** Matches the iter-2 reviewer's 30–40 estimate.

---

## 6. Sequencing for the synthesizer

1. Rescale constants and rename (compile-clean intermediate state, no behavior change yet — values still match 60 Hz when `dt=1/60` *after* the multiplications go in).
2. Plumb `dt` through `loop` → `update`.
3. Apply `* dt` to every position update and `+= dt` decrement to every timer in one pass.
4. Replace the two non-linear forms (vx lerp, knockback decay) with their `pow(..., dt*60)` equivalents.
5. Spot-check at 60 Hz: behavior should be visually identical to iter-2. Spot-check at 144 Hz (devtools throttle to 144 fps if available, or just observe): jump arc duration, walk acceleration, knockback decay, hitstop length should all match the 60 Hz feel.
6. Only after dt is verified clean: pick from §4 (HP bar lerp first, then walk cycle, then patrol-turn easing).

---

## 7. Edge cases for the synthesizer to watch

- **First-frame dt:** if `prev` is uninitialized at first `loop()` call, `dt` could be NaN or huge. Initialize `prev = performance.now()` *before* the first call, and the clamp at `1/30` handles any other anomaly.
- **Hitstop early-return inside `update(dt)`:** still receives `dt` and decrements `hitstop -= dt`. Don't decrement other timers during hitstop — the early-return on line 122 already prevents that. Confirm `keysPressed.clear()` still runs (it does, line 121).
- **`player.x === ARENA_LEFT+16` equality:** `Math.min/Math.max` returns its argument exactly when it's the limiting bound, so equality holds *after* clamp regardless of dt. Safe. (Optional cleanup: change to `<=` / `>=` for readability — not required.)
- **Game-over on killing hit:** hitstop is set, hp goes to 0, `toGameOver()` flips state. Next frame's `state !== STATE.PLAY` early-return fires before `hitstop` decrement runs — `hitstop` becomes stale carry-over to next match. Add `hitstop = 0` to `resetMatch` (already there at line 79; verify the new float zero is fine — it is).
- **Punch hit-test independence from dt:** the connect check (line 166) runs once at fire-time, samples positions at that instant, sets knockback / hitFlash / hitstop. dt-correct: positions are wherever they are at that instant; no integration over the frame. Safe.
- **Buffered punch during long dt frame:** `punchBuffer -= dt` could go from +0.05 to negative in one 33 ms frame. With `<= 0` on the gate and the `> 0` check on the active flag, behavior is identical to the 60 Hz case — the buffer expires that frame instead of next, which is correct for a 33 ms frame (it's been a long time).
- **Knockback Math.pow precision:** `Math.pow(0.7, dt*60)` for `dt=1/60` gives exactly 0.7 to float precision. For dt=1/144, gives 0.7^(60/144) ≈ 0.864 — knockback decays the same fraction per second regardless of refresh rate. Correct.
