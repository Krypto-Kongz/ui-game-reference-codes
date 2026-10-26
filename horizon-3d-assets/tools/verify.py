import bpy, sys, os, glob, json
import numpy as np

OUT = sys.argv[sys.argv.index('--') + 1]
results = []

def evaluated_verts(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    arrs = []
    for o in objs:
        ev = o.evaluated_get(dg)
        m = ev.to_mesh()
        a = np.array([(ev.matrix_world @ v.co)[:] for v in m.vertices])
        ev.to_mesh_clear()
        arrs.append(a)
    return np.concatenate(arrs)

for path in sorted(glob.glob(os.path.join(OUT, '*', '*', '*.fbx'))):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    sc = bpy.context.scene
    meshes = [o for o in sc.objects if o.type == 'MESH']
    arms = [o for o in sc.objects if o.type == 'ARMATURE']
    folder = os.path.dirname(path)
    r = {'file': os.path.relpath(path, OUT), 'meshes': len(meshes), 'armatures': len(arms)}
    mats = sorted({s.material.name for o in meshes for s in o.material_slots if s.material})
    r['materials'] = mats
    texfiles = sorted({os.path.basename(i.filepath) for i in bpy.data.images})
    r['texture_refs'] = texfiles
    # Horizon convention: material <Name>_Blend needs <Name>_BA.png next to the FBX
    r['textures_present'] = all(os.path.exists(os.path.join(folder, m.rsplit('_', 1)[0] + '_BA.png')) for m in mats)
    uvs = np.concatenate([np.array([d.uv[:] for d in o.data.uv_layers[0].data]) for o in meshes])
    r['uv_range'] = [round(float(uvs.min()), 3), round(float(uvs.max()), 3)]
    r['tris'] = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    acts = [a for a in bpy.data.actions]
    r['takes'] = [a.name for a in acts]
    if arms and arms[0].animation_data and arms[0].animation_data.action:
        a = arms[0].animation_data.action
        f0, f1 = int(a.frame_range[0]), int(a.frame_range[1])
        r['frames'] = [f0, f1]
        sc.frame_set(f0); p0 = evaluated_verts(meshes)
        size = p0.max(0) - p0.min(0)
        r['size_m'] = [round(float(x), 2) for x in size]
        steps = []
        prev = p0
        for f in range(f0 + 1, f1 + 1, max(1, (f1 - f0) // 24)):
            sc.frame_set(f); cur = evaluated_verts(meshes)
            steps.append(np.abs(cur - prev).max()); prev = cur
        sc.frame_set((f0 + f1) // 2); mid = evaluated_verts(meshes)
        sc.frame_set(f1); last = evaluated_verts(meshes)
        sc.frame_set(f1 - 1); before = evaluated_verts(meshes)
        r['motion_m'] = round(float(np.abs(mid - p0).max()), 3)
        step = float(np.abs(last - before).max())
        r['loop_gap_vs_step'] = round(float(np.abs(last - p0).max()) / max(step, 1e-6), 2)
    else:
        p0 = evaluated_verts(meshes)
        r['size_m'] = [round(float(x), 2) for x in (p0.max(0) - p0.min(0))]
    results.append(r)

print('VERIFY ' + json.dumps(results))
