"""
How it works, as three pre-rendered sprites in the manner of a top-down factory game: a fixed camera from above and to
the south, light from the upper left, transparent around, their shadows kept. Each can loop.
  install  a wooden chest packed with straw; a gear wheel jumps out of it and falls back in
  import   a rubber transport belt on its steel frame, carrying gear wheels from left to right
  play     a steel furnace at work: fire in its firebox, smoke and sparks from its exhaust

  blender -b -P art/sprites.py -- --sprite install|import|play [--preview] [--frames N] [--out PATH]
A still goes to --out (art/out/sprite-<name>.png); --frames renders the loop into art/out/sprite-<name>/####.png.
"""
import bpy
import math
import os
import random
import sys
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_kit as kit  # noqa: E402
import factory  # noqa: E402
from blender_kit import link  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SPRITE = argv[argv.index('--sprite') + 1] if '--sprite' in argv else 'install'
PREVIEW = '--preview' in argv or '--draft' in argv
DRAFT = '--draft' in argv  # small and quick, for looking at the motion
FRAMES = int(argv[argv.index('--frames') + 1]) if '--frames' in argv else 0
LOOP = 24
OUT = argv[argv.index('--out') + 1] if '--out' in argv else os.path.join(kit.HERE, 'out', f'sprite-{SPRITE}.png')

scene = kit.start()
rng = random.Random(5)

# ---------------------------------------------------------------- the stage: shadows only, a sun from the upper left

ground = bpy.data.objects.new('ground', bpy.data.meshes.new('ground'))
link(ground)
import bmesh  # noqa: E402
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=2)
bm.to_mesh(ground.data)
bm.free()
ground.is_shadow_catcher = True

sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = 4.5
sun.angle = math.radians(4)
sun.color = (1.0, 0.95, 0.88)
sun_object = link(bpy.data.objects.new('sun', sun))
sun_object.rotation_euler = (math.radians(42), 0, math.radians(-38))  # from the upper left, as such games light
world = bpy.data.worlds.new('studio')
scene.world = world
world.use_nodes = True
nodes, links = world.node_tree.nodes, world.node_tree.links
sky = nodes.new('ShaderNodeTexEnvironment')
import glob  # noqa: E402
sky.image = bpy.data.images.load(glob.glob(os.path.join(kit.ASSETS, 'boiler_room', '*.hdr'))[0])
links.new(sky.outputs['Color'], nodes['Background'].inputs['Color'])
nodes['Background'].inputs['Strength'].default_value = 0.9

camera_data = bpy.data.cameras.new('camera')
camera_data.type = 'ORTHO'
camera = link(bpy.data.objects.new('camera', camera_data))
camera.rotation_euler = (math.radians(48), 0, 0)  # looking north and down
scene.camera = camera


def frame_camera(centre, scale):
    camera_data.ortho_scale = scale
    direction = Vector((0, -math.sin(math.radians(48)), math.cos(math.radians(48))))
    camera.location = Vector(centre) + direction * 3


# ---------------------------------------------------------------- the three sprites

animate = []  # functions of t (0..1): each moves things for that moment of the loop
STILL = 0.22  # the moment the still shows

if SPRITE == 'install':
    chest, lid, jumper, follower, flying, rim = factory.chest()
    jumper.rotation_mode = follower.rotation_mode = 'ZYX'  # spun on its own axis, then tumbled
    frame_camera((0, 0.03, 0.15), 0.5)

    def pose(t):
        # The gear wheel jumps out and falls back in, a small one after it, straw with them; the chest hops as they land.
        def jump(at):
            p = (t - at) % 1.0
            return max(0.0, math.sin(p * math.tau)) if p < 0.5 else 0.0
        up = jump(0.0)
        straw = rim - 0.03 + 0.016  # resting on the straw, in sight
        settle = 0.005 * max(0.0, math.sin(((t - 0.88) % 1.0) / 0.12 * math.pi)) if t > 0.88 else 0.0
        # Straight up and down, lying flat the whole way, so it lands flat; it sinks into the straw just before.
        jumper.location = (0.012, -0.012, straw - settle + up * 0.165)
        jumper.rotation_euler = (0, 0, math.radians(20))
        after = jump(0.08)
        follower.location = (-0.062, -0.04, straw - 0.004 + after * 0.1)
        follower.rotation_euler = (0, 0, math.radians(-15))
        # Straw thrown up from where it lay, as the gear leaves, falling back as it lands.
        burst = jump(0.0)
        flying.location = (0.012, -0.012, straw - 0.02 + burst * 0.09)
        flying.scale = ((0.4 + burst * 0.7) if burst > 0.05 else 0.0,) * 3
        chest.location.z = 0.005 * max(0.0, math.sin(t * math.pi * 4)) if t > 0.5 else 0.0
    animate.append(pose)

