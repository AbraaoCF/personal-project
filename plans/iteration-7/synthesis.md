# Iteration 7 — Synthesis

**Composition:** rounds (keystone) + landingLag-crouch bug fix + off-balance lean + K.O. fade & gameEndHold + camera shake. **Total ~62 LOC** (35 + 1 + 10 + 8 + 6 + ~2 pip render). **Heavy jab deferred to iter-8** — too risky to land alongside rounds (rounds rewires run-loop end-state; heavy jab adds opponent variance simultaneously is hard to playtest cleanly).

The picks compose deliberately:
- `gameEndHold` introduced by pick 4 is **reused by rounds** as the pre-overlay pause (one timer, two consumers).
- The `.fading-in` CSS class is reusable for any future DOM overlay.
- Camera shake derives from `hitstop`, which already doubles on K.O. blows → round-deciding hits shake 2× harder for free.
- Lean covers two verbs (whiffLock + landingLag) with one primitive.

---

## Change 1 — Best-of-3 rounds with intermission

**What.** Replace single-K.O. game-end with best-of-3 rounds; first fighter to 2 round wins takes the match.

**Why.** Inspiration #1, iter-7 keystone. Doubles/triples per-match play time without new combat content; recon → adapt → comeback drama; re-amortizes all iter-2-to-6 depth across multiple round-cycles per match.

**Where.** `game.js`: module state near line 17, split `resetMatch` (lines 110–138) into `resetMatch` + `resetRound`, replace direct `toGameOver()` at line 418–420 with round-end branching, add pips + intermission overlay in `render` (after line 643), update `toGameOver` (lines 153–159).

**Spec.**

**State (after line 17):**
```
const ROUNDS_TO_WIN = 2;
const INTERMISSION_DURATION = 1.5;  // s
let playerWins = 0;
let opponentWins = 0;
let roundNumber = 1;
let roundPhase = 'fighting';   // 'fighting' | 'intermission'
let intermissionTimer = 0;
```

**Refactor `resetMatch` → call new `resetRound` for the body, then add match-level zeroing.** `resetRound` body = current `resetMatch` body MINUS `player.punchesLanded = 0; player.punchAttempts = 0;` (those are match-cumulative). `resetRound` MUST also zero `gameEndHold` (see change 4) and `shake` (see change 5). New `resetMatch`:
```
function resetMatch() {
  resetRound();
  player.punchesLanded = 0;
  player.punchAttempts = 0;
  playerWins = 0;
  opponentWins = 0;
  roundNumber = 1;
  roundPhase = 'fighting';
  intermissionTimer = 0;
}
```

**Intermission tick** at top of `update` (after line 171, the existing `if (state !== STATE.PLAY)` early-return block):
```
if (roundPhase === 'intermission') {
  intermissionTimer -= dt;
  if (intermissionTimer <= 0) {
    resetRound();
    roundPhase = 'fighting';
  }
  keysPressed.clear();
  return;
}
```

**Round-end / match-end branch** — replace lines 418–420:
```
if (roundPhase === 'fighting' && (player.hp <= 0 || opponent.hp <= 0) && hitstop <= 0) {
  if (gameEndHold === 0) gameEndHold = 0.5;
  gameEndHold -= dt;
  if (gameEndHold <= 0) {
    if (opponent.hp <= 0) playerWins++;
    else opponentWins++;
    if (playerWins >= ROUNDS_TO_WIN || opponentWins >= ROUNDS_TO_WIN) {
      toGameOver();
    } else {
      roundPhase = 'intermission';
      intermissionTimer = INTERMISSION_DURATION;
      roundNumber++;
    }
  }
}
```

**`toGameOver` (lines 153–159):**
```
function toGameOver() {
  state = STATE.OVER;
  const result = playerWins > opponentWins ? 'VICTORY' : 'DEFEAT';
  document.getElementById('gameover-stats').textContent =
    `${result} ${playerWins}-${opponentWins}  -  Punches thrown: ${player.punchAttempts}  (landed: ${player.punchesLanded})`;
  gameOverScreen.classList.add('fading-in');     // change 4
  show(gameOverScreen);
  requestAnimationFrame(() => gameOverScreen.classList.remove('fading-in'));  // change 4
}
```

**Render — round pips.** After each `drawHpBar` call (lines 634–637), draw pips:
```
ctx.fillStyle = '#ccc';
ctx.font = '12px monospace';
ctx.textAlign = 'left';
ctx.fillText((playerWins >= 1 ? '*' : 'o') + ' ' + (playerWins >= 2 ? '*' : 'o'),
             WALL_THICKNESS + 12, 12);
ctx.textAlign = 'right';
ctx.fillText((opponentWins >= 1 ? '*' : 'o') + ' ' + (opponentWins >= 2 ? '*' : 'o'),
             W - WALL_THICKNESS - 12, 12);
```

