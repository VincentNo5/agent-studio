---
name: agent-studio-3d
description: Use when changing Agent Studio's 3D floor, Blender asset kit, GLB pipeline, visual QA loop, or the /anatomy system map. Covers Blender MCP, production finishing, three.js performance and safe fallbacks.
version: 1.0.0
---

# Agent Studio 3D

Extend the studio without making the live runtime depend on a modelling tool.

## When to use

- Add or revise a prop, agent pod, room or camera composition in `public/hq3d.js`.
- Generate or update `public/studio-kit.glb`.
- Review the floor with a render/screenshot critique loop.
- Change the `/anatomy` system map.

## Non-negotiables

- Preserve the read-only boundary: visual work never mutates orchestration state.
- Keep the procedural fallback. A missing GLB, Blender or network must not blank the floor.
- Meters, floor origin, `-Y` forward, `AGENT_STUDIO_KIT`, `SM_*_A` names.
- Budget: ≤2k triangles per prop, ≤20k for the kit, one atlas or 1K per material.
- Respect `prefers-reduced-motion`; no camera motion that blocks reading.

## Blender path

1. Use `mcp-for-blender` for interactive object/material/light changes.
2. Use `blender-skills` for UV unwrap, bake, glTF validation and export checks.
3. Run `scripts/build-blender-assets.sh` for the deterministic kit.
4. Inspect the GLB bounds and origins before integrating; reject non-zero floor origins.
5. Load with `GLTFLoader` behind an existence check; fall back to primitives on any failure.

## Review loop

Capture `/` and `/floor` at 1440×1000 and 390×844. Ask for exactly three defects:
silhouette, contrast/readability, composition. Fix the asset or scene, not the data. Re-capture once.

## Files

- `blender/agent_studio_kit.py` — deterministic kit.
- `docs/BLENDER-PIPELINE.md` — repo mapping and roadmap.
- `public/hq3d.js` — runtime scene.
- `anatomy.html`, `public/anatomy.js` — system cutaway.
