# prep.py - prepares the Sunbeams and JellyFish models for Meta Horizon Worlds.
# Run with Blender's Python module:  python prep.py -- <sunbeams.fbx> <jellyfish.fbx> <texture dir> <out dir>
#
# Output per asset:
#   <out>/<Group>/animated/<Name>_animated.fbx   skinned mesh + armature + one looping take
#   <out>/<Group>/static/<Name>.fbx              plain mesh in its rest pose (works everywhere)
# Materials use Horizon's naming convention (<Name>_Blend -> <Name>_BA.png), textures are copied
# next to each FBX so a folder can be imported in one go.

import bpy, bmesh, sys, os, math, shutil, json
import numpy as np
from mathutils import Vector, Matrix

SUN_FBX, JELLY_FBX, TEX, OUT = sys.argv[sys.argv.index('--') + 1:][:4]
REPORT = {}

# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_fbx(path):
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=False, automatic_bone_orientation=False)

def select_only(objs, active=None):
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)

def delete(objs):
    for o in list(objs):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()

def blend_material(name, tex_file, strength=1.6):
    """Material named <name>_Blend (Horizon: unlit, alpha blended) using <name>_BA.png."""
    mat = bpy.data.materials.get(name + '_Blend') or bpy.data.materials.new(name + '_Blend')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    img = bpy.data.images.load(os.path.join(TEX, tex_file), check_existing=True)
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
    nt.links.new(t.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = strength
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    try:
        mat.surface_render_method = 'BLENDED'
    except Exception:
        pass
    return mat

def set_single_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.material_index = 0

def strip_extras(mesh):
    while mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes[0])

