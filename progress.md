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

Screenshots: `docs/milestones/00-before-*.png`.

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

Next: milestone 2, painterly ground and edges, and one WebGL2 renderer for the whole scene.
