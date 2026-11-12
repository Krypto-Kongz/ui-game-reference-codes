#!/usr/bin/env python3
# illus.py - clean flat-diagram illustration engine for the Creator Academy panel.
# Renders the 7 diagram archetypes in SCHEMA.md to crisp 1280x720 PNGs.
# Everything is supersampled 2x and downscaled with LANCZOS so flat shapes get smooth edges.
#
#   python3 illus.py selftest <out_dir>        # render one sample of each archetype
#   python3 illus.py build <content_dir> <out_dir>   # render every lesson diagram
import sys, os, json, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, SS = 1280, 720, 2            # final size, supersample factor
FONT_DIR = '/usr/share/fonts/truetype/dejavu'

# ---------------------------------------------------------------- palette
INK      = (31, 41, 60)            # near-black text
INK_SOFT = (104, 119, 145)         # muted text
LINE     = (210, 217, 230)         # hairlines
CARD     = (255, 255, 255)
BG       = (236, 240, 248)
PANEL    = (244, 247, 252)         # inner panel fill
SHADOW   = (24, 33, 56)

# per-app accent (main, light wash, dark)
APPS = {
    'blender':   {'main': (232, 125, 13),  'wash': (255, 241, 225), 'dark': (142, 73, 6),   'name': 'BLENDER',   'ui': (57, 61, 71)},
    'photoshop': {'main': (49, 168, 255),  'wash': (224, 242, 255), 'dark': (10, 70, 120),  'name': 'PHOTOSHOP', 'ui': (43, 43, 48)},
    'canva':     {'main': (125, 42, 232),  'wash': (240, 230, 255), 'dark': (74, 20, 150),  'name': 'CANVA',     'ui': (0, 196, 204)},
    'horizon':   {'main': (10, 132, 255),  'wash': (225, 236, 255), 'dark': (12, 60, 150),  'name': 'HORIZON',   'ui': (34, 40, 66)},
}
LEVEL_COLORS = {'Start': (46, 184, 138), 'Build': (240, 168, 40), 'Pro': (226, 76, 92)}
GOOD = (46, 184, 138)
BAD  = (226, 76, 92)
PAL  = [(10,132,255),(46,184,138),(240,168,40),(226,76,92),(125,42,232),(0,196,204),(232,125,13)]

_font_cache = {}
def font(size, bold=True, mono=False):
    key = (size, bold, mono)
    if key not in _font_cache:
        if mono:
            name = 'DejaVuSansMono-Bold.ttf' if bold else 'DejaVuSansMono.ttf'
        else:
            name = 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
        _font_cache[key] = ImageFont.truetype(os.path.join(FONT_DIR, name), size * SS)
    return _font_cache[key]

# ---------------------------------------------------------------- draw helpers (work in SS space)
class C:
    def __init__(self):
        self.img = Image.new('RGB', (W * SS, H * SS), BG)
        self.d = ImageDraw.Draw(self.img, 'RGBA')

    def rrect(self, box, r, fill=None, outline=None, width=1):
        x0, y0, x1, y1 = [v * SS for v in box]
        self.d.rounded_rectangle([x0, y0, x1, y1], radius=r * SS, fill=fill,
                                 outline=outline, width=max(1, width * SS))

    def shadow(self, box, r, blur=10, alpha=60, dy=5):
        x0, y0, x1, y1 = [v * SS for v in box]
        pad = blur * SS * 2
        lay = Image.new('RGBA', (int(x1 - x0 + pad * 2), int(y1 - y0 + pad * 2 + dy * SS)), (0, 0, 0, 0))
        ld = ImageDraw.Draw(lay)
        ld.rounded_rectangle([pad, pad + dy * SS, pad + (x1 - x0), pad + dy * SS + (y1 - y0)],
                             radius=r * SS, fill=SHADOW + (alpha,))
        lay = lay.filter(ImageFilter.GaussianBlur(blur * SS))
        self.img.paste(lay, (int(x0 - pad), int(y0 - pad)), lay)

    def line(self, p0, p1, fill=LINE, width=1):
        self.d.line([p0[0] * SS, p0[1] * SS, p1[0] * SS, p1[1] * SS], fill=fill, width=max(1, width * SS))

    def circle(self, cx, cy, r, fill=None, outline=None, width=1):
        self.d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS],
                       fill=fill, outline=outline, width=max(1, width * SS))

    def text(self, xy, s, size, fill=INK, bold=True, mono=False, anchor='la', max_w=None):
        f = font(size, bold, mono)
        s = str(s)
        if max_w is not None:
            s = self._fit(s, f, max_w * SS)
        self.d.text((xy[0] * SS, xy[1] * SS), s, font=f, fill=fill, anchor=anchor)

    def textbox(self, xy, s, size, fill=INK, bold=False, max_w=200, leading=1.25, anchor='la'):
        f = font(size, bold)
        lines = self._wrap(s, f, max_w * SS)
        lh = size * leading
        for i, ln in enumerate(lines):
            self.d.text((xy[0] * SS, (xy[1] + i * lh) * SS), ln, font=f, fill=fill, anchor=anchor)
        return len(lines) * lh

    def _tw(self, s, f):
        return self.d.textlength(s, font=f)

    def _fit(self, s, f, max_w):
        if self._tw(s, f) <= max_w:
            return s
        while s and self._tw(s + '...', f) > max_w:
            s = s[:-1]
        return s + '...'

    def _wrap(self, s, f, max_w):
        out, cur = [], ''
        for word in str(s).split():
            t = (cur + ' ' + word).strip()
            if self._tw(t, f) <= max_w or not cur:
                cur = t
            else:
                out.append(cur); cur = word
        if cur:
            out.append(cur)
        return out

    def arrow(self, p0, p1, fill=INK_SOFT, width=3, head=12):
        self.line(p0, p1, fill=fill, width=width)
        ang = math.atan2((p1[1] - p0[1]), (p1[0] - p0[0]))
        for a in (ang + 2.6, ang - 2.6):
            hx, hy = p1[0] + head * math.cos(a), p1[1] + head * math.sin(a)
            self.d.line([p1[0] * SS, p1[1] * SS, hx * SS, hy * SS], fill=fill, width=max(1, width * SS))

    def badge(self, cx, cy, n, color):
        self.circle(cx, cy, 15, fill=color)
        self.text((cx, cy - 1), str(n), 20, fill=(255, 255, 255), anchor='mm')

    def save(self, path):
        self.img.resize((W, H), Image.LANCZOS).save(path, optimize=True)

