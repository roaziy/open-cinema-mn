"""Modular cinema room kits -> room-standard.glb / room-imax.glb / room-dolby.glb

Run:  blender -b --factory-startup -P build_rooms.py
Writes the GLBs next to this file.

Geometry below is authored in Blender space (Z up). The glTF exporter converts to
three.js Y-up:  three(x, y, z) = blender(x, z, -y).

Conventions (three.js space):
  wall-mounted  WallPanel WallBase Sconce ExitSign Speaker ScreenBorderH/V Curtain
                back on plane x=0, face points +X, runs toward -Z ("right" when you
                look at it), up is +Y. Tiles: origin = bottom-left on the floor.
                Fixtures (Sconce/ExitSign/Speaker): origin = fixture centre on the wall.
  floor/ceiling Carpet, CeilingPanel: x in [0,1], z in [0,1]. Carpet top at y=0;
                CeilingPanel visible face at y=0 facing -Y (body above).
  steps         StepNosing, StepLight face -Z (toward the screen); riser plane z=0,
                StepNosing top of tread y=0, tread continues toward +Z, runs x in [0,1].
  Railing       runs x in [0,1], floor y=0, post at x=0.5.
  Downlight     surface-mount; origin = centre on the ceiling plane, hangs below it, faces -Y.
"""
import bpy, bmesh, os, json
import numpy as np
from math import radians, sin, cos, pi
from mathutils import Vector, Matrix

OUT = os.path.dirname(os.path.abspath(__file__))


# ------------------------------------------------------------------ colour / material
def srgb01(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def lin(h):
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb01(h))


def mat(name, base, rough=0.9, metal=0.0, emit=None, strength=1.0, double=False, image=None):
    """Plain Principled BSDF, values set directly on its inputs (no node chains)."""
    if name in bpy.data.materials:  # shared across modules of one kit
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        nt.nodes.clear()
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(b.outputs['BSDF'], nt.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    b.inputs['Base Color'].default_value = (*lin(base), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*lin(emit), 1)
        b.inputs['Emission Strength'].default_value = strength
    if image:  # image texture straight into Base Color = glTF baseColorTexture
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = image
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    m.use_backface_culling = not double  # exporter: doubleSided = not culling
    m.diffuse_color = (*lin(base), 1)
    return m


def carpet_image(path):
    """Self-made 512 px tileable cinema carpet (4 motifs per 1 m tile)."""
    n = 512
    y, x = np.mgrid[0:n, 0:n] / n
    u, v = (x * 4) % 1, (y * 4) % 1
    d = np.abs(u - .5) + np.abs(v - .5)  # diamond distance: 0 centre .. 1 cell corner
    rgb = np.empty((n, n, 3))
    rgb[:] = srgb01('#1B1519')
    gold, wine = srgb01('#6A5630'), srgb01('#4E1724')
    rgb[np.abs(d - .5) < .018] = gold
    rgb[d < .2] = wine
    rgb[np.abs(d - .14) < .014] = gold
    rgb[d < .045] = gold
    rgb[(1 - d) < .09] = wine
    rgb *= 1 + np.random.default_rng(7).normal(0, .06, (n, n, 1))  # pile noise
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((n, n, 1))], axis=2)
    img = bpy.data.images.new('carpet_standard', n, n)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.filepath_raw, img.file_format = path, 'JPEG'
    try:
        img.save(quality=88)
    except TypeError:
        img.save()
    bpy.data.images.remove(img)
    return bpy.data.images.load(path)