**Render — intermission overlay** (in `render`, after the gameplay block, still inside `if (state === STATE.PLAY || state === STATE.OVER)`):
```
if (roundPhase === 'intermission') {
  ctx.fillStyle = 'rgba(10, 10, 10, 0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#eee';
  ctx.font = 'bold 32px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`ROUND ${roundNumber}`, W / 2, H / 2 - 20);
  ctx.font = 'bold 20px ui-monospace, monospace';
  ctx.fillText(`${playerWins} : ${opponentWins}`, W / 2, H / 2 + 16);
}
```

**Edge cases.**
- ESC during intermission still goes to menu — keydown handler at line 26 fires unconditionally during STATE.PLAY.
- `displayedHp` lerps run before the K.O. branch, so the bar visibly drains during the 0.5 s `gameEndHold`.
- `punchesLanded` / `punchAttempts` NOT zeroed by `resetRound` — match-cumulative as designed.
- A round-end KO leaves the opp in last pose for 0.5 s hold + 1.5 s intermission. The intermission overlay covers the canvas ~70% so any post-hit rendering is dimmed but visible.

**Test in head.**
1. Round 1, KO opp: hitstop 0.133 s freeze; `gameEndHold` ticks 0.5 → 0; `playerWins=1`, `roundPhase='intermission'`, `roundNumber=2`, `intermissionTimer=1.5`.
2. Frames early-return through intermission tick at top of update; render shows "ROUND 2 / 1 : 0" with pips `* o` / `o o`.
3. `intermissionTimer<=0` → `resetRound()` (HP=100, positions reset, stats preserved); `roundPhase='fighting'`.
4. Round 2 KO with `playerWins=2` → `toGameOver()` fires text `VICTORY 2-0`.

**LOC.** ~35 (state ~7, resetRound dup ~5, resetMatch additions ~7, intermission tick ~7, K.O. branch ~12, toGameOver ~2, pips ~6, overlay ~9 — closer to 40 with overlay; trim by inlining where possible).

---

## Change 2 — Fix landingLag-crouch bug (1 LOC)

**What.** Add `&& player.landingLag <= 0` to the `player.crouching` gate.

**Why.** Playtest 9a, CRITICAL. Gate at lines 198–200 checks `whiffLock <= 0` but not `landingLag <= 0`; holding S during the 0.4 s landingLag from a whiffed dive sets `crouching=true`, applying `CROUCH_HURTBOX_DROP=16` in opp's jab band check (line 299) — free jab dodge while visually slumped.

**Where.** `game.js:198–200`.

**Spec.** Replace:
```
player.crouching = player.onGround
  && player.whiffLock <= 0
  && (keys.has('s') || keys.has('arrowdown') || player.uppercutTimer > 0);
```
With:
```
player.crouching = player.onGround
  && player.whiffLock <= 0
  && player.landingLag <= 0
  && (keys.has('s') || keys.has('arrowdown') || player.uppercutTimer > 0);
```

**Edge cases.** `uppercutTimer > 0` cannot coincide with `landingLag > 0` (uppercut is ground-only, dive is air-only) — no false-positive on the uppercut path.

**Test in head.** Player whiff-dives onto opp → `landingLag=0.4`. Player holds S. Pre-fix: `crouching=true`, drop=16 → opp jab fistY=y-50 falls outside shifted band (y-49, y+11) → MISS (free dodge). Post-fix: `crouching=false`, drop=0, band (y-65, y-5), fistY=y-50 → in range → HIT. Lagged player now eats coincident jab as intended.

---

## Change 3 — Off-balance lean (whiffLock + landingLag)

**What.** During `whiffLock > 0` or `landingLag > 0`, render head/torso pitched forward (whiff) or backward (land) over rooted legs.

**Why.** Smoothness pick #1 / Inspiration #4. Both lock states currently render as static / slumped poses. Lean reads as physical commit-cost: forward = punched air, backward = recovered from missed dive. Two-iter defer history; cheapest two-verb-for-one buy.

**Where.** `game.js`: `drawStick` opts (lines 462–466), landingLag branch (lines 478–483), standing-pose path (lines 491–522), render call (lines 571–580).

**Spec.**

**Add to opts (line 462–466):** `whiffLock = 0`.

**LandingLag branch (lines 478–483)** — backward lean:
```
if (landingLag > 0) {
  const landLean = -facing * 4 * Math.min(1, (LANDING_LAG - landingLag) / 0.15);
  ctx.fillText('_O_', x + landLean, y - 30);
  ctx.fillText('\\|/', x + (landLean * 0.5), y - 12);
  ctx.fillText('/ \\', x, y + 4);
  return;
}
```

