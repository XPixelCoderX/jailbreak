# LOST SUPPRESSION

A browser-based 3D first-person psychological horror game built with **TypeScript**, **Three.js**, and **Vite**.

The player wakes inside an abandoned research and containment facility after the **Suppression Event**. Power is unstable, security doors are sealed, terminals contain partial records of the disaster, and a stalking entity called **The Suppressor** moves through the dark.

The project is fully playable in a modern desktop browser and includes:

- First-person movement with pointer lock, sprint, crouch, stamina, head bob, and camera motion
- Flashlight gameplay with dynamic spotlight, volumetric beam, shadows, battery drain, flicker, and pickups
- Interactions via raycasting
- A modular interconnected facility with multiple themed zones
- Inventory, documents, terminals, keypad access, objectives, pause menu, credits, settings, subtitles, and save/load slots
- Procedural fallback audio generated with the Web Audio API
- Enemy AI with patrol, investigate, search, chase, ambush, and hearing behavior
- Environmental horror events, security camera feeds, hiding spots, and an ending choice

## Graphics & RTX-style rendering

The renderer is built around a modular post-processing pipeline that approximates
ray-traced effects in WebGL (no hardware RT is required, and none is claimed):

- **RTX quality tier** — screen-space reflections (SSR), image-based lighting
  probes (PMREM environment), planar reflections on flooded floors, GTAO ambient
  occlusion, bloom and volumetric light shafts
- **Six quality levels**: LOW, MEDIUM, HIGH, ULTRA, EXTREME, RTX — each seeds
  shadow quality, lighting quality, reflection quality, post-processing, bloom,
  ambient occlusion and volumetric toggles that remain individually adjustable
- Dynamic point-light shadow budget (up to 2048px PCF-soft maps) plus a
  shadow-casting player proxy for realistic player shadows
- Per-fixture lighting brains: fluorescent restrike stutter, faulty dropouts,
  random power failures with emergency-red surges, synchronized light shafts,
  glowing tubes and spark bursts
- Environment detail: pipes with collars, cable runs, electrical panels with
  blinking indicators, vents, warning placards, rust/grunge decals, broken
  equipment, instanced debris, steam plumes, water leaks, and drifting dust
- Cinematic grade: subtle chromatic aberration, film grain, vignette, black
  lift, and screen-warp distortion pulses during supernatural events

## Requirements

- Node.js 20+
- npm 10+
- Modern desktop browser with WebGL support

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Vite will start a local development server.

## Production build

```bash
npm run build
npm run preview
```

The production output is generated in:

```text
/dist
```

## Controls

```text
WASD       Move
Mouse      Look
SHIFT      Sprint
CTRL       Crouch
E          Interact
F          Flashlight
TAB        Inventory
ESC        Pause
F3         Debug Overlay
F4         Enemy Debug
F5         Debug Teleport
```

Graphics options live under **Settings → Graphics**: quality preset (6 tiers),
shadow / lighting / reflection quality, post-processing, bloom, ambient
occlusion, volumetric lights, fog density, view distance, resolution scaling,
anti-aliasing and brightness.

Controls can be rebound from the **Settings → Controls** menu.

## Game flow

1. Wake in the Intake Chamber.
2. Find the flashlight.
3. Reach the lobby.
4. Restore power from Maintenance.
5. Access the Research terminal.
6. Unlock the archive blast door.
7. Enter the Underground and find the Level 3 keycard.
8. Reach the Suppression Core.
9. Restore all lattice switches.
10. Choose an ending path.

## Project structure

```text
lost-suppression/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
├── src/
│   ├── main.ts
│   ├── styles.css
│   ├── types.ts
│   ├── audio/
│   │   └── AudioManager.ts
│   ├── config/
│   │   └── constants.ts
│   ├── core/
│   │   ├── InputManager.ts
│   │   └── SaveManager.ts
│   ├── enemies/
│   │   └── Suppressor.ts
│   ├── game/
│   │   ├── Game.ts
│   │   ├── GameLoop.ts
│   │   └── GameState.ts
│   ├── interaction/
│   │   └── Interactable.ts
│   ├── inventory/
│   │   └── Inventory.ts
│   ├── player/
│   │   └── Player.ts
│   ├── systems/
│   │   └── EventSystem.ts
│   ├── ui/
│   │   └── UIManager.ts
│   └── world/
│       └── Facility.ts
└── dist/ (after build)
```

## Major systems

### Game orchestration
`src/game/Game.ts`
- Bootstraps the renderer, scene, world, UI, save/load, events, and game states
- Manages transitions between menu, intro, gameplay, pause, settings, death, and ending
- Coordinates interaction, objectives, terminal actions, puzzle progress, and rendering

