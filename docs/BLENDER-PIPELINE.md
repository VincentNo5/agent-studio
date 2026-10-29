# Blender / 3D upgrade for Agent Studio

Reference: [Xian's 10-repo 3D list](https://x.com/Xian0063/status/2115684763793338508). The
post is a practical map of the AI-3D ecosystem, not a Blender tutorial. Its useful signal for
Agent Studio is the separation between **asset creation**, **production finishing**, **visual
review**, and **runtime rendering**.

## What the 10 repos mean for Agent Studio

| # | Repo | What it gives | Agent Studio use |
|---|------|---------------|------------------|
| 1 | [mcp-for-blender](https://github.com/ahujasid/mcp-for-blender) | MCP control of Blender: objects, materials, lights | Author the studio kit and iterate props/rooms from an agent session |
| 2 | [blender-skills](https://github.com/arjun988/blender-skills) | 94 production skills (UV, bake, glTF, validation) | Turn kit meshes into game-ready GLB with predictable scale/origins |
| 3 | [dream-loop](https://github.com/achimala/dream-loop) | Render → review → revise loop | Visual QA for the floor: screenshot, critique, fix lighting/composition |
| 4 | [threejs-skills](https://github.com/CloudAI-X/threejs-skills) | Agent-oriented Three.js guidance | Harden `public/hq3d.js`: color space, LOD, instancing, controls, resize |
| 5 | [threejs-game-skills](https://github.com/majidmanzarpour/threejs-game-skills) | Game loop, collisions, input | Not core; useful only for interactive agent mini-scenes |
| 6 | [react-three-fiber](https://github.com/pmndrs/react-three-fiber) | React renderer for Three.js | Not a migration target: the studio is deliberately plain Three.js |
| 7 | [modly](https://github.com/lightningpixel/modly) | Local image/text → 3D | Optional avatar/prop generation; keep the output local and reviewed |
| 8 | [DepthFlow](https://github.com/BrokenSource/DepthFlow) | Image → parallax video | Optional launch/intro motion, not the live floor |
| 9 | [anatomy](https://github.com/wheresryan22/anatomy) | Isometric interactive cutaways | The new `/anatomy` view: source → collector → experience |
| 10 | git-city | Procedural city from GitHub activity | Optional “agent city” view; not before asset and state work |

## Priority

1. **Asset kit + Blender pipeline** — highest leverage. The floor currently builds every prop
   from primitives. A small, shared kit gives better silhouettes, consistent scale and a path to
   artist-authored upgrades without rewriting the scene.
2. **Anatomy / system map** — already implemented. It makes the data plane legible and gives new
   contributors a map before they touch the 3D scene.
3. **Visual review loop** — screenshot the floor, critique lighting/readability, revise the kit or
   scene. Do not let a model rewrite the live state; it reviews pixels only.
4. **Three.js hardening** — keep instancing, cap DPR, pause when hidden, and budget draw calls.
5. **Optional creative layers** — DepthFlow intro, modly avatars, git-city activity view. These are
   content features, not foundations.

## Asset contract

- Units: **meters**, 1 Blender unit = 1 m.
- Forward: **-Y**; glTF export with Y-up.
- Origin: floor contact point, centered on X/Y.
- Kit collection: `AGENT_STUDIO_KIT`.
- Asset names: `SM_<Asset>_A`, materials `MAT_Studio_*`.
- Budget per prop: ≤ 2k triangles; kit ≤ 20k triangles; one 2K atlas or 1K per material.
- UVs: smart project for iteration; final assets use explicit UVs and baked maps.
- Export: GLB, apply transforms, no cameras/lights, no external textures.
- Runtime: load via `GLTFLoader` only when a kit GLB exists; procedural meshes remain the
  fallback, so a missing or failed asset never breaks the floor.
- Current implementation: the workstation kit desk/chair/plant/rack parts are `InstancedMesh`
  batches at the 49 workstation slots; procedural monitors, status strips and lamps remain
  live-data surfaces.
- Game furniture kit: `blender/game_kit.py` exports `KIT_*` groups (coffee bar, arcade, sofa,
  conference, tool cart, whiteboard, shelf, floor lamp, tall plant, rug, neon) to
  `public/game-kit.glb`. The runtime clones those groups into the lobby, production floor and
  engineering lounge, then animates the arcade/neon emissives.

## Commands

```bash
# Optional, requires Blender
scripts/build-blender-assets.sh
scripts/build-game-kit.sh

# With an explicit Blender install
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender scripts/build-blender-assets.sh
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender scripts/build-game-kit.sh

# MCP path (installs the Blender addon and writes a `blender` MCP entry)
uvx mcp-for-blender setup
```

The Blender scripts are `blender/agent_studio_kit.py` and `blender/game_kit.py`. Both are deterministic and safe to re-run.
The live app does not import Blender, `bpy`, or any Python dependency.

## Visual review loop

1. Start the studio and capture `/` and `/floor` at 1440×1000 and 390×844.
2. Ask a vision-capable reviewer for **three specific defects**: silhouette, contrast/readability,
   and composition. No generic “make it better”.
3. Fix the asset/scene, not the data. Re-capture.
4. Stop after one focused pass; keep the review artifact with the change.

## What not to do

- Do not make the runtime depend on Blender being installed.
- Do not bake a 100k-triangle hero mesh into a 49-agent floor.
- Do not let an agent mutate live orchestration state while “improving” visuals.
- Do not replace the existing procedural scene wholesale; add assets behind a fallback.