def export_fbx(path, objs, animated, frame_range=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc = bpy.context.scene
    if frame_range:
        sc.frame_start, sc.frame_end = frame_range
    if animated:
        arm = next(o for o in objs if o.type == 'ARMATURE')
        sc.name = arm.animation_data.action.name  # FBX take name = scene name
    select_only(objs)
    bpy.ops.export_scene.fbx(
        filepath=path, use_selection=True, object_types={'ARMATURE', 'MESH'},
        apply_scale_options='FBX_SCALE_ALL', apply_unit_scale=True, global_scale=1.0,
        axis_forward='-Z', axis_up='Y', bake_space_transform=False,
        mesh_smooth_type='FACE', use_mesh_modifiers=not animated, use_tspace=False,
        add_leaf_bones=False, primary_bone_axis='Y', secondary_bone_axis='X', armature_nodetype='NULL',
        bake_anim=animated, bake_anim_use_all_bones=True, bake_anim_use_nla_strips=False,
        bake_anim_use_all_actions=False, bake_anim_force_startend_keying=True,
        bake_anim_step=1.0, bake_anim_simplify_factor=0.0,
        path_mode='STRIP', embed_textures=False)

def copy_textures(folder, files):
    for f in files:
        shutil.copy2(os.path.join(TEX, f), os.path.join(folder, os.path.basename(f)))

def world_bbox(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        ev = o.evaluated_get(dg)
        m = ev.to_mesh()
        mw = ev.matrix_world
        pts += [mw @ v.co for v in m.vertices]
        ev.to_mesh_clear()
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi

def baked_static_copy(obj, name):
    """Evaluated (posed) mesh with world transform applied, as a new standalone object."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
    me.transform(obj.matrix_world)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o

def channelbag_fcurves(action):
    curves = []
    try:
        for layer in action.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    curves += list(cb.fcurves)
    except AttributeError:
        curves = list(action.fcurves)
    return curves

def shift_action(action, offset):
    for fc in channelbag_fcurves(action):
        for k in fc.keyframe_points:
            k.co.x += offset
            k.handle_left.x += offset
            k.handle_right.x += offset
        fc.update()

def tri_count(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)

# ---------------------------------------------------------------------------------------------
# Sunbeams: three rigs -> three assets, scaled from ~115 m tall to ~6 m, one looping take each
# ---------------------------------------------------------------------------------------------

SUN_HEIGHT = 6.0
SUN_RIGS = [('Sunbeams_Animation1_armature', 'A'), ('Sunbeams_Animation2_armature', 'B'), ('Sunbeams _Animation_3_armature', 'C')]

def prep_sunbeams():
    reset(); import_fbx(SUN_FBX)
    sc = bpy.context.scene
    sc.frame_set(2)
    all_meshes = [o for o in sc.objects if o.type == 'MESH']
    lo, hi = world_bbox(all_meshes)
    scale = SUN_HEIGHT / (hi.z - lo.z)  # one factor for all three so they stay in proportion
    REPORT['sunbeam_scale'] = scale

    for rig_name, letter in SUN_RIGS:
        reset(); import_fbx(SUN_FBX)
        sc = bpy.context.scene
        sc.render.fps = 24
        arm = bpy.data.objects[rig_name]
        mesh = [o for o in sc.objects if o.type == 'MESH' and o.parent == arm][0]
        delete([o for o in sc.objects if o not in (arm, mesh)])
        name = f'Sunbeams_{letter}'
        arm.name = name + '_Rig'; arm.data.name = name + '_Rig'
        mesh.name = name; mesh.data.name = name
        strip_extras(mesh.data)
        set_single_material(mesh, blend_material('Sunbeam', 'Sunbeam_BA.png', 2.2))

        # loop: frames 2..600 (frame 601 repeats frame 2) -> shift to 0..598
        act = arm.animation_data.action
        act.name = name + '_Loop'
        shift_action(act, -2)
        loop_len = 599
        sc.frame_set(0)
        # scale and ground the cluster: centre on X/Y, base at Z=0 (rest of animation keeps its motion)
        arm.scale = (scale, scale, scale)
        bpy.context.view_layer.update()
        lo, hi = world_bbox([mesh])
        arm.location = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
        bpy.context.view_layer.update()
        lo, hi = world_bbox([mesh])

        folder = os.path.join(OUT, 'Sunbeams', 'animated')
        export_fbx(os.path.join(folder, name + '_animated.fbx'), [arm, mesh], True, (0, loop_len - 1))
        copy_textures(folder, ['Sunbeam_BA.png'])

        static = baked_static_copy(mesh, name)
        mesh.name = name + '_skinned'
        static.name = name
        set_single_material(static, mesh.data.materials[0])
        folder = os.path.join(OUT, 'Sunbeams', 'static')
        export_fbx(os.path.join(folder, name + '.fbx'), [static], False)
        copy_textures(folder, ['Sunbeam_BA.png'])
        REPORT[name] = {
            'tris': tri_count(mesh.data), 'bones': len(arm.data.bones), 'frames': loop_len, 'fps': 24,
            'size_m': [round(v, 2) for v in (hi - lo)],
        }

# ---------------------------------------------------------------------------------------------
# Jellyfish: one asset per jellyfish + bubbles. New UVs, hologram material, a swim rig and loop.
# ---------------------------------------------------------------------------------------------

JELLY_HEIGHT = 1.2          # JellyFish001 becomes 1.2 m tall; the others keep their relative size
BELL_V = 0.70               # texture: bell uses v 0.70-1.0, tentacles 0-0.70
CHAIN = 5                   # tentacle bones
LOOPS = {'JellyFish001': 72, 'JellyFish002': 66, 'JellyFish003': 78, 'JellyFish004': 70, 'JellyFish005': 84, 'JellyFish006': 60}

def analyse_jelly(co):
    """Bell centre, top, bell bottom and tentacle tip heights from vertex positions (Z up).
    The bell is the dense band of vertices at the top; vertex count per slice drops sharply where
    the tentacles start (their outline is as wide as the bell, so width alone can't find it)."""
    z = co[:, 2]
    ztop, zbot = z.max(), z.min()
    h = ztop - zbot
    top = co[z > ztop - 0.12 * h]
    cx, cy = top[:, 0].mean(), top[:, 1].mean()
    bins = 30
    edges = np.linspace(ztop, zbot, bins + 1)
    cnt = np.array([((z <= edges[i]) & (z > edges[i + 1])).sum() for i in range(bins)])
    zb = ztop - 0.18 * h
    for i in range(2, 13):
        if cnt[i] < 0.55 * cnt[:i].mean():
            zb = edges[i]
            break
    zb = min(ztop - 0.10 * h, max(ztop - 0.40 * h, zb))
    return cx, cy, ztop, zb, zbot

def build_uvs(mesh, ztop, zb, zbot):
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    uv = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        p = mesh.vertices[loop.vertex_index].co
        u = math.atan2(p.y, p.x) / (2 * math.pi) + 0.5
        if p.z >= zb:
            v = BELL_V + (1 - BELL_V) * (p.z - zb) / max(1e-6, ztop - zb)
        else:
            v = BELL_V * (p.z - zbot) / max(1e-6, zb - zbot)
        uv.data[loop.index].uv = (u, min(1.0, max(0.0, v)))

def build_jelly_rig(name, ztop, zb, zbot):
    arm_data = bpy.data.armatures.new(name + '_Rig')
    arm = bpy.data.objects.new(name + '_Rig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    select_only([arm])
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones
    root = eb.new('Root'); root.head = (0, 0, zb); root.tail = (0, 0, zb + 0.15 * (ztop - zb) + 1e-3)
    bell = eb.new('Bell'); bell.head = (0, 0, zb); bell.tail = (0, 0, ztop); bell.parent = root
    prev = root
    seg = (zb - zbot) / CHAIN
    for i in range(CHAIN):
        b = eb.new(f'Tentacle{i + 1}')
        b.head = (0, 0, zb - i * seg); b.tail = (0, 0, zb - (i + 1) * seg)
        b.parent = prev
        b.use_connect = i > 0
        prev = b
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    return arm

def skin_jelly(obj, arm, ztop, zb, zbot):
    groups = {b.name: obj.vertex_groups.new(name=b.name) for b in arm.data.bones if b.name != 'Root'}
    blend = 0.06 * (ztop - zbot)
    centers = [(zb - (i + 0.5) * (zb - zbot) / CHAIN) for i in range(CHAIN)]
    for v in obj.data.vertices:
        z = v.co.z
        w = {}
        if z >= zb + blend:
            w['Bell'] = 1.0
        else:
            tb = 0.0 if z < zb - blend else (z - (zb - blend)) / (2 * blend)  # bell share in the blend band
            if tb > 0:
                w['Bell'] = tb
            # tentacle chain: linear blend between neighbouring bone centres
            if z >= centers[0]:
                tw = {0: 1.0}
            elif z <= centers[-1]:
                tw = {CHAIN - 1: 1.0}
            else:
                k = max(i for i in range(CHAIN) if centers[i] >= z)
                f = (centers[k] - z) / (centers[k] - centers[k + 1])
                tw = {k: 1 - f, k + 1: f}
            for i, x in tw.items():
                w[f'Tentacle{i + 1}'] = w.get(f'Tentacle{i + 1}', 0) + x * (1 - tb)
        for bn, x in w.items():
            if x > 1e-4:
                groups[bn].add([v.index], x, 'REPLACE')
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    obj.parent = arm

def animate_jelly(arm, name, L, height):
    """Seamless swim loop of L frames: bell squeeze, upward thrust, lagging tentacle wave."""
    if not arm.animation_data:
        arm.animation_data_create()
    pbs = arm.pose.bones
    for f in range(L + 1):
        p = f / L
        k = ((1 - math.cos(2 * math.pi * p)) / 2) ** 1.4               # contraction 0..1
        bell = pbs['Bell']
        bell.scale = (1 - 0.17 * k, 1 + 0.10 * k, 1 - 0.17 * k)
        bell.keyframe_insert('scale', frame=f)
        root = pbs['Root']
        root.location = (0, 0.045 * height * math.sin(2 * math.pi * p - 1.1), 0)  # rises after each squeeze
        root.rotation_euler = (0.035 * math.sin(2 * math.pi * p), 0, 0.03 * math.cos(2 * math.pi * p))
        root.keyframe_insert('location', frame=f)
        root.keyframe_insert('rotation_euler', frame=f)
        for i in range(CHAIN):
            t = pbs[f'Tentacle{i + 1}']
            amp = 0.05 + 0.045 * i
            ph = 2 * math.pi * p - 0.85 * (i + 1)
            t.rotation_euler = (amp * math.sin(ph), 0, amp * 0.7 * math.cos(ph + 0.6))
            t.scale = (1, 1 - 0.04 * k * (CHAIN - i) / CHAIN, 1)
            t.keyframe_insert('rotation_euler', frame=f)
            t.keyframe_insert('scale', frame=f)
    arm.animation_data.action.name = name + '_Swim'

def animate_bubbles(arm, L):
    if not arm.animation_data:
        arm.animation_data_create()
    for f in range(L + 1):
        p = f / L
        for i, pb in enumerate(arm.pose.bones):
            ph = i * 1.7
            pb.location = (0.05 * math.sin(2 * math.pi * p + ph), 0.09 * math.sin(2 * math.pi * p + ph * 0.6), 0.04 * math.cos(4 * math.pi * p + ph))
            pb.keyframe_insert('location', frame=f)
    arm.animation_data.action.name = 'Bubbles_Drift'

def prep_jellyfish():
    reset(); import_fbx(JELLY_FBX)
    sc = bpy.context.scene
    sc.render.fps = 24
    ref = bpy.data.objects['JellyFish001']
    # measure JellyFish001 height in world space to set the global scale
    lo, hi = world_bbox([ref])
    scale = JELLY_HEIGHT / (hi.z - lo.z)
    REPORT['jelly_scale'] = scale
    layout = {}
    names = sorted(o.name for o in sc.objects if o.type == 'MESH')
    for src_name in names:
        reset(); import_fbx(JELLY_FBX)
        sc = bpy.context.scene
        sc.render.fps = 24
        src = bpy.data.objects[src_name]
        delete([o for o in sc.objects if o is not src])
        me = src.data
        me.transform(Matrix.Scale(scale, 4) @ src.matrix_world)
        src.matrix_world = Matrix.Identity(4)
        strip_extras(me)
        co = np.array([v.co[:] for v in me.vertices])

        if src_name == 'Bubbles':
            name = 'Bubbles'
            lo3, hi3 = co.min(0), co.max(0)
            ctr = Vector(((lo3[0] + hi3[0]) / 2, (lo3[1] + hi3[1]) / 2, lo3[2]))
            layout[name] = [round(c, 3) for c in ctr]
            me.transform(Matrix.Translation(-ctr))
            select_only([src])
            dec = src.modifiers.new('Decimate', 'DECIMATE'); dec.ratio = 0.25
            bpy.ops.object.modifier_apply(modifier=dec.name)
            set_single_material(src, blend_material('Bubble', 'Bubble_BA.png', 1.2))
            src.name = name; me.name = name
            # rig: 6 bones, each bubble island follows its nearest bone
            co = np.array([v.co[:] for v in me.vertices])
            bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
            island = [-1] * len(bm.verts); n_isl = 0
            for v in bm.verts:
                if island[v.index] >= 0: continue
                stack = [v]; island[v.index] = n_isl
                while stack:
                    x = stack.pop()
                    for e in x.link_edges:
                        w = e.other_vert(x)
                        if island[w.index] < 0: island[w.index] = n_isl; stack.append(w)
                n_isl += 1
            island = np.array(island)
            centers = np.array([co[island == i].mean(0) for i in range(n_isl)])
            K = 6
            ks = centers[np.argsort(centers[:, 0])][np.linspace(0, n_isl - 1, K).astype(int)]
            for _ in range(10):
                lab = np.argmin(((centers[:, None, :] - ks[None]) ** 2).sum(-1), 1)
                ks = np.array([centers[lab == j].mean(0) if (lab == j).any() else ks[j] for j in range(K)])
            arm_data = bpy.data.armatures.new('Bubbles_Rig'); arm = bpy.data.objects.new('Bubbles_Rig', arm_data)
            sc.collection.objects.link(arm); select_only([arm]); bpy.ops.object.mode_set(mode='EDIT')
            for j in range(K):
                b = arm_data.edit_bones.new(f'Cluster{j + 1}'); b.head = Vector(ks[j]); b.tail = Vector(ks[j]) + Vector((0, 0, 0.1))
            bpy.ops.object.mode_set(mode='OBJECT')
            groups = [src.vertex_groups.new(name=f'Cluster{j + 1}') for j in range(K)]
            for vi, isl in enumerate(island):
                groups[int(lab[isl])].add([vi], 1.0, 'REPLACE')
            mod = src.modifiers.new('Armature', 'ARMATURE'); mod.object = arm; src.parent = arm
            L = 96
            animate_bubbles(arm, L)
            height = hi3[2] - lo3[2]
        else:
            idx = src_name[-3:]
            name = f'JellyFish{idx[1:]}'
            cx, cy, ztop, zb, zbot = analyse_jelly(co)
            origin = Vector((cx, cy, zb))
            layout[name] = [round(c, 3) for c in origin]
            me.transform(Matrix.Translation(-origin))
            ztop, zb, zbot = ztop - origin.z, 0.0, zbot - origin.z
            build_uvs(me, ztop, zb, zbot)
            set_single_material(src, blend_material('Jellyfish', 'Jellyfish_BA.png', 1.8))
            src.name = name; me.name = name
            arm = build_jelly_rig(name, ztop, zb, zbot)
            skin_jelly(src, arm, ztop, zb, zbot)
            L = LOOPS[src_name]
            height = ztop - zbot
            animate_jelly(arm, name, L, height)

        folder = os.path.join(OUT, 'JellyFish', 'animated')
        tex = ['Bubble_BA.png'] if name == 'Bubbles' else ['Jellyfish_BA.png']
        export_fbx(os.path.join(folder, name + '_animated.fbx'), [arm, src], True, (0, L - 1))
        copy_textures(folder, tex)
        sc.frame_set(0)
        # static: rest pose (no armature)
        src.modifiers.remove(src.modifiers['Armature'])
        src.parent = None
        for g in list(src.vertex_groups):
            src.vertex_groups.remove(g)
        folder = os.path.join(OUT, 'JellyFish', 'static')
        export_fbx(os.path.join(folder, name + '.fbx'), [src], False)
        copy_textures(folder, tex)
        lo, hi = world_bbox([src])
        REPORT[name] = {'tris': tri_count(me), 'bones': len(arm.data.bones), 'frames': L, 'fps': 24,
                        'size_m': [round(v, 2) for v in (hi - lo)]}
    REPORT['jelly_layout'] = layout

prep_sunbeams()
prep_jellyfish()
with open(os.path.join(OUT, 'report.json'), 'w') as f:
    json.dump(REPORT, f, indent=1)
print(json.dumps(REPORT, indent=1))
