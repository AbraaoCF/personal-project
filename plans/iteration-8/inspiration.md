# Iteration 8 — Inspiration

State after iter 7: best-of-3 rounds, K.O. fade + gameEndHold, camera shake, off-balance lean, landingLag-crouch fix. Opponent variance = jab + 30% feint. Player verbs = walk/jump/crouch + standing punch + crouch-uppercut + divepunch, with whiffLock and landingLag commit-costs. Match spans up to 3 rounds.

The iter-7 keystone (rounds) doubled match length but did NOT add new opponent moves. **By round 2 the player has read the full feint+jab rhythm.** Iter 8's job is to break that rhythm — variance the opponent across rounds and across attempts within a round. Heavy jab is the explicit default candidate; the rest of the picks compose around it (color budget, telegraph budget, animation budget) so the synthesizer can pick 2–3 without stepping on each other.

---

## Pick 1 — Heavy jab (the deferred default)

**Inspiration.** Punch-Out!! (NES) — Glass Joe's basic jab vs. King Hippo's heavy hook. Same archetype, different windup, different reward. Also Street Fighter II's light/heavy distinction on the same input slot.

**Trigger.** When opponent decides to attack (current line 312 condition: `dxToPlayer < JAB_RANGE && dxToPlayer > CONTACT_RANGE && stateTimer<=0`), roll first for **heavy** at ~25%, then for **feint** at 30% of the remaining 75%. Heavy and feint are mutually exclusive — heavy commits to landing a real hit, feint commits to faking one. Final mix per attack: ~25% heavy, ~22.5% feint, ~52.5% normal jab. Player can't read which is coming until the windup color appears.

**Mechanic.**
- New opponent state field: `attackKind ∈ {'normal','heavy'}`. Set during windup-entry alongside `feintRoll`.
- Heavy windup = **0.85 s** (vs normal 0.5 s) → strictly slower, more punishable on read.
- Heavy active = 0.14 s (slightly longer hitbox), reach 36 px (vs 32), damage **18** (vs 12).
- Heavy recovery = **0.55 s** (vs 0.35) → bigger counter window if dodged.
- Heavy CANNOT feint — the feint roll is gated on `attackKind === 'normal'`. Heavy is the "I am committing" branch; feint is the "I am pretending" branch. They are deliberately exclusive verbs.

**Telegraph.** The synthesis already uses `#ffcc66` (yellow `!`) for normal windup and `#776` flicker `!`/`?` for feint. Heavy gets:
- Windup `!!` glyph (two-bang) in **`#ff5555`** (clear red, distinct from yellow and gray-flicker).
- Slight backward shoulder-cock — opponent x nudges +2 px toward back-foot during the first 0.4 s of windup, then snaps forward into the active frame. ~3 LOC if reused from existing windup branch in `update`.

**Reward / tradeoff.**
- Player who reads red and crouches: dodges heavy → 0.55 s recovery window for a counter-uppercut at 1.5× = 15 dmg (vs 12 on normal). Heavy is the highest-value counter target in the game.
- Player who reads red and **jumps + dives**: divepunch at 1.3× = ~12 dmg, plus the heavy whiffs entirely.
- Player who eats a heavy at full HP loses 18% — round-deciding swing. Encourages reading windup color, not just spamming through pressure.
- Heavy vs feint asymmetry: feint punishes pre-emptive crouches, heavy punishes ignoring windups. The 25/22.5/52.5 mix means every attack matters.

**LOC.** ~28. Constants block (5), state field init in `resetRound` (1), kind-roll in windup-entry (3), windup branch reads `attackKind` to pick params (4), active branch reads kind for damage/reach (4), recovery branch reads kind for duration (2), render telegraph branch (~6), shoulder-cock nudge (3).

**Compose-with.** Camera shake auto-doubles on 18-dmg hits via `hitstop * 2` for K.O. (already wired). Lean primitive applies to opponent-windup naturally — but opponent doesn't lean today; not adding here.

