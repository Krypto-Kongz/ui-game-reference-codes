# Dream Canvas: a drawing board for Meta Horizon Worlds (Noesis UI + TypeScript)

A drawing board for Horizon Worlds with themes, animated brushes, 2D physics on your ink, and a
3D world board you can paint on in VR or with touch or a mouse.

```
horizon-drawing-board/
├── scripts/
│   ├── DrawingBoardShared.ts   events, types, color helpers (imported; attach to nothing)
│   ├── DrawingBoardUI.ts       Noesis panel logic (execution mode: Shared)
│   └── DrawingBoardWorld.ts    3D board: VR / touch drawing, glowing dots, physics (execution mode: Local)
└── noesis/
    ├── DrawingBoard.xaml       the Noesis page (core Noesis features only)
    └── ShaderFX.snippets.xaml  optional paste-in blocks for Noesis shader brushes/effects
```

## Features

**13 themes.** Each one restyles every panel, button, shadow, gradient, grid and palette. A theme
change plays a ripple animation.

| Theme | Style |
|---|---|
| Soft Clay, Midnight Clay, Candy Pastel | Neumorphism (dual light/dark extruded shadows) |
| Frosted Aurora, Liquid Glass, Ocean Deep, Aurora Borealis | Glassmorphism (translucent gradient panels, edge highlights and a top sheen over drifting color blobs) |
| Neon Cyberpunk, Molten Lava | Neon glow (glowing shadows and edges) |
| Vaporwave, Sunset Gradient | Gradient |
| Retro Arcade | Pixel / CRT (hard offset shadows, scanlines) |
| Minimal Mono | Minimal |

**15 tools**

| Brushes | What it does |
|---|---|
| Pen, Marker | Solid ink, and a translucent wide marker |
| Neon | White-hot core with a colored bloom |
| RGB | Rainbow gradient that keeps flowing across the canvas |
| Flow | Liquid gradient in theme colors with a travelling highlight |
| Aurora | Swaying, rotating green/cyan/violet curtains |
| Pulse | Ink that breathes (glow and opacity) |
| Spray | Airbrush speckles |
| Stardust | Ink that sheds twinkling star particles |
| Physics Pen | When you let go, the stroke becomes a rigid body that falls, tumbles, bounces and stacks. Throw it by moving the pointer as you release. |
| Line, Rect, Ellipse | Marching-ants preview. With the Physics Pen as the active brush, shapes become bodies too (an ellipse rolls like a wheel). |
| Eraser | Erases with a puff of particles |
| Grab & Throw | Grab any ink and fling it. Loose strokes become bodies when grabbed. |

**Effects:** Glow, a Stardust trail on any brush, Mirror x2/x4 and an 8-way kaleidoscope (with
animated guides), Grid, Vignette, CRT scanlines with a rolling band, and Bloom −/+.

**Canvas actions**
- **Undo**.
- **Clear:** the ink falls off the screen.
- **Gravity:** everything on the canvas becomes physics.
- **Shake.**
- **Explode:** pushes ink outward from the pointer.
- **Freeze.**

Moving the pointer quickly through falling ink knocks it around.

**3D world board.** Press **3D Board** to claim it. Only one artist holds it at a time, and
everyone else sees who has it.
- **VR:** hold either trigger and paint in the air. Glowing dots follow the controller tip, with
  haptic ticks and an optional trail.
- **Mobile / desktop:** the camera frames the board (focused interaction), and you touch or
  click-drag on it.
- **Beam:** prints your 2D drawing onto the 3D board.
- **Drop:** the art falls as real physics objects.
- **Burst:** blows the art apart. **Hold:** freezes it in place.
- **Undo 3D**, **Wipe 3D**, **Leave**.
- Rainbow, Flow, Aurora and Pulse dots keep animating their color and glow in the world.

**Animation everywhere.** Panels slide in, buttons scale on hover and squish when pressed, the
selected tool has a spinning gradient ring and a breathing glow, swatches pop, and toasts appear
for actions. The background blobs drift, the title shimmers, the logo and color ring spin, and a
cursor ring follows the pointer. Clicks spawn ripples and particle bursts, Clear and Explode shake
the screen, and the panels minimize to a floating orb.

## Setup in the desktop editor

### 1. Scripts
In the **Scripts** panel, create three scripts with these exact names and paste in the files:

| Script | Execution mode | Attach to |
|---|---|---|
| `DrawingBoardShared` | (any) | nothing, it is imported |
| `DrawingBoardUI` | **Shared** | the Noesis UI gizmo |
| `DrawingBoardWorld` | **Local** | the 3D board entity |

The scripts import each other as `from 'DrawingBoardShared'`. If your project resolves local
modules with relative paths, change that to `'./DrawingBoardShared'`.

### 2. Noesis page
1. Open **Noesis Studio**, create a page, and replace its XAML with `noesis/DrawingBoard.xaml`.
   Save and sync it to your world.
2. Add a **Noesis UI** gizmo, select the page, and make it interactive. Use a screen overlay for
   a full-screen drawing app, or a world panel for a wall-mounted tablet.
3. A 16:9 panel works best. The layout is tuned for 1600×900 and stretches to other sizes. The
   script reads the real size from `SizeChanged`; `canvasWidth` and `canvasHeight` are the
   fallback.
