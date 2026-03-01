# Prompt Log — ASCII Windstrike

## Project Overview
**ASCII Windstrike** is a browser-based ASCII game controlled via real-time hand tracking. The player generates a "wind field" using hand motion detected by MediaPipe, blowing ASCII sand particles down a first-person perspective lane to damage approaching enemies. Enemies advance toward the player, vary in size and behavior, and deal damage if not defeated in time.

AI was used as a **development assistant** to help with planning, system architecture, math reasoning, debugging, and iterative refinement. All final code was reviewed, modified, and understood by me.


---

## AI Tools Used
- **ChatGPT (GPT-5.x)** — early planning, architecture reasoning, initial implementation
- **Claude Sonnet 4.5 (via claude.ai)** — feature development, debugging, UI iteration, documentation
- **MediaPipe Hands** — browser-based hand tracking (runtime library)

---

## Development Timeline & AI Usage

### 1. Planning & System Structure (≈45 minutes)
**Goal:** Define a clear, explainable plan for implementing my game idea before writing code.

Instead of asking AI to generate a full project, I asked for **a structured plan** describing:
- how hand tracking should map to game mechanics
- what files and systems should exist
- how to keep the project understandable and interview-ready

**Prompts:**
> "Give me a plan for how you would implement this game with features."

> "How should I structure a project that separates hand tracking, game logic, and rendering?"
> "Provide me the base template files for an MVP of this"

**Outcome:**
- Decided on a three-layer structure:
  - `handWind.ts` → input sensing and interpretation
  - `main.ts` → orchestration and wiring
  - `game.ts` → simulation and rendering
- Defined responsibilities before coding
- Avoided gesture classification in favor of continuous velocity-based input

**Human work:**
- Chose which parts of the plan to keep vs simplify
- Adjusted scope to fit a 5–6 hour project
- Ensured every system would be explainable in a technical interview

---

### 2. Project Scaffolding & Architecture (≈45 minutes)
**Goal:** Set up the project according to the plan.


**Outcome:**
- Created a clean folder structure:
  - `src/main.ts` for DOM + loop control
  - `src/wind/handWind.ts` for MediaPipe logic
  - `src/wind/game.ts` for all gameplay and rendering
- Established clear data flow: input → wind → simulation → render

**Human work:**
- Manually created files and imports
- Resolved TypeScript module and path issues
- Ensured no MediaPipe-specific code appears inside `game.ts`

---

### 3. Hand Tracking → Wind Mapping (≈1 hour)
**Goal:** Make hand motion feel continuous and expressive rather than binary.

**Prompts:**
> "How do I map hand velocity to a force vector without gesture classification?"
> "Map sand movement x and y to finger tracking "
> "How can depth motion act like a pumping mechanic?"
> "Map two fingers and distance between as spread and narrowing of sand particles "

**Outcome:**
- Used frame-to-frame hand velocity instead of poses
- Mapped lateral velocity → sideways wind
- Mapped depth velocity → forward pumping force
- Added deadzones, smoothing, and clamping
- Tracked finger spread to control sand width and damage

**Human work:**
- Tuned constants for feel
- Debugged inverted axes and depth direction
- Iterated until hand motion felt intuitive and responsive

---

### 4. Particle System & Perspective Rendering (≈2 hours)
**Goal:** Create a convincing 3D illusion using only ASCII characters.

**Prompts :**
> "How can I fake a first-person perspective in a 2D canvas?"

> "How should size and opacity change near the horizon?"


**Outcome:**
- Simulated particles in world space (x, z)
- Projected into screen space with perspective math
- Added horizon line and converging lane grid
- Scaled particle size and opacity by depth
- Recycled particles at far depth to create continuous flow

**Human work:**
- Wrote and adjusted projection math
- Fixed mismatches between grid and particle paths
- Tuned visual falloff so depth reads clearly

---

### 5. Enemy System & Combat Loop (≈1.25 hours)
**Goal:** Introduce pressure and timing to the game.

