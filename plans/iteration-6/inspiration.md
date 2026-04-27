# Iteration 6 — Inspiration

State after iter 5: ground-game has two attack verbs (standing punch, crouch-uppercut), a 4-state opponent jab loop, mutual whiff penalties, and crouch as a dodge. Open seams: jump still dead, opponent rhythm metronomic, single-encounter match, crouch+J visual is one glyph, opponent never advances on the player. Below: 5 candidates, classic-fighter inspirations, ASCII-friendly, each ≤50 LOC.

---

## 1. Divepunch — jump rehab (Divekick / Street Fighter II air-tatsu)

**Inspiring game.** *Divekick* (entire game built around one airborne button); secondarily the dive-kick / J.HK overheads in *SF2* and *Tekken*'s deep jump-ins. The whole genre treats jump as a commitment that pays in the right read.

**Trigger.** Player presses J while `!player.onGround && player.vy >= 0` (descending arc only — rising jumps cannot dive, prevents instant-launch abuse).

**Mechanic.** Body locks into a diagonal `>>`/`<<` glyph and gains a downward-forward velocity boost (`vy = +540`, `vx = facing * 320`, override knockback channel). An active hitbox lives at `player.x + facing*30, player.y - 30` for the whole descent. On contact: 9 dmg, mid-arc knockback, hitstop. On ground touchdown without contact: lands in a 0.4 s `landingLag` state — `whiffLock`-equivalent but explicit so it can be drawn (slumped pose `_O_` / `\|/`).

**Reward.** A second punish line that defeats opponent windup *vertically*: opponent's jab band is `y - 65 to y - 5`, a diving fist at `y - 30` enters the opponent's head from above, outside the jab's reach band (`====` is at `y - 50`, dive enters at the top edge — geometrically over it). Cost: if opponent is in `recovery` already, dive's the wrong tool (slow) — it pays vs `windup` and `idle`, not vs already-punishable states. Mix-up: ground vs air punish.

**Why now.** Iter-5 explicitly deferred this and called jump a "trap button." Two iterations of buildup (whiffLock, knockback channel) make the dive's commitment cost legible. Jump rehabilitation is the single largest gameplay-surface unlock available.

