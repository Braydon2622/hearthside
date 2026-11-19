# Rebuild v2 progress

Brief: `prompts/rebuild-v2.md`. One section per milestone: what was done, what was measured, what is next.

## How things are checked

- `tools/shoot.ps1 -Prefix NN-name` takes the eight standard browser screenshots with headless Edge
  (noon, Fill desktop at noon, sunset, night; each at 1920x1080 and 800x600) into `docs/milestones/`.
  The page now takes `?hour=`, `?fill=1` (a repeatable full desktop) and `?clean=1` (hides the panel) for this.
- `tools/run-app.ps1 [-NoPause]` rebuilds and restarts the real app; `-NoPause` keeps it animating while a window
  covers the desktop, so `tools/measure.ps1` measures the animating cost.
- Real-desktop captures (`tools/deskshot.ps1`) show the owner's file names, so they are kept outside the repo.

### Baseline (before any change)

Measured today, same conditions as every milestone below (real app, 1920x1080, evening so the night-light layer
is on, `HEARTHSIDE_NO_PAUSE`, two 30 s runs): **13.3 to 14.4 % of one core, about 430 MB.** This is above the
9 % / 390 MB quoted in the brief; the difference is most likely the time of day (the night glow canvas adds a
fourth full-screen layer to composite) and whatever else this laptop is doing. The 10 % budget therefore needs
the renderer work planned for milestone 2, not just "no worse than before".

Screenshots: `docs/milestones/00-before-*.png`. These were re-taken during milestone 2 from the original `web/`
(exported from commit 48393f9, served on a second port with a small injected shim for size, time and a seeded
Fill), because headless Edge starts the page smaller than the window and then captures the full window without
a resize, which stretched the canvas against the icons. `tools/shoot.ps1` now pins the page size with `?size=WxH`.
The `01-field-*` shots were taken before that fix and are slightly stretched (about 9 % vertically at 1920x1080).

## Milestone 1: field engine (done)

- New `web/js/field.js`. Every icon rectangle (the whole icon cell, which is the icon picture plus its label area)
  adds a Gaussian hill (sigma 14 px) of open ground; empty district slots and paths add theirs too. Paths are the
  routed cell chains turned into smoothed polylines (Chaikin corner cutting), each adding a ridge of hills.
  The sum is sampled through a fixed two-octave noise warp, thresholded at 0.5, and converted into a signed
  distance with an exact Euclidean distance transform (Felzenszwalb), refined to sub-texel accuracy near the edge
  from the field's slope. Grid: one texel per 4x4 px (481x271 at 1920x1080).
- Channels: clearing distance, distance to the nearest icon (for "quiet near icons" later), district distance, and
  the village amount. Upload: two RGBA16F textures (old and new field).
- The morph runs in the shader: each pixel blends old to new over 0.9 s once the ripple from the drop point reaches
  it (up to 0.9 s away), so the whole change takes about 0.9 to 1.8 s. A new drop mid-morph snapshots the
  on-screen field as the new starting point. Nothing changes during a drag (only on drop), as before.
- Objects tuck away when their foot stands in the clearing (sampled from the new field) as well as by the old
  icon-overlap test, with the same ripple delay as the ground.
- Districts keep their lane grid; their outline is now the district channel of the field.
- `ground.js` moved to WebGL2 (GLSL 300 es) and reads the field textures; the per-cell plaza/path/district
  animation arrays in `world.js` are gone. Per-cell values (`plazaT`, `pathT`, `distT`) remain for walking and
  placing things, derived from the field.
- Label area: the native side already reports each icon as its full IFolderView spacing cell (picture plus label);
  that cell is used as the icon rectangle unchanged, so no Rust change was needed.

Measured: field rebuild 9 ms, whole `world.update` 24 ms with 99 icons (browser, only on change).
Real app: **15.1 to 15.8 % of one core, 451 to 459 MB** (baseline 13.3 to 14.4 %, 430 MB). Per-frame code is
unchanged, so the difference is mostly noise plus the WebGL2 context; the four stacked canvases are the real cost
and go away in milestone 2.

Checked: browser screenshots `01-field-*`; a drag in the browser (clearing shrinks at the old spot, a new plaza and
path open around the drop, trees tuck away along the ripple); Fill desktop gives a district with lots and lanes;
real desktop captured once (kept out of the repo).

## Milestone 2: painterly ground and edges, one renderer (done)

