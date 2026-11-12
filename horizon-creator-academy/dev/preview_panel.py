#!/usr/bin/env python3
# preview_panel.py - renders faithful HTML mockups of the panel views (same geometry/palette as
# the XAML) using the real lesson data + illustrations, for preview screenshots only.
import json, os, sys, html

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, '..', 'NoesisProject')
CONTENT = os.path.join(HERE, 'content')
RAIL='#151B2E'; BRAND='#3B4BE0'; INK='#1F293C'; SOFT='#687791'; LINE='#DBE1EC'
CARD='#FFFFFF'; WASH='#EFF2FB'; APPBG='#EAEEF6'
SEC=['#E87D0D','#31A8FF','#7D2AE8','#0A84FF']; NAMES=['Blender','Photoshop','Canva','Horizon']
GREEN='#2EB88A'; AMBER='#F0A828'; RED='#E24C5C'; LVL={'Start':GREEN,'Build':AMBER,'Pro':RED}

def esc(s): return html.escape(str(s))

def rail(active):
    items=''
    for i,n in enumerate(NAMES):
        bg='#22FFFFFF' if i==active else 'transparent'
        items+=f'<div class="nav" style="background:{bg}"><span class="bar" style="background:{SEC[i]}"></span>{n}</div>'
    tools=''.join(f'<div class="nav tool">{t}</div>' for t in ['Home','Search','Bookmarks'])
    return f'''<div class="rail">
      <div class="logo">CREATOR<br><span style="color:{BRAND}">ACADEMY</span></div>
      <div class="sep"></div><div class="lbl">LEARN</div>{items}
      <div class="lbl" style="margin-top:14px">TOOLS</div>{tools}
    </div>'''

def page(inner, active=0):
    return f'''<!doctype html><meta charset=utf-8><style>
    *{{margin:0;box-sizing:border-box;font-family:'DejaVu Sans',Arial,sans-serif}}
    body{{width:1480px;height:840px;background:{APPBG};position:relative;overflow:hidden}}
    .rail{{position:absolute;left:0;top:0;width:210px;height:840px;background:{RAIL};color:#fff;padding:0}}
    .logo{{font-weight:bold;font-size:26px;color:#fff;padding:30px 0 0 26px;line-height:1.25}}
    .sep{{height:2px;background:#33FFFFFF;margin:14px 26px}}
    .lbl{{color:#9AA6C4;font-size:16px;font-weight:bold;padding:4px 0 6px 30px}}
    .nav{{color:#fff;font-weight:bold;font-size:21px;height:50px;line-height:50px;margin:6px 14px;border-radius:12px;padding-left:36px;position:relative}}
    .nav .bar{{position:absolute;left:14px;top:10px;width:6px;height:30px;border-radius:3px}}
    .nav.tool{{height:46px;line-height:46px;color:#C7D0E6;font-size:20px}}
    .content{{position:absolute;left:230px;top:0;width:1030px;height:840px}}
    .h1{{font-size:46px;font-weight:bold;color:{INK}}}
    .sub{{font-size:22px;color:{SOFT}}}
    .card{{background:{CARD};border:1px solid {LINE};border-radius:16px;position:absolute}}
    .chip{{display:inline-block;color:#fff;font-weight:bold;font-size:16px;border-radius:15px;padding:5px 14px}}
    .step{{position:relative;font-size:19px;color:{INK};margin:0 0 10px 0;padding-left:44px;line-height:1.3}}
    .step .n{{position:absolute;left:0;top:0;width:30px;height:30px;border-radius:15px;background:{BRAND};color:#fff;font-weight:bold;font-size:16px;text-align:center;line-height:30px}}
    .btn{{display:inline-block;border-radius:12px;font-weight:bold;font-size:20px;text-align:center;border:1px solid {LINE}}}
    .key{{display:inline-block;width:56px;height:56px;line-height:56px;text-align:center;background:{CARD};border:1px solid {LINE};border-radius:12px;font-weight:bold;font-size:20px;color:{INK};margin:3px}}
    </style><body>{rail(active)}<div class="content">{inner}</div></body>'''