**Prompt examples:**
> "How can enemies move toward the player and damage them if not killed?"

> "How do I make enemy size affect both visuals and collision?"

**Outcome:**
- Enemies spawn far away and advance toward the camera
- Player has HP that drains when enemies reach attack range
- Enemy differences are primarily size-based
- Enemy glyph size scales with perspective and type
- Collision radius is derived from the actual rendered glyph size

**Human work:**
- Integrated collision math with rendering math
- Tuned damage to feel fair
- Ensured collider matches what the player visually sees
- Preserved consistent ASCII face style across enemies

---

### 6. UI, Debugging, and Polish (≈45 minutes)
**Goal:** Make the project presentable and robust.

**Prompt examples:**
> "Why is my canvas resizing when I add a border?"

> "How should I structure debug overlays for real-time systems?"

**Outcome:**
- Fixed CSS layout issues
- Added HUD for score, enemy HP, and player HP
- Added debug overlay for wind vectors and spread
- Added pause and game-over overlays

**Human work:**
- Debugged layout manually
- Decided which debug data was useful
- Ensured UI clarity without clutter

---

### 7. Enemy Variety & Wave System (≈1 hour) — Claude session
**Goal:** Make the game feel like it escalates and has meaningful enemy variety rather than one enemy type respawning endlessly.

I described the existing codebase to Claude and asked for help planning and implementing:

> "I want enemy variety / behaviors, wave / progression system, better HUD design, enemy visuals. Rank these areas by priority: 1. New gameplay features, 2. Visual / UI polish, 3. Code quality / refactoring"

**Outcome:**
- 6 enemy types added: `small`, `normal`, `big`, `dodger` (strafes), `rusher` (accelerates), `shielded` (requires focused beam)
- Per-type `EnemyBehavior` struct with strafe, rush, and shield logic
- `buildWaves()` system with 5 handcrafted waves and endless repeat mode
- `spawnPending()` scheduler with per-enemy delays within each wave
- Multi-line ASCII enemy bodies (`enemyBody()`) that scale with depth
- Per-enemy HP bars, shield glow ellipse, and color-coded enemy types

**Human work:**
- Reviewed all generated code before applying
- Caught that enemy faces in the start screen didn't match `enemyFace()` output
- Caught that `big` enemy was using hit-flash face `(ಠ益ಠ)` as its idle face instead of `(ಠ_ಠ)`
- Directed which enemy types to include and what their behaviors should feel like

---

### 8. Bug Fix: Continuous Enemy Damage (≈20 minutes) — Claude session
**Goal:** Fix a critical gameplay bug I found during playtesting.

I identified the bug myself through play:

> "it seems like after enemies pass bottom of screen they're doing damage to the player continuously"

The old code pinned enemies at `enemyAttackZ` forever and called `playerHP -= enemyDps * dt` every frame indefinitely.

**Outcome:**
- Enemies now deal a single burst of damage on contact (big=25, normal/others=15, small=10) and are immediately removed
- No more HP drain loop

**Human work:**
- Identified the bug through playtesting, not code review
- Verified the fix made logical sense before applying

---

### 9. Damage & Collision Tuning (≈30 minutes) — Claude session
**Goal:** Make combat feel balanced — sand shouldn't melt enemies instantly.

I drove all the tuning decisions myself, using Claude to explain which values to change:

> "i feel like the beam of sand is doing too much damage"

> "tell me what lines to change and why instead of this copy and paste"

> "how do i make the overall damage of the sand particles smaller"

**Outcome:**
- Damage per particle reduced from `Math.round(1 + (1 - spread) * 4)` to `0.3 + (1 - spread) * 0.4`
- Collision radii halved across all enemy types to better match glyph visuals

**Human work:**
- All final values chosen by me based on feel during playtesting
- Explicitly asked for explanations rather than just new files, so I understood what I was changing

---

### 10. Wave HP Scaling (≈20 minutes) — Claude session
**Goal:** Make later waves harder by increasing enemy HP.

