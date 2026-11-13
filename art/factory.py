"""
The factory sprites' models, all original: a wooden chest spilling gears, a rubber transport belt on a steel frame,
and a steel furnace with its blower, hopper, pipework and exhaust. Built from small parts (planks, plates, hex bolts,
rivets, flanges, pipes with bends, valves, gauges, weld beads, cables) in layered materials: steel under chipped
paint, rust that gathers in corners and runs down, bare metal on worn edges, grime in crevices, dust near the ground.
Textures are Poly Haven sets (CC0), projected without texture coordinates.
"""
import bpy
import bmesh
import glob
import math
import os
import random
from mathutils import Matrix, Vector

import blender_kit as kit
from blender_kit import link

rng = random.Random(11)
_materials = {}
_images = {}
_parent = [None]


# ---------------------------------------------------------------- node graphs, briefly

class Graph:
    def __init__(self, name):
        self.material = bpy.data.materials.new(name)
        self.material.use_nodes = True
        self.tree = self.material.node_tree
        self.bsdf = self.tree.nodes['Principled BSDF']
        self._coords = None

    def node(self, kind, **properties):
        node = self.tree.nodes.new(kind)
        for key, value in properties.items():
            setattr(node, key, value)
        return node

    def put(self, socket, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.tree.links.new(value, socket)
        elif isinstance(value, (int, float)):
            socket.default_value = value
        else:
            socket.default_value = (*value, 1) if len(value) == 3 and socket.type == 'RGBA' else value

    def math(self, operation, a, b=0.0, clamp=False):
        node = self.node('ShaderNodeMath', operation=operation, use_clamp=clamp)
        self.put(node.inputs[0], a)
        self.put(node.inputs[1], b)
        return node.outputs[0]

    def mix(self, factor, a, b, blend='MIX'):
        node = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        self.put(node.inputs[0], factor)
        self.put(node.inputs[6], a)
        self.put(node.inputs[7], b)
        return node.outputs[2]

    def lerp(self, factor, a, b):
        node = self.node('ShaderNodeMix', data_type='FLOAT')
        self.put(node.inputs[0], factor)
        self.put(node.inputs[2], a)
        self.put(node.inputs[3], b)
        return node.outputs[0]

    def step(self, value, low, high):
        """0 below [low], 1 above [high], smooth between."""
        node = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self.put(node.inputs[0], value)
        node.inputs[1].default_value = low
        node.inputs[2].default_value = high
        return node.outputs[0]

    def coords(self):
        """Object space (metres), shifted per object so that no two parts wear alike."""
        if self._coords is None:
            texture = self.node('ShaderNodeTexCoord')
            info = self.node('ShaderNodeObjectInfo')
            add = self.node('ShaderNodeVectorMath', operation='ADD')
            self.put(add.inputs[0], texture.outputs['Object'])
            self.put(add.inputs[1], self.math('MULTIPLY', info.outputs['Random'], 7.0))
            self._coords = add.outputs[0]
            self.random = info.outputs['Random']
        return self._coords

    def mapped(self, scale):
        mapping = self.node('ShaderNodeMapping')
        self.put(mapping.inputs[0], self.coords())
        mapping.inputs['Scale'].default_value = scale if isinstance(scale, tuple) else (scale, scale, scale)
        return mapping.outputs[0]

    def noise(self, scale, detail=6.0, stretch=None, roughness=0.55):
        node = self.node('ShaderNodeTexNoise')
        self.put(node.inputs['Vector'], self.mapped(stretch) if stretch else self.coords())
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = roughness
        return node.outputs[0]

    def image(self, folder, suffix, scale, colour=True):
        path = glob.glob(os.path.join(kit.ASSETS, folder, f'*_{suffix}_*.jpg'))[0]
        if path not in _images:
            _images[path] = bpy.data.images.load(path)
            _images[path].colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
        node = self.node('ShaderNodeTexImage', projection='BOX')
        node.projection_blend = 0.2
        node.image = _images[path]
        self.put(node.inputs[0], self.mapped(scale))
        return node.outputs[0]

    def crevice(self, distance=0.012):
        """1 where a surface is tucked in, 0 in the open."""
        occlusion = self.node('ShaderNodeAmbientOcclusion', samples=6)
        occlusion.inputs['Distance'].default_value = distance
        return self.math('SUBTRACT', 1.0, self.step(occlusion.outputs['AO'], 0.35, 0.92)), occlusion.outputs['AO']

    def edge(self, radius=0.003):
        """1 along an object's edges and corners."""
        bevel = self.node('ShaderNodeBevel', samples=4)
        bevel.inputs['Radius'].default_value = radius
        geometry = self.node('ShaderNodeNewGeometry')
        dot = self.node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
        self.put(dot.inputs[0], bevel.outputs[0])
        self.put(dot.inputs[1], geometry.outputs['Normal'])
        return self.step(self.math('SUBTRACT', 1.0, dot.outputs['Value']), 0.015, 0.2)

    def low(self, height=0.045):
        """1 at the ground, 0 from [height] up: where dust settles."""
        geometry = self.node('ShaderNodeNewGeometry')
        split = self.node('ShaderNodeSeparateXYZ')
        self.put(split.inputs[0], geometry.outputs['Position'])
        return self.math('SUBTRACT', 1.0, self.step(split.outputs['Z'], 0.0, height))

    def finish(self, colour, roughness, metallic=0.0, height=None, bump=0.3):
        self.put(self.bsdf.inputs['Base Color'], colour)
        self.put(self.bsdf.inputs['Roughness'], roughness)
        self.put(self.bsdf.inputs['Metallic'], metallic)
        if height is not None:
            node = self.node('ShaderNodeBump')
            node.inputs['Strength'].default_value = bump
            node.inputs['Distance'].default_value = 0.002
            self.put(node.inputs['Height'], height)
            self.put(self.bsdf.inputs['Normal'], node.outputs[0])
        return self.material


def metal(name, colour, paint=None, rust=0.35, wear=0.6, grime=0.85, dust=0.6, soot=0.0, metallic=0.85,
          rough=(0.3, 0.6), chips=0.4, patina=None, scale=1.0, edge=0.003, reach=0.012):
    """
    Steel as a machine wears it. [paint] covers it but for chips; [rust] (0..1) spreads from corners and in streaks;
    [wear] bares bright metal on the edges; [grime] blackens the crevices; [dust] browns what's near the ground;
    [soot] blackens all of it. [patina] replaces rust's texture with a colour (verdigris on copper).
    """
    g = Graph(name)
    big = g.noise(16 * scale, 5)
    fine = g.noise(130 * scale, 8)
    speck = g.noise(420 * scale, 3)
    streak = g.noise(45 * scale, 4, stretch=(1, 1, 0.1))
    crevice, open_air = g.crevice(reach)
    edges = g.edge(edge)
    convex = g.math('MULTIPLY', g.math('MULTIPLY', edges, g.step(open_air, 0.55, 0.85)), g.step(fine, 0.3, 0.55))
    colour_now = g.mix(g.step(big, 0.3, 0.7), tuple(c * 0.72 for c in colour), tuple(min(1, c * 1.2) for c in colour))
    metallic_now = metallic
    roughness = g.lerp(g.step(fine, 0.35, 0.7), rough[0], rough[1])
    height = g.math('MULTIPLY', fine, 0.25)
    if paint:
        # Chipped where the noise is high, along edges and in corners.
        chipping = g.math('ADD', g.math('ADD', g.math('MULTIPLY', big, 0.45), g.math('MULTIPLY', fine, 0.55)),
                          g.math('ADD', g.math('MULTIPLY', edges, 0.3), g.math('MULTIPLY', crevice, 0.12)))
        chipped = g.step(chipping, 0.9 - chips * 0.7, 0.95 - chips * 0.7)
        painted = g.mix(g.step(streak, 0.3, 0.75), tuple(c * 0.7 for c in paint), paint)
        colour_now = g.mix(chipped, painted, colour_now)
        metallic_now = g.math('MULTIPLY', chipped, metallic)
        roughness = g.lerp(chipped, 0.55, roughness)
        height = g.math('SUBTRACT', height, g.math('MULTIPLY', chipped, 0.5))
    rusting = g.math('ADD', g.math('ADD', g.math('MULTIPLY', big, 0.5), g.math('MULTIPLY', streak, 0.32)),
                     g.math('ADD', g.math('MULTIPLY', fine, 0.18), g.math('MULTIPLY', crevice, 0.3)))
    rusted = g.step(rusting, 0.8 - rust * 0.55, 0.95 - rust * 0.55) if rust > 0 else 0.0
    if rust > 0:
        rust_colour = patina if patina else g.mix(1.0, g.image('rust_coarse_01', 'diff', 9.0 * scale), (0.85, 0.7, 0.6), 'MULTIPLY')
        colour_now = g.mix(g.math('MULTIPLY', rusted, 0.92), colour_now, rust_colour)
        metallic_now = g.math('MULTIPLY', metallic_now, g.math('SUBTRACT', 1.0, rusted))
        roughness = g.lerp(rusted, roughness, 0.88)
        height = g.math('ADD', height, g.math('MULTIPLY', g.math('MULTIPLY', rusted, speck), 0.8))
    if wear > 0:
        worn = g.math('MULTIPLY', convex, wear)
        colour_now = g.mix(worn, colour_now, (0.78, 0.76, 0.72))
        metallic_now = g.lerp(worn, metallic_now, 1.0)
        roughness = g.lerp(worn, roughness, 0.28)
    if soot > 0:
        colour_now = g.mix(g.math('MULTIPLY', g.step(big, 0.2, 0.6), soot), colour_now, (0.012, 0.011, 0.01))
        roughness = g.lerp(soot, roughness, 0.92)
        metallic_now = g.math('MULTIPLY', metallic_now, 1 - soot * 0.8)
    if grime > 0:
        dirty = g.math('MULTIPLY', crevice, grime)
        colour_now = g.mix(dirty, colour_now, (0.02, 0.016, 0.012))
        roughness = g.lerp(dirty, roughness, 0.9)
    if dust > 0:
        dusty = g.math('MULTIPLY', g.math('MULTIPLY', g.low(), g.step(fine, 0.2, 0.6)), dust)
        colour_now = g.mix(dusty, colour_now, (0.2, 0.14, 0.09))
        roughness = g.lerp(dusty, roughness, 0.95)
        metallic_now = g.math('MULTIPLY', metallic_now, g.math('SUBTRACT', 1.0, dusty))
    return g.finish(colour_now, roughness, metallic_now, height, bump=0.35)


def rubber(name, colour=(0.02, 0.02, 0.022), paint=None, chips=0.5):
    """Belt rubber: near black, scuffed grey on its edges, dusty in patches; [paint] is a marking, mostly worn off."""
    g = Graph(name)
    big = g.noise(30, 5)
    fine = g.noise(260, 8)
    scratch = g.noise(120, 3, stretch=(0.06, 1, 1))  # scuffs along the belt's travel
    crevice, open_air = g.crevice(0.008)
    edges = g.math('MULTIPLY', g.edge(0.002), g.step(open_air, 0.5, 0.85))
    colour_now = g.mix(g.step(fine, 0.35, 0.75), colour, tuple(c * 2.6 for c in colour))
    roughness = g.lerp(g.step(big, 0.3, 0.7), 0.5, 0.78)
    height = g.math('ADD', g.math('MULTIPLY', fine, 0.3), g.math('MULTIPLY', scratch, 0.25))
    if paint:
        chipping = g.math('ADD', g.math('ADD', g.math('MULTIPLY', big, 0.4), g.math('MULTIPLY', fine, 0.35)),
                          g.math('ADD', g.math('MULTIPLY', scratch, 0.25), g.math('MULTIPLY', edges, 0.25)))
        chipped = g.step(chipping, 0.86 - chips * 0.7, 0.92 - chips * 0.7)
        colour_now = g.mix(chipped, g.mix(g.step(big, 0.3, 0.7), tuple(c * 0.75 for c in paint), paint), colour_now)
        roughness = g.lerp(chipped, 0.45, roughness)
        height = g.math('SUBTRACT', height, g.math('MULTIPLY', chipped, 0.4))
    colour_now = g.mix(g.math('MULTIPLY', edges, 0.55), colour_now, (0.16, 0.155, 0.15))
    dusty = g.math('MULTIPLY', g.step(g.math('ADD', g.math('MULTIPLY', big, 0.6), g.math('MULTIPLY', scratch, 0.4)), 0.5, 0.72), 0.38)
    colour_now = g.mix(dusty, colour_now, (0.15, 0.125, 0.1))
    colour_now = g.mix(g.math('MULTIPLY', crevice, 0.9), colour_now, (0.004, 0.004, 0.004))
    return g.finish(colour_now, roughness, 0.0, height, bump=0.5)


def wood(name, texture='weathered_planks', tint=(1.0, 0.82, 0.6), scale=3.2, vary=0.5):
    """Planks: a texture set along the plank (its local Z), each plank its own shade, pale on worn edges, dark in gaps."""
    g = Graph(name)
    fine = g.noise(150, 6)
    crevice, open_air = g.crevice(0.014)
    edges = g.math('MULTIPLY', g.edge(0.0035), g.step(open_air, 0.55, 0.85))
    shade = g.node('ShaderNodeHueSaturation')
    g.put(shade.inputs['Color'], g.mix(1.0, g.image(texture, 'diff', scale), tint, 'MULTIPLY'))
    g.coords()
    shade.inputs['Saturation'].default_value = 1.1
    g.put(shade.inputs['Value'], g.math('ADD', 1.0 - vary / 2, g.math('MULTIPLY', g.random, vary)))
    colour_now = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', edges, g.step(fine, 0.3, 0.6)), 0.6), shade.outputs[0], (0.62, 0.5, 0.34))
    colour_now = g.mix(g.math('MULTIPLY', crevice, 0.9), colour_now, (0.025, 0.017, 0.01))
    colour_now = g.mix(g.math('MULTIPLY', g.math('MULTIPLY', g.low(0.03), g.step(fine, 0.2, 0.6)), 0.6), colour_now, (0.16, 0.11, 0.07))
    material = g.finish(colour_now, 0.78, 0.0)
    normal = g.node('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = 1.5
    g.put(normal.inputs['Color'], g.image(texture, 'nor_gl', scale, colour=False))
    g.put(g.bsdf.inputs['Normal'], normal.outputs[0])
    return material


def plain(name, colour, roughness=0.6, metallic=0.0, emission=None, strength=0.0):
    g = Graph(name)
    if emission:
        g.put(g.bsdf.inputs['Emission Color'], emission)
        g.bsdf.inputs['Emission Strength'].default_value = strength
    return g.finish(colour, roughness, metallic)


def M(name):
    """The sprites' materials, each made once."""
    if name in _materials:
        return _materials[name]
    makers = {
        # steel, bare and painted
        'steel': lambda: metal(name, (0.3, 0.31, 0.33), rust=0.5, wear=0.75),
        'plate': lambda: metal(name, (0.36, 0.37, 0.39), rust=0.56, wear=0.7, rough=(0.35, 0.65)),
        'dark_steel': lambda: metal(name, (0.11, 0.115, 0.125), rust=0.46, wear=0.9),
        'cast': lambda: metal(name, (0.06, 0.06, 0.065), rust=0.3, wear=1.0, metallic=0.7, rough=(0.45, 0.7)),
        'bolt': lambda: metal(name, (0.2, 0.2, 0.21), rust=0.5, wear=1.0, edge=0.0012, dust=0.3),
        'iron': lambda: metal(name, (0.2, 0.205, 0.22), rust=0.52, wear=0.5, grime=0.9, dust=0.0, metallic=0.5, rough=(0.38, 0.62), scale=2.0, edge=0.0009, reach=0.0035),
        'shaft': lambda: metal(name, (0.55, 0.55, 0.56), rust=0.15, wear=0.5, metallic=1.0, rough=(0.2, 0.4)),
        'green': lambda: metal(name, (0.2, 0.2, 0.21), paint=(0.035, 0.085, 0.06), rust=0.45, chips=0.33),
        'red': lambda: metal(name, (0.2, 0.2, 0.21), paint=(0.5, 0.05, 0.03), rust=0.2, chips=0.4, wear=0.9, edge=0.0015, dust=0.0),
        'yellow': lambda: metal(name, (0.2, 0.2, 0.21), paint=(0.62, 0.36, 0.02), rust=0.45, chips=0.45),
        'ochre': lambda: metal(name, (0.22, 0.22, 0.23), paint=(0.3, 0.07, 0.035), rust=0.5, chips=0.45),
        'sooty': lambda: metal(name, (0.11, 0.115, 0.125), rust=0.3, wear=0.5, soot=0.75),
        'copper': lambda: metal(name, (0.85, 0.4, 0.2), rust=0.22, wear=0.3, patina=(0.1, 0.27, 0.2), metallic=0.8, rough=(0.25, 0.45), scale=3, dust=0.0, edge=0.001),
        'brass': lambda: metal(name, (0.75, 0.52, 0.2), rust=0.15, wear=0.3, patina=(0.1, 0.08, 0.04), metallic=1.0, rough=(0.22, 0.42), scale=3, dust=0.0),
        'band': lambda: metal(name, (0.09, 0.09, 0.1), rust=0.55, wear=0.9, dust=0.5),
        # the rest
        'rubber': lambda: rubber(name),
        'tyre': lambda: rubber(name, (0.03, 0.03, 0.032)),
        'chevron': lambda: rubber(name, paint=(0.85, 0.48, 0.02), chips=0.45),
        'wood': lambda: wood(name),
        'wood_dark': lambda: wood(name, 'old_planks_02', tint=(0.8, 0.6, 0.42), vary=0.35),
        'rope': lambda: plain(name, (0.42, 0.3, 0.14), 0.9),
        'gauge_face': lambda: plain(name, (0.8, 0.76, 0.62), 0.35),
        'needle': lambda: plain(name, (0.5, 0.03, 0.02), 0.4),
        'void': lambda: plain(name, (0.004, 0.004, 0.004), 0.95),
        'spark': lambda: plain(name, (1.0, 0.6, 0.2), emission=(1.0, 0.5, 0.1), strength=10.0),
        'lamp_on': lambda: plain(name, (0.2, 1.0, 0.3), emission=(0.2, 1.0, 0.3), strength=6.0),
    }
    if name == 'straw':
        g = Graph(name)
        crevice, _ = g.crevice(0.01)
        colour = g.mix(g.step(g.noise(300, 3), 0.3, 0.7), (0.34, 0.22, 0.07), (0.78, 0.6, 0.26))
        made = g.finish(g.mix(g.math('MULTIPLY', crevice, 0.9), colour, (0.05, 0.03, 0.01)), 0.75)
    elif name == 'stencil':
        # Paint through a stencil, most of it rubbed away: transparent where it's gone.
        g = Graph(name)
        worn = g.step(g.math('ADD', g.math('MULTIPLY', g.noise(60, 6), 0.6), g.math('MULTIPLY', g.noise(300, 4), 0.4)), 0.42, 0.5)
        g.put(g.bsdf.inputs['Alpha'], g.math('SUBTRACT', 1.0, g.math('MULTIPLY', worn, 0.85)))
        made = g.finish((0.82, 0.78, 0.62), 0.7)
    elif name == 'coal':
        g = Graph(name)
        made = g.finish(g.mix(g.step(g.noise(200, 5), 0.4, 0.7), (0.008, 0.008, 0.009), (0.035, 0.035, 0.04)),
                        g.lerp(g.step(g.noise(90, 4), 0.4, 0.6), 0.25, 0.7), 0.0, g.noise(150, 6), bump=0.6)
    elif name == 'ember':
        # Coals in the fire: black crust, orange cracks, white-yellow hearts.
        g = Graph(name)
        heat = g.noise(70, 5)
        ramp = g.node('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.34
        ramp.color_ramp.elements[0].color = (0.25, 0.01, 0.0, 1)
        ramp.color_ramp.elements[1].position = 0.72
        ramp.color_ramp.elements[1].color = (1.0, 0.6, 0.12, 1)
        middle = ramp.color_ramp.elements.new(0.52)
        middle.color = (1.0, 0.28, 0.02, 1)
        g.put(ramp.inputs[0], heat)
        g.put(g.bsdf.inputs['Emission Color'], ramp.outputs[0])
        g.bsdf.inputs['Emission Strength'].default_value = 6.0
        _materials['ember_strength'] = g.bsdf.inputs['Emission Strength']
        made = g.finish((0.02, 0.01, 0.0), 0.9)
    elif name == 'flame':
        # A tongue of fire: yellow at its root, orange above, gone at its tip.
        g = Graph(name)
        texture = g.node('ShaderNodeTexCoord')
        split = g.node('ShaderNodeSeparateXYZ')
        g.put(split.inputs[0], texture.outputs['Object'])
        up = split.outputs['Z']  # 0 at the root, 1 at the tip
        g.put(g.bsdf.inputs['Emission Color'], g.mix(g.step(up, 0.1, 0.8), (1.0, 0.62, 0.1), (1.0, 0.16, 0.01)))
        g.bsdf.inputs['Emission Strength'].default_value = 16.0
        flicker = g.noise(60, 4)
        g.put(g.bsdf.inputs['Alpha'], g.math('MULTIPLY', g.math('SUBTRACT', 1.0, g.step(g.math('ADD', up, g.math('MULTIPLY', flicker, 0.4)), 0.55, 1.1)), 0.9))
        made = g.finish((0, 0, 0), 1.0)
    elif name == 'glow':
        # Firelight on the ground: the stage only catches shadows, so the glow is its own soft patch.
        g = Graph(name)
        texture = g.node('ShaderNodeTexCoord')
        length = g.node('ShaderNodeVectorMath', operation='LENGTH')
        g.put(length.inputs[0], texture.outputs['Object'])
        g.put(g.bsdf.inputs['Emission Color'], (1.0, 0.36, 0.06, 1))
        g.bsdf.inputs['Emission Strength'].default_value = 1.6
        g.put(g.bsdf.inputs['Alpha'], g.math('MULTIPLY', g.math('SUBTRACT', 1.0, g.step(length.outputs['Value'], 0.0, 1.0)), 0.28))
        _materials['glow_strength'] = g.bsdf.inputs['Emission Strength']
        made = g.finish((0, 0, 0), 1.0)
    elif name == 'soot_smear':
        g = Graph(name)
        texture = g.node('ShaderNodeTexCoord')
        length = g.node('ShaderNodeVectorMath', operation='LENGTH')
        g.put(length.inputs[0], texture.outputs['Object'])
        fade = g.math('SUBTRACT', 1.0, g.step(g.math('ADD', length.outputs['Value'], g.math('MULTIPLY', g.noise(50, 5), 0.5)), 0.45, 1.25))
        g.put(g.bsdf.inputs['Alpha'], g.math('MULTIPLY', fade, 0.93))
        made = g.finish((0.006, 0.005, 0.005), 0.95)
    elif name == 'smoke':
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        tree = material.node_tree
        tree.nodes.remove(tree.nodes['Principled BSDF'])
        g = Graph.__new__(Graph)
        g.material, g.tree, g._coords = material, tree, None
        volume = g.node('ShaderNodeVolumePrincipled')
        volume.inputs['Color'].default_value = (0.5, 0.56, 0.68, 1)  # cool, so the fire's warm light leaves it grey
        volume.inputs['Anisotropy'].default_value = 0.2
        texture = g.node('ShaderNodeTexCoord')
        length = g.node('ShaderNodeVectorMath', operation='LENGTH')
        g.put(length.inputs[0], texture.outputs['Object'])
        ball = g.math('SUBTRACT', 1.0, g.step(length.outputs['Value'], 0.1, 1.0))
        geometry = g.node('ShaderNodeNewGeometry')
        billow = g.node('ShaderNodeTexNoise')
        g.put(billow.inputs['Vector'], geometry.outputs['Position'])
        billow.inputs['Scale'].default_value = 30
        billow.inputs['Detail'].default_value = 5
        fade = g.node('ShaderNodeAttribute', attribute_type='OBJECT', attribute_name='fade')
        density = g.math('MULTIPLY', g.math('MULTIPLY', ball, g.step(billow.outputs[0], 0.3, 0.6)), g.math('MULTIPLY', fade.outputs['Fac'], 700.0))
        g.put(volume.inputs['Density'], density)
        tree.links.new(volume.outputs[0], tree.nodes['Material Output'].inputs['Volume'])
        made = material
    else:
        made = makers[name]()
    _materials[name] = made
    return made


# ---------------------------------------------------------------- small parts

def group(name, location=(0, 0, 0), rotation=(0, 0, 0)):
    holder = link(bpy.data.objects.new(name, None))
    holder.location = location
    holder.rotation_euler = [math.radians(a) for a in rotation]
    holder.parent = _parent[-1]
    return holder


class inside:
    """Parts made within belong to [holder], placed in its space."""
    def __init__(self, holder):
        self.holder = holder

    def __enter__(self):
        _parent.append(self.holder)
        return self.holder

    def __exit__(self, *_):
        _parent.pop()


def _place(obj, material, location, smooth=True, sharp=40):
    link(obj)
    obj.parent = _parent[-1]
    obj.location = location
    if material:
        obj.data.materials.append(material)
    if smooth and obj.type == 'MESH':
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        obj.data.set_sharp_from_angle(angle=math.radians(sharp))
    return obj


def aim(obj, direction):
    """Turns [obj]'s Z to point along [direction]."""
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized())
    return obj


def box(size, location, material, bevel=0.0015, rotation=(0, 0, 0), segments=2):
    mesh = bpy.data.meshes.new('box')
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(bevel, min(size) * 0.45), segments=segments, affect='EDGES', profile=0.5)
    bm.to_mesh(mesh)
    bm.free()
    obj = _place(bpy.data.objects.new('box', mesh), material, location, sharp=50)
    obj.rotation_euler = [math.radians(a) for a in rotation]
    return obj


def plank(length, width, thick, location, along, normal, material, jitter=0.0):
    """A board with its grain along [along] and its faces towards [normal]."""
    obj = box((width, thick, length), location, material, bevel=min(width, thick) * 0.1)
    z, y = Vector(along).normalized(), Vector(normal).normalized()
    x = y.cross(z)
    obj.rotation_euler = Matrix((x, y, z)).transposed().to_euler()
    for axis in range(3):
        obj.rotation_euler[axis] += rng.uniform(-jitter, jitter)
    return obj


def lathe(profile, location, material, direction=(0, 0, 1), segments=32, caps=True):
    """A turned shape: [profile] is (radius, height) pairs from the bottom up, spun round Z."""
    mesh = bpy.data.meshes.new('lathe')
    bm = bmesh.new()
    rings = []
    for radius, height in profile:
        rings.append([bm.verts.new((math.cos(i / segments * math.tau) * radius, math.sin(i / segments * math.tau) * radius, height))
                      for i in range(segments)])
    for lower, upper in zip(rings, rings[1:]):
        for i in range(segments):
            bm.faces.new((lower[i], lower[(i + 1) % segments], upper[(i + 1) % segments], upper[i]))
    if caps and profile[0][0] > 0:
        bm.faces.new(reversed(rings[0]))
    if caps and profile[-1][0] > 0:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    return aim(_place(bpy.data.objects.new('lathe', mesh), material, location, sharp=35), direction)


def cylinder(radius, depth, location, material, direction=(0, 0, 1), segments=24, chamfer=0.12):
    """A cylinder centred on [location], its edges chamfered."""
    c = min(radius, depth / 2) * chamfer
    half = depth / 2
    return lathe([(radius - c, -half), (radius, -half + c), (radius, half - c), (radius - c, half)], location, material, direction, segments)


def ring(major, minor, location, material, direction=(0, 0, 1), segments=32, around=8):
    mesh = bpy.data.meshes.new('ring')
    bm = bmesh.new()
    loops = []
    for i in range(segments):
        a = i / segments * math.tau
        loops.append([bm.verts.new(((major + math.cos(b / around * math.tau) * minor) * math.cos(a),
                                    (major + math.cos(b / around * math.tau) * minor) * math.sin(a),
                                    math.sin(b / around * math.tau) * minor)) for b in range(around)])
    for i in range(segments):
        for b in range(around):
            bm.faces.new((loops[i][b], loops[(i + 1) % segments][b], loops[(i + 1) % segments][(b + 1) % around], loops[i][(b + 1) % around]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    return aim(_place(bpy.data.objects.new('ring', mesh), material, location, sharp=80), direction)


def bolt(location, direction=(0, 0, 1), size=0.004, material=None):
    """A hex bolt on its washer."""
    location, direction = Vector(location), Vector(direction).normalized()
    cylinder(size * 1.5, size * 0.3, location + direction * size * 0.15, material or M('bolt'), direction, 12)
    head = cylinder(size, size * 0.8, location + direction * size * 0.7, material or M('bolt'), direction, 6)
    head.rotation_quaternion = head.rotation_quaternion @ Matrix.Rotation(rng.uniform(0, 1), 4, 'Z').to_quaternion()
    return head


def bolts(start, end, count, direction=(0, 0, 1), size=0.004, material=None):
    start, end = Vector(start), Vector(end)
    for i in range(count):
        bolt(start.lerp(end, i / max(1, count - 1)), direction, size, material)


def rivet(location, direction=(0, 0, 1), size=0.003, material=None):
    return lathe([(size, 0), (size * 0.92, size * 0.3), (size * 0.6, size * 0.62), (size * 0.2, size * 0.74)], location,
                 material or M('bolt'), direction, 10)


def rivets(start, end, count, direction=(0, 0, 1), size=0.003, material=None):
    start, end = Vector(start), Vector(end)
    for i in range(count):
        rivet(start.lerp(end, i / max(1, count - 1)), direction, size, material)


def flange(centre, direction, radius, count=6, material=None, thickness=None):
    """A bolted pipe flange."""
    centre, direction = Vector(centre), Vector(direction).normalized()
    thickness = thickness or radius * 0.3
    cylinder(radius, thickness, centre, material or M('dark_steel'), direction, 28)
    side = direction.orthogonal().normalized()
    other = direction.cross(side)
    for i in range(count):
        a = (i + 0.5) / count * math.tau
        spot = centre + (side * math.cos(a) + other * math.sin(a)) * radius * 0.78
        for sign in (1, -1):
            bolt(spot + direction * sign * thickness / 2, direction * sign, radius * 0.11)


def tube(points, radius, material, bend=None, resolution=6, caps=True):
    """A pipe, rod or cable through [points], its corners bent round."""
    curve = bpy.data.curves.new('tube', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = resolution
    curve.use_fill_caps = caps
    spline = curve.splines.new('POLY')
    points = [Vector(p) for p in points]
    bend = radius * 2.4 if bend is None else bend
    path = []
    for i, p in enumerate(points):
        if 0 < i < len(points) - 1 and bend > 0:
            back, ahead = points[i - 1] - p, points[i + 1] - p
            reach = min(bend, back.length * 0.48, ahead.length * 0.48)
            a, b = p + back.normalized() * reach, p + ahead.normalized() * reach
            for k in range(9):
                s = k / 8
                path.append(a * (1 - s) ** 2 + p * 2 * s * (1 - s) + b * s * s)
        else:
            path.append(p)
    spline.points.add(len(path) - 1)
    for point, co in zip(spline.points, path):
        point.co = (*co, 1)
    return _place(bpy.data.objects.new('tube', curve), material, (0, 0, 0))


def pipe(points, radius, material=None, flanges=True, collars=True):
    """Pipework: a tube with a welded collar either side of each bend, and a bolted flange at each end."""
    material = material or M('steel')
    points = [Vector(p) for p in points]
    tube(points, radius, material)
    for i in range(len(points) - 1):
        direction = (points[i + 1] - points[i]).normalized()
        length = (points[i + 1] - points[i]).length
        if collars:
            for end, sign in ((points[i], 1), (points[i + 1], -1)):
                inner = 0 < (i if sign == 1 else i + 1) < len(points) - 1
                if inner and length > radius * 6:
                    cylinder(radius * 1.25, radius * 0.7, end + direction * sign * radius * 2.7, M('dark_steel'), direction, 20)
    if flanges:
        flange(points[0] + (points[1] - points[0]).normalized() * radius * 0.3, points[1] - points[0], radius * 1.75, 6)
        flange(points[-1] + (points[-2] - points[-1]).normalized() * radius * 0.3, points[-2] - points[-1], radius * 1.75, 6)


def weld(start, end, size=0.0022):
    """A weld bead: overlapping blobs along a seam."""
    start, end = Vector(start), Vector(end)
    count = max(2, int((end - start).length / (size * 1.0)))
    mesh = bpy.data.meshes.new('weld')
    bm = bmesh.new()
    for i in range(count):
        bead = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size * rng.uniform(0.8, 1.2))
        bmesh.ops.translate(bm, verts=bead['verts'], vec=start.lerp(end, i / (count - 1)) + Vector([rng.uniform(-size, size) * 0.2 for _ in range(3)]))
    bm.to_mesh(mesh)
    bm.free()
    return _place(bpy.data.objects.new('weld', mesh), M('bolt'), (0, 0, 0), sharp=180)


# Parts that move in a loop, each a pivot and its resting rotation: the gauges' needles, the valves' wheels.
MOVING = {'needles': [], 'wheels': []}


def handwheel(centre, direction, radius, material=None, spokes=4):
    """A valve's wheel: a rim, spokes, a hub and its nut, on a pivot that turns about its stem."""
    material = material or M('red')
    pivot = aim(group('wheel', location=Vector(centre)), direction)
    MOVING['wheels'].append((pivot, pivot.rotation_quaternion.copy()))
    origin, axis = Vector((0, 0, 0)), Vector((0, 0, 1))
    with inside(pivot):
        ring(radius, radius * 0.15, origin, material, axis, 28)
        for i in range(spokes):
            a = i / spokes * math.tau + 0.4
            tube([origin, Vector((math.cos(a), math.sin(a), 0)) * radius], radius * 0.09, material, caps=False, resolution=3)
        cylinder(radius * 0.28, radius * 0.3, origin, material, axis, 12)
        cylinder(radius * 0.16, radius * 0.5, axis * radius * 0.2, M('bolt'), axis, 6)


def valve(centre, along, up, radius):
    """A gate valve in a pipe of [radius] running [along]: body, flanges, bonnet, stem and wheel towards [up]."""
    centre, along, up = Vector(centre), Vector(along).normalized(), Vector(up).normalized()
    cylinder(radius * 1.7, radius * 2.6, centre, M('cast'), along, 20)
    for sign in (-1, 1):
        flange(centre + along * sign * radius * 1.6, along, radius * 2.1, 6, M('cast'))
    lathe([(radius * 1.5, 0), (radius * 1.5, radius * 1.4), (radius * 1.0, radius * 2.0), (radius * 1.0, radius * 2.6), (radius * 1.3, radius * 2.7),
           (radius * 1.3, radius * 3.0), (radius * 0.4, radius * 3.1), (radius * 0.4, radius * 5.0)], centre, M('cast'), up, 16)
    handwheel(centre + up * radius * 5.0, up, radius * 2.6)


def gauge(location, direction, radius=0.012, needle=0.3):
    """A pressure gauge facing [direction]: brass bezel, cream face, ticks, a red needle."""
    location, direction = Vector(location), Vector(direction).normalized()
    lathe([(radius * 0.9, -radius * 0.5), (radius, -radius * 0.4), (radius, radius * 0.2), (radius * 0.86, radius * 0.3), (radius * 0.86, radius * 0.12)],
          location, M('brass'), direction, 28)
    cylinder(radius * 0.86, radius * 0.1, location + direction * radius * 0.1, M('gauge_face'), direction, 28, chamfer=0)
    side = direction.orthogonal().normalized()
    other = direction.cross(side)
    if abs(direction.z) < 0.9:  # an upright face: 'other' is up
        side = direction.cross(Vector((0, 0, 1))).normalized()
        other = side.cross(direction)
    face = location + direction * radius * 0.17
    for i in range(7):
        a = math.radians(220 - i * 43.3)
        out = side * math.cos(a) + other * math.sin(a)
        tube([face + out * radius * 0.58, face + out * radius * 0.78], radius * 0.035, M('void'), caps=False, resolution=1)
    a = math.radians(220 - needle * 260)
    # The needle on its own pivot at the face's centre, so a loop can swing it.
    pivot = aim(group('needle', location=face), direction)
    rest = pivot.rotation_quaternion.copy()
    MOVING['needles'].append((pivot, rest))
    out = rest.inverted() @ (side * math.cos(a) + other * math.sin(a))
    with inside(pivot):
        tube([Vector((0, 0, 0)), out * radius * 0.7], radius * 0.05, M('needle'), caps=False, resolution=2)
    cylinder(radius * 0.12, radius * 0.1, face, M('bolt'), direction, 10)


def cable(points, radius=0.0022, material=None):
    curve = bpy.data.curves.new('cable', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for point, co in zip(spline.bezier_points, points):
        point.co = co
        point.handle_left_type = point.handle_right_type = 'AUTO'
    return _place(bpy.data.objects.new('cable', curve), material or M('tyre'), (0, 0, 0))


def gear(radius, teeth, thickness, material=None, spokes=5):
    """An iron gear wheel: a ring of cut teeth with a raised rim, spokes, and a hub proud of both faces round its bore."""
    material = material or M('iron')
    holder = group('gear')
    holder.rotation_mode = 'XYZ'
    with inside(holder):
        mesh = bpy.data.meshes.new('gear')
        bm = bmesh.new()
        outer, inner = [], []
        root, web = radius * 0.8, radius * 0.6
        for i in range(teeth):
            for fraction, r in ((0.0, root), (0.16, radius), (0.42, radius), (0.58, root)):
                a = (i + fraction) / teeth * math.tau
                outer.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, -thickness / 2)))
                inner.append(bm.verts.new((math.cos(a) * web, math.sin(a) * web, -thickness / 2)))
        count = len(outer)
        faces = [bm.faces.new((outer[i], outer[(i + 1) % count], inner[(i + 1) % count], inner[i])) for i in range(count)]
        extruded = bmesh.ops.extrude_face_region(bm, geom=faces)
        bmesh.ops.translate(bm, verts=[v for v in extruded['geom'] if isinstance(v, bmesh.types.BMVert)], vec=(0, 0, thickness))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(mesh)
        bm.free()
        body = _place(bpy.data.objects.new('gear', mesh), material, (0, 0, 0), smooth=False)
        bevel = body.modifiers.new('bevel', 'BEVEL')
        bevel.width = thickness * 0.1
        bevel.segments = 2
        bevel.limit_method = 'ANGLE'
        for i in range(spokes):
            a = (i + 0.5) / spokes * math.tau
            box((radius * 0.4, radius * 0.17, thickness * 0.62), (math.cos(a) * radius * 0.44, math.sin(a) * radius * 0.44, 0), material,
                bevel=thickness * 0.08, rotation=(0, 0, math.degrees(a)))
        half = thickness / 2
        lathe([(radius * 0.13, -half * 1.6), (radius * 0.27, -half * 1.6), (radius * 0.31, -half), (radius * 0.31, half), (radius * 0.27, half * 1.6),
               (radius * 0.13, half * 1.6)], (0, 0, 0), material, (0, 0, 1), 20)
        for sign in (-1, 1):
            cylinder(radius * 0.13, half * 0.1, (0, 0, sign * half * 1.62), M('void'), (0, 0, 1), 14, chamfer=0)  # the bore
            lathe([(radius * 0.61, half), (radius * 0.62, half * 1.3), (radius * 0.72, half * 1.3), (radius * 0.73, half)],
                  (0, 0, 0), material, (0, 0, sign), 32, caps=False)
    return holder


def chevron(width, arm, thickness, material, weight=0.55):
    """A moulded arrow, '>' shaped, pointing along +x."""
    mesh = bpy.data.meshes.new('chevron')
    bm = bmesh.new()
    half = width / 2
    points = [(-arm, half), (0, 0), (-arm, -half), (-arm + arm * weight, -half), (arm * weight, 0), (-arm + arm * weight, half)]
    face = bm.faces.new([bm.verts.new((x, y, 0)) for x, y in points])
    extruded = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, verts=[v for v in extruded['geom'] if isinstance(v, bmesh.types.BMVert)], vec=(0, 0, thickness))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    obj = _place(bpy.data.objects.new('chevron', mesh), material, (0, 0, 0), smooth=False)
    bevel = obj.modifiers.new('bevel', 'BEVEL')
    bevel.width = thickness * 0.3
    bevel.segments = 2
    bevel.limit_method = 'ANGLE'
    return obj


