# Iteration 9 — Smoothness Review

## Context recap

Iter-8 pivoted to sparring sim: opponent shield rhythm (`game.js:287-294`) + cat/mouse evasion (`game.js:296-315`). Iter-9 keystone is **wall-run / 4-surface arena (~50 LOC)** — a big mechanic that will rewrite the surface-relative position of every fighter and very likely touch `drawStick`, the shake `ctx.translate` block (`game.js:582-583`), arena bounds (`game.js:7-9`), and the gravity branch (`game.js:233-247`).

That means smoothness budget for iter-9 should be **deletion-tier or 1-LOC tunings only** — no work that touches the surface-orientation primitives wall-run will own. Reviewer reports 7 candidates; I rank them by (cost, isolation from wall-run, composition with the new shield indicator + evasion).

---

## Ranking

| # | Item | LOC | Conflicts with wall-run? | Composes with shield/evasion? | Pick? |
|---|---|---|---|---|---|
| 1 | HP bar tail darken (`'#8a4a4a'` → `'#5a2a2a'`) | 1 | No — HUD, screen-space | Neutral | **YES** |
| 2 | Shield indicator pulse on transition | ~6 | No — uses `opponent.stateTimer` already there | **Strong** — directly polishes the new (+) glyph | **YES** |
| 3 | Evasion patrolDir easing | ~5 | No — pure horizontal | **Strong** — softens the iter-8 instant-flip artifact | **YES** |
| 4 | Subpixel render snap | ~3 | **Risky** — wall-run rewrites draw-call coordinate space | Neutral | DEFER |
| 5 | Intermission overlay fade-in | ~6 | No, but eats budget | Neutral | DEFER |
| 6 | Knockback magnitude (`SHIELD_BOUNCE`) | 1 | No | Composes with shield | DEFER (playtest first) |
| 7 | Shake decay timing | ~1 | **Risky** — wall-run will reorient the shake translate | Neutral | DEFER |

**Recommended budget: ~12 LOC** for picks 1–3. Bank the remaining ~13 LOC of the cap for wall-run's polish needs (it almost always overruns).

---

## Pick 1 — HP bar tail darken (1 LOC)

**Where.** `game.js:559` — the `damageTailHp` fill in `drawHpBar`.

**Current.**
```
ctx.fillStyle = '#8a4a4a';
```

**Change.**
```
ctx.fillStyle = '#5a2a2a';
```

**Why now.** Four-iter defer. The tail at `#8a4a4a` reads as a *second* health color (muted red, almost like a yellow-red gradient stop). At `#5a2a2a` it reads as "drained, recently-occupied space" — the eye separates *current HP* (live red/yellow/green at line 564) from *recently lost HP* (dark stain) cleanly. Critical now because the sparring loop has the player landing big bursts on the open window — the tail drains visibly during each open-window punish, and a darker tail makes that burst legible.

**Composition.** Zero. This is a HUD color; wall-run can't touch it.

**Edge cases.** None. Same alpha, same rect, same lerp. The contrast against `#333` background (line 556) stays comfortable.

---

## Pick 2 — Shield indicator pulse on transition (~6 LOC)

**Where.** `game.js:619-625` — the `(+)` shield render block.

**Why now.** The iter-8 reviewer's spec landed the indicator as a static glyph (`game.js:624`). Static `(+)` gives the player **no anticipatory cue**: shield drops in 0.6 s and you find out by punching and getting through. A pulse driven by `opponent.stateTimer` shows the player how close the open window is — without adding a single new state variable.

**Fix sketch.** Replace the existing block at `game.js:619-625` with:
```
if (opponent.state === 'shielding') {
  // Pulse: gentle breath while protected; rapid flash in last 0.25 s before dropping.
  const closing = opponent.stateTimer < 0.25;
  const phase = closing
    ? Math.sin(performance.now() / 40)        // ~25 Hz urgency flicker
    : Math.sin(performance.now() / 200) * 0.3; // slow breath
  const alpha = 0.55 + 0.45 * Math.max(0, phase);
  ctx.fillStyle = `rgba(136, 204, 238, ${alpha.toFixed(3)})`;
  ctx.font = 'bold 18px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('(+)', opponent.x, opponent.y - 78);
}
```

LOC: ~6 net (3 added, glyph + font + position lines unchanged). The two `Math.sin` reads are the load-bearing ones — `closing` switches frequency on the last quarter-second of the protected window.

**Why this composition wins.** It uses the **already-present** `opponent.stateTimer` (`game.js:287-294`) — no new field, no new tick path, no new constants. The pulse turns a static glyph into a metronome the player can read at a glance, which directly addresses the cat/mouse loop's "when do I commit?" question.

**Composition with wall-run.** None. The render block is a fixed offset above `opponent.y`; wall-run will reposition `opponent.x/y` and the indicator follows for free. (If wall-run rotates the opponent on a side wall, the indicator floats next to the head in screen space — still legible. Adjust offset only if it occludes.)

**Edge cases.**
- `performance.now()` is monotonic; pulse continues across hitstop. That's fine — visual cue should not freeze with gameplay (the urgency reads as "the window is approaching").
- KO frame: opponent.hp ≤ 0 path doesn't gate `state === 'shielding'`. After KO the shield rhythm continues to tick (`game.js:288-294`). Indicator may flash on a downed opponent. If playtest hates this, gate with `&& opponent.hp > 0` (+1 LOC).
- Frequency 25 Hz "urgency flicker" is at the edge of comfort; if flicker bothers, raise the divisor (40 → 60 = ~17 Hz). Easy tune.