# ---------------------------------------------------------------- icon set (drawn in a box)
def icon(c, name, box, color, accent=None):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    s = min(w, h)
    accent = accent or color
    lw = max(2, int(s * 0.09))
    def rr(b, r, **k): c.rrect(b, r, **k)
    def ln(a, b, wd=lw, col=color): c.line(a, b, fill=col, width=wd)
    def box_in(f=0.62):
        m = s * (1 - f) / 2
        return [cx - s/2 + m, cy - s/2 + m, cx + s/2 - m, cy + s/2 - m]

    if name in ('move',):
        ln((cx, y0+h*0.12), (cx, y1-h*0.12)); ln((x0+w*0.12, cy), (x1-w*0.12, cy))
        for a in (0, 90, 180, 270):
            r = math.radians(a); tipx, tipy = cx + math.cos(r)*s*0.38, cy + math.sin(r)*s*0.38
            c.arrow((cx + math.cos(r)*s*0.2, cy + math.sin(r)*s*0.2), (tipx, tipy), fill=color, width=lw, head=s*0.12)
    elif name == 'rotate':
        c.d.arc([ (cx-s*0.34)*SS,(cy-s*0.34)*SS,(cx+s*0.34)*SS,(cy+s*0.34)*SS], 300, 210, fill=color, width=lw*SS)
        c.arrow((cx+s*0.34, cy-s*0.02),(cx+s*0.34, cy-s*0.18), fill=color, width=lw, head=s*0.12)
    elif name == 'scale':
        rr([cx-s*0.3, cy-s*0.3, cx+s*0.1, cy+s*0.1], s*0.04, outline=color, width=lw)
        rr([cx-s*0.05, cy-s*0.05, cx+s*0.32, cy+s*0.32], s*0.04, outline=accent, width=lw)
    elif name in ('select','lasso'):
        c.d.ellipse([(cx-s*0.3)*SS,(cy-s*0.3)*SS,(cx+s*0.3)*SS,(cy+s*0.3)*SS], outline=color, width=lw*SS)
        c.d.ellipse([ (cx-s*0.3)*SS,(cy-s*0.3)*SS,(cx+s*0.3)*SS,(cy+s*0.3)*SS], outline=None)
        for a in range(0,360,40):
            r=math.radians(a); c.circle(cx+math.cos(r)*s*0.3, cy+math.sin(r)*s*0.3, lw*0.6, fill=CARD)
    elif name in ('box','select_box','marquee'):
        c.d.rectangle([(cx-s*0.3)*SS,(cy-s*0.3)*SS,(cx+s*0.3)*SS,(cy+s*0.3)*SS], outline=color, width=lw*SS)
    elif name in ('brush','paint'):
        ln((x0+w*0.2, y1-h*0.2),(cx+s*0.05, cy-s*0.05), wd=lw)
        rr([cx-s*0.02, cy-s*0.32, cx+s*0.28, cy-s*0.02], s*0.04, fill=accent)
        c.circle(x0+w*0.2, y1-h*0.2, s*0.1, fill=color)
    elif name in ('erase','eraser'):
        rr([cx-s*0.28, cy-s*0.1, cx+s*0.28, cy+s*0.22], s*0.04, fill=accent, outline=color, width=lw)
        ln((cx-s*0.28, cy+s*0.06),(cx+s*0.28, cy+s*0.06))
    elif name == 'crop':
        ln((x0+w*0.28, y0+h*0.12),(x0+w*0.28, y1-h*0.2)); ln((x0+w*0.12,y0+h*0.28),(x1-h*0.2,y0+h*0.28))
        ln((x1-w*0.28, y0+h*0.2),(x1-w*0.28, y1-h*0.12)); ln((x0+w*0.2,y1-h*0.28),(x1-h*0.12,y1-h*0.28))
    elif name == 'text':
        c.text((cx, cy), 'T', int(s*0.7), fill=color, anchor='mm')
    elif name in ('pen','node'):
        c.d.polygon([(cx)*SS,(y0+h*0.12)*SS,(x1-w*0.18)*SS,(cy)*SS,(cx)*SS,(y1-h*0.2)*SS,(x0+w*0.18)*SS,(cy)*SS], outline=color, width=lw*SS)
        c.circle(cx, cy, s*0.08, fill=accent)
    elif name in ('layers','layer'):
        for i,dy in enumerate((0.18,0.02,-0.14)):
            col = accent if i==1 else color
            c.d.polygon([(cx)*SS,(cy+dy*s-s*0.16)*SS,(cx+s*0.32)*SS,(cy+dy*s)*SS,(cx)*SS,(cy+dy*s+s*0.16)*SS,(cx-s*0.32)*SS,(cy+dy*s)*SS], outline=col, width=lw*SS)
    elif name == 'mask':
        c.d.ellipse([(cx-s*0.3)*SS,(cy-s*0.3)*SS,(cx+s*0.3)*SS,(cy+s*0.3)*SS], outline=color, width=lw*SS)
        c.d.pieslice([(cx-s*0.3)*SS,(cy-s*0.3)*SS,(cx+s*0.3)*SS,(cy+s*0.3)*SS], 90, 270, fill=color)
    elif name in ('color','swatch'):
        c.d.pieslice([(cx-s*0.32)*SS,(cy-s*0.32)*SS,(cx+s*0.32)*SS,(cy+s*0.32)*SS],0,120, fill=(226,76,92))
        c.d.pieslice([(cx-s*0.32)*SS,(cy-s*0.32)*SS,(cx+s*0.32)*SS,(cy+s*0.32)*SS],120,240, fill=(46,184,138))
        c.d.pieslice([(cx-s*0.32)*SS,(cy-s*0.32)*SS,(cx+s*0.32)*SS,(cy+s*0.32)*SS],240,360, fill=(49,120,255))
    elif name == 'gradient':
        for i in range(10):
            t=i/9.0; col=tuple(int(color[j]*(1-t)+255*t) for j in range(3))
            c.d.rectangle([(x0+w*0.15+ (w*0.7)*i/10)*SS,(cy-s*0.28)*SS,(x0+w*0.15+(w*0.7)*(i+1)/10)*SS,(cy+s*0.28)*SS], fill=col)
    elif name in ('bucket','fill'):
        rr([cx-s*0.24, cy-s*0.26, cx+s*0.24, cy+s*0.1], s*0.05, fill=accent, outline=color, width=lw)
        c.circle(cx+s*0.22, cy+s*0.24, s*0.09, fill=color)
    elif name in ('wand','magic'):
        ln((x0+w*0.2, y1-h*0.2),(cx+s*0.08, cy-s*0.08), wd=lw, col=color)
        for a in range(0,360,45):
            r=math.radians(a); c.line((cx+s*0.14, cy-s*0.14),(cx+s*0.14+math.cos(r)*s*0.12, cy-s*0.14+math.sin(r)*s*0.12), fill=accent, width=lw)
    elif name == 'zoom':
        c.d.ellipse([(cx-s*0.3)*SS,(cy-s*0.3)*SS,(cx+s*0.12)*SS,(cy+s*0.12)*SS], outline=color, width=lw*SS)
        ln((cx+s*0.1, cy+s*0.1),(cx+s*0.3, cy+s*0.3), wd=lw+1)
    elif name == 'hand':
        rr([cx-s*0.22, cy-s*0.05, cx+s*0.22, cy+s*0.3], s*0.1, fill=accent, outline=color, width=lw)
        for i in range(4):
            c.d.rounded_rectangle([(cx-s*0.2+ i*s*0.13)*SS,(cy-s*0.3)*SS,(cx-s*0.1+i*s*0.13)*SS,(cy+s*0.02)*SS], radius=s*0.05*SS, fill=accent, outline=color, width=lw*SS)
    elif name == 'eyedropper':
        ln((x0+w*0.22, y1-h*0.22),(x1-w*0.28, y0+h*0.28), wd=lw+1)
        c.circle(x1-w*0.24, y0+h*0.24, s*0.1, fill=accent)
    elif name in ('extrude',):
        c.d.rectangle([(cx-s*0.28)*SS,(cy-s*0.08)*SS,(cx+s*0.12)*SS,(cy+s*0.28)*SS], outline=color, width=lw*SS)
        c.arrow((cx, cy),(cx+s*0.05, cy-s*0.3), fill=accent, width=lw, head=s*0.12)
    elif name in ('loopcut','knife','cut'):
        c.d.rectangle([(cx-s*0.3)*SS,(cy-s*0.26)*SS,(cx+s*0.3)*SS,(cy+s*0.26)*SS], outline=color, width=lw*SS)
        ln((cx, cy-s*0.34),(cx, cy+s*0.34), wd=lw, col=accent)
    elif name in ('subdivide','grid','align'):
        b=[cx-s*0.3,cy-s*0.3,cx+s*0.3,cy+s*0.3]; c.d.rectangle([v*SS for v in b], outline=color, width=lw*SS)
        ln((cx, cy-s*0.3),(cx, cy+s*0.3)); ln((cx-s*0.3, cy),(cx+s*0.3, cy))
    elif name == 'mirror':
        ln((cx, y0+h*0.12),(cx, y1-h*0.12), wd=lw, col=accent)
        c.d.polygon([(cx-s*0.08)*SS,(cy-s*0.2)*SS,(cx-s*0.32)*SS,(cy)*SS,(cx-s*0.08)*SS,(cy+s*0.2)*SS], fill=color)
        c.d.polygon([(cx+s*0.08)*SS,(cy-s*0.2)*SS,(cx+s*0.32)*SS,(cy)*SS,(cx+s*0.08)*SS,(cy+s*0.2)*SS], outline=color, width=lw*SS)
    elif name == 'bevel':
        c.d.polygon([(cx-s*0.3)*SS,(cy+s*0.3)*SS,(cx-s*0.3)*SS,(cy-s*0.1)*SS,(cx-s*0.1)*SS,(cy-s*0.3)*SS,(cx+s*0.3)*SS,(cy-s*0.3)*SS,(cx+s*0.3)*SS,(cy+s*0.3)*SS], outline=color, width=lw*SS)
    elif name in ('vertex','edge','face'):
        pts=[(cx-s*0.28,cy+s*0.26),(cx+s*0.28,cy+s*0.26),(cx+s*0.2,cy-s*0.24),(cx-s*0.2,cy-s*0.24)]
        c.d.polygon([(p[0]*SS,p[1]*SS) for p in pts], outline=color, width=lw*SS, fill=(accent+ (40,)) if name=='face' else None)
        if name=='edge': c.line(pts[0],pts[3], fill=accent, width=lw+2)
        for p in pts: c.circle(p[0],p[1], lw*0.9, fill=accent if name=='vertex' else color)
    elif name == 'uv':
        b=[cx-s*0.3,cy-s*0.3,cx+s*0.3,cy+s*0.3]; c.d.rectangle([v*SS for v in b], outline=color, width=lw*SS)
        c.d.polygon([(cx-s*0.3)*SS,(cy)*SS,(cx)*SS,(cy-s*0.3)*SS,(cx+s*0.3)*SS,(cy)*SS,(cx)*SS,(cy+s*0.3)*SS], outline=accent, width=lw*SS)
    elif name == 'camera':
        rr([cx-s*0.3, cy-s*0.16, cx+s*0.18, cy+s*0.22], s*0.05, outline=color, width=lw)
        c.d.polygon([(cx+s*0.18)*SS,(cy-s*0.05)*SS,(cx+s*0.32)*SS,(cy-s*0.16)*SS,(cx+s*0.32)*SS,(cy+s*0.16)*SS,(cx+s*0.18)*SS,(cy+s*0.05)*SS], fill=accent)
    elif name == 'light':
        c.circle(cx, cy-s*0.06, s*0.2, outline=color, width=lw)
        ln((cx-s*0.08, cy+s*0.18),(cx+s*0.08, cy+s*0.18)); ln((cx-s*0.06, cy+s*0.28),(cx+s*0.06, cy+s*0.28))
        for a in range(0,360,45):
            r=math.radians(a); c.line((cx+math.cos(r)*s*0.28, cy-s*0.06+math.sin(r)*s*0.28),(cx+math.cos(r)*s*0.34, cy-s*0.06+math.sin(r)*s*0.34), fill=accent, width=lw)
    elif name == 'play':
        c.d.polygon([(cx-s*0.18)*SS,(cy-s*0.26)*SS,(cx+s*0.28)*SS,(cy)*SS,(cx-s*0.18)*SS,(cy+s*0.26)*SS], fill=accent)
    elif name in ('cube',):
        c.d.polygon([(cx)*SS,(cy-s*0.32)*SS,(cx+s*0.3)*SS,(cy-s*0.14)*SS,(cx+s*0.3)*SS,(cy+s*0.18)*SS,(cx)*SS,(cy+s*0.34)*SS,(cx-s*0.3)*SS,(cy+s*0.18)*SS,(cx-s*0.3)*SS,(cy-s*0.14)*SS], outline=color, width=lw*SS)
        ln((cx, cy-s*0.32),(cx, cy+s*0.02)); ln((cx, cy+s*0.02),(cx+s*0.3, cy-s*0.14)); ln((cx, cy+s*0.02),(cx-s*0.3, cy-s*0.14))
    elif name in ('sphere','color_wheel'):
        c.circle(cx, cy, s*0.3, outline=color, width=lw)
        c.d.arc([(cx-s*0.14)*SS,(cy-s*0.3)*SS,(cx+s*0.14)*SS,(cy+s*0.3)*SS],0,360, fill=accent, width=lw*SS)
        c.d.arc([(cx-s*0.3)*SS,(cy-s*0.12)*SS,(cx+s*0.3)*SS,(cy+s*0.12)*SS],0,360, fill=accent, width=lw*SS)
    elif name == 'cylinder':
        c.d.ellipse([(cx-s*0.26)*SS,(cy-s*0.3)*SS,(cx+s*0.26)*SS,(cy-s*0.14)*SS], outline=color, width=lw*SS)
        ln((cx-s*0.26, cy-s*0.22),(cx-s*0.26, cy+s*0.22)); ln((cx+s*0.26, cy-s*0.22),(cx+s*0.26, cy+s*0.22))
        c.d.arc([(cx-s*0.26)*SS,(cy+s*0.06)*SS,(cx+s*0.26)*SS,(cy+s*0.22)*SS],0,180, fill=color, width=lw*SS)
    elif name in ('shape','shapes'):
        c.d.polygon([(cx)*SS,(cy-s*0.3)*SS,(cx+s*0.28)*SS,(cy+s*0.22)*SS,(cx-s*0.28)*SS,(cy+s*0.22)*SS], fill=accent)
        c.circle(cx+s*0.12, cy-s*0.12, s*0.12, fill=color)
    elif name in ('image','photo'):
        rr([cx-s*0.3, cy-s*0.26, cx+s*0.3, cy+s*0.26], s*0.05, outline=color, width=lw, fill=PANEL)
        c.circle(cx-s*0.12, cy-s*0.1, s*0.06, fill=accent)
        c.d.polygon([(cx-s*0.26)*SS,(cy+s*0.2)*SS,(cx-s*0.02)*SS,(cy-s*0.04)*SS,(cx+s*0.14)*SS,(cy+s*0.1)*SS,(cx+s*0.26)*SS,(cy-s*0.02)*SS,(cx+s*0.26)*SS,(cy+s*0.2)*SS], fill=color)
    elif name in ('upload','export'):
        c.arrow((cx, cy+s*0.22),(cx, cy-s*0.28), fill=accent, width=lw+1, head=s*0.16)
        ln((cx-s*0.26, cy+s*0.28),(cx+s*0.26, cy+s*0.28))
    elif name in ('download','save'):
        c.arrow((cx, cy-s*0.28),(cx, cy+s*0.2), fill=accent, width=lw+1, head=s*0.16)
        ln((cx-s*0.26, cy+s*0.28),(cx+s*0.26, cy+s*0.28))
    elif name == 'group':
        c.d.rectangle([(cx-s*0.3)*SS,(cy-s*0.3)*SS,(cx+s*0.08)*SS,(cy+s*0.08)*SS], outline=color, width=lw*SS)
        c.d.rectangle([(cx-s*0.08)*SS,(cy-s*0.08)*SS,(cx+s*0.3)*SS,(cy+s*0.3)*SS], outline=accent, width=lw*SS, fill=CARD)
    elif name == 'duplicate':
        c.d.rectangle([(cx-s*0.28)*SS,(cy-s*0.28)*SS,(cx+s*0.06)*SS,(cy+s*0.1)*SS], outline=color, width=lw*SS, fill=CARD)
        c.d.rectangle([(cx-s*0.06)*SS,(cy-s*0.1)*SS,(cx+s*0.28)*SS,(cy+s*0.28)*SS], outline=accent, width=lw*SS, fill=CARD)
    elif name in ('delete','trash'):
        rr([cx-s*0.2, cy-s*0.18, cx+s*0.2, cy+s*0.28], s*0.04, outline=color, width=lw)
        ln((cx-s*0.28, cy-s*0.18),(cx+s*0.28, cy-s*0.18), wd=lw)
        ln((cx-s*0.1, cy-s*0.28),(cx+s*0.1, cy-s*0.28), wd=lw)
        for dx in (-0.08,0,0.08): ln((cx+dx*s, cy-s*0.06),(cx+dx*s, cy+s*0.18))
    elif name == 'undo':
        c.d.arc([(cx-s*0.28)*SS,(cy-s*0.24)*SS,(cx+s*0.28)*SS,(cy+s*0.2)*SS],120,360, fill=color, width=lw*SS)
        c.arrow((cx-s*0.28, cy-s*0.02),(cx-s*0.16, cy-s*0.2), fill=color, width=lw, head=s*0.12)
    elif name == 'redo':
        c.d.arc([(cx-s*0.28)*SS,(cy-s*0.24)*SS,(cx+s*0.28)*SS,(cy+s*0.2)*SS],180,60, fill=color, width=lw*SS)
        c.arrow((cx+s*0.28, cy-s*0.02),(cx+s*0.16, cy-s*0.2), fill=color, width=lw, head=s*0.12)
    elif name == 'eye':
        c.d.ellipse([(cx-s*0.32)*SS,(cy-s*0.2)*SS,(cx+s*0.32)*SS,(cy+s*0.2)*SS], outline=color, width=lw*SS)
        c.circle(cx, cy, s*0.12, fill=accent)
    elif name == 'lock':
        rr([cx-s*0.2, cy-s*0.04, cx+s*0.2, cy+s*0.28], s*0.04, fill=accent)
        c.d.arc([(cx-s*0.14)*SS,(cy-s*0.3)*SS,(cx+s*0.14)*SS,(cy+s*0.04)*SS],180,360, fill=color, width=lw*SS)
    elif name == 'link':
        c.d.arc([(cx-s*0.3)*SS,(cy-s*0.18)*SS,(cx+s*0.02)*SS,(cy+s*0.18)*SS],30,330, fill=color, width=lw*SS)
        c.d.arc([(cx-s*0.02)*SS,(cy-s*0.18)*SS,(cx+s*0.3)*SS,(cy+s*0.18)*SS],210,150, fill=accent, width=lw*SS)
    elif name in ('sound','audio'):
        c.d.polygon([(cx-s*0.28)*SS,(cy-s*0.1)*SS,(cx-s*0.1)*SS,(cy-s*0.1)*SS,(cx+s*0.06)*SS,(cy-s*0.26)*SS,(cx+s*0.06)*SS,(cy+s*0.26)*SS,(cx-s*0.1)*SS,(cy+s*0.1)*SS,(cx-s*0.28)*SS,(cy+s*0.1)*SS], fill=color)
        for i,r in enumerate((0.16,0.26)):
            c.d.arc([(cx+s*0.06-r*s)*SS,(cy-r*s)*SS,(cx+s*0.06+r*s)*SS,(cy+r*s)*SS],300,60, fill=accent, width=lw*SS)
    elif name in ('anim','timeline'):
        ln((x0+w*0.14, cy),(x1-w*0.14, cy), wd=lw)
        for i in range(5): c.circle(x0+w*0.18+ i*(w*0.64/4), cy, s*0.05, fill=accent if i in (0,4) else color)
    elif name == 'bones':
        c.circle(cx-s*0.2, cy-s*0.18, s*0.1, outline=color, width=lw); c.circle(cx+s*0.2, cy+s*0.18, s*0.1, outline=color, width=lw)
        c.d.polygon([(cx-s*0.12)*SS,(cy-s*0.12)*SS,(cx+s*0.04)*SS,(cy-s*0.02)*SS,(cx+s*0.12)*SS,(cy+s*0.12)*SS,(cx-s*0.04)*SS,(cy+s*0.02)*SS], fill=accent)
    elif name == 'node':
        for p in [(cx-s*0.22,cy-s*0.18),(cx+s*0.22,cy-s*0.18),(cx,cy+s*0.22)]:
            c.circle(p[0],p[1],s*0.1, fill=accent)
        c.line((cx-s*0.22,cy-s*0.18),(cx,cy+s*0.22), fill=color, width=lw)
        c.line((cx+s*0.22,cy-s*0.18),(cx,cy+s*0.22), fill=color, width=lw)
    else:  # generic marker
        c.d.polygon([(cx)*SS,(cy-s*0.3)*SS,(cx+s*0.12)*SS,(cy-s*0.08)*SS,(cx+s*0.3)*SS,(cy-s*0.06)*SS,(cx+s*0.14)*SS,(cy+s*0.12)*SS,(cx+s*0.2)*SS,(cy+s*0.3)*SS,(cx)*SS,(cy+s*0.16)*SS,(cx-s*0.2)*SS,(cy+s*0.3)*SS,(cx-s*0.14)*SS,(cy+s*0.12)*SS,(cx-s*0.3)*SS,(cy-s*0.06)*SS,(cx-s*0.12)*SS,(cy-s*0.08)*SS], fill=accent)