def shape(points, location, material, normal=(0, -1, 0)):
    """A flat painted shape from 2D [points], facing [normal]."""
    mesh = bpy.data.meshes.new('shape')
    bm = bmesh.new()
    bm.faces.new([bm.verts.new((x, y, 0)) for x, y in points])
    bm.to_mesh(mesh)
    bm.free()
    obj = _place(bpy.data.objects.new('shape', mesh), material, location, smooth=False)
    z = Vector(normal).normalized()
    x = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 1, 0))
    y = z.cross(x).normalized()
    x = y.cross(z)
    obj.rotation_euler = Matrix((x, y, z)).transposed().to_euler()
    return obj


def lump(material, size, location, seed=0, squash=0.75):
    """A lump of coal or ash: a ball broken up by noise."""
    local = random.Random(seed)
    mesh = bpy.data.meshes.new('lump')
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=size)
    for v in bm.verts:
        v.co *= 1 + local.uniform(-0.28, 0.22)
        v.co.z *= squash
    bm.to_mesh(mesh)
    bm.free()
    obj = _place(bpy.data.objects.new('lump', mesh), material, location, smooth=False)
    obj.rotation_euler = (local.uniform(0, math.tau), local.uniform(0, math.tau), local.uniform(0, math.tau))
    return obj


