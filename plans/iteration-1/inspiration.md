# Iteration 1 — Inspiration & Gameplay Ideas

## Current state (1 sentence)
A 1v1 ASCII canvas sparring game where a stick player walks, jumps, and head-punches a horizontally-patrolling, non-attacking opponent until its HP bar empties and a K.O. screen shows punches thrown vs. landed.

## Proposals

### 1. Telegraphed Opponent Jab — inspired by Mike Tyson's Punch-Out!!
- Trigger: When the player is within ~120 px horizontally of the opponent, the opponent enters a "wind-up" state for ~30 frames (visualized by swapping its arms-glyph from `/|\` to a pulled-back `>|<` and tinting yellow), then fires a fixed-reach jab on frame 30.
- Mechanic: During the jab's active frames, if the player's head box overlaps the opponent's fist-reach, the player loses HP (introduce `player.hp` / `player.maxHp`, mirror the existing HP bar on the left). The jab has its own `punchCooldown` so attacks alternate.
- Why it fits: Punch-Out!! is built entirely on readable telegraphs — the new state is just a timer + glyph swap, and it instantly turns the opponent from a punching bag into an actual sparring partner. No new art needed; the ASCII glyph itself becomes the tell.
- Implementation sketch: Add `opponent.windup`, `opponent.jabTimer`, `opponent.jabCooldown`, and `player.hp`. In `update()`, gate state transitions by horizontal distance. In `drawStick()`, accept a `windup` opt to render the alternate arm glyph. Mirror `drawHpBar()` for the player. ~30 LOC.

### 2. Block / Guard Stance — inspired by Street Fighter II
- Trigger: Holding `S` or `↓` (or `K`) puts the player in a block stance: movement halts, `facing` locks, and the torso glyph changes to `/X\` (crossed arms).
- Mechanic: While blocking, incoming opponent jabs deal 1 chip damage instead of full damage and produce no hit-flash on the player. Blocking cannot be combined with punching (cooldown shared) and cannot be done mid-air, so the player must commit.
- Why it fits: SFII's hold-back-to-block is the canonical risk/reward in 2D fighters — it gives the player a defensive verb to pair with the new opponent jab from proposal #1, turning the loop into read-and-react. The `/X\` glyph reads instantly in monospace.
- Implementation sketch: Add `player.blocking` boolean computed each frame from key state. Skip the movement/punch branches when true. In the jab-hit check (proposal #1), branch on `player.blocking` to apply chip damage. Extend `drawStick()` with a `blocking` opt. ~15 LOC.

### 3. Body Blow vs. Head Punch — inspired by Punch-Out!! (high/low targeting)
- Trigger: `J` / `Space` punches at head height as today; pressing `K` (or holding `↓` while punching) throws a body blow at torso height (`fistY = player.y - 30`).
- Mechanic: Head punches deal current damage but only land when the opponent isn't ducking; body blows deal slightly less (5) but bypass a future block (proposal #2 chip rule already covers this — body blows ignore block entirely for full damage). This sets up genuine mix-ups even with a passive opponent.
- Why it fits: High/low targeting is the smallest possible mechanic that adds real decision depth, and it costs only one extra hitbox check. ASCII renders the difference clearly: jab arms at head row vs. waist row.
- Implementation sketch: Generalize the punch block in `update()` into a function taking `targetY` and `damage`. Add a second `keysPressed.has('k')` branch. Add a body-punch glyph row in `drawStick()` (`====` rendered at `y - 30` instead of `y - 50`). ~20 LOC.

### 4. Dash / Step-In — inspired by Divekick (commit-to-distance movement)
- Trigger: Double-tap `A`/`D` (or `←`/`→`) within 12 frames triggers a 16-frame dash in that direction at 2.2x walk speed; ends early on wall or punch input.
- Mechanic: During dash frames, the player cannot turn around and cannot block, but a punch thrown during the last 6 dash frames deals +50% damage (a "dash-in jab") and has +20 px reach. Adds a closing tool against a patrolling/jabbing opponent.
- Why it fits: Divekick's whole identity is "movement is commitment." A dash-jab gives the player an offensive option that pairs naturally with the opponent's telegraph window — close the gap during wind-up, punish on release.
- Implementation sketch: Track `lastTapDir`, `lastTapFrame`, `dashTimer`. Read taps from `keysPressed`. Override `vx` while `dashTimer > 0`. In the punch hitbox check, scale `damage` and `PUNCH_REACH` when `dashTimer < 6 && dashTimer > 0`. ~25 LOC.

### 5. Combo Counter & Stagger — inspired by One Finger Death Punch
- Trigger: Each landed punch within 60 frames of the previous one increments `player.combo`; missing a punch or being hit resets it to 0.
- Mechanic: At combo >= 3, the opponent enters a 45-frame "stagger" state — patrol stops, no jabs fire, and any landed punch deals double damage. The HUD shows `x3 COMBO` next to the HP bar in the same green-yellow-red palette already used.
- Why it fits: OFDP rewards rhythm and accuracy with escalating payoff, which directly addresses the current loop's lack of feedback beyond a hit-flash. It's pure timer math — no new collisions, no new entities — and it gives the K.O. screen a meaningful new stat to display.
- Implementation sketch: Add `player.combo`, `player.lastHitFrame` (use a global `frame` counter incremented in `update()`), `opponent.stagger`. Update on hit/miss in the existing punch block. Multiply damage when `opponent.stagger > 0`. Render combo text near the HP bar in `drawHpBar()`. Add `combo` peak to the K.O. stats string. ~25 LOC.
