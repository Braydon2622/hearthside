# Art sources

All painted art in Hearthside is AI-generated and then processed by `tools/cut-sprites.ps1` (cut from the
magenta sheets, snapped to one shared 28-colour palette in `web/art/palette.json`, edges darkened). The README
will disclose this. No studio, film or artist is named in any prompt.

## First generation (before rebuild v2)

`art/source/ground.png`, `houses.png`, `trees.png`, `props.png`, `villagers.png` and `art/style-options/*`
were generated before this log was started; the tool, model and prompts were not recorded at the time.
Still in use: `ground.png` (grass, cobble, dirt and lawn tiles) and `villagers.png` (villagers and cats; the
v2 villager sheet could not be generated, see below). The first-generation houses, trees and props sheets
are kept for history but no longer cut.

## Rebuild v2 (high eagle-eye camera, about 78 degrees)

Tool: Figma MCP `generate_image`, model `gemini-3.1-flash-image`, Figma file `c0ZdLNk5Ljz42emxUDz6tS`,
requested 2048x1024, delivered 1376x768 PNG. Date: 2026-11-18. The tool does not report a per-call price;
it bills Figma AI credits.

| File | Figma node | Use | Prompt |
| --- | --- | --- | --- |
| `art/source/v2/test-houses.png` (copied to `houses.png`) | 3:2 | Test sheet, then the houses sheet | Sprite sheet of 8 separate cottage rooftops in a 2x4 grid with clear gaps, each complete and uncropped, on flat pure magenta #FF00FF. Seen from high above at about 78 degrees, so the tiled roof fills almost the whole shape and only a thin strip of front wall and door shows at the bottom edge. Hand-painted gouache with loose visible brush strokes, softly rounded simplified shapes, warm saturated colours. Light comes from the upper left, with soft cool shading on the lower-right roof planes. No cast shadow on the background, no ground, no outlines, no text. Roofs in terracotta, faded orange, moss green, slate blue and teal, with chimneys, dormers, moss patches and one with a small rooftop garden. |
| `art/source/v2/test-houses-2.png` | 3:3 | Second test, not used (camera drifted lower, some outlines) | Sprite sheet of 8 separate small village cottages in a 2x4 grid with wide clear gaps, each complete and uncropped, on flat pure magenta #FF00FF. Seen from high above at about 78 degrees: the roof fills almost the whole shape and only a thin strip of front wall with a door and small windows shows at the bottom edge. Painted like a background painting for a classic hand-drawn animated film: opaque gouache on paper, loose visible brush strokes, soft painterly edges, gently irregular hand-drawn shapes, tiles suggested with a few dabs rather than drawn one by one, warm saturated colours. Light from the upper left: sunlit warm upper-left roof planes, soft cool blue-violet shading on the lower-right planes. No cast shadow on the background, no ground, no dark outlines, no text. Roofs in terracotta, faded orange, moss green, slate blue and teal; chimneys, dormer windows, moss patches, one with a tiny rooftop garden, one with ivy on the wall. |
| `art/source/v2/trees.png` | 3:4 | Feature trees | Sprite sheet of 8 separate feature trees in a 2x4 grid with wide clear gaps, each complete and uncropped, on flat pure magenta #FF00FF. Seen from high above at about 78 degrees, so each tree is a round leafy crown seen from the top, built from soft clustered leaf masses, with only a short stub of trunk peeking out at the bottom edge. Hand-painted gouache with loose visible brush strokes, softly rounded simplified shapes, warm saturated colours. Light comes from the upper left: sunlit yellow-green leaf clusters on the upper left, deep cool blue-green shading on the lower right. No cast shadow on the background, no ground, no outlines, no text. A big oak, a round maple, a pink blossom tree, a pale birch, a dark fir seen from above, a golden autumn tree, an apple tree with red fruit, and a willow. |
| `art/source/v2/props.png` | 3:5 | Props | Sprite sheet of 10 separate small village props in a 2x5 grid with wide clear gaps, each complete and uncropped, on flat pure magenta #FF00FF. Seen from high above at about 78 degrees, so you mostly see the tops of things with only a thin sliver of their front sides. Hand-painted gouache with loose visible brush strokes, softly rounded simplified shapes, warm saturated colours. Light comes from the upper left, with soft cool shading on the lower-right sides. No cast shadow on the background, no ground, no outlines, no text. A market stall with a striped awning and baskets of vegetables, a round stone well with a little wooden roof, a round stone fountain with water, a wooden bench, a stack of barrels and crates, a round hay bale, a small vegetable garden bed with green rows, a wooden flower barrel full of blooms, a wheelbarrow with pumpkins, and a short iron lamp post with a lantern. |

### Not generated

The villager sheet (prompt below) was refused with "Insufficient Figma AI credits"; the limit resets
2026-11-20 00:00 UTC. Per the brief, generation stopped there, so the two-animal sheet was not attempted either.

> Sprite sheet of 10 separate small villagers in a 2x5 grid with wide clear gaps, each complete and uncropped,
> standing, full figure, on flat pure magenta #FF00FF. Seen from high above at about 78 degrees, so you see the
> top of each head or hat and the shoulders large, with the body strongly foreshortened below and just the feet
> peeking out, like tiny people seen from a rooftop. Simple chunky readable shapes for a figure about 30 pixels
> tall: no faces needed. Hand-painted gouache with loose visible brush strokes, warm saturated colours. Light
> comes from the upper left, with soft cool shading on the lower right. No cast shadow on the background, no
> ground, no outlines, no text. A farmer in a straw hat, a woman with a red headscarf carrying a basket, a child
> in a yellow raincoat, an old man with a cane and flat cap, a baker in white apron, a girl with a blue dress and
> dark bob hair, a boy with a green cap, a woman in a purple shawl, a man in a brown waistcoat carrying a sack, a
> woman in an orange dress with a sun hat.
