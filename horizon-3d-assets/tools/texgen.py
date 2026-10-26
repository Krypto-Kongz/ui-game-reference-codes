# Builds Horizon-ready textures (PNG, 8-bit RGBA, power-of-two) for the Sunbeam and Jellyfish assets.
# Usage: python3 -I texgen.py <inputs dir> <out dir>
import sys, os
import numpy as np
from PIL import Image, ImageFilter

IN, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

def save(arr, name):
    Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, name), optimize=True)
    print('wrote', name)

# ---------------- Sunbeam_BA.png: warm light colour, alpha from the (rescaled) beam mask ----------------
def beam(mask_file, out_name, peak=0.72, size=1024, blur=7):
    m = Image.open(os.path.join(IN, 'suntex/Sunbeams_textures', mask_file)).convert('L').resize((size, size), Image.LANCZOS)
    a = np.asarray(m, dtype=np.float32)
    a = a / max(1.0, np.percentile(a, 99.7))  # the source masks only reach 9-63 out of 255
    # the low-range source has only a few grey levels: smooth away the resulting banding
    a = np.asarray(Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), np.float32) / 255
    a = np.clip(a, 0, 1) ** 0.85 * peak
    rgba = np.zeros((size, size, 4), np.float32)
    col = np.array([1.0, 0.90, 0.70])  # brighter version of the source colour (228,199,152)
    hot = np.array([1.0, 0.98, 0.92])
    t = (a / peak)[..., None]
    rgba[..., :3] = col * (1 - t) + hot * t  # cores of the beams run whiter
    rgba[..., 3] = a
    save(rgba, out_name)

beam('sunbeam_texture_alpha_blurred.png', 'Sunbeam_BA.png', peak=0.06)  # clusters stack dozens of planes
os.makedirs(os.path.join(OUT, 'alt'), exist_ok=True)
beam('sunbeam_noisy_texture_alpha_blurred.png', 'alt/Sunbeam_BA.png', peak=0.07, blur=3)

# ---------------- Jellyfish_BA.png: hologram jellyfish ----------------
# UVs are generated in prep.py: u = angle around the body (wraps), v = height (bell occupies v 0.70-1.0,
# tentacles v 0.0-0.70; v=1 is the top of the bell). Texture is uniform across u, so the seam is invisible.
S = 1024
v = np.linspace(1, 0, S, dtype=np.float32)[:, None]  # image row 0 = top = v 1
holo = np.asarray(Image.open(os.path.join(IN, 'holo/HOLO-TEX01.jpg')).convert('L'), dtype=np.float32) / 255
profile = holo.mean(axis=1)  # the horizontal-stripe pattern, one value per row
stripes = np.interp((v[:, 0] * 3.0) % 1.0, np.linspace(0, 1, len(profile)), profile)[:, None]  # 3x the source stripes
stripes = np.array(Image.fromarray((stripes * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255

def lerp(a, b, t):
    return a + (b - a) * t

bell = np.clip((v - 0.70) / 0.30, 0, 1)        # 0 at bell rim, 1 at bell top
tent = np.clip(v / 0.70, 0, 1)                 # 1 at bell rim, 0 at tentacle tips
in_bell = (v >= 0.70).astype(np.float32)

c_top = np.array([0.88, 0.98, 1.0]); c_rim = np.array([0.27, 0.77, 1.0])     # V-Ray colour2 (0.27,0.77,1.0)
c_mid = np.array([0.48, 0.38, 1.0]); c_tip = np.array([1.0, 0.36, 0.86])
rgb_bell = lerp(c_rim, c_top, bell ** 1.6)
rgb_tent = np.where(tent > 0.5, lerp(c_mid, c_rim, (tent - 0.5) * 2), lerp(c_tip, c_mid, tent * 2))
rgb = in_bell * rgb_bell + (1 - in_bell) * rgb_tent

a_bell = lerp(0.62, 0.42, bell)                 # rim reads slightly stronger than the dome
a_tent = 0.12 + 0.5 * tent ** 0.8              # tentacles fade toward the tips
alpha = in_bell * a_bell + (1 - in_bell) * a_tent
rim = np.exp(-((v - 0.70) / 0.025) ** 2)       # glowing rim line where bell meets tentacles
rgb = rgb + rim * 0.25
alpha = alpha + rim * 0.3
alpha = alpha * (0.62 + 0.38 * stripes)        # hologram scanlines
rgba = np.zeros((S, S, 4), np.float32)
rgba[..., :3] = np.clip(rgb, 0, 1)[:, None, :] * np.ones((1, S, 1))
rgba[..., 3] = np.clip(alpha, 0, 1) * np.ones((1, S))
save(rgba, 'Jellyfish_BA.png')

# ---------------- Bubble_BA.png: bubbles with a bright top highlight ----------------
B = 256
vb = np.linspace(1, 0, B, dtype=np.float32)[:, None]
hl = np.exp(-((vb - 0.85) / 0.08) ** 2)
rgba = np.zeros((B, B, 4), np.float32)
rgba[..., :3] = (np.array([0.70, 0.93, 1.0]) * (1 - hl[..., None]) + np.array([1, 1, 1]) * hl[..., None]) * np.ones((1, B, 1))
rgba[..., 3] = np.clip(0.22 + 0.55 * hl + 0.18 * np.abs(vb - 0.5) * 2, 0, 1) * np.ones((1, B))
save(rgba, 'Bubble_BA.png')