def strands(count, sample, material, length=(0.025, 0.06), thick=0.0014, seed=3):
    """Straw: [count] thin stalks, each placed and turned by sample(rng) -> (location, yaw, pitch)."""
    local = random.Random(seed)
    mesh = bpy.data.meshes.new('strands')
    bm = bmesh.new()
    for _ in range(count):
        location, yaw, pitch = sample(local)
        made = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(local.uniform(*length), thick * local.uniform(0.7, 1.5), thick), verts=made['verts'])
        bmesh.ops.rotate(bm, verts=made['verts'], cent=(0, 0, 0), matrix=Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(pitch, 3, 'Y'))
        bmesh.ops.translate(bm, verts=made['verts'], vec=location)
    bm.to_mesh(mesh)
    bm.free()
    return _place(bpy.data.objects.new('strands', mesh), material, (0, 0, 0), smooth=False)


def plate(size, location, material, normal=(0, -1, 0), studs=None, stud_size=0.0026, inset=0.006, bevel=0.001):
    """A flat plate facing [normal] (x: width, y: height, z: thickness), riveted or bolted round its edge."""
    obj = box(size, location, material, bevel=bevel)
    z = Vector(normal).normalized()
    x = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 1, 0))
    y = z.cross(x).normalized()
    x = y.cross(z)
    obj.rotation_euler = Matrix((x, y, z)).transposed().to_euler()
    if studs:
        nx, ny, kind = studs
        w, h = size[0] / 2 - inset, size[1] / 2 - inset
        spots = set()
        for i in range(nx):
            for v in (-h, h):
                spots.add((round(-w + 2 * w * i / max(1, nx - 1), 5), v))
        for j in range(ny):
            for u in (-w, w):
                spots.add((u, round(-h + 2 * h * j / max(1, ny - 1), 5)))
        for u, v in spots:
            spot = Vector(location) + x * u + y * v + z * size[2] / 2
            (bolt if kind == 'bolt' else rivet)(spot, z, stud_size)
    return obj