4. Attach `DrawingBoardUI`.

### 3. 3D board (optional but recommended)
1. **Board:** a flat cube, for example scale 4 × 2.25 × 0.05. Its forward (blue) axis must point
   toward the players. Attach `DrawingBoardWorld` and set `boardWidth` / `boardHeight` to match
   the scale.
2. **Ink dots:** make one small sphere (scale about 0.05):
   - a material that supports **tint** and **brightness** (an unlit or emissive style looks best)
   - **Motion: Interactive**, **Interaction: Physics**, collidable

   Duplicate it 150–300 times, put all copies under one empty object (e.g. `InkPool`) placed
   below the board, and drag `InkPool` into the board's **dotPool** property.
3. **Optional gizmos:**
   - **trail:** a Trail gizmo; set its color, width and length in the editor
   - **sparkFx:** a short Particle gizmo burst
   - **drawSfx** and **popSfx:** Sound gizmos
4. Drag the board entity into the `DrawingBoardUI` **worldBoard** property.

### 4. Optional shader pack
`noesis/ShaderFX.snippets.xaml` adds:
- Noesis shader brushes: an animated plasma background, waves, and a conic rainbow ring
- shader effects: Pixelate, Chromatic Aberration, Pinch (a bulge that follows the cursor), Noise,
  Saturation

The UI script already drives them through a **Shader FX** chip with six presets: Off, Pixel Art,
Glitch, Bulge, Noir and Dream. Paste the blocks one at a time at the `SHADER-FX SLOT` comments
and test each one. These classes come from Noesis's application framework, so check in Noesis
Studio that your Horizon build includes them.

## Properties

**DrawingBoardUI**

| Prop | Default | Meaning |
|---|---|---|
| worldBoard | – | the 3D board entity (enables the world features) |
| canvasWidth / canvasHeight | 1600 / 900 | fallback canvas size |
| floorInset | 150 | the physics floor sits this far above the bottom (above the dock) |
| startTheme | 2 | index into the theme list (2 = Frosted Aurora) |
| reassignLists | false | fallback if per-item updates don't refresh (see below) |

**DrawingBoardWorld**

| Prop | Default | Meaning |
|---|---|---|
| boardWidth / boardHeight | 4 / 2.25 | board size in meters |
| cameraDistance | 3.4 | mobile/desktop camera distance from the board |
| dotSpacing | 0.035 | meters between dots, scaled by brush size |
| vrReach | 0.1 | brush-tip distance in front of the controller |
| dotMinScale / dotMaxScale | 0.025 / 0.16 | dot size range |
| glowBrightness | 8 | material brightness for glowing brushes |
| animatedPerTick | 24 | color/glow updates per frame (network budget) |

## How it works

- **UI.** Everything visual lives in XAML. The script only writes fields on the Noesis data
  context (`theme.*`, `ui.*`, the `segs` pool, and so on), and Noesis renders and animates the
  rest on each player's device. The UI is local to each player, so the 2D canvas costs no
  network traffic.
- **Ink.** Strokes are a fixed pool of 420 line segments in a ring buffer: the oldest ink is
  recycled. Four ItemsControls draw the same pool:
  - a bloom layer with one shared BlurEffect
  - a crisp layer
  - two pulse layers
- **Animated brushes.** Each animated brush (rainbow, flow, aurora) is a single gradient brush
  with a storyboard-driven transform. Every stroke of that kind samples it, so the color flows
  through the ink for free.
- **2D physics.** Impulse-based rigid bodies with rotation, friction and restitution. Bodies
  collide with each other through sampled vertices, then with the floor and walls, and go to
  sleep when they come to rest.
- **World.** Claiming sends a network event. The server transfers ownership of the board, the
  dot pool and the gizmos to that player. Their client then runs the Local script:
  - VR uses trigger input
  - mobile and desktop use focused-interaction rays intersected with the board plane

  Dots are pooled entities: they are moved, tinted and brightened while drawing, then unlocked
  with gravity when dropped.

## Untested parts and troubleshooting

This was written against the Horizon TypeScript and Noesis APIs. It type-checks and its logic
was run headless against API stubs. It has **not** been run inside the Horizon editor yet. These
are the parts most likely to need a small adjustment:

- **Pointer event payload.** `onDown`, `onMove` and `onUp` expect `args.position.{x,y}` and also
  accept a few other shapes. If drawing appears offset, the coordinates are probably relative to a
  different element. Log `args` once to check.
- **Collection updates.** The ink and particle pools are updated by changing fields on items. If
  strokes don't appear, set `reassignLists = true`.
- **Touch.** The canvas listens to both mouse and touch events, and duplicate presses are
  ignored.
- **Focused-interaction exit.** If the player leaves focused interaction with the built-in X
  button, the board is released only if your build exposes `OnPlayerExitedFocusedInteraction`.
  Otherwise use **Leave**.
- **Physics properties.** `PhysicalEntity.locked`, `gravityEnabled` and `style.brightness` are
  wrapped in try/catch. If a dot material ignores brightness, use an emissive material.
- **Performance.** For Quest, reduce `SEG_POOL`, `PARTICLES` and the Bloom value, and lower
  `animatedPerTick` for crowded worlds.
