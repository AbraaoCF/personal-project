# Iteration 7 — Smoothness Review

## Context recap

Iter-6 shipped: divepunch + landingLag pose (`game.js:478-483`), feint (`game.js:284-289, 319-324, 625-632`), CRIT state-machine reorder, walk leg cycle (`game.js:520-521`), pulsing recovery `~` (`game.js:617-624`). State now has 3 player attack verbs each with a distinct pose path in `drawStick`. Lean was deferred so it could be co-designed across `whiffLock` AND `landingLag`.

Iter-7 keystone: **best-of-3 rounds (~35 LOC)**. Composition lever: rounds introduce new state transitions — round-end, round-start, match-end — and **each transition is a feedback moment**. K.O. screen smoothness was previously a one-of; with rounds, it's three round-end moments + one match-end moment. The smoothness budget should pay rent on those transitions.

## Ranking

| # | Item | LOC | Composes with rounds? | Pick? |
|---|---|---|---|---|
| 1 | Off-balance lean (whiffLock + landingLag co-design) | ~10 | Weak — but spec'd, deferred once, cheapest two-verb-for-one buy | YES |
| 2 | K.O. screen fade-in / round-end hold | ~8 | **Strong** — every round end is a transition; with 3 round-ends per match this is the highest-leverage smoothness pick of the iter | YES |
| 3 | Subtle camera shake on hit | ~6 | **Medium** — composes with hitstop + HP bar; KO-blow shake amplitude can be tied to round-deciding hits via existing `hitstop * 2` doubling | YES |
| 4 | Subpixel render snap (`Math.round` at draw) | ~3 | Neutral — global polish, two-iter deferred | maybe (slack only) |
| 5 | HP bar tail darken / stripe | ~3 | Neutral — three iters deferred | maybe (slack only) |
| 6 | Crouch animation richness (chamber + bob + dust) | ~22 | Weak — pure render polish, eats budget alone | DEFER |
| 7 | Patrol direction easing | ~5 | Weak — patrol now rarely uninterrupted (post-feint) | DEFER |
| 8 | Knockback magnitude bump | ~1 | Risky to compose with rounds (changes match length on top of rounds tripling it) | DEFER |
| 9 | Uppercut visual richness | ~5 | Weak — uppercut reads fine | DEFER |

**Recommended budget: ~24 LOC** for picks 1-3. Leaves ~1-3 LOC for one slack pick if rounds comes in lean.

---

## Pick 1 — Off-balance lean (whiffLock + landingLag, design once, apply both)

**Where.** `drawStick` at `game.js:461-523`. Standing-pose path (`game.js:492-522`) for whiffLock; landingLag early-return (`game.js:478-483`) already wired for `landingLag` opt; new opt `whiffLock` to add. Player render call at `game.js:571-580`.

**Why now.** Two-iter defer history. Both states now exist (whiffLock at `game.js:374`, landingLag at `game.js:218`), both currently render as static idle pose for their entire duration. The whiff and the dive-whiff are the player's two **commit-cost moments** — they should *feel* different from idle. Iter-5 spec: head + arms shifted by `4 * facing` px, eased over first 0.15 s, legs anchored. Same primitive drops into both branches.

**Fix sketch (~10 LOC).**

Add `whiffLock = 0` to opts destructure at `game.js:464-466`.

Standing-pose lean — insert after the `if (crouch)` early return at line 490:
```
const whiffLean = whiffLock > 0 ? facing * 4 * Math.min(1, (WHIFF_LOCK - whiffLock) / 0.15) : 0;
```
Apply `+ whiffLean` to head x at line 492 and arm fillText x at lines 510-517. Legs at line 521 unchanged.

LandingLag branch (lines 478-483), add forward lean — torso tipped over feet:
```
if (landingLag > 0) {
  const landLean = facing * 4 * Math.min(1, (LANDING_LAG - landingLag) / 0.15);
  ctx.fillText('_O_', x + landLean, y - 30);
  ctx.fillText('\\|/', x + landLean, y - 12);
  ctx.fillText('/ \\', x, y + 4);
  return;
}
```