# ---------------------------------------------------------------- common frame
CARD_BOX = (40, 32, W - 40, H - 32)
BODY = (76, 150, W - 76, H - 78)   # content region inside the card

def frame(c, app, title):
    a = APPS.get(app, APPS['horizon'])
    c.d.rectangle([0, 0, W * SS, H * SS], fill=BG)
    c.shadow(CARD_BOX, 26, blur=12, alpha=55, dy=6)
    c.rrect(CARD_BOX, 26, fill=CARD)
    c.rrect((CARD_BOX[0], CARD_BOX[1], CARD_BOX[2], CARD_BOX[1] + 10), 26, fill=a['main'])
    c.d.rectangle([CARD_BOX[0]*SS, (CARD_BOX[1]+26)*SS, CARD_BOX[2]*SS, (CARD_BOX[1]+36)*SS], fill=CARD)
    # title row
    c.circle(78, 95, 11, fill=a['main'])
    c.text((102, 95), title, 34, fill=INK, anchor='lm', max_w=W - 360)
    # app pill
    pw = 150
    c.rrect((W - 56 - pw, 74, W - 56, 116), 21, fill=a['wash'])
    c.text((W - 56 - pw/2, 95), a['name'], 20, fill=a['dark'], anchor='mm')
    c.line((76, 132), (W - 76, 132), fill=LINE, width=1)
    return a

