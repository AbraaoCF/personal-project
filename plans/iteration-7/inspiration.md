# Iteration 7 — Inspiration

State: 5 player verbs (walk, crouch, jump, standing punch, crouch-uppercut, divepunch), 3 opponent verbs (patrol, telegraphed jab, feint). Stand-trades are mutual, whiff is punished, dive is committal, feint forces reads. The combat layer is dense for a single encounter — but **the encounter ends in 1 K.O.** The shape of the match itself is the next axis to push.

Five proposals below, ranked by leverage. Each names a classic 2D fighter, a trigger, a mechanic, a reward, and an LOC estimate. ASCII-friendly; ≤50 LOC each.

---

## 1. Best-of-3 rounds with intermission — *Street Fighter II* (Capcom, 1991)

**Inspiration.** SF2 codified the "two wins to take the match" loop. Round 1 is reconnaissance — you learn the opponent's tendencies. Round 2 is adaptation. Round 3 (the rare reset) is comeback drama. A single K.O. discards everything you learned the moment you learned it; rounds compound the read.

**Trigger.** A K.O. (`player.hp <= 0` or `opponent.hp <= 0`) no longer ends the game. Instead, it ends the **round**. The game ends only when one fighter has won 2 rounds.

**Mechanic.**
- Add `match.playerWins`, `match.opponentWins` (0–2), `match.roundNumber` (1–3).
- After a K.O., enter a new state `STATE.ROUND_END`. Hold for ~1.5s on the K.O. tableau (existing hitstop keeps the death pose readable), then transition to `STATE.INTERMISSION`: a 1.5s overlay reading `ROUND 2  —  X : Y` (player wins : opponent wins) before resetting positions and HP, NOT stats (`punchAttempts`, `punchesLanded` accumulate across the match).
- During intermission, both fighters return to spawn (player x=250, opponent x=640). HP refills. Cooldowns and timers all reset. Knockback and hitstop cleared.
- When `match.playerWins === 2 || match.opponentWins === 2`, fall through to existing `toGameOver()` with match-result text (`MATCH WON 2-1`, etc.).
- Render two pip indicators above each HP bar (`o o` empty → `* o` one win → `* *` match won) so round score is readable at all times.

**Reward.** Every round you survive teaches you the opponent's feint cadence. A round 1 loss is recoverable. Comeback drama returns. Total play time per match doubles or triples without any new combat content — the existing depth gets re-played in light of fresh information.

**Edge cases.** Stat counters (punchesLanded/Attempts) stay match-cumulative — that's the right grain since they describe the player's match-long performance. The K.O. screen's "VICTORY"/"DEFEAT" copy now shows match outcome with round line score. Escape during intermission still goes to menu.

**LOC.** ~35 (state additions ~5, intermission/round-end states ~10, reset routine ~5, render pips ~8, intermission overlay ~7).

---

## 2. Heavy jab — opponent second attack type — *Street Fighter II* (LP/HP) / *Mortal Kombat* (high/low punch)

**Inspiration.** A single attack speed is a metronome the player can solve. SF2's three-button strength split (LP/MP/HP) gave the AI a windup-distribution that the player had to read in real time. Even just a **two-attack distribution** (fast jab vs slow heavy) breaks reflex-counter habits.

**Trigger.** When opponent enters `windup`, roll a **second die** (after the feint roll): 25% chance to upgrade to a **heavy jab**. Mutually exclusive with feint roll (a heavy can't feint — commitment is the point).

**Mechanic.**
- New constants: `HEAVY_CHANCE = 0.25`, `HEAVY_WINDUP = 0.85` (vs JAB_WINDUP 0.5), `HEAVY_DAMAGE = 18` (vs JAB 12), `HEAVY_RECOVERY = 0.55` (vs JAB 0.35 — bigger punish window on whiff).
- New flag `opponent.heavyRoll` set at windup entry. If feint didn't roll true, roll heavy. If heavy, override `stateTimer = HEAVY_WINDUP`.
- During windup with `heavyRoll=true`, render the `!` glyph as a **bigger, redder `!!`** at slow strobe (period ~300ms, not the 100ms feint flicker). Pose stays `<|\` / `/|>` but darker (`#cc6633` color tint via existing flashColor or a one-off fillStyle).
- In active state, if `heavyRoll`, hit-check uses `HEAVY_DAMAGE` and a wider knockback (`540 * facing` instead of 360). Active duration unchanged; the *windup* is what's longer.
- After active, recovery uses `HEAVY_RECOVERY`. Counter-punch on heavy-recovery scales the same 1.5×, so the reward for reading the heavy and dodging is **18 damage** (uppercut counter on heavy recovery → 15 damage; standing-punch counter → 12 damage).

**Reward.** Reading red `!!` and committing to crouch-uppercut nets the biggest single-hit damage swing in the game (15 dmg counter on a 0.55s window). Misreading the red as a regular `!` and reflex-stand-trading eats 18 — punishment scaled to telegraph clarity.

**Edge cases.** Crouch hurtbox drop already dodges JAB — heavy aims at the same band, so crouch dodges heavy too. Acceptable: crouch is the universal "don't read it, just dodge" option, and the heavy's payoff is the longer recovery window for crouch-uppercut. Feint and heavy are ME exclusive (heavy can't feint), so the bait-or-real read is unchanged for the standard 0.5s windup; the long red windup is *always* a real heavy. This is a deliberate clarity choice: variance lives in *fast* attacks, commitment in *slow* ones.