Pass `whiffLock: player.whiffLock` from render call at `game.js:571-580`.

**Tuning.** 4 px = one font-cell; the 0.15 s ramp is ~43% of `WHIFF_LOCK` and ~37% of `LANDING_LAG`, so both states hold at full lean for the majority of duration, then snap back on transition out (figure "regains balance" as inputs reopen).

**Edge cases.**
- `whiffLock` only fires on standing-punch miss (`game.js:374`); crouch path returns early at lines 485-490 before reaching lean code → uppercut whiff unaffected (correct; uppercut is lock-free per iter-5).
- Punch animation overlap: lean offsets head + arms; punch animation offsets fist relative to `x`. They compose linearly. If reads as "whole figure shoved," reduce to 3 px.
- Knockback channel adds to `player.x` directly (`game.js:189`). Whiff + immediate jab-counter = figure leans forward AND slides backward → reads as "leaning into the punch you just ate." Accidental beauty.
- Diving pose (`game.js:472-477`) returns before lean code. Dive doesn't lean (the dive IS the lean).

**LOC.** ~10. Whiff branch ~4, land branch ~4, opts wiring + render-call pass ~2.

---

## Pick 2 — K.O. screen / round-end fade

**Where.** `game.js:153-159` (`toGameOver`), `game.js:418-420` (game-over trigger), `style.css:25-37` (overlay).

**Why now.** Currently: hitstop ends → `toGameOver()` → DOM overlay appears instantly with `display: flex`. Zero animation. With **rounds shipping**, this transition fires up to **3 times per match** (round-end overlay) plus 1 match-end. Four transitions where the current behavior is a hard cut from gameplay to text. Highest structural-leverage smoothness pick of the iter.

**Fix sketch (~8 LOC).** Two parts that compose: a CSS fade and a game-clock hold so the impact pose is visible before the overlay appears.

**Part A — CSS fade (~4 LOC).** In `style.css` near line 33:
```
.overlay { ...existing... transition: opacity 0.4s ease-out; opacity: 1; }
.overlay.fading-in { opacity: 0; }
```
In `toGameOver` (`game.js:153-159`):
```
gameOverScreen.classList.add('fading-in');
show(gameOverScreen);
requestAnimationFrame(() => gameOverScreen.classList.remove('fading-in'));
```

**Part B — game-clock hold (~4 LOC).** Module-level `let gameEndHold = 0;`. Reset in `resetMatch` (`game.js:128`). Modify K.O. trigger at `game.js:418-420`:
```
if ((player.hp <= 0 || opponent.hp <= 0) && hitstop <= 0) {
  if (gameEndHold === 0) gameEndHold = 0.5;
  gameEndHold -= dt;
  if (gameEndHold <= 0) toGameOver();
}
```

Sequence: hit lands → hitstop 67-133 ms → 500 ms hold (HP-bar lerps continue, draining visibly) → 400 ms overlay fade. Total ~1 s of "moment-of-impact" cinema vs the current ~0 s.

**Composes with rounds.** `gameEndHold` is the **round-pause primitive**. If rounds adds its own per-round-end pause, the rounds spec should reuse this field/pattern rather than introducing a parallel timer. The `.fading-in` CSS class works for any "Round 1 to YOU" intermediate overlay too — one rule, multiple consumers.

**Edge cases.**
- HP-bar `displayedHp` lerps run at line 411-416 (after the K.O. check), so HP visibly drains during the hold — exactly the "you can see the killing blow's damage settle" moment.
- `gameEndHold` only decrements when `hitstop <= 0`, so freeze sequence orders correctly.
- `resetMatch` zeroing required so next match doesn't carry over.

**LOC.** ~8 (3 CSS, 1 reset, 1 state field, 3 trigger).

---

## Pick 3 — Subtle camera shake on hit

**Where.** `render()` at `game.js:562-644` (translate frame around the gameplay draw); shake set derived from `hitstop` near `game.js:418`.

