"""Game furniture kit for Agent Studio.

Blender 5.2+:
  blender -b -P blender/game_kit.py
Output: public/game-kit.glb (validated by re-import).
"""
import math
import os
import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "public", "game-kit.glb")
KIT = "AGENT_STUDIO_GAME_KIT"

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.world = bpy.data.worlds.new("GameWorld")
    scene.world.color = (0.02, 0.035, 0.06)

def mat(name, color, metal=0.0, rough=0.42, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*color, 1)
        b.inputs["Emission Strength"].default_value = emit
    m.diffuse_color = (*color, 1)
    return m

def bevel(obj, width=0.035, segments=3):
    mod = obj.modifiers.new("soft-game-edges", "BEVEL")
    mod.width = width
    mod.segments = segments
    return obj

def cube(name, loc, scale, material, parent=None, width=0.035, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    bevel(o, width)
    if parent:
        o.parent = parent
    return o

def cyl(name, loc, radius, depth, material, parent=None, vertices=32, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    if parent:
        o.parent = parent
    return o

def sphere(name, loc, scale, material, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    o.data.materials.append(material)
    if parent:
        o.parent = parent
    return o

def root(name):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o["asset"] = name
    o["units"] = "meters"
    o["origin"] = "floor"
    return o

def uv_all():
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
        o.select_set(False)

def build(mats):
    # Coffee bar: counter, espresso machine, cups, pendant lights, stools.
    r = root("KIT_CoffeeBar")
    cube("CoffeeCounter", (0, 0, 0.55), (3.4, 0.75, 1.1), mats["wood"], r, .06)
    cube("CoffeeTop", (0, 0, 1.12), (3.55, 0.9, 0.08), mats["cream"], r, .04)
    cube("CoffeeMachine", (-0.8, -0.05, 1.48), (1.0, 0.55, 0.65), mats["dark"], r, .06)
    cube("CoffeeMachineFace", (-0.8, 0.24, 1.48), (0.7, 0.02, 0.3), mats["cyan"], r, .02)
    for i in range(4):
        cyl("CoffeeCup", (0.2 + i * .3, 0.1, 1.22), .08, .12, mats["cream"], r, 20)
    for x in (-1.1, 1.1):
        cube("CoffeeStool", (x, 0.8, .35), (.5, .5, .08), mats["pink"], r, .08)
        cyl("CoffeeStoolLeg", (x, 0.8, .16), .08, .3, mats["dark"], r, 16)
    for x in (-1.0, 1.0):
        sphere("CoffeePendant", (x, -0.1, 2.05), (.18, .18, .18), mats["amber"], r)

    # Arcade cabinet with a glowing screen and controls.
    r = root("KIT_Arcade")
    cube("ArcadeBody", (0, 0, .85), (1.1, .75, 1.7), mats["dark"], r, .08)
    cube("ArcadeScreen", (0, -.39, 1.22), (.78, .02, .5), mats["cyan"], r, .03)
    cube("ArcadeMarquee", (0, -.39, 1.82), (.85, .03, .18), mats["pink"], r, .03)
    cube("ArcadeControl", (0, -.48, .86), (.9, .3, .14), mats["cream"], r, .04)
    cyl("ArcadeStick", (-.22, -.48, 1.0), .035, .24, mats["amber"], r, 12)
    for i in range(3):
        sphere("ArcadeButton", (.02 + i * .16, -.48, .96), (.055, .055, .025), mats["pink"], r)

    # Rounded sofa and cushions.
    r = root("KIT_Sofa")
    cube("SofaBase", (0, 0, .36), (2.5, 1.05, .38), mats["pink"], r, .12)
    cube("SofaBack", (0, .38, .85), (2.5, .24, .7), mats["pink"], r, .12)
    for x in (-1.0, 0, 1.0):
        cube("SofaCushion", (x, -.06, .63), (.72, .78, .22), mats["cream"], r, .1)
    for x in (-1.15, 1.15):
        cube("SofaArm", (x, 0, .65), (.2, 1.0, .55), mats["pink"], r, .1)

    # Open shelf with books and a plant.
    r = root("KIT_Shelf")
    for x in (-.9, .9):
        cube("ShelfPost", (x, 0, 1.0), (.08, .45, 2.0), mats["wood"], r, .02)
    for z in (.25, .85, 1.45, 1.95):
        cube("ShelfBoard", (0, 0, z), (1.9, .48, .08), mats["wood"], r, .02)
    for i, c in enumerate(("cyan", "pink", "amber", "green")):
        cube("ShelfBook", (-.6 + i * .35, 0, .48), (.18, .3, .35), mats[c], r, .02)
    cyl("ShelfPot", (.6, 0, 2.15), .12, .18, mats["cream"], r, 16)
    sphere("ShelfPlant", (.6, 0, 2.4), (.2, .2, .25), mats["green"], r)

    # Whiteboard on legs.
    r = root("KIT_Whiteboard")
    cube("Board", (0, 0, 1.2), (2.4, .08, 1.45), mats["cream"], r, .03)
    cube("BoardFrame", (0, 0, 1.2), (2.55, .04, 1.6), mats["dark"], r, .04)
    cube("BoardTray", (0, -.1, .42), (2.4, .14, .06), mats["dark"], r, .02)
    for x in (-.9, .9):
        cyl("BoardLeg", (x, 0, .22), .035, .44, mats["dark"], r, 12)

    # Tool cart with drawers and casters.
    r = root("KIT_ToolCart")
    cube("CartBody", (0, 0, .58), (1.1, .65, .9), mats["cyan"], r, .06)
    for z in (.35, .65, .95):
        cube("CartDrawer", (0, -.34, z), (.9, .02, .2), mats["cream"], r, .02)
    cube("CartTop", (0, 0, 1.08), (1.2, .72, .06), mats["dark"], r, .03)
    for x in (-.42, .42):
        for y in (-.22, .22):
            cyl("CartWheel", (x, y, .1), .09, .08, mats["dark"], r, 16, (math.pi / 2, 0, 0))

    # Small conference table with four stools.
    r = root("KIT_Conference")
    cyl("TableTop", (0, 0, .78), 1.15, .12, mats["cream"], r, 48)
    cyl("TableStem", (0, 0, .4), .15, .7, mats["dark"], r, 16)
    cyl("TableBase", (0, 0, .06), .55, .08, mats["dark"], r, 32)
    for i in range(4):
        a = i * math.pi / 2
        x, y = math.cos(a) * 1.55, math.sin(a) * 1.55
        cyl("TableStool", (x, y, .48), .28, .1, mats["pink"], r, 20)
        cyl("TableStoolLeg", (x, y, .24), .06, .48, mats["dark"], r, 12)

    # Floor lamp.
    r = root("KIT_FloorLamp")
    cyl("LampBase", (0, 0, .04), .28, .08, mats["dark"], r, 24)
    cyl("LampPole", (0, 0, 1.0), .035, 2.0, mats["dark"], r, 12)
    cyl("LampShade", (0, 0, 2.0), .32, .28, mats["amber"], r, 24)
    sphere("LampGlow", (0, 0, 1.86), (.24, .24, .08), mats["cream"], r)

    # Tall plant.
    r = root("KIT_PlantTall")
    cyl("TallPot", (0, 0, .28), .3, .56, mats["cream"], r, 24)
    cyl("TallTrunk", (0, 0, .9), .045, 1.0, mats["wood"], r, 12)
    for i in range(7):
        a = i * math.tau / 7
        sphere("TallLeaf", (math.cos(a) * .25, math.sin(a) * .25, 1.2 + (i % 3) * .12), (.22, .12, .28), mats["green"], r)

    # Rug.
    r = root("KIT_Rug")
    cube("Rug", (0, 0, .02), (4.0, 2.8, .04), mats["rug"], r, .08)
    cube("RugBorder", (0, 0, .045), (3.6, 2.4, .01), mats["cream"], r, .04)

    # Neon wall sign (abstract, no font dependency).
    r = root("KIT_Neon")
    cube("NeonFrame", (0, 0, 1.1), (2.2, .08, .7), mats["dark"], r, .05)
    cube("NeonBar", (0, -.05, 1.1), (1.7, .02, .08), mats["cyan"], r, .02)
    cube("NeonBar2", (0, -.05, .9), (1.2, .02, .06), mats["pink"], r, .02)

def main():
    reset()
    mats = {
        "dark": mat("MAT_Game_Dark", (0.035, 0.065, 0.1), .25, .38),
        "cream": mat("MAT_Game_Cream", (0.8, 0.72, 0.58), .02, .5),
        "wood": mat("MAT_Game_Wood", (0.38, 0.2, 0.11), .02, .55),
        "cyan": mat("MAT_Game_Cyan", (0.08, 0.55, 0.7), .1, .28, .35),
        "pink": mat("MAT_Game_Pink", (0.75, 0.22, 0.38), .05, .4, .08),
        "amber": mat("MAT_Game_Amber", (0.95, 0.55, 0.15), .05, .35, .35),
        "green": mat("MAT_Game_Green", (0.15, 0.5, 0.3), .02, .5),
        "rug": mat("MAT_Game_Rug", (0.08, 0.17, 0.23), .02, .8),
    }
    build(mats)
    uv_all()
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o["kit"] = KIT
    bpy.context.scene["asset_kit"] = KIT
    bpy.context.scene["units"] = "metric"
    bpy.context.scene["forward"] = "-Y"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=False, export_apply=True, export_yup=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=OUT)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("game-kit validation failed")
    print(f"Wrote {OUT}; validated {len(meshes)} meshes on re-import")

if __name__ == "__main__":
    main()
