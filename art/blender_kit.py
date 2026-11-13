"""
What the Blender scripts share: a fresh scene, Cycles on the Mac's GPU, and where the Poly Haven assets live.
"""
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
scene = None


def start():
    """A new, empty scene; link() puts things in it."""
    global scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    return scene


def cycles(samples, width, height, percentage=100):
    scene.render.engine = 'CYCLES'
    preferences = bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type = 'METAL'
    preferences.get_devices()
    for device in preferences.devices:
        device.use = True
    # PF_CPU=1 renders on the processor: for a quick look while a long render has the GPU (two at once run out of memory).
    scene.cycles.device = 'CPU' if os.environ.get('PF_CPU') else 'GPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = percentage
    scene.render.image_settings.file_format = 'PNG'


def link(obj):
    scene.collection.objects.link(obj)
    return obj