# ------------------------------------------------------------------ mesh builder
class Mesh:
    def __init__(self, name, uv_fn=None, recalc=True):
        self.name, self.uv_fn, self.recalc = name, uv_fn, recalc
        self.bm, self.mats, self.sharp = bmesh.new(), [], []

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def add(self, V, F, m, smooth=False, mats=None):
        vs = [self.bm.verts.new(v) for v in V]
        for i, f in enumerate(F):
            bf = self.bm.faces.new([vs[j] for j in f])
            bf.material_index = self._mi(mats[i] if mats else m)
            bf.smooth = smooth[i] if isinstance(smooth, (list, tuple)) else smooth
        return vs

    def finish(self):
        bm = self.bm
        if self.recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        for a, b in self.sharp:
            e = bm.edges.get((a, b))
            if e:
                e.smooth = False
        if self.uv_fn:
            uv = bm.loops.layers.uv.new('UVMap')
            for f in bm.faces:
                for lp in f.loops:
                    lp[uv].uv = self.uv_fn(lp.vert.co)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def box(M, x0, x1, y0, y1, z0, z1, m):
    V = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    M.add(V, [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)], m)


def prism(M, prof, axis, a0, a1, m, smooth=False):
    """Extrude a closed 2D outline. axis X: prof=(y,z); Y: prof=(x,z); Z: prof=(x,y)."""
    P = {'X': lambda u, v, a: (a, u, v), 'Y': lambda u, v, a: (u, a, v), 'Z': lambda u, v, a: (u, v, a)}[axis]
    n = len(prof)
    V = [P(u, v, a0) for u, v in prof] + [P(u, v, a1) for u, v in prof]
    F = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    M.add(V, F, m, [False, False] + [smooth] * n)


def loft(M, rings, m):
    n = len(rings[0])
    V = [p for r in rings for p in r]
    F = [tuple(range(n)), tuple(range(len(V) - 1, len(V) - n - 1, -1))]
    for i in range(len(rings) - 1):
        a, b = i * n, (i + 1) * n
        F += [(a + k, a + (k + 1) % n, b + (k + 1) % n, b + k) for k in range(n)]
    M.add(V, F, m)


def _arc(r, z, seg, k, a0, a1, mtx):
    return [tuple(mtx @ Vector((r * cos(a0 + (a1 - a0) * s / seg), r * sin(a0 + (a1 - a0) * s / seg), z))) for s in range(k)]


def cyl(M, r0, r1, z0, z1, seg, m, mtx=Matrix(), a0=0.0, a1=2 * pi, smooth=True):
    """Capped (partial) frustum along local Z; partial arcs get a flat chord face."""
    full = abs(a1 - a0 - 2 * pi) < 1e-6
    k = seg if full else seg + 1
    V = _arc(r0, z0, seg, k, a0, a1, mtx) + _arc(r1, z1, seg, k, a0, a1, mtx)
    sides = range(k) if full else range(k - 1)
    F = [tuple(range(k)), tuple(range(2 * k - 1, k - 1, -1))] + [(i, (i + 1) % k, k + (i + 1) % k, k + i) for i in sides]
    S = [False, False] + [smooth] * len(sides)
    if not full:
        F.append((0, k, 2 * k - 1, k - 1))
        S.append(False)
    M.add(V, F, m, S)


def lathe(M, prof, seg, mats, smooth, mtx=Matrix(), a0=0.0, a1=2 * pi):
    """Revolve a closed (r,z) profile; per-profile-edge materials / smoothing."""
    full = abs(a1 - a0 - 2 * pi) < 1e-6
    k, n = (seg if full else seg + 1), len(prof)
    V = [tuple(mtx @ Vector((r * cos(a0 + (a1 - a0) * s / seg), r * sin(a0 + (a1 - a0) * s / seg), z)))
         for s in range(k) for r, z in prof]
    F, FM, FS = [], [], []
    for s in range(seg):
        s2 = (s + 1) % k
        for i in range(n):
            i2 = (i + 1) % n
            F.append((s * n + i, s * n + i2, s2 * n + i2, s2 * n + i))
            FM.append(mats[i])
            FS.append(smooth[i])
    if not full:
        F += [tuple(range(n)), tuple((k - 1) * n + i for i in reversed(range(n)))]
        FM += [mats[0]] * 2
        FS += [False] * 2
    M.add(V, F, None, FS, FM)


