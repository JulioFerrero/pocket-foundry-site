"""
Tiny pre-rendered sprites for the 88x31 buttons (art/badges.mjs), each a seamless loop on a transparent ground:
a brass gear wheel turning one tooth (12 frames) and Blender's monkey head looking from side to side (24 frames).
On the processor only: they are a few pixels across, and the GPU may be busy with a long render.
  blender -b -P art/badge_sprites.py   ->  art/out/badge-sprites/gear/01.png ..., art/out/badge-sprites/monkey/01.png ...
"""
import bpy
import bmesh
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out', 'badge-sprites')
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def metal(name, colour, roughness):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*colour, 1)
    bsdf.inputs['Metallic'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = roughness
    return material


def light(name, energy, rotation, colour=(1, 1, 1)):
    sun = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
    sun.data.energy = energy
    sun.data.color = colour
    sun.rotation_euler = [math.radians(a) for a in rotation]
    scene.collection.objects.link(sun)
    return sun


def render(name, frames, size, pose):
    scene.render.resolution_x = scene.render.resolution_y = size
    os.makedirs(os.path.join(OUT, name), exist_ok=True)
    for frame in range(frames):
        pose(frame / frames)
        scene.render.filepath = os.path.join(OUT, name, f'{frame + 1:02d}.png')
        bpy.ops.render.render(write_still=True)


# The gear wheel: eight fat teeth, a sunk web with four holes, an iron hub. Seen from well above, so it reads at 27 pixels.
TEETH = 8
gear_mesh = bpy.data.meshes.new('gear')
bm = bmesh.new()
outline = []
for i in range(TEETH):
    # Each tooth a blunt trapezium: wide at the root, a flat tip a little narrower.
    for offset, r in ((-0.30, 0.72), (-0.20, 1.0), (0.20, 1.0), (0.30, 0.72)):
        a = (i + offset) / TEETH * math.tau
        outline.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, 0)))
face = bm.faces.new(outline)
top = bmesh.ops.extrude_face_region(bm, geom=[face])
for v in [g for g in top['geom'] if isinstance(g, bmesh.types.BMVert)]:
    v.co.z = 0.3
bm.normal_update()
bm.to_mesh(gear_mesh)
bm.free()
gear = bpy.data.objects.new('gear', gear_mesh)
scene.collection.objects.link(gear)
gear.data.materials.append(metal('brass', (0.9, 0.58, 0.16), 0.38))
bevel = gear.modifiers.new('bevel', 'BEVEL')
bevel.width = 0.035
bevel.segments = 2
dark = metal('iron', (0.1, 0.1, 0.11), 0.6)


def disc(name, radius, depth, location, material):
    item = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=radius, radius2=radius, depth=depth)
    bm.to_mesh(item.data)
    bm.free()
    item.location = location
    item.data.materials.append(material)
    item.parent = gear
    scene.collection.objects.link(item)
    return item


disc('hub', 0.26, 0.5, (0, 0, 0.22), metal('steel', (0.5, 0.52, 0.55), 0.35))
for i in range(4):
    a = (i + 0.5) / 4 * math.tau
    disc(f'hole{i}', 0.13, 0.05, (math.cos(a) * 0.5, math.sin(a) * 0.5, 0.3), dark)

key = light('key', 6.5, (48, -8, -35), (1.0, 0.95, 0.85))
light('rim', 2.0, (-50, 0, 140), (0.6, 0.75, 1.0))
world = bpy.data.worlds.new('world')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.6

camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
camera.data.type = 'ORTHO'
scene.collection.objects.link(camera)
scene.camera = camera

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 96
scene.cycles.filter_width = 1.0  # a tighter pixel filter than the default: small sprites stay crisp
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
try:
    scene.view_settings.view_transform = 'Standard'
except TypeError:
    pass


def aim(tilt, distance, scale, height=0.0):
    """The camera [tilt] degrees off straight down, looking at the origin raised by [height]."""
    t = math.radians(tilt)
    camera.data.ortho_scale = scale
    camera.location = (0, -math.sin(t) * distance, math.cos(t) * distance + height)
    camera.rotation_euler = (t, 0, 0)


aim(28, 6, 2.2, 0.1)


def turn_gear(t):
    gear.rotation_euler[2] = -t * math.tau / TEETH


render('gear', 12, 27, turn_gear)
gear.hide_render = True
for child in gear.children:
    child.hide_render = True

# The monkey head, Blender's own test model, in the grey clay of its viewport, looking from side to side.
bpy.ops.mesh.primitive_monkey_add(size=2)
monkey = bpy.context.object
bpy.ops.object.shade_smooth()
subdivision = monkey.modifiers.new('subdivision', 'SUBSURF')
subdivision.render_levels = 2
clay = bpy.data.materials.new('clay')
clay.use_nodes = True
clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.62, 0.6, 0.57, 1)
clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.5
monkey.data.materials.append(clay)
# Her eyes are separate islands of the mesh (the two small ones): dark and glossy, so the face reads when tiny.
eye = bpy.data.materials.new('eye')
eye.use_nodes = True
eye.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.01, 0.01, 0.012, 1)
eye.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.15
monkey.data.materials.append(eye)
bm = bmesh.new()
bm.from_mesh(monkey.data)
seen = set()
for start in bm.verts:
    if start in seen:
        continue
    island, stack = {start}, [start]
    while stack:
        for edge in stack.pop().link_edges:
            for v in edge.verts:
                if v not in island:
                    island.add(v)
                    stack.append(v)
    seen |= island
    if len(island) < 60:
        for v in island:
            for f in v.link_faces:
                f.material_index = 1
bm.to_mesh(monkey.data)
bm.free()
aim(74, 6, 2.75, 0.0)
key.data.energy = 3.2
key.rotation_euler = (math.radians(55), 0, math.radians(-40))
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35


def turn_monkey(t):
    monkey.rotation_euler[2] = math.radians(50) * math.sin(t * math.tau)


render('monkey', 24, 27, turn_monkey)
print('SPRITES done')
