# Iteration 8 — Smoothness Review

## Context recap

Iter-7 shipped: rounds + lean (whiffLock + landingLag) + K.O. fade + 0.5 s `gameEndHold` + camera shake derived from `hitstop`. Verified live in `game.js`:
- `shake` decays 0.85/frame at `game.js:619`, jitters via `ctx.translate(sx, sy)` at `game.js:620-623`.
- Round pips at `game.js:705-709`, instant `o → *` flip on `playerWins`/`opponentWins` increment.
- Intermission overlay at `game.js:717-727`, hard rect.
- HP bar tail color `#8a4a4a` at `game.js:599`.
- Standing/crouch/dive/landing draw paths all use raw float `player.x`, `opponent.x`.

Iter-8 keystone (per orchestrator): heavy jab (~28 LOC) leaning on the existing windup-pose primitive (`game.js:568, 571`); possibly step-back jab (~18 LOC) leaning on existing knockback channel (`game.js:222-227, 290-296`). That's ~46 LOC of combat content. Smoothness should sit at ~15 LOC to leave headroom.

## Ranking

| # | Item | LOC | Composes with heavy jab / step-back? | Pick? |
|---|---|---|---|---|
| 1 | Subpixel render snap (`Math.round` at draw call sites) | ~4 | **Strong** — shimmer risk multiplied by shake (live since iter-7); every new attack pose inherits the fix for free | YES |
| 2 | Round pip pulse on win (0.3 s scale/glow) | ~7 | Neutral — pure feedback for the keystone-of-iter-7. First iter where rounds is live; win-moment is currently a flat flip | YES |
| 3 | HP bar tail darken `#8a4a4a → #5a2a2a` | ~1 | **Medium** — heavy jab's bigger damage chunk leaves longer tails; subtler color keeps tail readable without screaming | YES |
| 4 | Intermission overlay fade-in/out | ~6 | Neutral — composes with rounds. Hard-cut visible up to 2× per match now | maybe (slack only) |
| 5 | Crouch / uppercut animation richness | ~22 | Weak — eats budget, pure paint | DEFER |
| 6 | Patrol direction easing | ~5 | Weak — opp rarely uninterrupted post-feint; step-back would shorten patrol windows further | DEFER |
| 7 | Knockback magnitude bump (~20 → 30-40 px) | ~1 | **Risky** — step-back jab introduces new knockback values. Tune knockback _after_ step-back lands so both reads settle together | DEFER |
| 8 | Shake decay 0.85 → 0.88 | ~1 | Neutral — playtest-only tuning, no spec change | DEFER (note) |

**Recommended budget: ~12 LOC** for picks 1-3. Leaves ~13 LOC slack for pick 4 if heavy jab comes in lean and step-back slips to iter-9.

---

## Pick 1 — Subpixel render snap

**Where.** Draw call sites for player + opponent in `render`:
- `game.js:632` `drawStick(player.x, player.y, ...)`
- `game.js:651` uppercut `*` glyph at `player.x + player.facing * 18`
- `game.js:655` `drawStick(opponent.x, opponent.y, ...)`
- `game.js:667, 677, 685, 693` opponent state-marker glyphs at `opponent.x`

**Why now.** Four-iter defer. Shipped iter-7 camera shake (`game.js:619-623`) adds `(Math.random() - 0.5) * shake` to canvas translate — a fractional offset every frame during shake windows. Combined with already-fractional `player.x` (set by `player.x += player.vx * dt` at `game.js:221`, `dt ≈ 0.0167`, `vx` up to 192 → 3.2 px/frame increments rarely landing on integer boundaries) the ASCII glyphs alias-shimmer when shake is active. The bug existed pre-iter-7 but was masked by static camera; shake exposed it.