> "do the enemies hp scale with wave?"

After Claude explained the approach, I reviewed the generated code and caught a bug:

> "wait is this correct [pasting code where hpScale was defined but the configs still had hardcoded values]"

**Outcome:**
- `makeEnemy()` now accepts `waveIndex` and applies `hpScale = 1 + waveIndex * 0.15`
- `spawnPending()` passes `this.waveIndex` to the factory

**Human work:**
- Caught that `hpScale` was computed but never used — the fix hadn't actually been applied
- Verified the corrected version before applying

---

### 11. HUD Redesign & Overlap Fixes (≈45 minutes) — Claude session
**Goal:** Make the HUD readable and non-overlapping.

**Human work:**
- fixed overlapping values myself with understanding from claude

---

### 12. Start Screen & Panel Hiding (≈45 minutes) — Claude session
**Goal:** Give the game a proper entry point and clean up the panel so it's not overwhelming before the camera starts.

I designed the UX flow:

> "i want to add a start screen with directions and instructions before the game actually starts — replaces the game canvas until started — click Start Camera, you should make the start camera button glow so that the player knows to click it to start"

> "i also don't want the left hand panel besides for the camera to show until the camera is turned on and the game is started"

**Outcome:**
- Start screen with title, how-to-play steps, enemy reference, and animated CTA arrow
- Start Camera button pulses with yellow glow animation
- Panel hides sensitivity slider, debug, legend, and tips until `game-started` class is added
- Canvas hidden with `display:none` until camera starts

**Human work:**
- Caught that generated `index.html` never included the `panel-extras` wrapper div even though the CSS was correct. 
- Caught an HTML parse error: `&#益;` is not a valid numeric character reference. Asked for plain Unicode instead.
- Directed the exact information to show on the start screen

---

### 13. Sound Effects & Music (≈45 minutes) — Claude session
**Goal:** Add audio feedback and background music using only the Web Audio API — no files.

> "Wave start sound, Enemy death sound, Game over sound, Enemy reaches you / damage sound"

> "what vibe do you want for the music? → Chiptune / retro melody"

**Outcome:**
- `sounds.ts` created with all effects synthesized via Web Audio API oscillators
- Chiptune music: 4-bar looping melody (square wave) + bass line (triangle wave) at 140 BPM
- `startMusic()` / `stopMusic()` with smooth gain fade-out
- `playGameOver()` automatically calls `stopMusic()`
- Music pauses when game is paused — I caught this wasn't included and added it

**Human work:**
- Chose which sound events to include
- Decided volume levels felt right after reviewing the gain values
- Directed the music pause behavior


### 14. Quality of Life & Final Polish (≈20 minutes) — Claude session

- **Press R to restart** — added to `keydown` handler, game over overlay updated to show the shortcut
- **Enemy spawn rate** — asked Claude to explain the delay system so I could tune values myself in `buildWaves()`
- **CSS border** — I wrote the CSS myself with two bugs (missing `solid`, missing `px` unit); Claude identified them and I applied the fix

---

## Code Attribution Summary

| File | Written by | Notes |
|------|-----------|-------|
| `handWind.ts` | Collaborative | Entirely self-written. MediaPipe integration, velocity math, spread calibration, tuned values and debugged camera direction to game direction |
| `game.ts` (original) | Me | Core game loop, physics, projection math, single-enemy version. |
| `game.ts` (current) | Collaborative | Wave system, enemy types/behaviors, HUD, sounds wired in with Claude. All reviewed and debugged by me. |
| `main.ts` | collaborative | Game loop, overlay drawing. Start screen + music wiring added with Claude. template from ChatGPT|
| `sounds.ts` | Claude | Reviewed and tuned by me (volume levels, sound selection, pause behavior). |
| `index.html` | Collaborative | Original structure by me, start screen and panel-extras added with Claude. |
| `style.css` | Collaborative | Base layout by me, start screen styles and glow animations added with Claude. |


