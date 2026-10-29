"""Agent Studio asset kit — a deterministic Blender source file.

Run:
  blender -b -P blender/agent_studio_kit.py

Produces public/studio-kit.glb. The live studio keeps its procedural
fallback; this kit is an optional quality upgrade for the three.js floor.
"""
import math
import os
import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "public", "studio-kit.glb")
KIT = "AGENT_STUDIO_KIT"

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.world = bpy.data.worlds.new("StudioWorld")
    scene.world.color = (0.015, 0.035, 0.06)

def material(name, color, metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat

def cube(name, loc, scale, mat, parent=None, bevel=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("edge-soften", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    if parent:
        obj.parent = parent
    return obj

def cylinder(name, loc, radius, depth, mat, vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj

def uv(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)

def desk(parent, mats):
    body = cube("SM_Desk_A", (0, 0, 0.76), (1.8, 0.78, 0.07), mats["dark"], parent)
    for x in (-0.78, 0.78):
        for y in (-0.3, 0.3):
            cube("SM_DeskLeg_A", (x, y, 0.38), (0.07, 0.07, 0.7), mats["dark"], parent, 0.01)
    cube("SM_DeskRail_A", (0, 0.28, 0.56), (1.6, 0.06, 0.08), mats["dark"], parent, 0.01)
    uv(body)
    return body

def monitor(parent, mats):
    cube("SM_Monitor_A", (0, -0.2, 1.18), (0.88, 0.06, 0.52), mats["dark"], parent, 0.03)
    cube("SM_MonitorScreen_A", (0, -0.235, 1.18), (0.78, 0.01, 0.43), mats["cyan"], parent, 0.01)
    cube("SM_MonitorStand_A", (0, -0.2, 0.9), (0.1, 0.1, 0.2), mats["dark"], parent, 0.01)

def chair(parent, mats):
    cube("SM_ChairSeat_A", (0, 0, 0.48), (0.58, 0.56, 0.09), mats["warm"], parent, 0.04)
    cube("SM_ChairBack_A", (0, 0.28, 0.82), (0.56, 0.08, 0.6), mats["warm"], parent, 0.04)
    for x in (-0.24, 0.24):
        for y in (-0.2, 0.2):
            cube("SM_ChairLeg_A", (x, y, 0.23), (0.05, 0.05, 0.46), mats["dark"], parent, 0.01)

def rack(parent, mats):
    cube("SM_ServerRack_A", (0, 0, 0.95), (0.72, 0.72, 1.9), mats["dark"], parent, 0.03)
    for i in range(6):
        cube("SM_ServerSlot_A", (0, -0.37, 0.42 + i * 0.23), (0.54, 0.02, 0.05), mats["cyan"], parent, 0.01)
    cube("SM_ServerGlow_A", (0, -0.38, 1.78), (0.1, 0.01, 0.04), mats["green"], parent, 0.01)

def plant(parent, mats):
    cylinder("SM_PlantPot_A", (0, 0, 0.24), 0.22, 0.46, mats["warm"], 24)
    cylinder("SM_PlantStem_A", (0, 0, 0.68), 0.035, 0.5, mats["green"], 12)
    for i in range(5):
        a = i * math.tau / 5
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.18, location=(math.cos(a) * 0.22, math.sin(a) * 0.22, 0.86 + (i % 2) * 0.12))
        leaf = bpy.context.object
        leaf.name = "SM_PlantLeaf_A"
        leaf.scale = (1.0, 0.45, 0.55)
        leaf.data.materials.append(mats["green"])
        leaf.parent = parent

def pod(parent, mats):
    cylinder("SM_AgentPod_A", (0, 0, 0.55), 0.36, 0.1, mats["dark"], 32)
    cylinder("SM_AgentPodRing_A", (0, 0, 0.58), 0.33, 0.02, mats["cyan"], 32)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.26, location=(0, 0, 0.92))
    orb = bpy.context.object
    orb.name = "SM_AgentOrb_A"
    orb.scale = (1, 1, 1.25)
    orb.data.materials.append(mats["green"])
    orb.parent = parent

def main():
    reset()
    mats = {
        "dark": material("MAT_Studio_Dark", (0.035, 0.075, 0.11), 0.25, 0.4),
        "cyan": material("MAT_Studio_Cyan", (0.12, 0.62, 0.8), 0.1, 0.25),
        "warm": material("MAT_Studio_Warm", (0.55, 0.3, 0.16), 0.05, 0.55),
        "green": material("MAT_Studio_Green", (0.18, 0.6, 0.36), 0.05, 0.4),
    }
    coll = bpy.data.collections.new(KIT)
    bpy.context.scene.collection.children.link(coll)
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[KIT]
    for name, build, x in (("Desk", desk, -3.2), ("Monitor", monitor, -3.2), ("Chair", chair, -3.2), ("Rack", rack, 0.0), ("Plant", plant, 3.2), ("AgentPod", pod, 3.2)):
        empty = bpy.data.objects.new(f"KIT_{name}", None)
        coll.objects.link(empty)
        empty.location.x = x
        build(empty, mats)
        empty["asset"] = name
        empty["units"] = "meters"
        empty["origin"] = "floor"
    for obj in coll.objects:
        if obj.type == "MESH":
            obj["kit"] = KIT
    bpy.context.scene["asset_kit"] = KIT
    bpy.context.scene["units"] = "metric"
    bpy.context.scene["forward"] = "-Y"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=False, export_apply=True, export_yup=True)
    print(f"Wrote {OUT}")

if __name__ == "__main__":
    main()