elif SPRITE == 'import':
    belt, move, step, surface, length = factory.belt()
    lanes = 2
    per_lane = 5
    spacing = 4  # slats between gear wheels: the belt moves that far a loop, so the loop closes
    gears = []
    for lane in range(lanes):
        for i in range(per_lane):
            g = factory.gear(0.024, 11, 0.008)
            g.rotation_euler = (0, 0, rng.uniform(0, math.tau))
            gears.append((g, lane, i))
    frame_camera((0.0, -0.02, 0.05), 0.43)

    def pose(t):
        move(t * spacing)
        span = per_lane * spacing * step
        start, edge = -length / 2 + 0.004, length / 2
        half = 0.0045
        axle = 0.094 - 0.028  # the head drum's axle (factory.belt: top 0.094, drum 0.028)
        radius = surface + half - axle  # the gear's centre, riding round the drum
        detach = 0.95  # how far round it rides before it flies off
        for g, lane, i in gears:
            x = ((i + lane * 0.5 + t) * spacing * step) % span - length / 2 - 0.05
            y = (lane - 0.5) * 0.074
            rest = surface + half
            # Spun on its own axis first, then tipped about the belt's cross axis: so it always tips forward.
            g.rotation_mode = 'ZYX'
            turn = g.get('turn', 0.0)
            if x < start - 0.03 or x > edge + 0.2:
                g.location = (0, 0, -5)  # off the belt and out of the picture
            elif x < start:
                # Dropped on at the tail: falling from above, landing as the belt reaches it.
                d = (start - x) / 0.03
                g.location = (start, y, rest + d * d * 0.07)
                g.rotation_euler = (0, 0, turn)
            elif x <= edge:
                g.location = (x, y, rest)
                g.rotation_euler = (0, 0, turn)
            else:
                # Over the head: round the drum's curve, then off it along its tangent, falling.
                angle = (x - edge) / radius
                if angle < detach:
                    g.location = (edge + radius * math.sin(angle), y, axle + radius * math.cos(angle))
                    g.rotation_euler = (0, angle, turn)
                else:
                    u = (x - edge) - radius * detach
                    px, pz = edge + radius * math.sin(detach), axle + radius * math.cos(detach)
                    g.location = (px + math.cos(detach) * u, y, pz - math.sin(detach) * u - 22 * u * u)
                    g.rotation_euler = (0, detach + u * 9, turn)
    for g, lane, i in gears:
        g['turn'] = g.rotation_euler[2]
    animate.append(pose)

else:  # play
    furnace, lights, flames, mouth = factory.furnace()
    puff = factory.smoke(mouth)
    frame_camera((0.01, 0.0, 0.2), 0.6)
    sparks = []
    spark_mesh = bpy.data.meshes.new('spark')
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.0024)
    bm.to_mesh(spark_mesh)
    bm.free()
    spark_mesh.materials.append(factory.M('spark'))
    for i in range(22):
        spark = link(bpy.data.objects.new(f'spark_{i}', spark_mesh))
        spark.visible_shadow = False
        sparks.append((spark, rng.uniform(0, 1), rng.uniform(-0.02, 0.07), rng.uniform(-0.03, 0.02), rng.uniform(0.05, 0.12)))

    def pose(t):
        # Sparks rise out of the stack and die; each comes round once a loop, at its own moment. Smoke drifts off.
        for spark, offset, dx, dy, height in sparks:
            p = (t + offset) % 1.0
            spark.location = mouth + Vector((dx * p * (0.5 + p), dy * p, p ** 0.7 * height))
            spark.scale = (max(0.05, 1 - p * p),) * 3
        puff(t)
        flicker = 1 + 0.25 * math.sin(t * math.tau * 3) + 0.1 * math.sin(t * math.tau * 7)
        for light, energy in lights:
            light.energy = energy * flicker
        from mathutils import Quaternion
        for i, (pivot, rest) in enumerate(factory.MOVING['needles']):
            swing = 0.45 * math.sin((t * (1 + i % 2) + i * 0.37) * math.tau) + 0.12 * math.sin((t * 5 + i) * math.tau)
            pivot.rotation_quaternion = rest @ Quaternion((0, 0, 1), swing)
        for i, (flame, tall, offset) in enumerate(flames):
            flame.scale.z = tall * (0.8 + 0.35 * math.sin((t * (2 + i % 3) + offset) * math.tau))
    animate.append(pose)

# ---------------------------------------------------------------- render

if os.environ.get('PF_CAM'):  # a closer look while modelling: PF_CAM=x,y,z,scale
    look = [float(v) for v in os.environ['PF_CAM'].split(',')]
    frame_camera(look[:3], look[3])

# Twice the size, then halved: small parts keep their edges.
# Loops render with fewer samples (the denoiser cleans them); stills with more.
kit.cycles(12 if DRAFT else 24 if PREVIEW else (96 if FRAMES else 160), width=440, height=400,
           percentage=50 if DRAFT else 100 if PREVIEW else 200)
scene.render.film_transparent = True
scene.render.image_settings.color_mode = 'RGBA'
# Game sprites want saturated fire and hard highlights: the plain transform with more contrast, not a film curve.
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'Medium High Contrast'
scene.view_settings.exposure = -0.15


def halve(path):
    """Halves a rendered picture, averaging each four pixels (weighted by their alpha)."""
    import numpy
    image = bpy.data.images.load(path, check_existing=False)
    w, h = image.size
    pixels = numpy.empty(w * h * 4, dtype=numpy.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(h // 2, 2, w // 2, 2, 4)
    alpha = pixels[..., 3:4]
    total = alpha.sum(axis=(1, 3))
    colour = (pixels[..., :3] * alpha).sum(axis=(1, 3)) / numpy.maximum(total, 1e-6)
    small = numpy.concatenate([colour, total / 4], axis=-1)
    out = bpy.data.images.new('small', w // 2, h // 2, alpha=True)
    out.pixels.foreach_set(small.astype(numpy.float32).ravel())
    out.filepath_raw = path
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(image)
    bpy.data.images.remove(out)


def render(path, t):
    for pose in animate:
        pose(t)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if not PREVIEW:
        halve(path)


if FRAMES:
    os.makedirs(os.path.join(kit.HERE, 'out', f'sprite-{SPRITE}'), exist_ok=True)
    for frame in range(FRAMES):
        render(os.path.join(kit.HERE, 'out', f'sprite-{SPRITE}', f'{frame + 1:04d}.png'), frame / FRAMES)
else:
    render(OUT, STILL)
print('RENDERED', SPRITE)