---

## Pick 2 — Step-back jab (spatial variance)

**Inspiration.** Virtua Fighter / Tekken — the back-step-into-jab as a spacing tool. Also Punch-Out!! Bald Bull's lean-back tell vs. lean-forward charge.

**Trigger.** When opponent enters windup, **5% of normal-jab rolls** become step-back jabs (i.e. ~2.6% of all attacks — rare flavor, not a core variance). Mutually exclusive with feint and heavy. Gate: `attackKind === 'normal' && !feintRoll && Math.random() < 0.05`.

**Mechanic.**
- New windup sub-state or flag `stepBack: true`.
- During the first 0.25 s of windup, opponent's `x` shifts away from the player by 24 px total (smooth, eased: `dx = -dirToPlayer * 24 * (t/0.25)`).
- Remaining windup, active, recovery proceed as normal jab — but from the new x position.
- The step extends total windup feel without changing windup time: player who pre-emptively dashes in expecting a normal jab finds themselves now OUT of jab range and mid-commit.

**Reward / tradeoff.**
- Punishes: pre-emptive forward dashes during yellow `!`. Player learns to wait for active frame before committing.
- Reward path: player who STAYS still and catches the jab on its arrival eats a clean dodge-window (jab now reaches from 24 px farther → may even whiff entirely if player crouches at extreme range).
- Spatial variance unsticks the rhythm. Today, jab range is fixed at 60 px → player memorizes one footsie distance. Step-back makes that distance fluid.

**Telegraph.** No new color; reuses yellow `!`. The visual cue is **the step itself** — opponent visibly slides back during windup, which reads as commitment-tell. Optional `<-` glyph above head during the 0.25 s slide (~2 LOC). Without it, the slide alone is the read.

**LOC.** ~18. Flag init (1), 5% roll in windup-entry (2), slide tick in windup branch (5), patrolDir clamp (1), edge-case bounds clamp `ARENA_LEFT/RIGHT` (2), optional glyph (~3), reset-round zero (1). Few interactions with feint/heavy — sits cleanly inside the normal-jab branch.

**Compose-with.** Heavy jab and step-back are independent rolls — could in principle co-exist (a heavy that also steps back) but spec excludes that for clarity. Synthesizer can ship both this iter.

---

## Pick 3 — Crouch chamber pose + uppercut dust kick

**Inspiration.** Street Fighter II — Ryu's crouching stance (knee bent forward, fist coiled at hip) and Shoryuken launch dust. Iter-7 deferred this; it's pure render polish that composes with the lean primitive shipped iter 7.

**Trigger.** Always-on render whenever `player.crouching` or `player.uppercutTimer > 0`.