# ---------------------------------------------------------------- the wooden chest

def chest():
    """
    A wooden chest, open, packed with straw and gear wheels: planked walls on skids, iron straps and corners riveted
    on, a stencilled arrow, rope handles, a lid thrown back on strap hinges. Returns its holder and what it carries.
    """
    holder = group('chest')
    w, d, h, t = 0.21, 0.17, 0.125, 0.012
    z0 = 0.012
    wood_, iron = M('wood'), M('band')
    with inside(holder):
        for x in (-0.07, 0.07):
            plank(d + 0.012, 0.026, z0, (x, 0, z0 / 2), (0, 1, 0), (0, 0, 1), M('wood_dark'))
        plank(w, d, t, (0, 0, z0 + t / 2), (1, 0, 0), (0, 0, 1), wood_)
        rows = 3
        ph = h / rows
        for i in range(rows):
            z = z0 + ph * (i + 0.5)
            for side in (-1, 1):
                plank(w + rng.uniform(-0.002, 0.003), ph - 0.0025, t, (rng.uniform(-0.001, 0.001), side * (d / 2 - t / 2), z), (1, 0, 0), (0, side, 0), wood_, 0.012)
                plank(d - 2 * t, ph - 0.0025, t, (side * (w / 2 - t / 2), 0, z), (0, 1, 0), (side, 0, 0), wood_, 0.012)
        front = -d / 2
        # Iron: corner angles and two straps on the front and back, riveted; bands along the sides.
        for side in (-1, 1):
            for y, normal in ((front - 0.0012, (0, -1, 0)), (-front + 0.0012, (0, 1, 0))):
                plate((0.017, h + 0.002, 0.0024), (side * (w / 2 - 0.0085), y, z0 + h / 2), iron, normal)
                rivets((side * (w / 2 - 0.0085), y - normal[1] * -0.0012, z0 + 0.012), (side * (w / 2 - 0.0085), y - normal[1] * -0.0012, z0 + h - 0.012), 5, normal, 0.0032)
                plate((0.015, h + 0.002, 0.0024), (side * 0.052, y, z0 + h / 2), iron, normal)
                rivets((side * 0.052, y - normal[1] * -0.0012, z0 + 0.014), (side * 0.052, y - normal[1] * -0.0012, z0 + h - 0.014), 4, normal, 0.003)
            plate((0.017, h + 0.002, 0.0024), (side * (w / 2 + 0.0012), front + 0.0085, z0 + h / 2), iron, (side, 0, 0))
            plate((0.017, h + 0.002, 0.0024), (side * (w / 2 + 0.0012), -front - 0.0085, z0 + h / 2), iron, (side, 0, 0))
            # The straps fold over the rim.
            for x in (side * 0.052,):
                plate((0.015, t + 0.004, 0.0022), (x, front + t / 2, z0 + h + 0.0011), iron, (0, 0, 1))
                rivet((x, front + t / 2, z0 + h + 0.002), (0, 0, 1), 0.003)
            # Rope handles through iron eyes.
            x = side * (w / 2 + 0.002)
            for y in (-0.035, 0.035):
                plate((0.02, 0.02, 0.003), (x, y, z0 + h * 0.66), iron, (side, 0, 0))
                ring(0.006, 0.0018, (x + side * 0.004, y, z0 + h * 0.66), iron, (0, 1, 0), 14, 6)
            cable([(x + side * 0.004, -0.035, z0 + h * 0.66), (x + side * 0.02, -0.02, z0 + h * 0.5), (x + side * 0.024, 0.0, z0 + h * 0.44),
                   (x + side * 0.02, 0.02, z0 + h * 0.5), (x + side * 0.004, 0.035, z0 + h * 0.66)], 0.0036, M('rope'))
        # Nails in the plank ends.
        for i in range(rows):
            for x in (-0.03, 0.0, 0.03):
                rivet((x + rng.uniform(-0.004, 0.004), front - 0.0002, z0 + ph * (i + 0.5) + rng.uniform(-0.01, 0.01)), (0, -1, 0), 0.0016)
        # The hasp's staple, and the stencil: an arrow into a tray.
        plate((0.022, 0.02, 0.0024), (0, front - 0.0012, z0 + h - 0.014), iron, (0, -1, 0))
        ring(0.0055, 0.0017, (0, front - 0.006, z0 + h - 0.014), M('bolt'), (1, 0, 0), 14, 6)
        stencil = M('stencil')
        shape([(-0.011, 0.03), (0.011, 0.03), (0.011, 0.002), (0.026, 0.002), (0, -0.026), (-0.026, 0.002), (-0.011, 0.002)],
              (0, front - 0.0009, z0 + h * 0.47), stencil, (0, -1, 0))
        shape([(-0.03, -0.031), (0.03, -0.031), (0.03, -0.038), (-0.03, -0.038)], (0, front - 0.0009, z0 + h * 0.47), stencil, (0, -1, 0))

        # Inside: straw, with gear wheels and copper plate bedded in it.
        fill = z0 + h - 0.03
        box((w - 2 * t, d - 2 * t, fill - z0 - t), (0, 0, (fill + z0 + t) / 2), M('straw'), bevel=0)

        def bed(r):
            return (r.uniform(-w / 2 + 0.03, w / 2 - 0.03), r.uniform(front + 0.03, -front - 0.03), fill + r.uniform(0.0, 0.014)), r.uniform(0, math.tau), r.uniform(-0.3, 0.3)

        def spill(r):
            x = r.uniform(-w / 2 + 0.02, w / 2 - 0.02)
            return (x, front + r.uniform(0.0, 0.012), z0 + h + r.uniform(0.0, 0.006)), math.pi / 2 + r.uniform(-0.6, 0.6), r.uniform(0.2, 0.7)

        strands(900, bed, M('straw'))
        strands(26, spill, M('straw'), seed=8)
        packed = []
        for (x, y, z, r, tilt, turn) in [(-0.052, -0.02, 0.012, 0.03, (22, -14), 20), (0.05, 0.02, 0.014, 0.033, (-16, 20), 70), (0.045, -0.04, 0.006, 0.024, (30, 8), 10),
                                         (-0.04, 0.04, 0.008, 0.026, (-24, -10), 45)]:
            g = gear(r, 12, r * 0.3)
            g.location = (x, y, fill + z)
            g.rotation_euler = (math.radians(tilt[0]), math.radians(tilt[1]), math.radians(turn))
            packed.append(g)
        for k in range(3):
            box((0.062, 0.042, 0.004), (-0.004 + k * 0.004, 0.032 - k * 0.003, fill + 0.008 + k * 0.0048), M('copper'), bevel=0.0008, rotation=(14, -8, 24 + k * 7))

        # The lid, thrown back on its hinges; its underside faces us.
        swing = -122
        lid = group('lid', (0, -front, z0 + h), (swing, 0, 0))
        dl = d + 0.01
        with inside(lid):
            for i in range(3):
                plank(w + 0.012 + rng.uniform(-0.002, 0.002), dl / 3 - 0.002, t, (0, -(i + 0.5) * dl / 3, t / 2), (1, 0, 0), (0, 0, 1), wood_, 0.008)
            for x in (-0.06, 0.06):
                plank(dl - 0.045, 0.024, 0.009, (x, -dl / 2, -0.0045), (0, 1, 0), (0, 0, -1), M('wood_dark'))
                rivets((x, -dl + 0.035, -0.009), (x, -0.035, -0.009), 4, (0, 0, -1), 0.0022)
                # strap hinges, their knuckles on the hinge line
                plate((0.014, 0.05, 0.0024), (x + 0.021, -0.03, -0.0012), iron, (0, 0, -1))
                rivets((x + 0.021, -0.045, -0.0024), (x + 0.021, -0.018, -0.0024), 3, (0, 0, -1), 0.0026)
                cylinder(0.005, 0.03, (x + 0.021, 0.0, 0.0), M('bolt'), (1, 0, 0), 12)
            plate((w + 0.016, t + 0.003, 0.0024), (0, -dl - 0.0012, t / 2), iron, (0, -1, 0))
            rivets((-w / 2 + 0.01, -dl - 0.0024, t / 2), (w / 2 - 0.01, -dl - 0.0024, t / 2), 9, (0, -1, 0), 0.0026)
            plate((0.02, 0.034, 0.0024), (0, -dl + 0.012, -0.0012), iron, (0, 0, -1))  # the hasp
        # What jumps out: a big gear wheel, a small one after it, straw in the air.
        jumper = gear(0.044, 14, 0.012)
        follower = gear(0.022, 10, 0.007)
        flying = group('flying')
        with inside(flying):
            def tossed(r):
                a = r.uniform(0, math.tau)
                return (math.cos(a) * r.uniform(0.02, 0.085), r.uniform(-0.05, 0.03), r.uniform(-0.03, 0.1)), r.uniform(0, math.tau), r.uniform(-1.2, 1.2)
            strands(16, tossed, M('straw'), length=(0.02, 0.04), seed=21)
    return holder, lid, jumper, follower, flying, z0 + h