def text(M, body, size, m, xf):
    cu = bpy.data.curves.new('_t', 'FONT')
    cu.body, cu.size, cu.extrude, cu.resolution_u = body, size, 0.0008, 3
    cu.align_x, cu.align_y = 'CENTER', 'CENTER'
    ob = bpy.data.objects.new('_t', cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    M.add([xf(v.co) for v in me.vertices], [tuple(p.vertices) for p in me.polygons], m)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)


# ------------------------------------------------------------------ kits
ALL = ['WallPanel', 'WallBase', 'CeilingPanel', 'Carpet', 'StepNosing', 'StepLight', 'Downlight',
       'ExitSign', 'Speaker', 'ScreenBorderH', 'ScreenBorderV']
KITS = {
    'standard': dict(
        modules=ALL + ['Sconce', 'Curtain'],
        wall=('#5A1A24', .95), chamfer=.012, base='dado', dado='#2B2429', trim='#141214',
        ceiling='#2A292E', carpet=None, nosing=('#6B6358', .8, .35), led=('#FFD9A8', 3), step=('#FFD9A8', 3),
        down=('#2B2B2E', '#0C0C0D', '#FFB46B', 5), exit=('#B9BDC1', 1.8), spk=(.36, .55, .28, '#1D1D20', '#0F0F11'),
        velvet='#070707', curtain='#5E0F1C', sconce=('#5C4632', '#FFA757', 3)),
    'imax': dict(
        modules=ALL + ['Railing'],
        wall=('#0B0B0C', 1.0), chamfer=.006, base='skirt', trim='#0A0A0B',
        ceiling='#080809', carpet='#16181D', nosing=('#141416', 0.0, .8), led=('#CFE3FF', 2), step=('#9CC8FF', 2.5),
        down=('#0C0C0D', '#070707', '#E6EEFF', 4), exit=('#151517', 1.5), spk=(.45, .75, .38, '#0B0B0C', '#060606'),
        velvet='#050505', rail=('#121214', '#BFD8FF', 2)),
    'dolby': dict(
        modules=ALL + ['Railing'],
        wall=('#09090A', 1.0), chamfer=.004, base='cove', trim='#09090A', accent=('#5B4BFF', 3),
        ceiling='#070708', carpet='#0B0B0C', nosing=('#0F0F11', 0.0, .8), led=('#BFD4FF', 1.5), step=('#BFD4FF', 2),
        down=('#0A0A0B', '#060606', '#DCE6FF', 3), exit=('#151517', 1.2), spk=(.26, .38, .24, '#0A0A0B', '#050505'),
        velvet='#040404', rail=('#0F0F11', '#BFD4FF', 1.5)),
}