def home(data):
    cards=''
    pos=[(40,190),(535,190),(40,460),(535,460)]
    for i,(x,y) in enumerate(pos):
        d=data[i]
        cards+=f'''<div class="card" style="left:{x}px;top:{y}px;width:470px;height:240px">
          <div style="height:10px;border-radius:12px 12px 0 0;background:{SEC[i]}"></div>
          <div style="padding:26px 28px">
            <div style="font-size:34px;font-weight:bold;color:{INK}">{NAMES[i]}</div>
            <div style="font-size:21px;color:{SOFT};margin-top:14px;height:96px">{esc(d['blurb'])}</div>
            <div style="font-size:19px;font-weight:bold;color:{SEC[i]}">{len(d['lessons'])} lessons</div>
          </div></div>'''
    inner=f'<div style="padding:48px 0 0 40px"><div class="h1">Learn to Create</div><div class="sub" style="margin-top:12px;width:900px">Tap a tool on the left, or a card below. Big, simple lessons with a picture on every page.</div></div>{cards}'
    return page(inner, 0)

def lesson(sec_i, l, counter):
    img=os.path.abspath(os.path.join(IMG, l['id']+'.png'))
    steps=''.join(f'<div class="step"><span class="n">{i+1}</span>{esc(s)}</div>' for i,s in enumerate(l['steps']))
    tip=f'<div class="card" style="left:30px;top:430px;width:660px;height:54px;background:{WASH};border:none;display:flex;align-items:center;padding:0 18px"><div style="font-size:18px;font-weight:bold;color:{BRAND}">{esc(l["tip"])}</div></div>' if l.get('tip') else ''
    inner=f'''
      <img src="file://{img}" style="position:absolute;left:30px;top:30px;width:660px;height:372px;border-radius:16px;border:1px solid {LINE};background:#fff;object-fit:contain">
      <div style="position:absolute;left:716px;top:34px;font-size:18px;color:{SOFT};font-weight:bold">{counter}</div>
      <div class="chip" style="position:absolute;left:880px;top:30px;background:{LVL.get(l['level'],AMBER)}">{l['level']}</div>
      <div style="position:absolute;left:716px;top:70px;width:300px;font-size:34px;font-weight:bold;color:{INK}">{esc(l['title'])}</div>
      <div style="position:absolute;left:716px;top:150px;width:300px;font-size:22px;color:{SOFT}">{esc(l['subtitle'])}</div>
      <div style="position:absolute;left:716px;top:196px;width:300px">{steps}</div>
      {tip}
      <div style="position:absolute;left:30px;top:498px;width:560px;height:12px;background:{LINE};border-radius:6px"></div>
      <div style="position:absolute;left:30px;top:498px;width:170px;height:12px;background:{BRAND};border-radius:6px"></div>
      <div class="btn" style="position:absolute;left:30px;top:536px;width:150px;height:56px;line-height:56px;background:#fff;color:{INK}">&lt; Back</div>
      <div class="btn" style="position:absolute;left:190px;top:536px;width:150px;height:56px;line-height:56px;background:#fff;color:{INK}">Next &gt;</div>
      <div class="btn" style="position:absolute;left:350px;top:536px;width:160px;height:56px;line-height:56px;background:{BRAND};color:#fff;border:none">Save</div>
      <div class="btn" style="position:absolute;left:540px;top:536px;width:150px;height:56px;line-height:56px;background:{BRAND};color:#fff;border:none">Quiz</div>'''
    return page(inner, sec_i)