# ---------------------------------------------------------------- the transport belt

def belt(length=0.3, width=0.14):
    """
    A rubber transport belt along x: thick rubber slats round a drum at each end, moulded chevrons painted yellow and
    worn; steel side rails with stiffeners, bolts and guide wheels; pillow-block bearings, a tensioner, legs with
    cross braces on bolted feet; a geared motor with its chain guard and cable. Returns its holder, a function that
    moves the belt by a number of slats, the slat spacing, the surface height, and the top run's length.
    """
    holder = group('belt')
    top, drum = 0.094, 0.028
    axle = top - drum
    perimeter = 2 * length + math.tau * drum
    count = 32
    step = perimeter / count
    steel, dark = M('steel'), M('dark_steel')
    slats = []
    with inside(holder):
        for i in range(count):
            slat = group('slat')
            slat.rotation_mode = 'XYZ'
            with inside(slat):
                box((step - 0.0026, width, 0.007), (0, 0, -0.0035), M('rubber'), bevel=0.0016)
                for y in (-width / 2 + 0.007, width / 2 - 0.007):  # a raised lip along each edge
                    box((step - 0.004, 0.006, 0.003), (0, y, 0.001), M('rubber'), bevel=0.001)
                if i % 2 == 0:
                    chevron(width * 0.5, step * 0.95, 0.0028, M('chevron')).location = (step * 0.35, 0, -0.0002)
            slats.append(slat)

        def move(shift):
            """Places every slat [shift] slats along the loop: over the top, round the drum, back underneath."""
            for i, slat in enumerate(slats):
                s = ((i + shift) * step) % perimeter
                if s < length:
                    slat.location, pitch = (-length / 2 + s, 0, top), 0.0
                elif s < length + math.pi * drum:
                    pitch = (s - length) / drum
                    slat.location = (length / 2 + math.sin(pitch) * drum, 0, axle + math.cos(pitch) * drum)
                elif s < 2 * length + math.pi * drum:
                    slat.location, pitch = (length / 2 - (s - length - math.pi * drum), 0, axle - drum), math.pi
                else:
                    pitch = math.pi + (s - 2 * length - math.pi * drum) / drum
                    slat.location = (-length / 2 + math.sin(pitch) * drum, 0, axle + math.cos(pitch) * drum)
                slat.rotation_euler = (0, pitch, 0)
        move(0)

        # Drums and their shafts; idlers under the top run; a pan between the runs.
        for end in (-1, 1):
            cylinder(drum - 0.007, width + 0.004, (end * length / 2, 0, axle), dark, (0, 1, 0), 28)
            cylinder(0.007, width + 0.07, (end * length / 2, 0, axle), M('shaft'), (0, 1, 0), 16)
        for i in range(5):
            cylinder(0.008, width + 0.01, (-length / 2 + 0.05 + i * (length - 0.1) / 4, 0, top - 0.016), M('shaft'), (0, 1, 0), 14)
        box((length - 0.03, width + 0.012, 0.004), (0, 0, axle), dark)

        for side in (-1, 1):
            y = side * (width / 2 + 0.009)
            out = (0, side, 0)
            face = y + side * 0.004
            # The rail: a deep plate with a capping strip and a foot flange, stiffened between the wheels.
            box((length + 0.012, 0.008, 0.05), (0, y, top - 0.029), steel, bevel=0.0012)
            box((length + 0.03, 0.012, 0.005), (0, y + side * 0.001, top - 0.001), dark, bevel=0.0012)
            box((length + 0.012, 0.018, 0.005), (0, y + side * 0.005, top - 0.056), dark, bevel=0.0012)
            bolts((-length / 2 + 0.012, y + side * 0.002, top + 0.0015), (length / 2 - 0.012, y + side * 0.002, top + 0.0015), 12, (0, 0, 1), 0.0026)
            wheels = 6
            for i in range(wheels):
                x = -length / 2 + 0.036 + i * (length - 0.072) / (wheels - 1)
                # a guide wheel on a stub axle: tyre, dished hub, nut
                cylinder(0.0125, 0.008, (x, face + side * 0.006, top - 0.03), M('tyre'), out, 24, chamfer=0.3)
                lathe([(0.008, 0), (0.008, 0.005), (0.0055, 0.0062), (0.0055, 0.0045), (0.003, 0.0045), (0.003, 0.0075), (0.0, 0.0075)],
                      (x, face + side * 0.004, top - 0.03), M('shaft'), out, 16)
                bolt((x, face + side * 0.0095, top - 0.03), out, 0.0028)
                if i < wheels - 1:
                    middle = x + (length - 0.072) / (wheels - 1) / 2
                    box((0.005, 0.008, 0.044), (middle, face + side * 0.003, top - 0.029), dark, bevel=0.001)
                    weld((middle + 0.003, face + side * 0.001, top - 0.05), (middle + 0.003, face + side * 0.001, top - 0.008), 0.0013)
                    bolt((middle - 0.011, face, top - 0.012), out, 0.0022)
                    bolt((middle + 0.011, face, top - 0.046), out, 0.0022)
            # Pillow-block bearings at each drum, on bolted pads; a screw tensioner at the tail.
            for end in (-1, 1):
                x = end * length / 2
                box((0.044, 0.007, 0.036), (x, face + side * 0.0035, axle), M('ochre'), bevel=0.002)
                lathe([(0.017, 0), (0.017, 0.006), (0.012, 0.011), (0.012, 0.014), (0.0075, 0.014)], (x, face + side * 0.007, axle), M('ochre'), out, 20)
                cylinder(0.0045, 0.006, (x, face + side * 0.024, axle), M('bolt'), out, 6)
                for dx in (-0.016, 0.016):
                    for dz in (-0.012, 0.012):
                        bolt((x + dx, face + side * 0.007, axle + dz), out, 0.0026)
            x = -length / 2
            tube([(x - 0.005, face + side * 0.006, axle + 0.024), (x + 0.06, face + side * 0.006, axle + 0.024)], 0.0022, M('shaft'))
            for nut_x in (x + 0.004, x + 0.03, x + 0.058):
                cylinder(0.0045, 0.004, (nut_x, face + side * 0.006, axle + 0.024), M('bolt'), (1, 0, 0), 6)
            box((0.006, 0.012, 0.012), (x + 0.06, face + side * 0.004, axle + 0.024), dark)
            # Legs on bolted feet, cross-braced.
            legs = (-length / 2 + 0.045, 0.0, length / 2 - 0.045)
            for x in legs:
                box((0.014, 0.012, top - 0.058), (x, y + side * 0.004, (top - 0.058) / 2), steel, bevel=0.0012)
                box((0.04, 0.03, 0.004), (x, y + side * 0.006, 0.002), dark, bevel=0.001)
                for dx in (-0.014, 0.014):
                    bolt((x + dx, y + side * 0.012, 0.004), (0, 0, 1), 0.003)
                box((0.026, 0.004, 0.012), (x, face + side * 0.006, top - 0.062), dark, bevel=0.001)  # a gusset under the rail
                weld((x - 0.012, face + side * 0.008, top - 0.057), (x + 0.012, face + side * 0.008, top - 0.057), 0.0014)
            for a, b in zip(legs, legs[1:]):
                span, rise = b - a - 0.014, top - 0.07
                for sign in (-1, 1):
                    box((math.hypot(span, rise), 0.003, 0.006), ((a + b) / 2, y + side * (0.011 + 0.0016 * sign), rise / 2 + 0.004), steel, bevel=0.0008,
                        rotation=(0, sign * math.degrees(math.atan2(rise, span)), 0))
                bolt(((a + b) / 2, y + side * 0.0135, rise / 2 + 0.004), out, 0.0026)
        for x in (-length / 2 + 0.045, 0.0, length / 2 - 0.045):
            box((0.01, width + 0.02, 0.01), (x, 0, 0.012), dark)

        # The drive, in front at the head end: a finned motor on a base, a gearbox, a chain guard up to the drum's shaft.
        front = -(width / 2 + 0.013)
        mx, my, mz = 0.02, front - 0.05, 0.03
        box((0.13, 0.058, 0.005), (mx + 0.02, my, 0.0025), dark, bevel=0.001)
        for dx in (-0.056, 0.056):
            for dy in (-0.022, 0.022):
                bolt((mx + 0.02 + dx, my + dy, 0.005), (0, 0, 1), 0.003)
        green = M('green')
        lathe([(0.018, 0), (0.023, 0.003), (0.023, 0.058), (0.02, 0.062), (0.012, 0.064)], (mx - 0.036, my, mz), green, (1, 0, 0), 28)
        for i in range(9):
            cylinder(0.0262, 0.0022, (mx - 0.028 + i * 0.0058, my, mz), green, (1, 0, 0), 28)
        lathe([(0.0, 0), (0.02, 0.0), (0.024, 0.004), (0.024, 0.016), (0.021, 0.016)], (mx - 0.05, my, mz), dark, (1, 0, 0), 28)  # the fan cowl
        for k in range(5):
            box((0.0012, 0.03 - abs(k - 2) * 0.006, 0.002), (mx - 0.0505, my, mz - 0.012 + k * 0.006), M('void'), bevel=0)
        for dx in (-0.02, 0.012):
            box((0.012, 0.05, 0.012), (mx + dx, my, 0.009), green, bevel=0.002)
        box((0.026, 0.022, 0.014), (mx - 0.006, my - 0.004, mz + 0.027), dark, bevel=0.002)  # the terminal box
        for dx in (-0.009, 0.009):
            for dy in (-0.007, 0.007):
                bolt((mx - 0.006 + dx, my - 0.004 + dy, mz + 0.034), (0, 0, 1), 0.0018)
        cylinder(0.0042, 0.008, (mx - 0.022, my - 0.004, mz + 0.027), M('brass'), (1, 0, 0), 10)
        cable([(mx - 0.024, my - 0.004, mz + 0.027), (mx - 0.05, my - 0.014, mz + 0.03), (mx - 0.085, my - 0.026, 0.006), (mx - 0.12, my - 0.012, 0.003),
               (mx - 0.16, my - 0.03, 0.003), (mx - 0.2, my - 0.022, 0.003)], 0.0028)
        cylinder(0.006, 0.02, (mx + 0.036, my, mz), M('shaft'), (1, 0, 0), 12)
        gx = mx + 0.066
        box((0.044, 0.05, 0.05), (gx, my, 0.03), M('ochre'), bevel=0.004, segments=3)
        plate((0.034, 0.036, 0.003), (gx, my, 0.0565), dark, (0, 0, 1), studs=(2, 2, 'bolt'), stud_size=0.0026, inset=0.005)
        cylinder(0.0045, 0.006, (gx, my - 0.006, 0.061), M('brass'), (0, 0, 1), 6)  # the oil filler
        for dz in (-0.014, 0.0, 0.014):
            box((0.046, 0.052, 0.003), (gx, my, 0.03 + dz), M('ochre'), bevel=0.001)
        # the chain guard: a slanted case from the gearbox to the head drum's shaft, in front of the bearing
        gy = front - 0.016
        low, high = Vector((gx + 0.006, gy, 0.036)), Vector((length / 2, gy, axle))
        middle, run = (low + high) / 2, high - low
        angle = -math.degrees(math.atan2(run.z, run.x))
        guard = M('yellow')
        box((run.length, 0.012, 0.036), middle, guard, bevel=0.003, rotation=(0, angle, 0))
        for end in (low, high):
            cylinder(0.018, 0.012, end, guard, (0, 1, 0), 24)
            cylinder(0.006, 0.016, end, M('shaft'), (0, 1, 0), 12)
            bolt(end + Vector((0, -0.008, 0)), (0, -1, 0), 0.0036)
        for s in (0.25, 0.5, 0.75):
            for dz in (-0.013, 0.013):
                bolt(low.lerp(high, s) + Vector((dz * run.z / run.length * -1, -0.006, dz * run.x / run.length)), (0, -1, 0), 0.0022)
        box((0.02, front - gy + 0.02, 0.02), (gx + 0.006, (gy + my) / 2 - 0.004, 0.036), dark, bevel=0.002)
    return holder, move, step, top + 0.0028, length