---

## Pick 3 — Evasion patrolDir easing (~5 LOC)

**Where.** `game.js:296-315` — the cat/mouse evasion / patrol block.

**Why now.** Reviewer flagged this directly: at `game.js:303`, `opponent.patrolDir = fleeDir;` flips the moment the player crosses `EVASION_RANGE`. The opponent's velocity reverses on a single frame — reads as a teleport-direction, not a flee. Compounds with the patrol→flee transition at the same boundary (`game.js:299` vs `game.js:306`) where opponent **speed** also doubles (`OPPONENT_SPEED=96` → `EVASION_SPEED=130`). One frame of full-speed reverse direction is the smoothness regression of iter-8.

**Fix sketch.** Replace the inner movement of the evasion branch (`game.js:299-303`) with a velocity field that lerps toward the desired direction:

Add a field on opponent (init in declaration `game.js:64-75` and `resetRound` `game.js:132-138`):
```
opponent.fleeVx = 0;
```

Replace `game.js:299-303` (evasion branch) with:
```
if (dist < EVASION_RANGE) {
  const targetVx = (dxToPlayer > 0 ? -1 : 1) * EVASION_SPEED;
  opponent.fleeVx += (targetVx - opponent.fleeVx) * (1 - Math.pow(1 - 0.18, dt * 60));
  opponent.x += opponent.fleeVx * dt;
  opponent.patrolDir = opponent.fleeVx < 0 ? -1 : 1;
} else {
  opponent.fleeVx = 0;
  // ...existing patrol step unchanged...
}
```

LOC: ~5 (field decl + reset + 3 inside the branch; the patrol arm is unchanged).

**Tuning.** 0.18 lerp factor at 60 fps ≈ 100 ms to 90 % of target — fast enough to read as "alarmed flee," slow enough that the moment of decision is visible. Use the same `1 - Math.pow(1 - k, dt * 60)` form already at `game.js:208` for player vx, so the easing primitive is consistent across both fighters.

**Composition.**
- With shield indicator (pick 2): when opponent flees AND closes shield, the player sees both an *approaching open window* (pulse rate) and an *opponent winding away* (smooth flee). The two cues now read as one coherent behavior beat.
- With wall-run: pick is pure horizontal velocity. When wall-run lands, this `fleeVx` is exactly the field that needs a surface-tangent rotation — so this pick *seeds the primitive* wall-run will need anyway. If wall-run takes more than 50 LOC, the cleanest cut is to keep `fleeVx` and let wall-run reuse it.

**Edge cases.**
- `fleeVx` doesn't decay in the patrol arm; we hard-zero it. Means crossing back out of `EVASION_RANGE` snaps to patrol speed in one frame. That's *acceptable* — exit from the panic zone is a moment we want to read crisply (the fighter has "regained composure"). If playtest disagrees, swap `opponent.fleeVx = 0` for the same lerp toward 0 (+0 LOC).
- Knockback path (`game.js:280-285`) still gates `if (!knockbackActive)`. fleeVx persists across knockback, which is correct — opponent resumes flee after the bounce.
- `patrolDir` sync at the end of the branch keeps any code that reads it (none currently, but reviewer flagged "for any visual cue" in iter-8 synthesis line 124) functional.

---

## LOC tally

| # | Pick | LOC |
|---|---|---|
| 1 | HP bar tail darken | 1 |
| 2 | Shield indicator pulse | ~6 |
| 3 | Evasion patrolDir easing | ~5 |
| | **Total** | **~12** |

Roughly half the 25-LOC cap. Banking the rest for wall-run's overrun is the explicit recommendation.

---

## Coordinate with wall-run (orchestrator note)

1. **`opponent.fleeVx` (pick 3) is the primitive wall-run will reuse.** When the opponent rotates onto a side wall, the surface-tangent velocity is exactly this field with a basis swap. Don't introduce a parallel `wallVx` — extend `fleeVx` semantically.
2. **The shield indicator (pick 2) is screen-space-positioned via `opponent.x/y`.** When wall-run rotates the opponent, the (+) follows for free. If it occludes the wall, defer a screen-anchored offset to iter-10.
3. **HP bar (pick 1) is HUD; wall-run never touches it.** Free of conflict.

---

## Deferred (still on the table after iter-9)

- **Subpixel render snap** (~3 LOC) — five-iter defer. Hold until wall-run lands; the rotated draw paths will need their own snap pass and doing it before is wasted work.
- **Intermission overlay fade-in** (~6 LOC) — playtest hasn't flagged this hard yet, and 4-surface arena will probably introduce a "round-start" flourish (gravity settle, fighters rotating to new floor) that subsumes it. Defer to iter-10/11.
- **Knockback magnitude tune** (`SHIELD_BOUNCE` 360 → 480 say) — 1 LOC tuning, but coupled to the shield rhythm pacing. Wait for one playtest with the pulse indicator (pick 2) before tuning the bounce — players who can *see* the open window will feel the bounce differently.
- **Shake decay timing** — currently `shake *= 0.85;` at `game.js:579` is frame-dependent (no `dt`). Wall-run will rewrite the translate block; tune shake decay there in the same edit.
- **Crouch animation richness, uppercut visual richness, opponent KO pose** — pure paint-job iters; better filed against a quiet iteration with no big mechanic.