**Why now.** "Punch felt" is a stack of cues: hitstop (have), hitFlash (have), knockback (have), HP-bar pulse (have), camera shake (don't). The shake amplitude scales naturally with `hitstop`, which already doubles on KO blows (`game.js:306, 347, 368, 396`) and 1.5× on counters — so the round-deciding hit shakes 2× harder for free.

**Fix sketch (~6 LOC).**

Module-level: `let shake = 0;`

Set centrally — derive from `hitstop` rather than touching all 5 hit sites. Insert in `update()` between the K.O.-check at line 418 and `keysPressed.clear()` at line 422:
```
if (hitstop > 0) shake = hitstop / HITSTOP_DURATION * 4;
```
Auto-yields 4 px on normal hits, 6 px on counters, 8 px on KO blows.

Decay at render top (`game.js:563`):
```
shake *= 0.85;
const sx = (Math.random() - 0.5) * shake;
const sy = (Math.random() - 0.5) * shake;
ctx.save();
ctx.translate(sx, sy);
```
Restore at end of `render()`: `ctx.restore();`

**Tuning.** 4 px peak = one font-cell. Random per-frame jitter (not a sine wave) reads as "impact reverberation," not "screen wobble." Decay 0.85/frame at 60 fps ≈ 100 ms — fades within the hitstop window so movement resumes on a settled camera.

**Edge cases.**
- Walls and HP bars get shaken too — acceptable, sells "the world reacted." If HUD wobble reads wrong, wrap only the gameplay draw block (lines 567-643) inside the translate (+2 LOC).
- `update()` returns early when `hitstop > 0` (line 173-176). The set at line ~419 runs *after* hit logic on the same frame `hitstop` is set, so the shake fires once and decays through the freeze.
- Multiple hits in quick succession: last set wins (replaces, doesn't add). Acceptable; rare.

**LOC.** ~6 (1 module field, 1 set, 1 decay, 3 save/translate/restore).

---

## LOC tally

| # | Pick | LOC |
|---|---|---|
| 1 | Off-balance lean (whiffLock + landingLag) | ~10 |
| 2 | K.O. fade + game-end hold | ~8 |
| 3 | Camera shake on hit | ~6 |
| | **Total** | **~24** |

Under the 25-LOC cap with ~1 LOC slack. If rounds (~35 LOC) overruns, drop pick 3 — it's the most independent and re-pickable any iter. If rounds comes in lean, fold **subpixel snap** (~3 LOC: `Math.round(player.x)` / `Math.round(opponent.x)` at the four draw call sites) as the four-iter-deferred slack pick.

---

## Coordinate with rounds (orchestrator note)

1. **`gameEndHold` is the round-pause primitive.** Rounds should reuse this field/pattern rather than introducing a parallel timer. Strongly recommend the rounds spec author look at pick 2 part B before naming their own field.
2. **`.fading-in` CSS class is reusable.** Any "Round 1 to YOU" intermediate overlay can use it. One rule, multiple consumers.
3. **Shake on KO is amplified for free.** Since shake derives from `hitstop` and the hit code already doubles `hitstop` on KO blows, the round-deciding hit shakes 2× as hard with no rounds-specific code.

---

## Deferred (still on the table)

- **Subpixel render snap** (~3 LOC) — four iters deferred, still cheap. Promote to slack-filler this iter if rounds is lean; else iter-8.
- **HP bar tail darken** (`#8a4a4a` → `#5a2a2a`) — three iters deferred. Slack-tier.
- **Crouch animation richness** (~22 LOC) — eats budget alone. Better in a quiet iter with no keystone.
- **Patrol direction easing** — opponent now in non-idle states (windup/feint/recovery) frequently enough that patrol-flip is rarely visible. Drop indefinitely; revisit only if playtest flags.
- **Uppercut visual richness** — reads fine; pure paint-job. Future quiet-iter.
- **Knockback magnitude bump** (20px → 30-40px) — tuning. Land rounds first, playtest, tune in iter-8.