# ---------------------------------------------------------------- the steel furnace

def furnace():
    """
    A steel furnace at work. A plated, riveted body on a skid; a firebox behind cast doors thrown open, coals and
    flame inside, a grate, an ash drawer; a tall banded exhaust, sooty towards its top, stayed with rods; on top, a
    pressure drum with a relief valve, a main with a gate valve, copper lines, gauges; a blower with its motor on one
    side and a coal hopper on the other; cables. Returns its holder, the fire's lights, and the stack's mouth.
    """
    holder = group('furnace')
    w, d, h, z0 = 0.2, 0.18, 0.13, 0.02
    top = z0 + h
    front = -d / 2
    steel, dark, plate_steel, cast = M('steel'), M('dark_steel'), M('plate'), M('cast')
    with inside(holder):
        # The skid: two channels and cross members, bolted feet.
        for y in (front + 0.02, -front - 0.02):
            box((w + 0.05, 0.022, z0), (0, y, z0 / 2), dark, bevel=0.002)
        for x in (-w / 2 - 0.012, w / 2 + 0.012):
            box((0.018, d + 0.012, z0 * 0.8), (x, 0, z0 * 0.4), dark, bevel=0.002)
        for x in (-w / 2 - 0.016, w / 2 + 0.016):
            box((0.026, 0.034, 0.004), (x, front + 0.006, 0.002), steel, bevel=0.001)
            bolt((x, front + 0.0, 0.004), (0, 0, 1), 0.0034)
        bolts((-w / 2 + 0.02, front + 0.008, z0), (w / 2 - 0.02, front + 0.008, z0), 6, (0, -0.4, 1), 0.003)

        # The body, with the firebox cut into its front.
        body = box((w, d, h), (0, 0, z0 + h / 2), plate_steel, bevel=0.004, segments=3)
        fx, fz, fw, fh = -0.012, z0 + 0.062, 0.1, 0.054
        cutter = box((fw, 0.12, fh), (fx, front, fz), None, bevel=0)
        cutter.hide_render = cutter.hide_viewport = True
        cut = body.modifiers.new('firebox', 'BOOLEAN')
        cut.object = cutter
        cut.operation = 'DIFFERENCE'
        box((w + 0.012, d + 0.012, 0.008), (0, 0, top + 0.004), steel, bevel=0.002)
        for i in range(9):
            for y in (front - 0.001, -front + 0.001):
                bolt((-w / 2 + 0.008 + i * (w - 0.016) / 8, y + (0.006 if y < 0 else -0.006), top + 0.008), (0, 0, 1), 0.003)
        for j in range(6):
            for x in (-w / 2 + 0.005, w / 2 - 0.005):
                bolt((x, front + 0.03 + j * (d - 0.06) / 5, top + 0.008), (0, 0, 1), 0.003)
        # Corner angles and a waist band, riveted; weld beads where the plates meet the skid.
        for side in (-1, 1):
            x = side * (w / 2 - 0.007)
            plate((0.016, h - 0.004, 0.003), (x, front - 0.0015, z0 + h / 2), dark, (0, -1, 0))
            rivets((x, front - 0.003, z0 + 0.01), (x, front - 0.003, top - 0.012), 9, (0, -1, 0), 0.0028)
            weld((side * w / 2, front, z0 + 0.003), (side * w / 2, -front, z0 + 0.003), 0.002)
        weld((-w / 2, front, z0 + 0.002), (w / 2, front, z0 + 0.002), 0.0022)
        plate((w - 0.03, 0.012, 0.0028), (0, front - 0.0014, top - 0.012), dark, (0, -1, 0))
        rivets((-w / 2 + 0.024, front - 0.0028, top - 0.012), (w / 2 - 0.024, front - 0.0028, top - 0.012), 13, (0, -1, 0), 0.0026)

        # The firebox: brick-dark inside, coals, flame, a grate; a cast frame, two doors thrown open, an ash drawer.
        for i in range(26):
            lump(M('ember'), rng.uniform(0.008, 0.014), (fx + rng.uniform(-fw / 2 + 0.008, fw / 2 - 0.008), front + rng.uniform(0.008, 0.045),
                                                        fz - fh / 2 + rng.uniform(0.004, 0.02)), seed=i)
        flames = []
        for i in range(7):
            tall = rng.uniform(0.022, 0.042)
            flame = lathe([(0.0055, 0.0), (0.008, 0.22), (0.006, 0.55), (0.0025, 0.85), (0.0, 1.0)],
                          (fx + (i - 3) * 0.013 + rng.uniform(-0.003, 0.003), front + rng.uniform(0.012, 0.032), fz - fh / 2 + 0.012), M('flame'), (0, 0, 1), 10)
            flame.scale = (1.0, 1.0, tall)
            flame.visible_shadow = False
            flames.append((flame, tall, rng.uniform(0, 1)))
        for i in range(8):
            box((0.0036, 0.006, fh * 0.5), (fx - fw / 2 + 0.008 + i * (fw - 0.016) / 7, front + 0.002, fz - fh * 0.25), cast, bevel=0.001)
        box((fw, 0.006, 0.004), (fx, front + 0.002, fz), cast, bevel=0.001)
        frame = 0.014
        for (sx, sz, x, z) in [(fw + 2 * frame, frame, fx, fz + fh / 2 + frame / 2), (fw + 2 * frame, frame, fx, fz - fh / 2 - frame / 2),
                               (frame, fh, fx - fw / 2 - frame / 2, fz), (frame, fh, fx + fw / 2 + frame / 2, fz)]:
            box((sx, 0.012, sz), (x, front - 0.005, z), cast, bevel=0.003, segments=3)
        for x in (fx - fw / 2 - frame / 2, fx + fw / 2 + frame / 2):
            for z in (fz - fh / 2 - frame / 2, fz, fz + fh / 2 + frame / 2):
                bolt((x, front - 0.011, z), (0, -1, 0), 0.0036)
        for x in (fx - 0.025, fx + 0.025):
            bolt((x, front - 0.011, fz + fh / 2 + frame / 2), (0, -1, 0), 0.0036)
        for side in (-1, 1):
            hinge_x = fx + side * (fw / 2 + frame * 0.8)
            door = group('door', (hinge_x, front - 0.013, fz), (0, 0, side * 118))
            with inside(door):
                # closed, a door lies along -side x from its hinge; its inner face is +y
                box((fw / 2, 0.007, fh + 0.008), (-side * fw / 4, 0, 0), cast, bevel=0.002)
                box((fw / 2 - 0.012, 0.004, fh - 0.01), (-side * fw / 4, 0.004, 0), M('sooty'), bevel=0.0015)
                for z in (-fh / 2 + 0.008, fh / 2 - 0.008):
                    cylinder(0.0045, 0.012, (0, 0, z), M('bolt'), (0, 0, 1), 10)
                    box((0.02, 0.003, 0.007), (-side * 0.012, -0.004, z), dark, bevel=0.001)
                tube([(-side * (fw / 2 - 0.008), -0.003, -0.012), (-side * (fw / 2 - 0.008), -0.016, -0.012), (-side * (fw / 2 - 0.008), -0.016, 0.012),
                      (-side * (fw / 2 - 0.008), -0.003, 0.012)], 0.0022, M('shaft'))
        soot = shape([(-1, -1), (1, -1), (1, 1), (-1, 1)], (fx, front - 0.0006, fz + fh / 2 + 0.012), M('soot_smear'), (0, -1, 0))
        soot.visible_shadow = False
        soot.scale = (0.085, 0.058, 1.0)
        # The ash drawer and what's fallen from it.
        az = z0 + 0.012
        box((fw + 0.01, 0.008, 0.017), (fx, front - 0.004, az), dark, bevel=0.002)
        tube([(fx - 0.02, front - 0.008, az), (fx - 0.02, front - 0.017, az), (fx + 0.02, front - 0.017, az), (fx + 0.02, front - 0.008, az)], 0.0022, M('shaft'))
        for i in range(14):
            lump(M('coal') if i % 5 else M('ember'), rng.uniform(0.003, 0.007), (fx + rng.uniform(-0.05, 0.05), front - rng.uniform(0.022, 0.05), 0.003), seed=40 + i)

        # Beside the firebox: a draught damper with its lever, a nameplate, a thermometer well and gauge.
        px = w / 2 - 0.028
        gauge((px, front - 0.008, z0 + 0.088), (0, -1, 0.25), 0.0155, needle=0.72)
        cylinder(0.006, 0.01, (px, front - 0.003, z0 + 0.088), M('brass'), (0, 1, 0), 10)
        plate((0.034, 0.02, 0.002), (px, front - 0.001, z0 + 0.052), M('brass'), (0, -1, 0), studs=(2, 2, 'rivet'), stud_size=0.0016, inset=0.003)
        for k in range(3):
            box((0.022, 0.0012, 0.0016), (px, front - 0.0022, z0 + 0.057 - k * 0.005), M('void'), bevel=0)
        plate((0.03, 0.022, 0.003), (px, front - 0.0015, z0 + 0.022), dark, (0, -1, 0), studs=(2, 2, 'bolt'), stud_size=0.002, inset=0.004)
        tube([(px - 0.006, front - 0.004, z0 + 0.022), (px + 0.008, front - 0.02, z0 + 0.034)], 0.0022, M('shaft'))
        lathe([(0.004, 0), (0.0048, 0.004), (0.003, 0.009), (0.0, 0.01)], (px + 0.008, front - 0.02, z0 + 0.034), M('red'), (0.5, -0.7, 0.45), 10)
        lx = -w / 2 + 0.027
        tube([(lx, front - 0.007, z0 + 0.02), (lx, front - 0.007, top - 0.03)], 0.0032, M('copper'), caps=True)  # a sight glass
        for z in (z0 + 0.022, top - 0.032):
            cylinder(0.0055, 0.009, (lx, front - 0.005, z), M('brass'), (0, 1, 0), 10)
            cylinder(0.005, 0.007, (lx, front - 0.007, z), M('brass'), (0, 0, 1), 6)
        bolts((lx + 0.014, front - 0.001, z0 + 0.03), (lx + 0.014, front - 0.001, top - 0.03), 4, (0, -1, 0), 0.0022)

        # The exhaust, back left: a coned base, three flanged lengths narrowing upwards, clamp bands, a flared mouth.
        sx, sy = -0.046, 0.036
        s0 = top + 0.008
        lathe([(0.046, 0), (0.046, 0.006), (0.04, 0.01), (0.03, 0.036), (0.03, 0.04)], (sx, sy, s0), dark, (0, 0, 1), 32)
        for i in range(10):
            a = i / 10 * math.tau
            bolt((sx + math.cos(a) * 0.043, sy + math.sin(a) * 0.043, s0 + 0.007), (0, 0, 1), 0.0028)
        for i in range(6):
            a = (i + 0.5) / 6 * math.tau
            box((0.004, 0.016, 0.026), (sx + math.cos(a) * 0.037, sy + math.sin(a) * 0.037, s0 + 0.02), dark, bevel=0.001,
                rotation=(0, 0, math.degrees(a) + 90))  # gussets round the cone
        heights = [(0.04, 0.105, 0.027, dark), (0.105, 0.165, 0.0245, M('sooty')), (0.165, 0.212, 0.0225, M('sooty'))]
        for low, high, radius, material in heights:
            cylinder(radius, high - low, (sx, sy, s0 + (low + high) / 2), material, (0, 0, 1), 28, chamfer=0.02)
            flange((sx, sy, s0 + low + 0.003), (0, 0, 1), radius * 1.3, 8, dark, 0.006)
            cylinder(radius * 1.07, 0.006, (sx, sy, s0 + (low + high) / 2 + 0.006), M('band'), (0, 0, 1), 28)  # a clamp band
            box((0.008, 0.006, 0.01), (sx, sy - radius * 1.1, s0 + (low + high) / 2 + 0.006), M('band'), bevel=0.001)
            bolt((sx + 0.004, sy - radius * 1.12, s0 + (low + high) / 2 + 0.006), (1, 0, 0), 0.002)
            rivets((sx + 0.006, sy - radius * 0.99, s0 + low + 0.012), (sx + 0.006, sy - radius * 0.99, s0 + high - 0.006), 4, (0.2, -1, 0), 0.0018)
        mouth = s0 + 0.212
        lathe([(0.0225, 0), (0.028, 0.012), (0.03, 0.014), (0.03, 0.019), (0.026, 0.019), (0.021, 0.004), (0.02, -0.03)], (sx, sy, mouth), M('sooty'), (0, 0, 1), 28)
        cylinder(0.02, 0.002, (sx, sy, mouth - 0.012), M('void'), (0, 0, 1), 20, chamfer=0)
        throat = cylinder(0.019, 0.002, (sx, sy, mouth - 0.008), M('ember'), (0, 0, 1), 20, chamfer=0)
        throat.scale = (0.8, 0.8, 1)
        # Stay rods from a collar to the lid's corners, on turnbuckles.
        collar = s0 + 0.112
        for (cx, cy) in ((-w / 2 + 0.006, front + 0.03), (w / 2 - 0.05, -front - 0.008), (-w / 2 + 0.006, -front - 0.008)):
            away = Vector((cx - sx, cy - sy, 0)).normalized()
            start, end = Vector((sx, sy, collar)) + away * 0.027, Vector((cx, cy, top + 0.01))
            tube([start, end], 0.0013, M('shaft'), caps=False, resolution=2)
            cylinder(0.0028, 0.012, start.lerp(end, 0.75), M('bolt'), end - start, 6)
            ring(0.003, 0.001, end, M('bolt'), (0, 1, 0), 10, 5)

        # The pressure drum, front right of the lid, on saddles; banded, riveted, domed.
        dx_, dy_, dr, dl_ = 0.042, -0.042, 0.03, 0.088
        dz = top + 0.008 + 0.008 + dr
        lathe([(0.0, -0.012), (dr * 0.55, -0.009), (dr * 0.9, -0.002), (dr, 0.006), (dr, dl_ - 0.006), (dr * 0.9, dl_ + 0.002), (dr * 0.55, dl_ + 0.009), (0.0, dl_ + 0.012)],
              (dx_ - dl_ / 2, dy_, dz), steel, (1, 0, 0), 32)
        for x in (dx_ - dl_ / 2 + 0.008, dx_ + dl_ / 2 - 0.008, dx_):
            cylinder(dr + 0.002, 0.007, (x, dy_, dz), M('band'), (1, 0, 0), 32)
            for i in range(12):
                a = i / 12 * math.tau
                rivet((x, dy_ + math.cos(a) * (dr + 0.002), dz + math.sin(a) * (dr + 0.002)), (0, math.cos(a), math.sin(a)), 0.0018)
        for x in (dx_ - 0.026, dx_ + 0.026):
            box((0.01, dr * 1.7, dr * 0.9), (x, dy_, top + 0.008 + dr * 0.45), dark, bevel=0.002)
            for y in (dy_ - dr * 0.95, dy_ + dr * 0.95):
                bolt((x, y, top + 0.01), (0, 0, 1), 0.0026)
        cylinder(0.01, 0.004, (dx_ - dl_ / 2 - 0.012, dy_, dz), M('brass'), (1, 0, 0), 16)
        # a relief valve on top, with its lever and weight
        rx = dx_ + 0.022
        lathe([(0.007, 0), (0.007, 0.006), (0.0045, 0.008), (0.0045, 0.02), (0.008, 0.022), (0.008, 0.03), (0.003, 0.034)], (rx, dy_, dz + dr - 0.002), M('brass'), (0, 0, 1), 14)
        tube([(rx, dy_ + 0.004, dz + dr + 0.034), (rx, dy_ - 0.03, dz + dr + 0.036)], 0.0016, M('shaft'))
        cylinder(0.006, 0.01, (rx, dy_ - 0.03, dz + dr + 0.03), cast, (0, 0, 1), 12)
        # a gauge on a siphon, facing us
        gx = dx_ - 0.026
        tube([(gx, dy_, dz + dr - 0.002), (gx, dy_, dz + dr + 0.012), (gx, dy_ - 0.01, dz + dr + 0.018), (gx, dy_ - 0.01, dz + dr + 0.03)], 0.0022, M('brass'))
        gauge((gx, dy_ - 0.012, dz + dr + 0.043), (0, -1, 0.5), 0.015, needle=0.55)

        # The main: up from the drum, back across the lid through a gate valve, round into the stack's base.
        r = 0.0085
        mz_ = dz + dr + 0.026
        pipe([(dx_ + 0.002, dy_, dz + dr - 0.003), (dx_ + 0.002, dy_, mz_), (dx_ + 0.002, 0.058, mz_), (sx + 0.03, 0.058, mz_ - 0.0), (sx + 0.03, 0.058, s0 + 0.03)], r)
        valve((dx_ + 0.002, 0.012, mz_), (0, 1, 0), (0, 0, 1), r)
        cylinder(r * 1.6, 0.01, (sx + 0.03, 0.058, s0 + 0.024), dark, (0, 0, 1), 16)
        # A second, lower line from the lid's back right corner into the drum's end, with a small cock.
        bx, by, bz = w / 2 - 0.018, 0.05, top + 0.088
        pipe([(bx, by, top + 0.008), (bx, by, bz), (bx, dy_ + 0.0, bz), (bx, dy_, dz + dr - 0.006)], 0.0065, M('dark_steel'), flanges=False)
        flange((bx, by, top + 0.011), (0, 0, 1), 0.012, 6)
        cylinder(0.0085, 0.012, (bx, 0.012, bz), M('brass'), (0, 1, 0), 12)
        tube([(bx, 0.012, bz), (bx, 0.012, bz + 0.014)], 0.002, M('brass'))
        box((0.022, 0.004, 0.003), (bx + 0.004, 0.012, bz + 0.015), M('red'), bevel=0.001, rotation=(0, 0, 25))
        # Copper lines: from the front gauge up over the lip and across to the stack, clipped down in a pair.
        copper = M('copper')
        for k, offset in enumerate((0.0, 0.008)):
            x = px - 0.012 + offset
            tube([(x, front - 0.004, z0 + 0.1), (x, front - 0.006, top + 0.016 + offset * 0.4), (x, front + 0.012, top + 0.016 + offset * 0.4), (-0.02 + offset, front + 0.012 + offset, top + 0.014),
                  (-0.02 + offset, 0.0 - offset, top + 0.014), (sx + 0.0 + offset, 0.0 - offset, top + 0.014), (sx + offset, sy - 0.03, s0 + 0.012)], 0.0026, copper, bend=0.008)
        for (cx, cy) in ((-0.016, front + 0.04), (-0.016, front + 0.07), (0.03, front + 0.016)):
            box((0.02, 0.006, 0.004), (cx, cy, top + 0.016), M('bolt'), bevel=0.001, rotation=(0, 0, 0 if cy > front + 0.02 else 90))
        tube([(lx, front - 0.007, top - 0.03), (lx, front - 0.007, top + 0.018), (lx, front + 0.02, top + 0.018), (lx + 0.02, front + 0.04, top + 0.014), (sx - 0.02, sy - 0.036, s0 + 0.012)],
             0.0026, copper, bend=0.008)
        # A junction box at the back right with a lamp; conduit and cables away to the ground.
        jx, jy = w / 2 - 0.03, front + 0.165
        box((0.034, 0.022, 0.04), (jx, jy, top + 0.028), M('green'), bevel=0.002)
        plate((0.028, 0.034, 0.002), (jx, jy - 0.012, top + 0.028), dark, (0, -1, 0), studs=(2, 2, 'bolt'), stud_size=0.0018, inset=0.004)
        cylinder(0.004, 0.005, (jx, jy - 0.014, top + 0.036), M('lamp_on'), (0, -1, 0), 12)
        cable([(jx + 0.017, jy, top + 0.02), (w / 2 + 0.014, jy + 0.004, top + 0.004), (w / 2 + 0.02, jy + 0.01, 0.06), (w / 2 + 0.05, jy + 0.0, 0.004), (w / 2 + 0.1, jy - 0.03, 0.003),
               (w / 2 + 0.14, jy - 0.02, 0.003)], 0.003)
        cable([(jx - 0.017, jy, top + 0.03), (jx - 0.04, jy + 0.004, top + 0.012), (0.02, 0.07, top + 0.011), (sx + 0.05, sy + 0.03, top + 0.012)], 0.0022)

        # The blower, on the left: a scroll casing facing us, its intake grille, a duct into the body, a motor behind.
        bx_, by_, bz_, br = -w / 2 - 0.05, front + 0.045, 0.062, 0.043
        green = M('green')
        cylinder(br, 0.036, (bx_, by_, bz_), green, (0, 1, 0), 36, chamfer=0.06)
        box((0.05, 0.034, 0.036), (bx_ + 0.03, by_, bz_ + br - 0.018), green, bevel=0.002)  # the outlet, into the body
        flange((bx_ + 0.048, by_, bz_ + br - 0.018), (1, 0, 0), 0.024, 6, dark, 0.006)
        lathe([(br * 0.94, 0), (br * 0.94, 0.004), (br * 0.55, 0.006), (br * 0.52, 0.002)], (bx_, by_ - 0.018, bz_), dark, (0, -1, 0), 36)
        for i in range(10):
            a = i / 10 * math.tau
            bolt((bx_ + math.cos(a) * br * 0.82, by_ - 0.022, bz_ + math.sin(a) * br * 0.82), (0, -1, 0), 0.0028)
        cylinder(br * 0.52, 0.002, (bx_, by_ - 0.017, bz_), M('void'), (0, 1, 0), 24, chamfer=0)
        for i in range(3):
            ring(br * (0.16 + i * 0.14), 0.0012, (bx_, by_ - 0.02, bz_), M('shaft'), (0, 1, 0), 24, 5)
        for i in range(6):
            a = i / 6 * math.tau
            tube([(bx_, by_ - 0.021, bz_), (bx_ + math.cos(a) * br * 0.52, by_ - 0.021, bz_ + math.sin(a) * br * 0.52)], 0.0012, M('shaft'), caps=False, resolution=2)
        cylinder(0.006, 0.006, (bx_, by_ - 0.022, bz_), M('bolt'), (0, 1, 0), 6)
        for x in (bx_ - 0.028, bx_ + 0.028):
            box((0.008, 0.04, bz_ - br * 0.6), (x, by_, (bz_ - br * 0.6) / 2), dark, bevel=0.0015)
        box((0.085, 0.05, 0.005), (bx_, by_, 0.0025), dark, bevel=0.001)
        for x in (bx_ - 0.036, bx_ + 0.036):
            bolt((x, by_ - 0.018, 0.005), (0, 0, 1), 0.003)
        lathe([(0.022, 0), (0.027, 0.004), (0.027, 0.05), (0.022, 0.056), (0.01, 0.058)], (bx_, by_ + 0.018, bz_), M('ochre'), (0, 1, 0), 28)
        for i in range(7):
            cylinder(0.0295, 0.0024, (bx_, by_ + 0.028 + i * 0.006, bz_), M('ochre'), (0, 1, 0), 28)
        box((0.022, 0.024, 0.012), (bx_, by_ + 0.045, bz_ + 0.031), dark, bevel=0.002)
        cable([(bx_ + 0.008, by_ + 0.045, bz_ + 0.034), (bx_ + 0.03, by_ + 0.05, bz_ + 0.05), (-w / 2 - 0.002, by_ + 0.06, top - 0.01), (-w / 2 + 0.01, by_ + 0.07, top + 0.012),
               (sx - 0.02, sy + 0.05, top + 0.012), (0.0, 0.078, top + 0.011), (jx - 0.017, jy + 0.004, top + 0.02)], 0.0022)

        # The hopper, on the right: a riveted bin on legs, heaped with coal, a chute into the body.
        hx, hy, hz = w / 2 + 0.052, 0.01, 0.07
        hw, hd = 0.07, 0.1
        yellow = M('ochre')
        for (sxz, loc, normal) in [((hw, 0.07, 0.004), (hx, hy - hd / 2, hz + 0.02), (0, -1, 0)), ((hw, 0.07, 0.004), (hx, hy + hd / 2, hz + 0.02), (0, 1, 0)),
                                   ((hd, 0.07, 0.004), (hx - hw / 2, hy, hz + 0.02), (-1, 0, 0)), ((hd, 0.07, 0.004), (hx + hw / 2, hy, hz + 0.02), (1, 0, 0))]:
            plate(sxz, loc, yellow, normal, studs=(5, 4, 'rivet') if normal[1] < 0 else None, stud_size=0.0024, inset=0.005)
        for x in (hx - hw / 2, hx + hw / 2):
            for y in (hy - hd / 2, hy + hd / 2):
                box((0.008, 0.008, hz + 0.056), (x, y, (hz + 0.056) / 2), dark, bevel=0.0015)
                box((0.02, 0.02, 0.004), (x, y, 0.002), dark, bevel=0.001)
        for y in (hy - hd / 2 - 0.003,):
            box((hw + 0.012, 0.004, 0.008), (hx, y, hz + 0.052), dark, bevel=0.001)  # a rim angle
            box((math.hypot(hw, 0.05), 0.003, 0.006), (hx, y - 0.001, 0.03), dark, bevel=0.0008, rotation=(0, math.degrees(math.atan2(0.05, hw)), 0))
            box((math.hypot(hw, 0.05), 0.003, 0.006), (hx, y - 0.003, 0.03), dark, bevel=0.0008, rotation=(0, -math.degrees(math.atan2(0.05, hw)), 0))
        box((hw - 0.006, hd - 0.006, 0.05), (hx, hy, hz + 0.012), M('coal'), bevel=0)
        for i in range(60):
            px_, py_ = rng.uniform(-1, 1), rng.uniform(-1, 1)
            heap = 0.03 * (1 - max(abs(px_), abs(py_)) ** 2)
            lump(M('coal'), rng.uniform(0.008, 0.013), (hx + px_ * (hw / 2 - 0.01), hy + py_ * (hd / 2 - 0.01), hz + 0.036 + heap * rng.uniform(0.5, 1.0)), seed=100 + i)
        box((0.03, 0.04, 0.03), (w / 2 + 0.012, hy, hz - 0.012), dark, bevel=0.002, rotation=(0, 28, 0))  # the chute
        for i in range(5):
            lump(M('coal'), rng.uniform(0.005, 0.008), (hx + rng.uniform(-0.04, 0.05), hy - hd / 2 - rng.uniform(0.02, 0.05), 0.004), seed=200 + i)

        # The fire's light: out of the firebox onto the doors and the ground, and up the stack's throat.
        lights = []
        for location, energy, size in (((fx, front - 0.035, fz), 1.6, 0.03), ((fx, front + 0.02, fz + 0.005), 0.5, 0.02), ((sx, sy, mouth + 0.03), 0.25, 0.02)):
            light = bpy.data.lights.new('fire', 'POINT')
            light.energy = energy
            light.color = (1.0, 0.4, 0.1)
            light.shadow_soft_size = size
            _place(bpy.data.objects.new('fire', light), None, location)
            lights.append((light, energy))
        glow = shape([(-1, -1), (1, -1), (1, 1), (-1, 1)], (fx, front - 0.055, 0.0015), M('glow'), (0, 0, 1))
        glow.scale = (0.1, 0.06, 1)
        glow.visible_shadow = False
    return holder, lights, flames, Vector((sx, sy, mouth + 0.012))


def smoke(mouth, count=10, drift=(0.2, 0.03, 0.085)):
    """Puffs of smoke from [mouth], drifting and swelling. Returns a function of t (0..1) that moves them, looping."""
    mesh = bpy.data.meshes.new('puff')
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(M('smoke'))
    puffs = []
    for i in range(count):
        puff = link(bpy.data.objects.new('puff', mesh))
        puff.visible_shadow = False
        puffs.append((puff, i / count, rng.uniform(-1, 1), rng.uniform(-1, 1)))

    def move(t):
        for puff, offset, wobble_x, wobble_y in puffs:
            p = (t + offset) % 1.0
            rise = p ** 0.8
            puff.location = mouth + Vector((drift[0] * p * p + wobble_x * 0.012 * p, drift[1] * p + wobble_y * 0.01 * p, drift[2] * rise + 0.004))
            size = 0.018 + 0.05 * p
            puff.scale = (size, size, size * 0.9)
            puff['fade'] = max(0.0, min(1.0, p * 8)) * (1 - p) ** 1.6
    return move