**LOC.** ~28 (constants 4, roll logic 4, state-machine branches 8, render branch 8, heavy active hit-check parameter swap 4).

---

## 3. Crouch/uppercut animation richness — *Street Fighter II Shoryuken* / *Tekken low-kick rise*

**Inspiration.** SF2's Shoryuken has a chambering crouch (the fighter visibly compresses) and a rising fist with motion-line trails. Uppercut weight comes from *anticipation* (crouch holds the energy) and *release* (fist explodes upward). Currently our uppercut is `*` rising — readable but featureless.

**Trigger.** Active during `player.uppercutTimer > 0`, with three render-only sub-poses based on the timer's progress.

**Mechanic.**
- Replace the single `*` glyph with a phased rising-arc render:
  - **Chamber phase (t < 0.15):** crouch pose with a tiny `'` at the player's hip on the facing side (`x + facing * 8, y - 6`). Reads as "loading."
  - **Rise phase (0.15 ≤ t < 0.55):** main rising fist. Replace `*` with `/^|` (facing right) or `|^\` (facing left), positioned along the existing arc. The `^` is the leading knuckle.
  - **Apex phase (t ≥ 0.55):** the fist is at the top of its arc, drawn at `x + facing * 18, y - 80`. Add 2 motion-line glyphs trailing below: `'` and `,` at offset positions, fading out via alpha.