def footer(c, app):
    c.text((W - 76, H - 50), 'CREATOR ACADEMY', 15, fill=INK_SOFT, anchor='rm')

# ---------------------------------------------------------------- mock app window chrome
def app_chrome(c, app, box, label=''):
    a = APPS.get(app, APPS['horizon'])
    x0, y0, x1, y1 = box
    c.shadow(box, 12, blur=8, alpha=40, dy=4)
    c.rrect(box, 12, fill=(250, 251, 253), outline=LINE, width=1)
    c.rrect((x0, y0, x1, y0 + 30), 12, fill=a['ui'])
    c.d.rectangle([x0*SS, (y0+18)*SS, x1*SS, (y0+30)*SS], fill=a['ui'])
    for i, col in enumerate([(255,95,86),(255,189,46),(39,201,63)]):
        c.circle(x0 + 16 + i * 18, y0 + 15, 5, fill=col)
    if label:
        c.text(((x0+x1)/2, y0 + 15), label, 14, fill=(230,233,240), anchor='mm')
    return (x0 + 10, y0 + 40, x1 - 10, y1 - 10), a

# ---------------------------------------------------------------- archetype renderers
def r_app_window(c, sp):
    app = sp.get('app', 'horizon')
    a = frame(c, app, sp.get('title', 'Layout'))
    work, _ = app_chrome(c, app, (BODY[0], BODY[1], BODY[0] + 760, BODY[3]), app.capitalize())
    wx0, wy0, wx1, wy1 = work
    ww, wh = wx1 - wx0, wy1 - wy0
    regions = sp.get('regions', [])
    for i, rg in enumerate(regions):
        rx0 = wx0 + rg['x'] * ww; ry0 = wy0 + rg['y'] * wh
        rx1 = rx0 + rg['w'] * ww; ry1 = ry0 + rg['h'] * wh
        col = PAL[i % len(PAL)]
        c.rrect((rx0+3, ry0+3, rx1-3, ry1-3), 8, fill=a['wash'], outline=col, width=2)
        c.text(((rx0+rx1)/2, (ry0+ry1)/2 + (10 if rg.get('n') else 0)), rg['label'], 19,
               fill=a['dark'], anchor='mm', max_w=(rx1-rx0)-16)
        if rg.get('n'):
            c.badge(rx0 + 20, ry0 + 20, rg['n'], col)
    # callouts panel on the right
    cx0 = BODY[0] + 788
    c.text((cx0, BODY[1] + 6), 'WHAT IS WHAT', 18, fill=INK_SOFT, anchor='lm')
    y = BODY[1] + 34
    for i, co in enumerate(sp.get('callouts', [])):
        col = PAL[(co.get('n', i+1) - 1) % len(PAL)]
        c.badge(cx0 + 14, y + 16, co.get('n', i + 1), col)
        h = c.textbox((cx0 + 38, y + 4), co['text'], 20, fill=INK, max_w=BODY[2]-cx0-40, leading=1.2)
        y += max(42, h + 18)
    footer(c, app)