**Standing-pose whiff lean** — at start of standing block (after line 490, before line 492):
```
const whiffLean = whiffLock > 0
  ? facing * 4 * Math.min(1, (WHIFF_LOCK - whiffLock) / 0.15)
  : 0;
```

Apply `+ whiffLean` to the x of:
- Line 492: `'O'` head.
- Lines 510, 512, 514, 517: torso glyphs (`====`, `|\`/`/|`, idle/windup `/|\`). For line 510 specifically, the existing `x + facing * (8 + off)` becomes `x + whiffLean + facing * (8 + off)`.
- Legs at line 521 unchanged (rooted).

**Render call (lines 571–580):** add `whiffLock: player.whiffLock` to opts.

**Edge cases.**
- `whiffLock` only fires from missed standing punch (line 374). Crouch path returns early at line 489 → uppercut whiff unaffected (no whiffLock by design).
- Diving returns early at line 476 → dive doesn't lean.
- Lean eases in over 0.15 s (peaks at 4 px), holds peak for the remainder of the 0.35/0.40 s window, snaps to 0 when the lock clears. Reads as "regains balance" the moment inputs reopen.
- Hitstop pauses `whiffLock` decrement → lean frozen at peak during freeze. Intentional ("moment of recognition").
- Knockback adds to `player.x`; whiff + immediate jab eat = figure leans forward AND slides backward. Reads as "leaning into the punch they ate." Acceptable.
- Punch animation (PUNCH_DURATION=0.2 s) and whiffLock (0.35 s) overlap for the first 0.2 s. Lean shifts the whole upper body uniformly; the punch's `====` arm shifts too, preserving relative positioning. Reads as "leaning into the strike that missed."

**Test in head.**
1. Player whiffs J at long range. Frame 0: `punchTimer=0.20`, `whiffLock=0.35`. `whiffLean = facing * 4 * min(1, 0/0.15) = 0`. No lean yet.
2. Frame at t=0.05: `whiffLock=0.30`. `whiffLean = facing * 4 * min(1, 0.05/0.15) ≈ facing * 1.33`. Slight pitch.
3. t=0.15: `whiffLock=0.20`. `whiffLean = facing * 4` (peak). Full lean. Punch arm retracting.
4. t=0.20: punch animation ends; idle pose returns at standard branch, lean still applied → figure pitched at +4 px head/torso, legs rooted.
5. t=0.35: `whiffLock=0`. Lean snaps to 0. Figure recovers.
- LandingLag mirror: `-facing * 4` over the 0.4 s window — same shape, opposite sign, reads as backward stagger from missed dive.

**LOC.** ~10 (opts wiring 1, whiff const 3, head/torso `+whiffLean` 4 sites = 4, landingLag rewrite 4 lines vs current 3 = +1, render call 1).

---

## Change 4 — K.O. fade-in + gameEndHold

**What.** 0.5 s game-clock hold before overlay reveal so the killing pose is visible; 0.4 s CSS opacity fade so the overlay bleeds in.

**Why.** Smoothness pick #2. With rounds, the K.O./round-end transition fires up to 4× per match. `gameEndHold` is the **round-pause primitive reused by change 1**.

**Where.** `game.js`: module state line 17, reset in `resetMatch`/`resetRound` (covered by change 1), K.O. branch covered by change 1, `toGameOver` covered by change 1. `style.css` after line 37.

**Spec.**

**Module state (line 17):** `let gameEndHold = 0;`. Reset in `resetRound` (per change 1).

**K.O. branch + `toGameOver` fade integration** — already specified in change 1.

**CSS (after line 37):**
```
.overlay { transition: opacity 0.4s ease-out; opacity: 1; }
.overlay.fading-in { opacity: 0; }
```

**Edge cases.**
- `gameEndHold` only decrements when `hitstop <= 0` (since the hitstop early-return at line 173–176 fires first) → freeze and hold sequence cleanly.
- `displayedHp` lerps run before the K.O. branch (lines 411–416 vs 418), so HP visibly drains during the 0.5 s hold.
- `resetRound` zeros `gameEndHold` so transitions don't carry stale value.

**Test in head.**
1. KO hit: hitstop=0.133 (2×). Frames early-return through 0.13 s.
2. Hitstop hits 0; line 418 branch: `gameEndHold=0.5`; gameplay still renders (HP bars draining).
3. ~30 frames (~0.5 s) later: `gameEndHold<=0`; either round-end or `toGameOver()`.
4. Match-end path: overlay added with `.fading-in` (opacity 0); RAF removes class → CSS transition fades 0→1 over 0.4 s.
5. Total cinema: ~0.13 s freeze + 0.5 s hold + 0.4 s fade ≈ 1 s. Up from ~0 s.

**LOC.** ~8 (1 state field, 4 K.O. branch — folded into change 1, 3 `toGameOver` — folded into change 1, 2 CSS).

---

## Change 5 — Camera shake on hit

**What.** Random per-frame jitter (±N px) on canvas translate during render, amplitude derived from `hitstop / HITSTOP_DURATION`, decaying 0.85/frame.

**Why.** Smoothness pick #3. Composes with hitstop, hitFlash, knockback, HP-bar pulse — adds the missing physical-impact cue. Amplitude scales naturally with `hitstop` (already doubled on KO, 1.5× on counters) → round-deciding hits shake harder for free.

**Where.** `game.js`: module state line 17, set in `update` near line 410, apply at top + bottom of `render`.

**Spec.**

**Module state (line 17):** `let shake = 0;`. Reset in `resetRound` (per change 1).

**Set in `update`** — after the contact-damage block (after line 409), before the K.O. check:
```
if (hitstop > 0) shake = Math.max(shake, (hitstop / HITSTOP_DURATION) * 4);
```
`Math.max` is defensive for multiple same-frame hits.

**Apply in `render`** — after `ctx.clearRect(0, 0, W, H);` (line 563):
```
shake *= 0.85;
const sx = (Math.random() - 0.5) * shake;
const sy = (Math.random() - 0.5) * shake;
ctx.save();
ctx.translate(sx, sy);
```

At end of `render` (after line 643, before closing `}`): `ctx.restore();`.

**Tuning.**
- 4 px peak normal, 6 px counters (1.5× hitstop), 8 px KO (2× hitstop).
- Decay 0.85/frame at 60 fps → e-fold ~6 frames ~100 ms — fades within freeze; movement resumes on settled camera.

**Edge cases.**
- Walls, ground, HP bars, controls hint all shake — sells "the world reacted." If HUD wobble reads wrong in playtest, wrap only the gameplay block (lines 567–643). Ship full-screen first; revisit.
- Frame where hitstop transitions 0→nonzero: hit-checks at lines 302/337/358/386 set hitstop; shake-set at ~line 410 runs same frame, captures fresh hitstop. Subsequent frames early-return at line 173 — but `render` still runs and applies decaying shake.
- `resetMatch`/`resetRound` zero `shake`.

**Test in head.**
1. Counter-punch: hitstop=0.1 s; shake=(0.1/0.0667)×4=6 px peak.
2. Frame 1 freeze: shake decays to 5.1; sx∈±2.55, sy∈±2.55. Canvas jitters.
3. Frame 6 (~100 ms): shake≈2.3 px. Hitstop ends; shake decays to <1 within ~4 more frames. Camera settles.
4. KO: hitstop=0.133, shake=8 px peak. Freezes 8 frames; by gameEndHold start, shake is ~1 px → killing pose reads on near-settled camera, only immediate aftermath shakes.

**LOC.** ~6 (1 module field, 1 set line, 0 reset — counted in change 1, 4 render save/translate/sx-sy/restore — net ~5).

---

## Deferred

- **Heavy jab (Inspiration #2, ~28 LOC):** mutually exclusive with feint, slow-windup variance, bigger damage. Strong iter-8 candidate now that rounds doubles match length and player has cross-round recon time. Defer rationale: too risky to land alongside rounds in one iteration.
- **Step-back jab (Inspiration #5, ~18 LOC):** opponent positional variance. Iter-8/9 once player has confidence in counters and footsies.
- **Crouch / uppercut animation richness (Inspiration #3, ~22 LOC):** chamber, dust kick, knee bob. Pure render polish — best in a quiet iter with no keystone.
- **Subpixel render snap (~3 LOC):** four-iter deferred. Slack-tier.
- **HP bar tail darken (~3 LOC):** three-iter deferred. Slack-tier.
- **Patrol direction easing (~5 LOC):** opponent rarely uninterrupted post-feint; drop indefinitely unless playtest flags.
- **Knockback magnitude bump:** tune in iter-8 after rounds ships and per-round impact is observed.

**Design question deferred — dive sets opp `idle` (playtest 9e):** dive HIT sets `opponent.state='idle'` (line 389), not `'recovery'`, so dive→standing-punch deals 12+8=20 (no second-hit counter). Changing to `'recovery'` enables 12+12=24. Per orchestrator brief, **keep idle for now** — combos add complexity. Revisit iter-8 alongside heavy jab tuning.

**Doc-drift items (no fix needed):** divepunch vy is replaced not added (playtest 9f); pulse alpha is 0.30–1.00 not 0.65–1.0 (playtest 9g). Cosmetic spec drift only.