**Mechanic.**
- **Chamber pose** (replaces flat `_O_ / /|\ / / \` crouch glyph at lines 535–539):
  - Head dipped: `_O_` y -28 (was -30) — 2 px lower.
  - Torso coiled: `(|)` instead of `/|\` at y -12, suggesting fist-at-hip silhouette.
  - Bent knees: `/_\` instead of `/ \` at y +4 — wider stance.
  - **Knee-bob breathing** when stationary-crouching (no uppercut active): `breathBob = Math.sin(performance.now() / 240) * 1.5` added to head y. Gentle 1.5 px oscillation, ~4 Hz period — reads as held breath.
- **Dust kick** on uppercut launch (first 0.08 s of `uppercutTimer`):
  - At feet `y + 4`, draw three glyphs that fade out: ` * ` / ` . ` / `.  .` cycling.
  - Symmetric around player.x at offsets ±10 and 0; alpha = `uppercutTimer / UPPER_DURATION` clamped to [0, 1].
  - Reads as ground-burst from the launch.

**Reward.**
- Visual richness — the move that already does 1.5× counter dmg now LOOKS like a commitment.
- Composes with iter-7 lean: lean is hands-off-balance, chamber is hands-coiled-on-purpose. Same body-language vocabulary, opposite intent.
- Knee-bob during the 'wait-and-counter' game (player crouches under jab) gives texture to held positions — addresses iter-7 deferred 'static crouch read'.

**LOC.** ~22. Chamber pose rewrite in crouch branch (5), breathBob calc + apply (3), uppercut dust render in main render block (~10), constants for offsets/alpha decay (2), wiring uppercutTimer through drawStick opts if needed (2).

**Compose-with.** None — pure render. Doesn't touch state machine. Safe slot in any iter, even alongside heavy jab.

---

## Pick 4 — Adaptive opponent (between-round difficulty)

**Inspiration.** Punch-Out!! "Title Defense" mode — every fighter reappears with tightened windups after the first match. Also Street Fighter II arcade — the AI clearly ramps after losing. Best-of-3 rounds creates the perfect hook for this; iter 7 set up the structure but didn't use it.

**Trigger.** At round-end, in the K.O. branch (synthesis lines 459–467), tag the loser. **If opponent lost the round, opponent gets +1 difficulty stack.** No symmetric ramp for the player — this is "the opponent learns from the player," not a rubber-band.

**Mechanic.**
- New module-state: `let opponentDifficulty = 0;` (0, 1, or 2 across a best-of-3).
- Reset to 0 in `resetMatch` (NOT `resetRound`).
- After `opponentWins++` in the K.O. branch: leave difficulty alone. After `playerWins++`: `opponentDifficulty++`.
- Difficulty applies as **multipliers/offsets** read at windup-entry:
  - **Stack 1 (lost round 1):** windup time × 0.85 (faster reaction, harder to read), feint chance 30% → 38% (more mind games), heavy chance 25% → 28%.
  - **Stack 2 (lost rounds 1+2, sudden death):** windup × 0.75, feint 45%, heavy 32%.
- These stack only if player is winning; if opponent wins round 1, difficulty stays 0 — easier rounds as a small "you're losing, let up slightly" reverse-rubber-band, or just neutral. Spec: **don't decay** — difficulty is monotonic non-decreasing per match.

**Reward / tradeoff.**
- Match-length variance feels purposeful: round 3 isn't just "more of round 1," it's measurably harder. Encourages closing out in 2–0.
- Player who 2–0s the opponent never sees stack 2 — hidden depth on 2–1 / 1–2 outcomes only.
- Rubber-band is one-directional → doesn't punish skill, only resists snowballs.
- Composes with heavy jab + step-back: at stack 2, the 32% heavy + 45% feint mix means only 23% of attacks are vanilla jabs — completely different read-game from round 1.

**Telegraph.** One small UI cue: the round-pip color for the opponent **shifts red** as their stack increases. `o o` → `o *` (one stack lit) → `* *` (two stacks). Or use the existing pip with a tint: at stack 1, opponent pip text color goes from `#ccc` to `#dc8c6c`; at stack 2, `#dc6c6c`. ~3 LOC where pips draw.

**LOC.** ~18. State field (1), reset in `resetMatch` only (1), increment in K.O. branch (2), apply at windup-entry — multiply `JAB_WINDUP`, scale roll thresholds (~6), pip color tint (~3), guards/clamps (2), constants for the stack tables (~3).

**Compose-with.** Heavy jab — adaptive multiplies heavy chance too (small numbers, but compounds the read challenge). Step-back — could let step-back chance scale too (5% → 8% → 12%) for ~2 extra LOC. Knockback magnitude — leave alone; only attack timing/prob scales.

---

## Pick 5 — Counter-stun on perfect uppercut

**Inspiration.** Street Fighter — counter-hit stun state. Mortal Kombat — "STUNNED" floating-text on a hard read. Also Punch-Out!! star-punch reward. Iter 5 added crouch-uppercut + counter-bonus, but the counter is purely numerical (×1.5 dmg). The player has no visual confirmation that they read the windup correctly beyond the HP bar tick.

**Trigger.** When the player lands an uppercut on opponent during `state === 'windup'` (not just recovery — windup uppercut = "I read the tell"). Currently the code only counts `state === 'recovery'` as counter (line 374). Add `'windup'` to the counter set for uppercut specifically — the crouch-under-jab fantasy.

**Mechanic.**
- On windup-uppercut counter: opponent enters new state `'stunned'`, `stateTimer = 0.6 s`.
- During stun: opponent renders with three rotating glyphs above head (`* . o`) — classic dazed-stars motif, ~3 chars cycling at 8 Hz.
- Stun blocks all opponent attack rolls; on stun-end, opponent goes to `'idle'` with cooldown.
- During stun, a **second** standing-punch from the player lands as a clean hit (no whiffLock if opp is in stun-band) → enables a 15 (uppercut counter) + 8 (free standing) = 23-dmg combo as the read-payoff. Single-hit only — second hit ends stun via the existing `state='idle'` transition on hit.

**Reward / tradeoff.**
- Tells the player "you nailed the read" with audiovisual punch beyond the number tick.
- The stun → free-punch combo is the highest-skill payoff in the game (~23 dmg, nearly a quarter of HP). Must crouch BEFORE windup color resolves (since uppercut takes ~0.2 s to launch, you have to commit during the 0.5 s normal windup or 0.85 s heavy windup).
- Vs heavy jab: heavy windup is 0.85 s → easier read window → bigger reward (heavy uppercut counter: 1.5 × 10 = 15, then stun, then 8 free = 23). Heavy is now the highest-EV target in the game IF you can read red.
- Doesn't break feint logic: feint exits windup at 0.6 × windup time → uppercut launched on a feint windup will MISS (opp now in 'feint' state, hurtbox shifts) — feint correctly punishes pre-emptive uppercut.

**Telegraph.** Stun glyph `* . o` cycling above opponent head. Reuses the `!` rendering site (line 667) — drop in glyph cycle on `state === 'stunned'`.

**LOC.** ~16. New state branch in opp state-machine (2), `'windup'` added to uppercut counter check (1 LOC change), stun-glyph render branch (~5), stun-state transition on second hit (already happens via `state='idle'` at line 378 — verify), reset-round handles via existing state init (0), constants (2), edge-case: stun cleared on knockback wall-clamp (1).

**Compose-with.** Heavy jab — heavy + counter-stun is the strongest combo target. Crouch chamber pose — chamber pose now visually justifies the read commitment. Adaptive — stun timer could shorten with difficulty stack (0.6 → 0.5 → 0.4) for ~2 LOC, making the combo harder to extend in round 3.

---

## Iter-8 picks — synthesizer guidance

**Default keystone:** Pick 1 (heavy jab) — the explicitly-deferred default. ~28 LOC. Adds the second opponent attack archetype the game has been missing since iter 4.

**Strongest co-pick:** Pick 4 (adaptive opponent) — directly leverages the iter-7 rounds keystone, which currently has no in-match consequence beyond the pip count. ~18 LOC. Tunes heavy/feint mix automatically across rounds.

**Best polish slot:** Pick 3 (crouch chamber + dust) — pure render, ~22 LOC, zero state-machine risk. Composes with iter-7 lean as a body-language pair.

**Skip if budget tight:** Pick 2 (step-back jab) — flavor variance, low frequency (2.6% of attacks). Defer to iter 9 when the player has internalized heavy-vs-normal first.

**Speculative high-skill:** Pick 5 (counter-stun) — ~16 LOC but rewires the counter system. Defer if heavy jab is shipped this iter; player needs a round to learn heavy reads before stun-combos become legible. Pair with heavy in iter 9 for the matched payoff.

**Recommended iter-8 trio:** Pick 1 + Pick 4 + Pick 3 (~68 LOC total). Heavy jab adds the move; adaptive applies it differently across rounds; chamber pose makes the read-commit fantasy visible. Each touches an independent subsystem (opponent state machine / match flow / player render) → safe to land together.