- **One WebGL2 canvas** (`web/js/render.js`) replaces the four stacked canvases. Per frame: the cached ground picture
  is blitted in, every standing thing is drawn as instanced quads from one sprite atlas (one draw call), a
  finishing pass adds cloud shadows and the time of day, and night lights are added on top. Cloud shadows (and
  later the grade) therefore cover sprites and villagers too, not just the ground. The CPU-side per-sprite tint
  copies in `sprites.js` are gone (the tint is a uniform). Villagers, cats, smoke and birds became atlas sprites
  (code-drawn stand-ins are kept for villagers and cats in case the painted ones fail to load).
- **Ground shader** (still painted off-screen, only while the field morphs): the painted grass, dirt and lawn tiles,
  broken up by brush-stroke noise (stretched noise whose direction drifts across the screen) in a warm and a cool
  layer, plus two grass hues drifting at large scale. The cobble tile is mirrored when repeated, which read as a
  kaleidoscope at plaza size, so plazas are now painted Voronoi cobbles (warm mid-tones, lit from the top-left,
  blue-grey gaps) with the cobble tile only lending its brushwork; cobbles go quieter right under icons.
- **Painted rim**: a crisp edge (under 1 px of anti-aliasing, no soft fade) with a brushy wobble, a darker richer
  grass lip outside it, a cool shadow on the plaza floor under the lip on the light side (sampled 5 and 11 px
  toward the light), a faintly lit inner wall on the far side, and a slight darkening all round the inner edge.
  District lots read as raised beds with a dark kerb toward the lanes.
- **Cloud shadows**: a seamless 256x256 noise texture built at start-up, two layers drifting at different speeds,
  darkening and cooling whatever is under them.
- **Frame loop**: the loop now runs on a timer at 20 fps (30 while rearranging) instead of requestAnimationFrame
  with skipped frames. With rAF the browser's 60 Hz frame machinery stays awake for the skipped frames too; the
  switch alone took the real app from about 12 % to 9 %.

Measured (real app, same conditions as the baseline): rAF loop 11.6 to 12.7 %; timer loop **7.9 to 9.0 % of one
core, 443 to 445 MB** animating; **0.8 %** while covered. Memory is about 15 MB above the baseline's 430 MB; to be
revisited (the two full-screen off-screen pictures are 16 MB; the old four canvases cost about the same, so this
needs a careful A/B at the end rather than a guess).

Checked: `02-ground-*` screenshots; the rim and inner shadow at 1:1 crops; drag and morph still fine; night lights
and the district render through the new pipeline.

## Milestone 3: unified lighting and colour grade (done)

- **One light, from the top-left; every shadow drawn by the engine.** The painted sprites have no cast shadow on
  their background; the baked shadows were the ellipses the code painted into each sprite canvas (in `fromImage`
  and every placeholder) and the dark blob under each villager. All of those are gone. Each instance now carries
  the height it stands; the renderer draws every sprite again as its own silhouette, blurred by reading a
  lower-detail mip level of the atlas (bias 2.2), offset by height x (0.9, 0.62), into a half-size shadow picture
  with MAX blending (so overlapping shadows never double-darken), and multiplies that over the ground once in a
  cool blue-grey. Villagers cast from their figure, and a hop throws the shadow further; birds use a large
  "height above ground" so their shadows land far away. Atlas padding went up to 12 px so blurred mips do not
  pick up neighbouring sprites.
- **Grade pass** over the finished frame (replacing the old per-sprite tint copies): keyframed by hour with gain,
  lift, saturation, S-curve contrast and bloom strength/threshold (night, dawn, morning, day, sunset, dusk).
  Bloom: bright parts at quarter size, two-pass Gaussian blur, added before the grade. Paper: a fixed fine grain
  plus faint large blotches (not animated, so it reads as paper rather than film noise). Night lights are still
  added after the grade so they stay warm.

Measured (real app, animating): **9.1 to 9.4 % of one core, 427 to 442 MB.** Covered not re-measured separately
(the paused path is unchanged since milestone 2: 0.8 %).

Checked: `03-light-*` screenshots; shadows at 2.4x crops (soft, cool, offset bottom-right, merged where trees
overlap); sunset is warm with lifted purple shadows; night is deep blue with warm windows and lanterns.

## Milestone 4: new hero art at the new camera (partly done: stopped by image credits)