def r_toolbar(c, sp):
    app = sp.get('app', 'blender')
    a = frame(c, app, sp.get('title', 'Tools'))
    tools = sp.get('tools', [])
    n = len(tools)
    vertical = sp.get('orient', 'vertical') == 'vertical' and n <= 8
    if vertical:
        th = min(84, (BODY[3] - BODY[1] - 20) // max(1, n))
        x0 = BODY[0] + 30
        total = th * n
        y = (BODY[1] + BODY[3]) / 2 - total / 2
        for i, t in enumerate(tools):
            cy = y + i * th + th / 2
            c.rrect((x0, cy - th/2 + 6, x0 + th - 12, cy + th/2 - 6), 12, fill=a['wash'], outline=a['main'], width=2)
            icon(c, t.get('icon','shape'), (x0+10, cy-th/2+14, x0+th-22, cy+th/2-14), a['dark'], a['main'])
            c.text((x0 + th + 6, cy), t['label'], 23, fill=INK, anchor='lm', max_w=BODY[2]-(x0+th+6)-10)
    else:
        cols = min(4, n)
        rows = math.ceil(n / cols)
        cw = (BODY[2]-BODY[0]) / cols
        chh = min(190, (BODY[3]-BODY[1]) / rows)
        gy0 = (BODY[1]+BODY[3])/2 - rows*chh/2
        for i, t in enumerate(tools):
            r, cc = divmod(i, cols)
            cx = BODY[0] + cc * cw + cw/2
            cyy = gy0 + r * chh + chh/2
            c.rrect((cx-cw/2+14, cyy-chh/2+10, cx+cw/2-14, cyy+chh/2-10), 14, fill=a['wash'], outline=a['main'], width=2)
            icon(c, t.get('icon','shape'), (cx-30, cyy-chh/2+18, cx+30, cyy-chh/2+78), a['dark'], a['main'])
            c.text((cx, cyy+chh/2-26), t['label'], 20, fill=INK, anchor='mm', max_w=cw-28)
    footer(c, app)

def r_shortcuts(c, sp):
    app = sp.get('app', 'blender')
    a = frame(c, app, sp.get('title', 'Keys'))
    keys = sp.get('keys', [])
    cols = 2 if len(keys) > 4 else 1
    rows = math.ceil(len(keys)/cols)
    cw = (BODY[2]-BODY[0]) / cols
    rh = min(86, (BODY[3]-BODY[1]) / rows)
    gy = (BODY[1]+BODY[3])/2 - rows*rh/2
    for i, k in enumerate(keys):
        cc, r = i // rows, i % rows
        x0 = BODY[0] + 30 + cc * cw
        cy = gy + r * rh + rh/2
        # keycap
        kw = max(64, 30 + len(k['key']) * 16)
        c.shadow((x0+6, cy-26, x0+6+kw, cy+26), 10, blur=4, alpha=35, dy=3)
        c.rrect((x0+6, cy-26, x0+6+kw, cy+26), 10, fill=(252,253,255), outline=a['main'], width=2)
        c.rrect((x0+10, cy-22, x0+2+kw, cy+16), 8, fill=a['wash'])
        c.text((x0+6+kw/2, cy-2), k['key'], 22, fill=a['dark'], anchor='mm', mono=True)
        c.text((x0+6+kw+18, cy), k['does'], 23, fill=INK, anchor='lm', max_w=cw-kw-40)
    footer(c, app)

def r_steps_flow(c, sp):
    app = sp.get('app', 'canva')
    a = frame(c, app, sp.get('title', 'Steps'))
    steps = sp.get('steps', [])
    n = len(steps)
    gap = 24
    cw = min(220, (BODY[2]-BODY[0] - gap*(n-1)) / n)
    total = cw*n + gap*(n-1)
    x = (BODY[0]+BODY[2])/2 - total/2
    cy = (BODY[1]+BODY[3])/2
    ch = min(230, BODY[3]-BODY[1]-10)
    for i, s in enumerate(steps):
        x0 = x + i*(cw+gap)
        c.shadow((x0, cy-ch/2, x0+cw, cy+ch/2), 14, blur=7, alpha=40, dy=5)
        c.rrect((x0, cy-ch/2, x0+cw, cy+ch/2), 16, fill=CARD, outline=a['wash'], width=3)
        c.rrect((x0, cy-ch/2, x0+cw, cy-ch/2+8), 16, fill=a['main'])
        c.d.rectangle([x0*SS,(cy-ch/2+8)*SS,(x0+cw)*SS,(cy-ch/2+20)*SS], fill=CARD)
        c.circle(x0+cw/2, cy-ch/2+56, 30, fill=a['wash'])
        icon(c, s.get('icon','shape'), (x0+cw/2-26, cy-ch/2+30, x0+cw/2+26, cy-ch/2+82), a['dark'], a['main'])
        c.badge(x0+28, cy-ch/2+30, i+1, a['main'])
        c.textbox((x0+cw/2, cy-ch/2+108), s['label'], 21, fill=INK, max_w=cw-28, anchor='ma', leading=1.2, bold=True)
        if i < n-1:
            c.arrow((x0+cw+2, cy),(x0+cw+gap-2, cy), fill=a['main'], width=4, head=12)
    footer(c, app)

def _motif(c, box, motif, col, a):
    x0,y0,x1,y1 = box
    if motif == 'pixels':
        px = (x1-x0)/8
        import random
        random.seed(hash(motif) & 255)
        for r in range(6):
            for cc in range(8):
                t = (r+cc) % 3
                shade = tuple(int(col[i]*(0.5+0.12*t)+255*(0.5-0.12*t)) for i in range(3))
                c.d.rectangle([(x0+cc*px)*SS,(y0+r*(y1-y0)/6)*SS,(x0+(cc+1)*px)*SS,(y0+(r+1)*(y1-y0)/6)*SS], fill=shade, outline=CARD, width=1)
    elif motif == 'layers':
        for i in range(4):
            yy = y0 + 14 + i*22
            c.rrect((x0+14, yy, x1-14, yy+16), 4, fill=PAL[i%len(PAL)])
    elif motif in ('swatches','shapes'):
        for i in range(6):
            c.circle(x0+30+(i%3)*((x1-x0)/3), y0+30+(i//3)*44, 16, fill=PAL[i%len(PAL)])
    elif motif == 'mesh':
        gx=(x1-x0)/5; gy=(y1-y0)/4
        for i in range(6):
            c.line((x0+i*gx,y0),(x0+i*gx,y1), fill=col, width=2)
        for j in range(5):
            c.line((x0,y0+j*gy),(x1,y0+j*gy), fill=col, width=2)
    elif motif == 'grid':
        gx=(x1-x0)/6; gy=(y1-y0)/5
        for i in range(7): c.line((x0+i*gx,y0),(x0+i*gx,y1), fill=LINE, width=1)
        for j in range(6): c.line((x0,y0+j*gy),(x1,y0+j*gy), fill=LINE, width=1)
    else:
        icon(c, 'shape', ((x0+x1)/2-40,(y0+y1)/2-40,(x0+x1)/2+40,(y0+y1)/2+40), col, a['main'])

def r_compare(c, sp):
    app = sp.get('app', 'photoshop')
    a = frame(c, app, sp.get('title', 'Compare'))
    halves = [('left', sp.get('left', {})), ('right', sp.get('right', {}))]
    pw = (BODY[2]-BODY[0] - 40)/2
    for i,(side, d) in enumerate(halves):
        x0 = BODY[0] + i*(pw+40)
        kind = d.get('kind','neutral')
        ring = {'good':GOOD,'bad':BAD,'neutral':a['main']}.get(kind, a['main'])
        c.shadow((x0, BODY[1]+6, x0+pw, BODY[3]-6), 16, blur=8, alpha=40, dy=5)
        c.rrect((x0, BODY[1]+6, x0+pw, BODY[3]-6), 16, fill=CARD, outline=ring, width=3)
        c.text((x0+pw/2, BODY[1]+44), d.get('label',''), 27, fill=ring, anchor='mm', max_w=pw-24)
        _motif(c, (x0+30, BODY[1]+78, x0+pw-30, BODY[3]-96), d.get('motif','none'), a['main'], a)
        # verdict mark
        mk = x0+pw-42
        if kind in ('good','bad'):
            c.circle(mk, BODY[1]+40, 18, fill=ring)
            if kind=='good':
                c.line((mk-8, BODY[1]+40),(mk-2, BODY[1]+47), fill=CARD, width=4); c.line((mk-2, BODY[1]+47),(mk+9, BODY[1]+32), fill=CARD, width=4)
            else:
                c.line((mk-7, BODY[1]+33),(mk+7, BODY[1]+47), fill=CARD, width=4); c.line((mk+7, BODY[1]+33),(mk-7, BODY[1]+47), fill=CARD, width=4)
        c.textbox((x0+pw/2, BODY[3]-84), d.get('caption',''), 22, fill=INK, max_w=pw-30, anchor='ma', leading=1.2)
    # vs
    c.circle((BODY[0]+BODY[2])/2, (BODY[1]+BODY[3])/2, 26, fill=a['dark'])
    c.text(((BODY[0]+BODY[2])/2, (BODY[1]+BODY[3])/2-1), 'VS', 20, fill=CARD, anchor='mm')
    footer(c, app)

def r_diagram_map(c, sp):
    app = sp.get('app', 'horizon')
    a = frame(c, app, sp.get('title', 'Overview'))
    nodes = sp.get('nodes', [])
    cx, cy = (BODY[0]+BODY[2])/2, (BODY[1]+BODY[3])/2 + 6
    R = min(210, (BODY[3]-BODY[1])/2 - 20)
    n = len(nodes)
    pts = []
    for i, nd in enumerate(nodes):
        ang = -math.pi/2 + i*2*math.pi/n
        nx, ny = cx + math.cos(ang)*(R+18), cy + math.sin(ang)*R*0.82
        pts.append((nx, ny, nd))
    for nx, ny, nd in pts:
        c.line((cx, cy),(nx, ny), fill=a['wash'], width=6)
    for i,(nx, ny, nd) in enumerate(pts):
        col = PAL[i % len(PAL)]
        c.shadow((nx-96, ny-42, nx+96, ny+42), 14, blur=6, alpha=35, dy=4)
        c.rrect((nx-96, ny-42, nx+96, ny+42), 14, fill=CARD, outline=col, width=2)
        icon(c, nd.get('icon','shape'), (nx-80, ny-20, nx-44, ny+16), col, col)
        lbl = str(nd['label'])
        lines = c._wrap(lbl, font(18, True), 118*SS)[:2]
        ly = ny - (len(lines)-1)*11
        for li, line in enumerate(lines):
            c.text((nx-34, ly + li*22), line, 18, fill=INK, anchor='lm', max_w=120)
    c.shadow((cx-72, cy-72, cx+72, cy+72), 18, blur=8, alpha=55, dy=5)
    c.circle(cx, cy, 72, fill=a['main'])
    c.circle(cx, cy, 72, outline=a['dark'], width=3)
    c.textbox((cx, cy-14), sp.get('center','World'), 24, fill=CARD, max_w=120, anchor='ma', leading=1.1, bold=True)
    footer(c, app)

SUBJECTS = {}
def _subject(c, name, box, a):
    x0,y0,x1,y1 = box
    cx, cy = (x0+x1)/2, (y0+y1)/2
    s = min(x1-x0, y1-y0)
    if name == 'cube_mesh':
        p = {'top':(cx, cy-s*0.42),'r':(cx+s*0.42, cy-s*0.18),'rb':(cx+s*0.42, cy+s*0.2),
             'b':(cx, cy+s*0.44),'lb':(cx-s*0.42, cy+s*0.2),'l':(cx-s*0.42, cy-s*0.18),'c':(cx, cy+s*0.02)}
        poly = [p['top'],p['r'],p['rb'],p['b'],p['lb'],p['l']]
        c.d.polygon([(q[0]*SS,q[1]*SS) for q in poly], fill=a['wash'], outline=a['dark'], width=4)
        for e in ('top','r','rb','b','lb','l'):
            c.line(p['c'], p[e], fill=a['main'], width=3)
        for e in poly+[p['c']]:
            c.circle(e[0], e[1], 7, fill=a['dark'])
        return {'corner':p['top'],'edge':((p['l'][0]+p['top'][0])/2,(p['l'][1]+p['top'][1])/2),
                'side':((cx+p['r'][0])/2,(cy+p['r'][1])/2-s*0.1),'face':(cx,cy)}
    if name == 'layer_stack':
        res={}
        for i in range(4):
            yy = cy + s*0.28 - i*s*0.2
            col = PAL[i%len(PAL)]
            c.d.polygon([(cx-s*0.4)*SS,(yy)*SS,(cx)*SS,(yy-s*0.16)*SS,(cx+s*0.4)*SS,(yy)*SS,(cx)*SS,(yy+s*0.16)*SS],
                        fill=tuple(int(col[j]*0.45+255*0.55) for j in range(3)), outline=col, width=3)
            res[['bottom','mid','mid2','top'][i]]=(cx+s*0.4, yy)
        res['side']=(cx-s*0.4, cy)
        return res
    if name in ('gizmo','panel_ui'):
        for ax,(dx,dy,col) in {'x':(0.42,0,(226,76,92)),'y':(0,-0.42,(46,184,138)),'z':(0.3,0.26,(49,120,255))}.items():
            c.arrow((cx,cy),(cx+dx*s, cy+dy*s), fill=col, width=6, head=s*0.08)
        c.circle(cx, cy, 12, fill=a['dark'])
        return {'corner':(cx+0.42*s,cy),'edge':(cx,cy-0.42*s),'side':(cx+0.3*s,cy+0.26*s),'face':(cx,cy)}
    if name == 'color_wheel':
        for ang in range(0,360,6):
            col = tuple(int(127+127*math.cos(math.radians(ang-h))) for h in (0,120,240))
            c.d.pieslice([(cx-s*0.4)*SS,(cy-s*0.4)*SS,(cx+s*0.4)*SS,(cy+s*0.4)*SS], ang, ang+6, fill=col)
        c.circle(cx, cy, s*0.16, fill=CARD)
        return {'corner':(cx+s*0.4,cy-s*0.2),'edge':(cx,cy-s*0.4),'side':(cx+s*0.28,cy+s*0.28),'face':(cx,cy)}
    if name in ('uv_map','texture_tile','canvas_frame','brush_stroke','bone_rig','sphere_mesh'):
        if name=='bone_rig':
            icon(c,'bones',(cx-s*0.4,cy-s*0.4,cx+s*0.4,cy+s*0.4), a['dark'], a['main'])
        elif name=='brush_stroke':
            pts=[(x0+10,cy+40),(cx-40,cy-40),(cx+40,cy+30),(x1-10,cy-40)]
            c.d.line([v for p in pts for v in (p[0]*SS,p[1]*SS)], fill=a['main'], width=int(s*0.12), joint='curve')
        else:
            c.rrect((cx-s*0.4, cy-s*0.3, cx+s*0.4, cy+s*0.3), 10, fill=a['wash'], outline=a['dark'], width=3)
            _motif(c,(cx-s*0.36, cy-s*0.26, cx+s*0.36, cy+s*0.26), 'mesh' if 'uv' in name else 'grid', a['main'], a)
        return {'corner':(cx+s*0.4,cy-s*0.3),'edge':(cx,cy-s*0.3),'side':(cx+s*0.4,cy),'face':(cx,cy)}
    icon(c,'shape',box,a['dark'],a['main'])
    return {'corner':(cx,cy),'edge':(cx,cy),'side':(cx,cy),'face':(cx,cy)}

def r_callout_art(c, sp):
    app = sp.get('app', 'blender')
    a = frame(c, app, sp.get('title', 'Anatomy'))
    stage = (BODY[0]+30, BODY[1]+10, BODY[0]+560, BODY[3]-10)
    c.rrect(stage, 14, fill=(250,251,254), outline=LINE, width=1)
    anchors = _subject(c, sp.get('subject','cube_mesh'), (stage[0]+40, stage[1]+30, stage[2]-40, stage[3]-30), a)
    arrows = sp.get('arrows', [])
    lx = BODY[0] + 620
    n = len(arrows)
    gap = (BODY[3]-BODY[1]) / max(1, n)
    akeys = list(anchors.keys())
    for i, ar in enumerate(arrows):
        ly = BODY[1] + gap*i + gap/2
        col = PAL[i % len(PAL)]
        target = anchors.get(ar.get('to','').split()[0].lower(), anchors[akeys[i % len(akeys)]])
        c.rrect((lx, ly-30, BODY[2], ly+30), 12, fill=a['wash'])
        c.circle(lx+24, ly, 9, fill=col)
        c.textbox((lx+44, ly-14), ar['text'], 20, fill=INK, max_w=BODY[2]-lx-56, leading=1.15)
        c.arrow((lx-6, ly),(target[0]+8, target[1]), fill=col, width=3, head=11)
        c.circle(target[0], target[1], 6, fill=col)
    footer(c, app)

RENDERERS = {
    'app_window': r_app_window, 'toolbar': r_toolbar, 'shortcuts': r_shortcuts,
    'steps_flow': r_steps_flow, 'compare': r_compare, 'diagram_map': r_diagram_map,
    'callout_art': r_callout_art,
}

def render(diagram, out_path):
    c = C()
    fn = RENDERERS.get(diagram.get('type'))
    if not fn:
        raise ValueError('unknown diagram type: ' + str(diagram.get('type')))
    fn(c, diagram.get('spec', {}))
    c.save(out_path)

# ---------------------------------------------------------------- CLI
def selftest(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    samples = {
      'app_window': {'type':'app_window','spec':{'app':'horizon','title':'Desktop Editor Layout',
        'regions':[{'x':0,'y':0,'w':0.66,'h':0.74,'label':'Viewport','n':1},
                   {'x':0.66,'y':0,'w':0.34,'h':0.42,'label':'Hierarchy','n':2},
                   {'x':0.66,'y':0.42,'w':0.34,'h':0.32,'label':'Properties','n':3},
                   {'x':0,'y':0.74,'w':1,'h':0.26,'label':'Asset Library','n':4}],
        'callouts':[{'n':1,'text':'Your 3D scene - fly with WASD and right-mouse'},
                    {'n':2,'text':'Every object in the world, in a tree'},
                    {'n':3,'text':'Change the selected object here'},
                    {'n':4,'text':'Drag in assets and your uploads'}]}},
      'toolbar': {'type':'toolbar','spec':{'app':'blender','title':'Transform Tools','orient':'vertical',
        'tools':[{'icon':'move','label':'Move (G)'},{'icon':'rotate','label':'Rotate (R)'},
                 {'icon':'scale','label':'Scale (S)'},{'icon':'extrude','label':'Extrude (E)'},
                 {'icon':'loopcut','label':'Loop Cut (Ctrl R)'}]}},
      'shortcuts': {'type':'shortcuts','spec':{'app':'photoshop','title':'Must-Know Keys',
        'keys':[{'key':'V','does':'Move tool'},{'key':'B','does':'Brush'},{'key':'E','does':'Eraser'},
                {'key':'Ctrl T','does':'Free transform'},{'key':'Ctrl J','does':'Duplicate layer'},
                {'key':'[ ]','does':'Brush size'}]}},
      'steps_flow': {'type':'steps_flow','spec':{'app':'canva','title':'Make a Thumbnail',
        'steps':[{'icon':'image','label':'Start a design'},{'icon':'text','label':'Add bold text'},
                 {'icon':'shapes','label':'Add elements'},{'icon':'download','label':'Export PNG'}]}},
      'compare': {'type':'compare','spec':{'app':'photoshop','title':'Resolution Matters',
        'left':{'label':'72 DPI','caption':'Blurry when scaled up','kind':'bad','motif':'pixels'},
        'right':{'label':'300 DPI','caption':'Stays crisp and clean','kind':'good','motif':'pixels'}}},
      'diagram_map': {'type':'diagram_map','spec':{'app':'horizon','title':'Parts of a World','center':'Your World',
        'nodes':[{'icon':'cube','label':'Gizmos'},{'icon':'node','label':'Scripts'},
                 {'icon':'sound','label':'Audio'},{'icon':'image','label':'Assets'},
                 {'icon':'anim','label':'Saves'}]}},
      'callout_art': {'type':'callout_art','spec':{'app':'blender','title':'Anatomy of a Mesh','subject':'cube_mesh',
        'arrows':[{'to':'corner','text':'Vertex - a single point in space'},
                  {'to':'edge','text':'Edge - a line between two points'},
                  {'to':'face','text':'Face - a flat surface'}]}},
    }
    for name, d in samples.items():
        render(d, os.path.join(out_dir, 'sample_' + name + '.png'))
        print('rendered', name)

def build(content_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    count = 0
    for fn in sorted(os.listdir(content_dir)):
        if not fn.endswith('.json'):
            continue
        data = json.load(open(os.path.join(content_dir, fn)))
        for les in data['lessons']:
            render(les['diagram'], os.path.join(out_dir, les['id'] + '.png'))
            count += 1
    print('rendered', count, 'illustrations to', out_dir)

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'selftest'
    if cmd == 'selftest':
        selftest(sys.argv[2] if len(sys.argv) > 2 else 'out_samples')
    elif cmd == 'build':
        build(sys.argv[2], sys.argv[3])
    else:
        print('usage: illus.py selftest <dir> | build <content_dir> <out_dir>')
