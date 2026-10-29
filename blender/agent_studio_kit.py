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

def cube(name, loc, scale, mat, parent=None, bevel=0.02, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
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

def cylinder(name, loc, radius, depth, mat, vertices=32, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
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
    # Height-adjustable studio desk: warm top, dark frame, cable tray and drawer pedestal.
    cube("SM_DeskTop_A", (0, 0, 0.78), (1.9, 0.86, 0.055), mats["warm"], parent, 0.045)
    cube("SM_DeskApron_A", (0, 0.38, 0.70), (1.82, 0.045, 0.12), mats["dark"], parent, 0.02)
    for x in (-0.84, 0.84):
        for y in (-0.34, 0.34):
            cube("SM_DeskLeg_A", (x, y, 0.38), (0.06, 0.06, 0.72), mats["dark"], parent, 0.012)
    cube("SM_DeskCableTray_A", (0, 0.20, 0.60), (1.45, 0.18, 0.05), mats["dark"], parent, 0.01)
    cube("SM_DeskModesty_A", (0, 0.35, 0.44), (1.30, 0.025, 0.34), mats["dark"], parent, 0.01)
    for i, z in enumerate((0.18, 0.40, 0.62)):
        cube("SM_DeskDrawer_A", (0.58, -0.42, z), (0.42, 0.04, 0.19), mats["dark"], parent, 0.012)
        cube("SM_DeskDrawerFace_A", (0.58, -0.45, z), (0.38, 0.015, 0.15), mats["warm"], parent, 0.008)
        cube("SM_DeskHandle_A", (0.58, -0.47, z), (0.16, 0.015, 0.018), mats["cyan"], parent, 0.004)
    cylinder("SM_DeskGrommet_A", (0, 0.28, 0.81), 0.055, 0.012, mats["dark"], 24, parent)
    return parent

def monitor(parent, mats):
    cube("SM_Monitor_A", (0, -0.2, 1.18), (0.88, 0.06, 0.52), mats["dark"], parent, 0.03)
    cube("SM_MonitorScreen_A", (0, -0.235, 1.18), (0.78, 0.01, 0.43), mats["cyan"], parent, 0.01)
    cube("SM_MonitorStand_A", (0, -0.2, 0.9), (0.1, 0.1, 0.2), mats["dark"], parent, 0.01)

def chair(parent, mats):
    # Ergonomic task chair: rounded seat/back, headrest, armrests, gas lift and five-star base.
    cube("SM_ChairSeat_A", (0, 0, 0.47), (0.62, 0.58, 0.11), mats["warm"], parent, 0.06)
    cube("SM_ChairBack_A", (0, 0.29, 0.86), (0.58, 0.10, 0.64), mats["warm"], parent, 0.06)
    cube("SM_ChairHeadrest_A", (0, 0.29, 1.28), (0.34, 0.08, 0.18), mats["warm"], parent, 0.04)
    for x in (-0.34, 0.34):
        cube("SM_ChairArm_A", (x, 0.01, 0.65), (0.055, 0.48, 0.055), mats["dark"], parent, 0.02)
        cube("SM_ChairArmPad_A", (x, -0.12, 0.70), (0.10, 0.24, 0.035), mats["dark"], parent, 0.012)
    cylinder("SM_ChairGas_A", (0, 0, 0.26), 0.035, 0.32, mats["dark"], 20, parent)
    for i in range(5):
        a = i * math.tau / 5
        cube("SM_ChairSpoke_A", (math.cos(a) * 0.18, math.sin(a) * 0.18, 0.08), (0.30, 0.045, 0.035), mats["dark"], parent, 0.01, (0, 0, a))
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.055, location=(math.cos(a) * 0.34, math.sin(a) * 0.34, 0.045))
        wheel = bpy.context.object
        wheel.name = "SM_ChairWheel_A"
        wheel.scale = (1, .55, 1)
        wheel.data.materials.append(mats["dark"])
        wheel.parent = parent

def rack(parent, mats):
    cube("SM_ServerRack_A", (0, 0, 0.95), (0.76, 0.76, 1.92), mats["dark"], parent, 0.04)
    for i in range(8):
        cube("SM_ServerSlot_A", (0, -0.385, 0.34 + i * 0.19), (0.58, 0.018, 0.055), mats["cyan"], parent, 0.008)
        cube("SM_ServerVent_A", (0, -0.39, 0.31 + i * 0.19), (0.42, 0.008, 0.012), mats["dark"], parent, 0.002)
    cube("SM_ServerGlow_A", (0, -0.40, 1.80), (0.12, 0.008, 0.035), mats["green"], parent, 0.004)
    for x in (-0.30, 0.30):
        cube("SM_ServerHandle_A", (x, -0.40, 1.35), (0.035, 0.012, 0.24), mats["cyan"], parent, 0.004)
    for x in (-0.28, 0.28):
        for y in (-0.26, 0.26):
            cylinder("SM_ServerWheel_A", (x, y, 0.045), 0.045, 0.03, mats["dark"], 16, parent)
    return parent

def plant(parent, mats):
    cylinder("SM_PlantPot_A", (0, 0, 0.24), 0.22, 0.46, mats["warm"], 24)
    cylinder("SM_PlantStem_A", (0, 0, 0.68), 0.035, 0.5, mats["green"], 12)
    cylinder("SM_PlantRim_A", (0, 0, 0.47), 0.235, 0.04, mats["dark"], 24, parent)
    for i in range(9):
        a = i * math.tau / 9
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=0.18, location=(math.cos(a) * (0.16 + (i % 3) * 0.05), math.sin(a) * (0.16 + (i % 3) * 0.05), 0.74 + (i % 4) * 0.11))
        leaf = bpy.context.object
        leaf.name = "SM_PlantLeaf_A"
        leaf.scale = (1.15, 0.38, 0.62)
        leaf.rotation_euler = (0.25 * math.cos(a), 0.25 * math.sin(a), a)
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
            uv(obj)
    bpy.context.scene["asset_kit"] = KIT
    bpy.context.scene["units"] = "metric"
    bpy.context.scene["forward"] = "-Y"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=False, export_apply=True, export_yup=True)
    # Round-trip validation: a GLB that cannot be imported is not a deliverable.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=OUT)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("GLB validation failed: no meshes imported")
    print(f"Wrote {OUT}; validated {len(meshes)} meshes on re-import")

if __name__ == "__main__":
    main()