Heavy jab (iter-8) introduces another opponent state with a windup-pose render (already wired through `drawStick`'s `windup` opt at `game.js:568, 571`). Snapping at the draw call sites — not in `drawStick` — means every new pose inherits the fix without per-pose plumbing.

**Fix sketch (~4 LOC).** Simplest: snap the two character x values once before the draw block. Insert at `game.js:629` (top of the `if (state === STATE.PLAY || state === STATE.OVER)` body):
```
const px = Math.round(player.x);
const ox = Math.round(opponent.x);
```
Replace `player.x` → `px` at `game.js:632, 651`. Replace `opponent.x` → `ox` at `game.js:655, 667, 670, 677, 685, 693`.

**Tuning.** Snap only x; y is already integer-stable (only changes via gravity integration on jump arc, and the jitter is far smaller than glyph height). Snap before, not after, the shake translate — shake supplies the sub-pixel motion intentionally; we want characters _stable relative to the shake frame_, not double-jittered.

**Edge cases.**
- HP bar already uses integer math from canvas constants (`game.js:592`); no change.
- `walkPhase` tick uses raw `vx` (unaffected).
- Hit-detection still uses raw `player.x` / `opponent.x` (correct — physics shouldn't snap, only render).
- The uppercut `*` arcY (`game.js:646`) is computed from `player.y - 10 - 70 * t` and rendered at `player.y` baseline — unchanged.
- `drawStick` internally uses `x + facing * (8 + off)`, etc. With `x` already rounded, `facing * (8 + off)` keeps floats internal but the head/torso bases are integer. Acceptable; the jitter source was the base, not the offsets.

**LOC.** ~4 (2 const declarations + 2 replace_all at usage sites, but counted as the textual diff: +2 lines).

---

## Pick 2 — Round pip pulse on win

**Where.** `game.js:705-709`, the four-character pip render. Currently:
```
ctx.fillText((playerWins >= 1 ? '*' : 'o') + ' ' + (playerWins >= 2 ? '*' : 'o'),
             WALL_THICKNESS + 12, 12);
```
The `o → *` flip is instantaneous on `playerWins++` / `opponentWins++` at `game.js:459-460`.

**Why now.** Rounds shipped iter-7. The pip _is_ the round-win acknowledgement, and right now it's a single-frame state change at the same instant `roundPhase` flips to `intermission`. The intermission overlay then fades in (would be, with pick 4) covering the canvas — the pip change is upstaged before it registers. With rounds-to-win = 2, this beat fires 2-3× per match; missing it costs the climactic round-win feedback.

This is independent of heavy jab. It composes with rounds (already live). It pays rent on the keystone of iter-7 — the first iter where rounds is _observable_ in production.

**Fix sketch (~7 LOC).**

Module-level state, near `game.js:24-28`:
```
let pipPulseTimer = 0;
let pipPulseSide = null;  // 'player' | 'opponent'
```

Trigger — modify the win-increment at `game.js:459-460` (inside the `if (gameEndHold <= 0)` block):
```
if (opponent.hp <= 0) { playerWins++; pipPulseTimer = 0.3; pipPulseSide = 'player'; }
else { opponentWins++; pipPulseTimer = 0.3; pipPulseSide = 'opponent'; }
```

Tick — already covered by the existing update loop's other timers; add at `game.js:268` (next to the other `*Timer -= dt` block):
```
if (pipPulseTimer > 0) pipPulseTimer -= dt;
```

Render — modify `game.js:701-709`. Replace the static pip block with a font-size scaled rendering when the corresponding side is pulsing:
```
const pipBase = 12;
const pulseT = pipPulseTimer > 0 ? pipPulseTimer / 0.3 : 0;
const playerPipSize = pipPulseSide === 'player' ? pipBase + 6 * pulseT : pipBase;
const oppPipSize = pipPulseSide === 'opponent' ? pipBase + 6 * pulseT : pipBase;
ctx.fillStyle = '#ccc';
ctx.font = `${playerPipSize}px monospace`;
ctx.textAlign = 'left';
ctx.fillText((playerWins >= 1 ? '*' : 'o') + ' ' + (playerWins >= 2 ? '*' : 'o'),
             WALL_THICKNESS + 12, 12);
ctx.font = `${oppPipSize}px monospace`;
ctx.textAlign = 'right';
ctx.fillText((opponentWins >= 1 ? '*' : 'o') + ' ' + (opponentWins >= 2 ? '*' : 'o'),
             W - WALL_THICKNESS - 12, 12);
```

Reset `pipPulseTimer = 0; pipPulseSide = null` in `resetMatch` at `game.js:151-160`.

**Tuning.** 0.3 s window — long enough to register before the intermission overlay covers, short enough to settle by the time `roundPhase` flips. Linear scale 12 → 18 px reads as a "pop." Keep monochrome — pulsing color would compete with the intermission overlay text.

**Edge cases.**
- Match-ending win: pip pulse fires same frame as `toGameOver()` is called. The K.O. screen is a DOM overlay above the canvas, so the pulsing pip is partially visible during the 0.4 s CSS fade — acceptable, the player sees the pip flip and the screen settle simultaneously.
- Resetting in `resetMatch` only (not `resetRound`) — so the pulse can finish its 0.3 s after `roundPhase` flips to `intermission`. The intermission tick early-returns at `game.js:197-205` before the pip render, but the pip render runs in `render()` regardless of `roundPhase` (`game.js:701-709` is unconditional within the gameplay block). The `pipPulseTimer -= dt` decrement is in `update`, which is bypassed during intermission early-return. Choose: either move the decrement above the intermission early-return (preferred — adds 0 LOC if placed right) OR accept that the pulse freezes through intermission and snaps to baseline on round-2 first frame (acceptable but worse).
- Two pulses in same match: `pipPulseSide` swap is fine; only one side animates at a time, but two pip-flips in a single match never happen on the same frame.

**LOC.** ~7 (2 state, 2 trigger lines, 1 tick, ~6 render swap counted as diff +2).

---

## Pick 3 — HP bar tail darken

**Where.** `game.js:599`, `ctx.fillStyle = '#8a4a4a';`.

**Why now.** Three-iter defer. Heavy jab (iter-8) deals more damage per hit than the standing punch's 8 — likely 16-20 per orchestrator typical. The tail HP bar uses `damageTailHp` lerping toward `displayedHp` at slow rate `0.06` (`game.js:451`), so the visible "tail" length scales with damage chunk size. A 20-damage hit leaves a tail ~2.5× longer than the existing 8-damage punch's tail, lit by the current fairly-bright `#8a4a4a`. Darkening to `#5a2a2a` keeps the tail visible-as-reference but stops it from competing with the live HP fill.

**Fix sketch (~1 LOC).** Change `'#8a4a4a'` → `'#5a2a2a'` at `game.js:599`.

**Tuning.** `#5a2a2a` is RGB (90, 42, 42) — about 65% the brightness of `#8a4a4a` (138, 74, 74). Still distinguishable from the bg `#333` (51, 51, 51) and the live-HP green/yellow/red. If playtest reads the tail as "vanished," step up to `#6a3535`.

**Edge cases.** None; pure color swap. No interaction with shake, flash, or rounds.

**LOC.** 1.

---

## LOC tally

| # | Pick | LOC |
|---|---|---|
| 1 | Subpixel render snap | ~4 |
| 2 | Round pip pulse on win | ~7 |
| 3 | HP bar tail darken | ~1 |
| | **Total** | **~12** |

Comfortably under the 25-LOC cap. Leaves ~13 LOC for an additional smoothness pick if heavy jab comes in under-budget _and_ step-back is dropped to iter-9.

**Slack-tier candidate: intermission overlay fade (~6 LOC).** If budget allows, fade the `rgba(10, 10, 10, 0.7)` rect at `game.js:718-719` from `0` → `0.7` over the first 0.3 s of intermission and back to `0` over the last 0.3 s. Use `intermissionTimer` already on hand:
```
const fadeIn = Math.min(1, (INTERMISSION_DURATION - intermissionTimer) / 0.3);
const fadeOut = Math.min(1, intermissionTimer / 0.3);
const alpha = 0.7 * Math.min(fadeIn, fadeOut);
ctx.fillStyle = `rgba(10, 10, 10, ${alpha.toFixed(3)})`;
```
Same pattern for the text alpha if desired. Defer-or-ship by orchestrator's call.

---

## Coordinate with heavy jab / step-back (orchestrator notes)

1. **`drawStick`'s `windup`/`windupFacing` opts (`game.js:514, 568, 571`) are the heavy-jab pose primitive.** Heavy jab can extend by adding a `chargeT` opt (0..1) that intensifies the windup glyph (e.g. `<<|\\` at high charge) — no changes to the std drawStick primitives needed beyond opts wiring. Smoothness pick 1 (subpixel snap) covers the new pose for free.
2. **Step-back jab knockback uses `opponent.knockback` channel (`game.js:69, 290-296`).** The channel decays at 0.7^60dt — already tuned across 4 attack types. Add a negative-magnitude knockback for step-back (`opponent.knockback = -200 * facing` to retreat from player) and the existing channel handles decay + bounds-clamp.
3. **Pip pulse fires on `playerWins++`/`opponentWins++` regardless of how the round ended.** Heavy-jab K.O. and step-back-stalled-out K.O. both trigger pulse. No coordination needed.

---

## Deferred (still on the table after iter-8)

- **Crouch / uppercut animation richness** (~22 LOC): pure paint, eats budget alone. Best in a quiet iter with no keystone.
- **Patrol direction easing** (~5 LOC): step-back jab will further reduce the windows where patrol-flip is visible. Drop indefinitely unless playtest flags.
- **Knockback magnitude bump**: step-back jab introduces a _retreat_ knockback in opposition to existing strike-knockback. Tune both together iter-9 once the channel sees the new direction.
- **Shake decay 0.85 → 0.88**: tuning question. The 0.85 decays through `~6 frames ≈ 100 ms`; 0.88 decays through `~8 frames ≈ 130 ms`. With heavy jab landing for 1.5-2× the damage, the post-hit shake settle period is currently 100 ms in a hitstop window of 133 ms (KO-blow) — the shake settles _before_ hitstop ends, which already reads correct. **Recommend hold at 0.85.** If heavy jab playtest reads "shake snaps off too quickly," revisit iter-9 alongside the magnitude bump.
- **Match-end overlay smoothness** beyond the iter-7 fade: e.g. a "WIN/LOSE" pre-overlay flash before the K.O. screen. Speculative; defer until playtest asks.