- Add a **dust kick on launch**: at uppercut activation (`t < 0.05`), draw two `,` glyphs at the player's feet (`x - 8, y + 4` and `x + 8, y + 4`) in dim grey. Auto-clears as `uppercutTimer` advances past 0.05.
- Crouch idle pose (without uppercut active) gets a subtle **knee bob**: alternate between `/|\` and `/|<` (or just shift the `|` 1px left/right) over a ~0.6s sin period. Tiny but it sells "coiled, not frozen."

**Reward.** The uppercut feels like a *technique*, not a generic ground attack. The chamber phase gives the player a 0.15s visual confirmation that the input registered (currently uppercut just appears mid-rise — confusing if mistimed). The dust kick anchors the launch to the ground.

**Edge cases.** Already gated by `uppercutTimer > 0` so only fires during the move. The crouch knee-bob during *idle* crouch should NOT fire when `uppercutTimer > 0` — the chamber overrides. Hit-on-uppercut shortens timer to `UPPER_DURATION * 0.4` (existing); the apex phase may not render — fine, the move connected and hitstop sells the impact.

**LOC.** ~22 (chamber pose 4, rise glyph swap 4, apex motion lines 5, dust 4, knee bob 5).

---

## 4. Off-balance lean during whiffLock and landingLag — *Tekken side-step recovery* / *Yie Ar Kung-Fu stagger*

**Inspiration.** When you whiff a punch in Tekken, your fighter visibly pitches forward — committed, exposed, embarrassed. Currently our whiffLock and landingLag are pure-input-locks: the stick figure stands ramrod-straight while frozen. The body should *show* the cost.

**Trigger.** While `player.whiffLock > 0` OR `player.landingLag > 0`, render a leaning body pose biased in the direction of the missed action.

**Mechanic.**
- New parameter `lean` in `drawStick` opts (signed: positive = lean forward toward `facing`, negative = lean back).
- During whiffLock: `lean = facing * (whiffLock / WHIFF_LOCK)` — strongest lean at the start, eases toward 0. Body offset by `lean * 4` px on the head and `lean * 2` on the torso. Specifically:
  - Head: `O` drawn at `x + lean * 4, y - 50`
  - Torso glyph `/|\` drawn at `x + lean * 2, y - 30`
  - Legs unchanged at `x, y - 10` (rooted)
  - Effect: the figure pitches forward like they over-committed the punch.
- During landingLag: `lean = -facing * (landingLag / LANDING_LAG)` — lean **back**, as if the dive whiffed past and they're recovering balance. Same offset math, opposite sign.
- Existing whiffLock/landingLag pose glyphs (`_O_` for landing) replaced by leaning standing pose for whiffLock; landingLag keeps its slumped `_O_` but adds the lean offset.

**Reward.** Whiff feels physical, not just a UI lock. The lean's *direction* tells the player *why* they're stuck (forward = punched air, backward = landed wrong). Reads at a glance during the 0.35s/0.4s lock windows.

**Edge cases.** Hitstop pauses the lean's decay (update is suspended), which is fine — frozen lean during freeze reads as "the moment of recognition." If both whiffLock and landingLag are nonzero (impossible in current code but defensive), prioritize whiffLock direction. Crouch and dive override the lean (they have full poses already). Knockback hit during whiffLock — player gets shoved backward while leaning forward, which reads as "punished mid-recovery." Acceptable, even good.

**LOC.** ~14 (lean parameter 1, head/torso offset math 4, whiffLock lean source 2, landingLag lean source 2, render conditionals 5).

---

## 5. Step-back-then-jab — opponent positional variance — *Karate Champ* / *Virtua Fighter footsies*

**Inspiration.** Karate Champ's CPU would step **back** before lunging — denying the player a stationary target and forcing them to read the *spatial* tell, not just the temporal one. Right now our opponent only varies in time (windup duration via heavy, fake-or-real via feint). Adding *spatial* variance (a step-back during windup) introduces a footsies dimension without a true pursuit AI.

**Trigger.** When opponent enters `windup`, 20% chance (rolled alongside feint/heavy, mutually exclusive with both) to mark this attack as a **step-back jab**.

**Mechanic.**
- New flag `opponent.stepBackRoll`, set at windup entry. Mutually exclusive with `feintRoll` and `heavyRoll`.
- During the first 0.3s of windup, if `stepBackRoll`, opponent's x velocity is `-OPPONENT_SPEED * 1.5 * facing-toward-player` (i.e., walk *away* from the player at 144 px/s). Movement clamped to arena bounds.
- After 0.3s, the step-back ends. Remaining 0.2s of windup is normal (committed pose `<|\`). Active hit-check uses normal JAB params — but the opponent is now ~43 px farther from the player than where they started the windup.
- Render: during the step-back portion, draw a small backward chevron (`<` or `>` opposite facing) below the `!` glyph at `opponent.x, opponent.y - 64`. Reads as "they're moving back."

**Reward.** The player can no longer assume the windup happens *here*. A counter-punch fired toward the windup position whiffs because the opponent stepped out of range. The player must *track* during the windup, not just react at its end. This creates real footsies: do you step forward into the step-back to maintain range, or hold ground and let them whiff out of range? Crouch-dodge still works regardless — the step-back doesn't change the jab's hitbox shape, only its origin point. So the safe option (crouch) stays safe; the *aggressive* option (counter-punch) gets harder.

**Edge cases.** Step-back can hit the arena wall — clamp to ARENA_LEFT/RIGHT, fine. Step-back during knockback (knockback ticks first, then state-machine). Step-back combined with player walking forward: net relative speed = WALK_SPEED + 1.5*OPPONENT_SPEED = 336 px/s closure → player can chase. That's the intended footsies dance. Player-side facing flips if player crosses opponent during the step-back: opponent's "facing toward player" recomputes each frame, so step-back direction inverts mid-step. Acceptable rare oddity; the state stays internally consistent.

**LOC.** ~18 (constants/flags 3, roll logic 3, step-back movement 5, render chevron 5, mutual-exclusion gating 2).

---

## Composition notes for the synthesizer

**Match shape vs combat depth.** #1 (rounds) is the structural backbone for iter-7 — it changes the scale at which all existing depth pays off. Cheapest high-leverage change available.

**Opponent depth.** #2 (heavy) and #5 (step-back) both add an axis to the opponent. They compose: a windup roll picks one of {feint, heavy, step-back, normal} with non-overlapping probabilities. The four-way distribution is the right amount of variance for the player's 5 verbs to cover. Pick **one** of #2 or #5 in iter-7 (probably #2 — damage variance teaches the heavy-uppercut combo, and step-back is a natural follow-up in iter-8 once the player is confident in their counters).

**Animation richness.** #3 (uppercut) and #4 (lean) are pure render polish. #4 is the smaller, more universal win (covers two existing verbs — whiffLock and landingLag — with one primitive). #3 is bigger and more specific. **Both are cheap enough to ship together** if budget allows; together they total ~36 LOC.

**Recommended bundle.** #1 + #2 + #4 = ~77 LOC (rounds + heavy jab + universal lean). Ships the structural change, the opponent-depth bump, and the smoothness primitive that retroactively improves whiffLock and landingLag. Defers #3 (uppercut richness) and #5 (step-back) for iter-8, where step-back can pair with a pursuit AI reconsideration once the player has 3+ rounds of footsies experience to evaluate.

**If budget is tight,** drop #4 and ship #1 + #2 = ~63 LOC. Rounds and heavy jab are the two non-skippable iter-7 picks.