def build_module(name, K):
    nos_col, nos_metal, nos_rough = K['nosing']
    if name == 'WallPanel':  # acoustic fabric tile, chamfered vertical edges -> seam between tiles
        M, d, c = Mesh(name), .04, K['chamfer']
        prism(M, [(0, 0), (d - c, 0), (d, c), (d, 1 - c), (d - c, 1), (0, 1)], 'Z', 0, 1,
              mat('WallFabric', K['wall'][0], K['wall'][1]))
    elif name == 'WallBase':
        M, trim = Mesh(name), mat('BaseTrim', K['trim'], .55 if K['base'] == 'dado' else 1.0)
        if K['base'] == 'dado':  # 0.92 m dado: kick + panel (seam chamfers) + cap rail
            box(M, 0, .085, 0, 1, 0, .1, trim)
            prism(M, [(0, 0), (.065, 0), (.07, .005), (.07, .995), (.065, 1), (0, 1)], 'Z', .1, .875,
                  mat('Dado', K['dado'], .8))
            prism(M, [(0, .875), (.08, .875), (.095, .895), (.085, .915), (0, .915)], 'Y', 0, 1, trim)
        elif K['base'] == 'skirt':
            prism(M, [(0, 0), (.06, 0), (.06, .11), (.05, .12), (0, .12)], 'Y', 0, 1, trim)
        else:  # skirting with blue-violet LED on its 45 deg top chamfer: seen from seats, washes up the wall
            prism(M, [(0, 0), (.07, 0), (.07, .14), (.06, .15), (0, .15)], 'Y', 0, 1, trim)
            n, t, c = Vector((.7071, .7071)), Vector((-.7071, .7071)), Vector((.065, .145)) + Vector((.7071, .7071)) * .0007
            led = [c - t * .006 - n * .0006, c + t * .006 - n * .0006, c + t * .006 + n * .0006, c - t * .006 + n * .0006]
            prism(M, [tuple(p) for p in led], 'Y', 0, 1, mat('AccentLED', K['accent'][0], .5, emit=K['accent'][0],
                                                            strength=K['accent'][1]))
    elif name == 'CeilingPanel':  # bevelled acoustic tile, face down at z=0
        M, c, t = Mesh(name), .012, .03
        r = lambda x0, x1, y0, y1, z: [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
        loft(M, [r(c, 1 - c, -1 + c, -c, 0), r(0, 1, -1, 0, c), r(0, 1, -1, 0, t)], mat('CeilingTile', K['ceiling'], 1.0))
    elif name == 'Carpet':
        if K['carpet'] is None:
            img = carpet_image(os.path.join(bpy.app.tempdir, 'carpet_standard.jpg'))
            m = mat('Carpet', '#FFFFFF', 1.0, image=img)
        else:
            m = mat('Carpet', K['carpet'], 1.0)
        M = Mesh(name, uv_fn=lambda co: (co.x, co.y + 1))
        box(M, 0, 1, -1, 0, -.01, 0, m)
    elif name == 'StepNosing':  # L-profile nosing, LED strip on the 45 deg nose chamfer
        M = Mesh(name)
        prism(M, [(-.055, 0), (-.055, .006), (-.01, .006), (.008, -.012), (.008, -.045), (0, -.045), (0, 0)], 'X', 0, 1,
              mat('Nosing', nos_col, nos_rough, nos_metal))
        n, t, c = Vector((.7071, .7071)), Vector((.7071, -.7071)), Vector((-.001, -.003)) + Vector((.7071, .7071)) * .0007
        led = [c - t * .0045 - n * .0006, c + t * .0045 - n * .0006, c + t * .0045 + n * .0006, c - t * .0045 + n * .0006]
        prism(M, [tuple(p) for p in led], 'X', 0, 1, mat('StepLED', K['led'][0], .5, emit=K['led'][0], strength=K['led'][1]))
    elif name == 'StepLight':  # riser light: plate + eyebrow hood + lens
        M, plate = Mesh(name), mat('Nosing', nos_col, nos_rough, nos_metal)
        box(M, -.05, .05, 0, .006, -.025, .025, plate)
        box(M, -.046, .046, .006, .02, .006, .013, plate)
        box(M, -.04, .04, .006, .0075, -.016, .004, mat('StepLens', K['step'][0], .4, emit=K['step'][0], strength=K['step'][1]))
    elif name == 'Sconce':  # half-cylinder up/down light, glowing band + glowing interior
        M, (shell_c, glow_c, s) = Mesh(name), K['sconce']
        shell, glow = mat('SconceBronze', shell_c, .4, .75), mat('SconceGlow', glow_c, .4, emit=glow_c, strength=s)
        for z0, z1 in ((.03, .28), (-.28, -.03)):
            lathe(M, [(.092, z0), (.10, z0), (.10, z1), (.092, z1)], 16, [shell, shell, shell, glow],
                  [False, True, False, True], a0=-pi / 2, a1=pi / 2)
        cyl(M, .097, .097, -.03, .03, 16, glow, a0=-pi / 2, a1=pi / 2)
    elif name == 'Downlight':  # surface-mount can: everything hangs below the ceiling plane
        M, (trim_c, baffle_c, glow_c, s) = Mesh(name), K['down']
        trim, baffle = mat('DownTrim', trim_c, .45, .5), mat('DownBaffle', baffle_c, 1.0)
        lathe(M, [(.075, 0), (.075, -.07), (.062, -.07), (.045, -.03), (.045, 0)], 24,
              [trim, trim, baffle, baffle, trim], [True, False, True, True, False])
        cyl(M, .046, .046, -.032, -.028, 24, mat('DownGlow', glow_c, .4, emit=glow_c, strength=s), smooth=False)
    elif name == 'ExitSign':
        M, (housing_c, s) = Mesh(name), K['exit']
        box(M, 0, .05, -.18, .18, -.08, .08, mat('ExitHousing', housing_c, .5, .3))
        box(M, .05, .054, -.168, .168, -.068, .068, mat('ExitGreen', '#19E06A', .4, emit='#19E06A', strength=s))
        text(M, 'EXIT', .085, mat('ExitWhite', '#F4FFF7', .4, emit='#F4FFF7', strength=s * 1.2),
             lambda co: (.054 + co.z, co.x, co.y))
    elif name == 'Speaker':
        M, (w, h, d, cab_c, gr_c) = Mesh(name), K['spk']
        ch, w2, h2 = .015, w / 2, h / 2
        oct_ = lambda a, b, c: [(-a + c, -b), (a - c, -b), (a, -b + c), (a, b - c), (a - c, b), (-a + c, b), (-a, b - c), (-a, -b + c)]
        prism(M, oct_(w2, h2, ch), 'X', 0, d - .006, mat('SpeakerCabinet', cab_c, .65))
        prism(M, oct_(w2 - .012, h2 - .012, ch * .6), 'X', d - .006, d, mat('SpeakerGrille', gr_c, 1.0))
    elif name in ('ScreenBorderH', 'ScreenBorderV'):  # 0.5 m black velvet masking, 1 m long
        M = Mesh(name)
        prism(M, [(0, 0), (.06, 0), (.08, .02), (.08, .48), (.06, .5), (0, .5)], 'Y' if name[-1] == 'H' else 'Z', 0, 1,
              mat('Velvet', K['velvet'], 1.0))
    elif name == 'Curtain':  # 6 box pleats per metre; straight verticals so it tiles both ways
        M, cols = Mesh(name, recalc=False), 72
        V = []
        for j in range(cols + 1):
            y = j / cols
            x = .015 + .10 * abs(sin(6 * pi * y)) ** .6
            V += [(x, y, 0), (x, y, 1)]
        F = [(2 * j, 2 * j + 2, 2 * j + 3, 2 * j + 1) for j in range(cols)]
        vs = M.add(V, F, mat('CurtainVelvet', K['curtain'], .85, double=True), True)
        M.sharp = [(vs[2 * j], vs[2 * j + 1]) for j in range(0, cols + 1, 12)]  # crisp fold creases
    elif name == 'Railing':  # aisle handrail with LED under the rail
        M, (rail_c, led_c, s) = Mesh(name), K['rail']
        rail = mat('RailMetal', rail_c, .7, .5)
        cyl(M, .022, .022, 0, 1, 12, rail, Matrix.Translation((0, 0, .92)) @ Matrix.Rotation(radians(90), 4, 'Y'))
        cyl(M, .02, .02, 0, .9, 12, rail, Matrix.Translation((.5, 0, 0)))
        cyl(M, .055, .055, 0, .012, 16, rail, Matrix.Translation((.5, 0, 0)))
        box(M, 0, 1, -.006, .006, .892, .898, mat('RailLED', led_c, .5, emit=led_c, strength=s))
    return M.finish()


# Light_* empties: sample room in three.js coords (screen wall z=0, audience +z, floor y=0, centre x=0).
# intensity units: point/spot = candela, rect = nits (cd/m2), strip = candela per metre.
def P(name, pos, color, intensity, **kw):
    return (name, pos, color, intensity, kw)


def lights(kit):
    L = []
    if kit == 'standard':  # 16 w x 20 d x 9 h, scope screen 14 x 5.86, bottom at 1.1 m
        for i, (x, z) in enumerate([(-7.95, 5), (-7.95, 10), (-7.95, 15), (7.95, 5), (7.95, 10), (7.95, 15)], 1):
            L.append(P(f'Light_Sconce_{i}', (x, 2.6, z), '#FFA757', 25, type='point', range=5.0, show_dim=0.15))
        for i, (x, z) in enumerate([(-4, 6), (4, 6), (-4, 12), (4, 12), (-4, 18), (4, 18)], 1):
            L.append(P(f'Light_Downlight_{i}', (x, 9, z), '#FFB46B', 150, type='spot', angle=50.0, aim='down', range=12.0, show_dim=0.0))
        for k in range(1, 5):
            L.append(P(f'Light_StepLight_{k}', (-6.6, .3 * k - .15, 7 + k), '#FFD9A8', 0.6, type='point', range=1.5))
        L.append(P('Light_StepNosing_1', (-6.6, .3, 8), '#FFD9A8', 0.4, type='strip', range=1.0))
        exits, screen = [(-7.95, 2.4, 19), (7.95, 2.4, 19)], ('#E8EEFF', 48, 14.0, 5.86, 1.1)
    elif kit == 'imax':  # 24 w x 26 d x 18 h, 1.43:1 screen 22 x 15.4, bottom at 0.9 m
        for i, (x, z) in enumerate([(-6, 8), (6, 8), (-6, 16), (6, 16)], 1):
            L.append(P(f'Light_Downlight_{i}', (x, 18, z), '#E6EEFF', 120, type='spot', angle=40.0, aim='down', range=20.0, show_dim=0.0))
        for k in range(1, 7):
            L.append(P(f'Light_StepLight_{k}', (-9, .5 * k - .25, 6 + k), '#9CC8FF', 0.4, type='point', range=1.5))
        L.append(P('Light_StepNosing_1', (-9, .5, 7), '#CFE3FF', 0.25, type='strip', range=1.0))
        L.append(P('Light_Railing_1', (-8.6, 1.4, 8), '#BFD8FF', 0.2, type='strip', range=1.0))
        exits, screen = [(-11.95, 2.4, 25), (11.95, 2.4, 25)], ('#EEF2FF', 75, 22.0, 15.4, 0.9)
    else:  # dolby: 16 w x 20 d x 9 h, screen 15 x 6.28 wall to wall, bottom at 1.0 m
        for i, (x, z) in enumerate([(-7.95, 4), (-7.95, 10), (-7.95, 16), (7.95, 4), (7.95, 10), (7.95, 16)], 1):
            L.append(P(f'Light_Accent_{i}', (x, .25, z), '#5B4BFF', 6, type='spot', angle=70.0, aim='up', range=4.0))
        for i, (x, z) in enumerate([(-4, 7), (4, 7), (-4, 14), (4, 14)], 1):
            L.append(P(f'Light_Downlight_{i}', (x, 9, z), '#DCE6FF', 60, type='spot', angle=30.0, aim='down', range=10.0, show_dim=0.0))
        for k in range(1, 5):
            L.append(P(f'Light_StepLight_{k}', (-6.6, .35 * k - .175, 7 + k), '#BFD4FF', 0.25, type='point', range=1.2))
        L.append(P('Light_StepNosing_1', (-6.6, .35, 8), '#BFD4FF', 0.2, type='strip', range=1.0))
        L.append(P('Light_Railing_1', (-6.2, 1.25, 9), '#BFD4FF', 0.15, type='strip', range=1.0))
        exits, screen = [(-7.95, 2.4, 19), (7.95, 2.4, 19)], ('#F0F2FF', 106, 15.0, 6.28, 1.0)
    for i, p in enumerate(exits, 1):
        L.append(P(f'Light_ExitSign_{i}', p, '#19E06A', 2 if kit != 'dolby' else 1.5, type='point', range=3.0))
    col, nits, w, h, bottom = screen
    L.append(P('Light_Screen_1', (0, bottom + h / 2, .1), col, nits, type='rect', width=w, height=h,
               note='screen bounce while a film plays; scale with picture brightness'))
    return L


def add_light(name, pos, color, intensity, kw):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = (pos[0], -pos[2], pos[1])  # three -> blender
    e.empty_display_type, e.empty_display_size = 'SPHERE', .15
    e['color'], e['intensity'] = color, float(intensity)
    for k, v in kw.items():
        e[k] = v
    return e


# ------------------------------------------------------------------ AO -> vertex colour "AO"
WALL = {'WallPanel', 'WallBase', 'Sconce', 'ExitSign', 'Speaker', 'ScreenBorderH', 'ScreenBorderV', 'Curtain'}
FLOOR = {'WallBase', 'Railing'}


def _plane(pts):
    me = bpy.data.meshes.new('_occ')
    me.from_pydata(pts, [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new('_occ', me)
    bpy.context.scene.collection.objects.link(o)
    return o


def occluders(ob):
    """Temporary wall/floor/riser planes so contact shadow lands where the module meets the room."""
    bb = [Vector(c) for c in ob.bound_box]
    lo = Vector([min(v[i] for v in bb) for i in range(3)]) - Vector((1, 1, 1))
    hi = Vector([max(v[i] for v in bb) for i in range(3)]) + Vector((1, 1, 1))
    hs, e = [], -.0005
    if ob.name in WALL:
        hs.append(_plane([(e, lo.y, lo.z), (e, hi.y, lo.z), (e, hi.y, hi.z), (e, lo.y, hi.z)]))
    if ob.name in FLOOR:
        hs.append(_plane([(lo.x, lo.y, e), (hi.x, lo.y, e), (hi.x, hi.y, e), (lo.x, hi.y, e)]))
    if ob.name == 'StepNosing':  # tread behind (y<0) and riser below (z<0)
        hs.append(_plane([(lo.x, lo.y, e), (hi.x, lo.y, e), (hi.x, 0, e), (lo.x, 0, e)]))
        hs.append(_plane([(lo.x, e, lo.z), (hi.x, e, lo.z), (hi.x, e, 0), (lo.x, e, 0)]))
    if ob.name == 'StepLight':
        hs.append(_plane([(lo.x, e, lo.z), (hi.x, e, lo.z), (hi.x, e, hi.z), (lo.x, e, hi.z)]))
    return hs


def bake_ao(objs):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device, sc.cycles.samples = 'CPU', 64
    sc.world.light_settings.distance = 0.2
    for ob in objs:
        hs = occluders(ob)
        for o in objs:
            o.hide_render = o is not ob
        # CORNER domain: AO per face corner with the face's own normal, so flat tiles stay
        # uniform (no gradient from averaged normals) and tile seamlessly
        ca = ob.data.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
        ob.data.color_attributes.active_color = ca
        for o in sc.objects:
            o.select_set(False)
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        for h in hs:
            me = h.data
            bpy.data.objects.remove(h)
            bpy.data.meshes.remove(me)
    for o in objs:
        o.hide_render = False


# ------------------------------------------------------------------ main
def stats(ob):
    me = ob.data
    xs, ys, zs = ([v.co[i] for v in me.vertices] for i in range(3))
    return dict(tris=sum(len(p.vertices) - 2 for p in me.polygons),
                size_xyz=[round(max(xs) - min(xs), 3), round(max(zs) - min(zs), 3), round(max(ys) - min(ys), 3)],
                min_xyz=[round(min(xs), 3), round(min(zs), 3), round(-max(ys), 3)],
                max_xyz=[round(max(xs), 3), round(max(zs), 3), round(-min(ys), 3)])


report = {}
for kit, K in KITS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.world = bpy.data.worlds.new('World')
    objs = [build_module(n, K) for n in K['modules']]
    for name, pos, color, intensity, kw in lights(kit):
        add_light(name, pos, color, intensity, kw)
    bpy.context.view_layer.update()
    bake_ao(objs)
    path = os.path.join(OUT, f'room-{kit}.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_extras=True,
        export_cameras=False, export_lights=False, export_animations=False,
        export_draco_mesh_compression_enable=False, export_image_format='JPEG', export_jpeg_quality=85,
        export_vertex_color='NAME', export_vertex_color_name='AO', export_all_vertex_colors=False)
    report[kit] = dict(file=path, bytes=os.path.getsize(path), modules={o.name: stats(o) for o in objs})

print('REPORT ' + json.dumps(report))