### Facility generation
`src/world/Facility.ts`
- Builds the environment procedurally with rooms, corridors, doors, props, lights, terminals, cameras, documents, hiding spots, and puzzle objects
- Provides collision, zone detection, line-of-sight checks, and simple node-based pathfinding support
- Includes zero external content requirements by generating geometry and fallback textures procedurally

### Player controller
`src/player/Player.ts`
- Handles mouse look, movement, sprinting, crouching, stamina, view motion, flashlight state, and fear metrics
- Drives battery drain, flicker behavior, footstep pacing, and survival health state

### Interaction system
`src/interaction/Interactable.ts`
- Provides reusable interactable types for doors, pickups, documents, breakers, fuse boxes, terminals, keypads, hiding spots, and core switches

### Enemy AI
`src/enemies/Suppressor.ts`
- Uses a simple state machine with:
  - `IDLE`
  - `PATROL`
  - `INVESTIGATE`
  - `HEAR_PLAYER`
  - `SEARCH`
  - `CHASE`
  - `LOSE_TARGET`
  - `RETURN`
  - `AMBUSH`
- Reacts to noise, visibility, hiding, and power progression

### Audio system
`src/audio/AudioManager.ts`
- Uses the Web Audio API for fallback procedural sound generation
- Controls ambient drone, music layers, footsteps, door sounds, UI feedback, breathing, heartbeat, radio bursts, and entity presence
- Supports audio categories:
  - Master
  - Music
  - SFX
  - Ambient
  - Voice
  - UI

### UI
`src/ui/UIManager.ts`
- Builds the menu, HUD, subtitles, pause screen, credits, inventory, objectives, settings, save/load panel, document view, terminal interface, keypad, death screen, and ending screen
- Includes the persistent external links required by the project brief

### Saving
`src/core/SaveManager.ts`
- Uses `localStorage`
- Stores save slots, settings, inventory, player state, objective state, puzzle state, door state, and world interaction state

## Procedural / fallback asset system

This project is designed to remain playable without custom imported assets.

Fallback strategy:
- **Models** → generated using Three.js primitive geometry
- **Textures** → generated with `CanvasTexture`
- **SFX / ambience** → generated with the Web Audio API

That means the game still functions even if no external art pipeline has been added yet.

## How to add rooms

The facility layout is created inside `src/world/Facility.ts`.

To add a room:
1. Add a new `createRoom(...)` call inside `buildFacility()`.
2. Give it a zone id and dimensions.
3. Add openings to connect it to adjacent spaces.
4. Decorate it with helper methods or new prop builders.
5. Add navigation nodes in `createNodes()` so the enemy can route through it.
6. Optionally add lights, cameras, terminals, documents, or pickups.

## How to add enemies

The active enemy is implemented in `src/enemies/Suppressor.ts`.

To add a new enemy type:
1. Create a new class in `src/enemies/`.
2. Give it geometry, update logic, and state transitions.
3. Add hearing / sight logic as needed.
4. Instantiate and update it from `src/game/Game.ts`.
5. Add new patrol nodes or area logic in `Facility.ts`.

## How to add puzzles

Current puzzle logic is coordinated in `src/game/Game.ts` with world hooks from `Interactable.ts` and `Facility.ts`.

To add another puzzle:
1. Create a new interactable or terminal action.
2. Add a boolean or structured entry to `PuzzleState` in `src/types.ts`.
3. Update save/load logic automatically through the shared save object.
4. Gate doors, lights, or objectives based on the new state.

## How to modify settings

Default settings live in:

```text
src/config/constants.ts
```

Persistent settings are loaded and saved by:

```text
src/core/SaveManager.ts
```

UI wiring lives in:

```text
src/ui/UIManager.ts
```

Renderer, audio, and input application happens in:

```text
src/game/Game.ts
```

## How to change external links

External links are defined centrally in:

```ts
export const LINKS = {
  website: 'https://pay.pcsmp.net',
  discord: 'https://discord.gg/jqPt6a563h'
};
```

File:

```text
src/config/constants.ts
```

## Credits

```text
LOST SUPPRESSION

GAME MADE BY
EDWIN SHEEN

SFX & AUDIO BY
EDWIN SHEEN
```

## External links confirmation

The required persistent links are implemented in the **main menu footer**:

- **WEBSITE** → `https://pay.pcsmp.net`
- **DISCORD** → `https://discord.gg/jqPt6a563h`

They are rendered as actual clickable anchor elements.
