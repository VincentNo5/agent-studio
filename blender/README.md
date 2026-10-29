# Agent Studio Blender kit

Optional Blender source for the studio floor. The live app keeps its procedural meshes as a
fallback and never imports Blender.

```bash
# from the repo root, with Blender installed
scripts/build-blender-assets.sh
# or
blender -b -P blender/agent_studio_kit.py
```

Output: `public/assets/studio-kit.glb`.

Conventions: meters, origin at floor, `-Y` forward, collection `AGENT_STUDIO_KIT`, asset names
`SM_*_A`. The kit contains a desk, monitor, chair, server rack, plant and agent pod.

For agent-driven modelling, install the Blender MCP server and the production skills:

```bash
uvx mcp-for-blender setup
# then use the blender-skills collection for UV / bake / glTF validation
```

See `docs/BLENDER-PIPELINE.md` for the full mapping and asset budget.