**Sharpened spec.** `vy >= 0` gate is critical — without it the player jumps and immediately dives, stripping the air-time commitment. Pair `landingLag` with the existing whiffLock channel (reuse, don't duplicate). Hit-band X tolerance ~28 (mirror UPPER_HIT_TOL). Damage 9 — between standing 8 and uppercut 10, so dive isn't a strict upgrade.

**LOC.** ~30. Fits if it's the only big change.

---

## 2. Opponent feint — break metronomic rhythm (Dhalsim / Tekken stance bait)

**Inspiring game.** *Street Fighter*'s Dhalsim feint-stretches; *Tekken*'s sidestep-into-cancel; *Virtua Fighter*'s bait stances. Feint = telegraph that doesn't commit, forcing the player to defend or whiff their own counter.

**Trigger.** When opponent enters `windup`, roll a 30% chance. If feint: after `JAB_WINDUP * 0.6` (~0.3 s, before active would normally start), abort to a new `feint` state for 0.4 s, then return to `idle` with full `JAB_COOLDOWN`.

**Mechanic.** During `feint`: opponent draws the wound-up pose with a *flicker* (alternate `<|\` and `/|\` every 0.1 s) and the `!` glyph dims to grey. No hitbox. On exit, opponent is in `idle` (not `recovery`) — so the player's reflexive crouch-uppercut (which targets recovery) hits *idle*: still legal but no 1.5× counter bonus. Reading "this is a feint" rewards *not* committing.

**Reward.** Two new player skills: (a) read flicker as feint, hold ground; (b) on flicker→idle exit, opponent is briefly mid-stance and a fast standing punch lands at standard damage. Player who panic-counters during feint eats their own whiffLock.

**Why now.** Opponent loop is currently a 1.2 s metronome — "wait, dodge, punish" repeat. Iter-5 synthesis explicitly tags rhythm predictability as the next problem. 30% feint rate keeps actual jabs as the dominant threat (still 70%) — feint is variance, not the new norm.

**LOC.** ~18. Two state additions, small render branch, one rng roll.

---

## 3. Best-of-3 rounds with brief intermission (Street Fighter / Mortal Kombat)

**Inspiring game.** *Street Fighter II* and every fighter since uses best-of-3 to convert single-mistake losses into recoverable matches. *Mortal Kombat*'s "Round 1 — FIGHT!" pacing.

**Trigger.** Match starts; `match.round = 1`, `match.playerWins = 0`, `match.oppWins = 0`. On K.O., instead of going to `STATE.OVER`, increment winner's count, set `state = STATE.INTERMISSION` for 1.5 s, then `resetMatch()` for round 2/3. First to 2 wins flips `STATE.OVER` with cumulative stats. Round number drawn top-center.

**Mechanic.** Intermission renders both fighters frozen in their final pose with a centered `ROUND 2` (or `MATCH POINT`) overlay. Round 3 (if reached) is sudden-death — both fighters start with 60 HP instead of 100 to compress the climax.

**Reward.** A bad opening read is no longer terminal. Players who learn the loop mid-match get to apply it. Tension curve becomes per-round, then per-match. Opens space for cumulative stats — punches landed across rounds. Adds variance: a 100-HP first-round whiff now costs 33% of match progress, not 100%.

**Why now.** Iter-5 ships polished single-encounter combat. Without rounds, mastery curve flatlines after one K.O. Rounds turn the existing depth into a *journey*. Plus: removes the "opponent never advances" sting — over three rounds the opponent's patrol drift averages to neutral, and round 3's compressed HP forces both sides to engage.

**LOC.** ~35. New STATE constant, intermission timer, round counters in match object, one render overlay block, one resetRound vs resetMatch split.

---

## 4. Crouch animation richness — visible knee-bend, fist chamber, dust kick (Street Fighter Ryu crouch)

**Inspiring game.** *Street Fighter II* Ryu/Ken crouches: knees flex visibly, lead arm chambers low, occasional dust-kick puff on transition. *Garou*'s crouch breath. Stance reads as *coiled*, not just "shorter."

**Trigger.** `player.crouching === true`. Pure render-side, no gameplay change.

**Mechanic.** Three additions to the crouch pose (currently `_O_` / `/|\` / `/ \`):
- **Coiled-arm pose:** swap `/|\` for `/J\` (or `/]\`, suggesting fist chambered at hip) when `uppercutTimer === 0`. When `uppercutTimer > 0`, swap to `/^\` for the brief telegraph frame before the `*` glyph rises.
- **Knee bob:** while crouching idle, oscillate the legs row `y` offset by `Math.sin(performance.now() / 200) * 1.5` — sub-pixel breathing so the figure isn't statue-still.
- **Crouch transition dust:** on the frame `crouching` flips false→true, draw `. .` at `player.y + 8` for 0.15 s, fading. Same on uppercut launch (suggests push-off).

**Reward.** Crouch becomes a *verb you see*, not a Y-coordinate change. Uppercut chamber pose telegraphs commitment 1 frame before `*` — a tiny readability gift to spectators (and to the player learning the timing). Iter-4/5 added the keystone counter pattern; this iter sells it visually.

**Why now.** Iter-5 synthesis flagged crouch+J's visual as just `*`. Whole crouch system has dramatic gameplay weight (counter target, uppercut launcher, hurtbox dropper) and minimal visual weight. Asymmetry between mechanical depth and rendered fidelity is now the largest in the game.

**LOC.** ~22. All in `drawStick` and a transition-detect timer on the player.

---

## 5. Opponent advancing pressure — close-distance walk (SF2 Bison / KOF Iori)

**Inspiring game.** *SF2 Bison* walks forward steadily when out of range — patrol turns into pursuit at threshold. *KOF*'s Iori advances after a whiffed counter to deny breathing room. *Punch-Out!!* opponents step in after the player retreats.

**Trigger.** When `opponent.state === 'idle'` AND `dx > JAB_RANGE` (out of jab trigger) AND `opponent.stateTimer <= 0` (post-cooldown), opponent abandons `patrolDir` and walks toward player at `OPPONENT_SPEED * 0.6` (~58 px/s — slower than player's 192).

**Mechanic.** New idle sub-behavior: `if (dx > JAB_RANGE) patrolDir = (player.x < opponent.x ? -1 : 1)` overriding the wall-based patrol direction. Patrol min/max bounds remain as safety clamps, but no longer dictate direction outside `dx > JAB_RANGE`. Once `dx <= JAB_RANGE` the windup trigger fires as today — pursuit naturally hands off to the existing combat loop.

**Reward.** Player can no longer camp arena edges. Retreat is no longer free — opponent closes the gap, eats some of the player's counter-prep time. Pairs with feint (#2) and rounds (#3) to make matches feel like bouts instead of stationary metronomes. Walls (currently aesthetic) become tactical: corner the opponent and pursuit becomes 0 closure, but cornering yourself accelerates incoming pressure.

**Why now.** Iter-5 synthesis listed "opponent never moves toward the player except in idle patrol" as an explicit gap. This is the smallest possible patch to that gap. Pursuit speed at 0.6× player speed preserves player as the faster mover; opponent stays a *threat to read*, not a *threat to outrun*.

**LOC.** ~12. One conditional inside the existing idle branch; reuses `OPPONENT_SPEED`.

---

## Reconsiderations called out by orchestrator

**Jump rehab is overdue.** Candidate #1 (divepunch). The design-shaped hole has been visible since iter-3. Two iterations of supporting infrastructure (whiffLock, knockback channel, hitstop scaling) now make the airborne commitment legible. If iter-6 ships only one big thing, ship this.

**Metronomic rhythm.** Candidate #2 (feint) at ~18 LOC is the cheapest variance injection in the design space. A 30% feint rate is well-studied in real fighters as the sweet spot — high enough to matter, low enough to keep jabs the read.

**No comeback / no win-variance / single-encounter.** Candidate #3 (rounds) addresses all three: best-of-3 is comeback-shaped, round 3 sudden-death is variance, and the structure is multi-encounter by definition. The 1.5 s intermission slot is also where future flourishes live (round-win quotes, round-number callouts, kombo stats).

**Opponent never advances.** Candidate #5 (pursuit) — the smallest, most surgical fix. Reuses constants and existing state machine; no new state needed.

**Crouch+J visual is just `*`.** Candidate #4 (crouch animation) — purely visual, but the crouch system carries enormous gameplay weight now and deserves matching fidelity. The chamber-pose / dust-kick / knee-bob trio is the reading the gameplay already earned.

---

## Pairing notes for synthesis

- **Divepunch + feint** is a high-leverage pair: feint introduces variance the player needs new tools to handle, dive provides the air-option that makes feint-reading a real choice. ~48 LOC together.
- **Rounds + pursuit** is the "match-shape" pair: rounds give the journey, pursuit gives the within-round tension. ~47 LOC together. Both safer LOC-wise than the dive.
- **Crouch animation** is independent of all four — pure render polish, fits any combo as the LOC slack-filler.
- Avoid pairing **divepunch + rounds** in one iteration: best-of-3 with an undertested new attack verb amplifies tuning risk across three rounds instead of one.
- **Pursuit + feint** would compound into "opponent advances and lies about jabbing" — possibly too much variance at once; defer one if both are tempting.