- **Generated** (Figma MCP `generate_image`, `gemini-3.1-flash-image`, all prompts in `art/SOURCES.md`): two
  house test sheets, then trees and props. Test 1 (the brief's example prompt) was compared at on-screen size
  against `art/style-options/H-ghibli-inspired-overhead.png`: right camera (roof fills the shape, thin wall
  strip), about 150 px wide on screen, a little flatter and crisper than the reference. Test 2 asked for looser
  gouache and came out more painterly, but the camera drifted lower (big gables in perspective) and some dark
  outlines appeared, so test 1 became the houses sheet. Trees match the camera well. Props came out closer to
  50-60 degrees with dark outlines: usable, but the weakest sheet.
- **Stopped**: the villager sheet was refused with "Insufficient Figma AI credits" (resets 2026-11-20 00:00 UTC).
  Following the brief, generation stopped; the animals sheet was not attempted. Villagers and cats keep the
  first-generation side-view art (now on the shared palette). The tool does not report a price per call; five
  calls succeeded before the refusal.
- **Pipeline**: `tools/cut-sprites.ps1` now prefers `art/source/v2/*.png`, then snaps every sprite (houses,
  trees, props, villagers) to one shared 28-colour palette found by k-means over samples of all of them
  (`web/art/palette.json`), then darkens a 5 px band along every outline by up to 30 % toward a deep warm brown.
  The quantisation reads as flat gouache dabs and is what makes the three sheets look like one set.
- **Scale**: cottages 146-152 px wide, big tree crowns 76-104 px (smaller in district slots), villagers about
  30 px tall, props 26-72 px. The world lays out fewer, larger houses (6x6-cell footprint on a roomy staggered
  grid, dealt from a shuffled deck so roof colours vary, with a garden strip kept free round each), and trees
  on a staggered 3-cell grid so forest crowns overlap into a canopy. In districts a house now needs four empty
  slots in a square (a cottage is two slots wide); single slots get a smaller tree or a prop that fits.
- Grass and district lawns were pulled toward a deeper, cooler green to sit with the new art.

Measured (real app, animating): **8.1 to 9.4 % of one core, 440 MB.**

Checked: `04-art-*` screenshots, palette contact sheet, Fill desktop (slots and gaps furnished, nothing over
icons), night windows glow along the thin front walls.

Not done in this milestone: new villagers and the two animals (no credits). To finish once credits reset:
generate the villager sheet with the prompt in `art/SOURCES.md` into `art/source/v2/villagers.png`, an animals
sheet into `art/source/v2/animals.png`, re-run `tools/cut-sprites.ps1`, and point the `villager` and `cat`
entries of `ART` in `web/js/sprites.js` at them (the cutter needs one line to include `animals`).
Optionally regenerate props for a steeper camera without outlines.

## Milestone 5: code-drawn density (done)

- New `web/js/filler.js`. Shape templates painted once by code in the shared palette and lit from the top-left
  (dark base, mid tones, sunlit dabs upper left, darker painted edge): four bushes (one flowering), three small
  tree crowns, six flower-dab colours, three grass tufts, three stepping stones, horizontal and vertical fence
  pieces, and three crop beds. They go into the same atlas as the painted art.
- Placement, recomputed only when the icons change, from the land field: a jittered 14 px grid over the whole
  screen. Nothing inside a clearing; a dense band of small bushes, flowers and tufts along clearing rims; small
  crowns and bushes filling the forest floor between the big trees; flowers in drifts (noise-masked, one or two
  colours per drift), shrub groups and tufts on village grass. Four-bed crop fields on the village outskirts
  where a 120x90 px patch is free. Stepping stones up to every standing house door, and a picket fence with a
  gate round about half the gardens. About 1,100 to 1,600 pieces at 1920x1080.
- **Quiet near icons**: every piece is scaled by smoothstep(4, 24, distance to the nearest icon) and dropped
  below 0.12, so detail fades out within about 20 px of any icon.
- **Cost**: the filler has its own instance buffer, uploaded only when it changes. Grow-in and shrink-away run in
  the vertex shader from a per-piece start time, following the drop ripple, so the CPU does nothing per frame.
  Pieces that are still wanted after a move keep their place (stable keys), so only what changed animates.
- **Regrowth**: trees now regrow linearly from a sapling over about 1.8 s, staggered, once space frees up;
  buildings rise in about 0.7 s. Checked by dragging an icon away from a clearing in the browser: the old plaza
  closes and the three houses it had displaced grow back while the new plaza opens at the drop.
- **Performance fix**: per-process breakdown showed about 6 % in the GPU process and 4 % in the renderer, i.e.
  draw-call and pass overhead. Shadows (kept between frames) are now refreshed every second frame and bloom
  every fourth frame; both are always refreshed on a forced or paused frame.

Measured (real app, animating, four 30 s runs): **7.8 to 9.0 % of one core, 427 to 432 MB.** Before the pass
reduction: 5.8 to 17.7 % (mean about 10.8 %).

Checked: `05-density-*` screenshots, 1.6x crops, a drag in the browser.

## Milestone 6: life (done)

- **Smooth walking**: a route of cells is now turned into a line through the cells' walking points (lane points
  inside districts), each villager keeping slightly to their own side, rounded off with two passes of corner
  cutting. Villagers follow it at a constant pace that eases in when they set off and out as they arrive;
  footfalls (bob and rock) follow the distance actually walked, and facing only flips on a clear sideways move.
