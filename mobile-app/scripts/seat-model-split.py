# Blender headless: from the 2-seat GLB keep the red unit, build one `Seat` and one `Arm`,
# fix the fabric colour, drop tiny parts, decimate the armrest, export a small GLB.
import sys
import bpy
import bmesh
from mathutils import Matrix

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

objs = {o.name: o for o in bpy.data.objects}
for o in list(bpy.data.objects):
    if o.name.endswith("_old"):
        bpy.data.objects.remove(o, do_unlink=True)

def subtree(root):
    out, stack = [], [objs[root]]
    while stack:
        o = stack.pop()
        out.append(o)
        stack.extend(o.children)
    return [o for o in out if o.type == "MESH"]

DROP = ("Bolt", "Badge")

def build(name, roots, origin_x):
    parts = [o for r in roots for o in subtree(r) if not o.name.startswith(DROP)]
    # bake world transforms into the meshes
    for o in parts:
        o.data = o.data.copy()
        o.data.transform(o.matrix_world)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    # origin on the floor, centred across x on the seat / divider
    ob.data.transform(Matrix.Translation((-origin_x, 0, 0)))
    return ob

seat = build("Seat", ["Seat_L", "Back_L"], -0.285)
arm = build("Arm", ["ArmStandard_1"], 0.0)

# the armrest is the heaviest part: decimate the divider
dec = arm.modifiers.new("dec", "DECIMATE")
dec.ratio = 0.45
bpy.context.view_layer.objects.active = arm
bpy.ops.object.modifier_apply(modifier="dec")

# fabric: the colour lived only in the sheen; give it a real base colour
for m in bpy.data.materials:
    if m.name.startswith("Fabric_Red") and m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                n.inputs["Base Color"].default_value = (0.32, 0.018, 0.022, 1.0)
                n.inputs["Roughness"].default_value = 0.95

# keep only Seat and Arm
for o in list(bpy.data.objects):
    if o.name not in ("Seat", "Arm"):
        bpy.data.objects.remove(o, do_unlink=True)

for o in (seat, arm):
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
    print(f"OUT {o.name} tris={tris} mats={[s.material.name for s in o.material_slots]} "
          f"x=[{min(xs):.3f},{max(xs):.3f}] y=[{min(ys):.3f},{max(ys):.3f}] z=[{min(zs):.3f},{max(zs):.3f}]")
    bm.free()

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_apply=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
    export_draco_mesh_compression_enable=False,
    export_yup=True,
)
print("EXPORTED", dst)