def search():
    rows_qwerty=['QWERTYUIOP','ASDFGHJKL','ZXCVBNM']
    kb=''
    for r,row in enumerate(rows_qwerty):
        kb+=f'<div style="position:absolute;left:{30+r*22}px;top:{170+r*64}px">'+''.join(f'<span class="key">{c}</span>' for c in row)+'</div>'
    kb+=f'<div style="position:absolute;left:30px;top:362px"><span class="key" style="width:150px">Space</span><span class="key" style="width:150px">Delete</span><span class="key" style="width:150px">Clear</span></div>'
    res=[('Mark Seams And Unwrap','Flatten the model for texturing','BLENDER'),
         ('UV Unwrapping','Flatten your model to paint it','BLENDER'),
         ('Seamless Tileable Textures','Make a texture that repeats','PHOTOSHOP')]
    rc=''
    for i,(t,s,tag) in enumerate(res):
        rc+=f'''<div class="card" style="left:716px;top:{74+i*82}px;width:524px;height:74px">
          <div style="position:absolute;left:18px;top:12px;font-size:21px;font-weight:bold;color:{INK}">{t}</div>
          <div style="position:absolute;left:18px;top:42px;font-size:17px;color:{SOFT}">{s}</div>
          <div style="position:absolute;right:16px;top:42px;font-size:16px;font-weight:bold;color:{BRAND}">{tag}</div></div>'''
    inner=f'''<div style="position:absolute;left:30px;top:30px;font-size:34px;font-weight:bold;color:{INK}">Search the Academy</div>
      <div class="card" style="left:30px;top:90px;width:660px;height:56px;display:flex;align-items:center;padding-left:20px;font-size:26px;color:{INK}">uv<span style="color:{BRAND}">|</span></div>
      {kb}
      <div style="position:absolute;left:716px;top:34px;font-size:24px;color:{SOFT};font-weight:bold">Results</div>{rc}'''
    return page(inner, 0)

def quiz():
    inner=f'''<div style="position:absolute;left:30px;top:30px;font-size:34px;font-weight:bold;color:{INK}">Quiz</div>
      <div style="position:absolute;left:130px;top:44px;font-size:22px;color:{SOFT};font-weight:bold">3 / 8</div>
      <div class="card" style="left:30px;top:92px;width:720px;height:150px;background:{WASH};border:none;padding:24px">
        <div style="font-size:28px;font-weight:bold;color:{INK}">Which panel lists every object in your world?</div></div>
      <div class="btn" style="position:absolute;left:30px;top:268px;width:720px;height:72px;line-height:72px;background:#fff;color:{INK}">The Hierarchy</div>
      <div class="btn" style="position:absolute;left:30px;top:352px;width:720px;height:72px;line-height:72px;background:#332EB88A;color:{INK};border:3px solid {GREEN}">The Properties panel &nbsp; <span style="color:{GREEN};font-size:16px">Correct answer</span></div>
      <div class="btn" style="position:absolute;left:30px;top:436px;width:720px;height:72px;line-height:72px;background:#fff;color:{INK}">The Console</div>
      <div style="position:absolute;left:30px;top:536px;width:560px;font-size:24px;font-weight:bold;color:{BRAND}">Correct! +1 to Ana</div>
      <div class="btn" style="position:absolute;left:600px;top:528px;width:150px;height:56px;line-height:56px;background:{BRAND};color:#fff;border:none">Next</div>
      <div class="card" style="left:780px;top:92px;width:240px;height:492px">
        <div style="padding:20px 24px"><div style="font-size:22px;font-weight:bold;color:{INK}">Scoreboard</div>
        <div style="font-size:21px;font-weight:bold;color:{INK};margin-top:28px;line-height:2">1. Ana&nbsp;&nbsp;&nbsp;3<br>2. Bob&nbsp;&nbsp;&nbsp;1</div></div></div>'''
    return page(inner, 3)

def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    data=[json.load(open(os.path.join(CONTENT,k+'.json'))) for k in ['blender','photoshop','canva','horizon']]
    open(os.path.join(outdir,'home.html'),'w').write(home(data))
    bl=data[0]['lessons'][9]  # blender-10
    open(os.path.join(outdir,'lesson.html'),'w').write(lesson(0, bl, '10 / 20'))
    open(os.path.join(outdir,'search.html'),'w').write(search())
    open(os.path.join(outdir,'quiz.html'),'w').write(quiz())
    print('wrote home/lesson/search/quiz html to', outdir)

if __name__=='__main__':
    main(sys.argv[1] if len(sys.argv)>1 else 'preview_html')