- **Idle actions**: when they stop, people look around, chat (two idle neighbours within 50 px face each other
  and nod), crouch to tend the flowers, stretch, or give a little hop; cats sit or groom. All are done with the
  one picture per villager by squashing, tilting and lifting it, and the engine shadow follows.
- **Wind**: every tree crown (big trees, district trees, gap firs and the code-drawn crowns and bushes) sways in
  the vertex shader, about 3 % of its width at the top, with a slow gust whose phase rolls across the screen
  and a quicker flutter on top. Their shadows sway with them. No repaint cost: the frame is redrawn anyway.
- **Performance and memory work** in this milestone:
  - the ground copy and the shadow multiply became one pass;
  - the WebGL context is requested `desynchronized` and `low-power`; this alone took the animating cost from
    about 9.6 % to about 5.5 %. Checked on the real desktop that frames still reach the screen (two captures
    3 s apart differ in 6.6 % of sampled pixels: sway, clouds, walkers);
  - painted sprites are stored at 1.4x their on-screen size instead of 2x (atlas 2048x1096 down to 2048x572),
    the shadow picture is single-channel, the per-sprite canvases are released once the final atlas is on the
    card, and the frame loop no longer allocates objects per lantern and villager.

Measured (real app, same conditions as the baseline, 30 s runs):

| | CPU, animating | Memory, animating | CPU, covered | Memory, covered |
| --- | --- | --- | --- | --- |
| Baseline (original `web/`, rebuilt today) | 14.9 to 16.2 % | 430 to 431 MB | 0.5 to 0.6 % | 452 MB |
| Milestone 6 (final) | **4.9 to 8.1 %** | **433 to 436 MB** | **0.1 to 0.4 %** | **452 to 454 MB** |

CPU is well inside the 10 % / 3 % budget. Memory is the same as the baseline while covered and about 3 to 5 MB
(about 1 %) above it while animating, which is within run-to-run noise but not provably "no worse"; it has
been cut by about 15 MB from its peak during this work.

Checked: `06-life-*` screenshots (all four states, both sizes); villager positions sampled in the browser
(smooth curves, eased stops, idle actions cycling); real desktop captured (kept out of the repo).

## Milestone 4, finished (2026-11-19)

- The villager sheet and an animal sheet (four cats, four dogs) were generated from a second Figma account the
  owner set up (two calls; prompts and file in `art/SOURCES.md`). The cutter now also cuts `animals`, and the
  shared palette was rebuilt with the new sprites included (still 28 colours); the code-drawn filler colours
  in `filler.js` were updated to the new palette.
- Villagers are drawn about 27-32 px tall, cats and dogs about 15-18 px long. The village now has two animals,
  a cat and a dog (`kind: 'dog'` joins `'cat'`; both use the pet walk, speed and idle actions).
- The villagers are closer to three-quarter view than 78 degrees; kept, because at 30 px they read far better
  than a figure seen straight down would.

Measured (real app, animating, three 30 s runs): **6.7 to 9.3 % of one core, 424 to 431 MB.**
Screenshots `06-life-*` re-taken with the new villagers.

## Summary and what is left

All six milestones are in, including the villager and animal art for milestone 4 (generated a day late).
- Worth regenerating some day: props at a steeper angle without dark outlines.

Things I could not verify fully:
- the real desktop was checked by `PrintWindow` captures (tools/deskshot.ps1), not by eye on the monitor;
  with the desynchronized canvas, an on-screen look is worth one glance;
- performance was measured at night-time real clock on this laptop only, with other apps running;
- the browser drag test ran in the in-app browser at 1024x768, not at 1920x1080.
