# Creator Academy - content + illustration schema (shared contract)

A Noesis GUI panel for Meta Horizon Worlds that teaches four creator tools. One shared screen:
the server owns the current page, panels show it, whoever taps changes it for everyone.

Four sections, ~20 lessons each (the "Mega guide"):
- `blender`  - Blender for 3D / Horizon assets
- `photoshop` - Adobe Photoshop for textures and art
- `canva`    - Canva for thumbnails, logos, promo art
- `horizon`  - Meta Horizon building, VR + desktop editor

## Output format (one JSON file per section: `content/<section>.json`)
```
{
  "section": "blender",
  "label": "Blender",
  "blurb": "One sentence shown on the section's cover card.",
  "lessons": [ <Lesson>, ... ]   // exactly 20, ordered beginner -> advanced
}
```

## Lesson object
```
{
  "id": "blender-01",                  // section + two-digit index, unique
  "title": "The Blender Window",       // <= 34 chars, Title Case
  "subtitle": "Where everything lives", // <= 48 chars
  "level": "Start|Build|Pro",          // difficulty chip
  "minutes": 3,                         // est. read time, 1-6
  "steps": [                            // 3 to 6 items, each <= 95 chars, plain ASCII
    "Left-click selects. Right-click opens a menu.",
    "..."
  ],
  "tip": "Pro tip: ... (<= 110 chars, optional, may be empty string)",
  "keywords": ["window","viewport","panels"],  // 3-8 lowercase words for the search box
  "diagram": <Diagram>,                 // one illustration spec, see below
  "quiz": {                             // one multiple-choice check (used by the section quiz)
    "q": "Which mouse button selects an object?",   // <= 90 chars
    "choices": ["Left", "Right", "Middle"],          // 3 choices, each <= 40 chars
    "answer": 0                                       // index of the correct choice
  }
}
```

## Diagram object - pick ONE `type` and fill its `spec`. Keep all text plain ASCII.
The Python engine renders these as clean flat diagrams at 1280x720. Keep labels short.

1. `app_window` - a labeled mock of the app's screen with numbered callouts. Best for layout tours.
```
{ "type":"app_window", "spec": {
  "app":"blender|photoshop|canva|horizon",   // sets the color accent + menu-bar style
  "title":"Default Layout",
  "regions":[  // 2-6 rectangles drawn inside the mock window, as fractions 0..1 of the work area
    {"x":0.0,"y":0.0,"w":0.7,"h":0.78,"label":"3D Viewport","n":1},
    {"x":0.7,"y":0.0,"w":0.3,"h":0.5,"label":"Outliner","n":2}
  ],
  "callouts":[ {"n":1,"text":"Your 3D scene lives here"}, {"n":2,"text":"List of objects"} ]
}}
```

2. `toolbar` - a labeled vertical or horizontal strip of tool icons. Best for "the tools".
```
{ "type":"toolbar", "spec": {
  "app":"blender", "title":"Edit Mode Tools", "orient":"vertical|horizontal",
  "tools":[ {"icon":"move","label":"Move (G)"}, {"icon":"rotate","label":"Rotate (R)"} ]
  // icon is one of: move,rotate,scale,select,box,brush,erase,crop,text,pen,layers,mask,
  //                 color,gradient,bucket,lasso,wand,zoom,hand,eyedropper,extrude,loopcut,
  //                 subdivide,mirror,bevel,knife,vertex,edge,face,uv,camera,light,play,
  //                 cube,sphere,cylinder,shape,image,upload,download,grid,align,group,
  //                 duplicate,delete,undo,redo,save,eye,lock,link,sound,anim,node,export
}}
```

3. `shortcuts` - a keyboard hotkey map. Best for "learn the keys".
```
{ "type":"shortcuts", "spec": {
  "app":"blender", "title":"Must-Know Keys",
  "keys":[ {"key":"G","does":"Grab / move"}, {"key":"Tab","does":"Edit <-> Object"},
           {"key":"Ctrl Z","does":"Undo"} ]   // 4-8 entries, key <= 8 chars, does <= 30
}}
```

4. `steps_flow` - numbered step chips joined by arrows. Best for a workflow / recipe.
```
{ "type":"steps_flow", "spec": {
  "app":"canva", "title":"Make a Thumbnail",
  "steps":[ {"icon":"image","label":"Start a design"}, {"icon":"text","label":"Add bold text"},
            {"icon":"download","label":"Export PNG"} ]   // 3-5 chips
}}
```

5. `compare` - two labeled panels side by side (before/after, right/wrong, A/B).
```
{ "type":"compare", "spec": {
  "app":"photoshop", "title":"Resolution",
  "left": {"label":"72 DPI","caption":"Blurry when big","kind":"bad|good|neutral","motif":"pixels"},
  "right":{"label":"300 DPI","caption":"Crisp and sharp","kind":"good","motif":"pixels"}
  // motif one of: pixels,layers,swatches,shapes,mesh,bones,uv,grid,none
}}
```

6. `diagram_map` - a central node with labeled spokes. Best for a concept / overview.
```
{ "type":"diagram_map", "spec": {
  "app":"horizon", "title":"Parts of a World",
  "center":"World",
  "nodes":[ {"icon":"cube","label":"Gizmos"}, {"icon":"node","label":"Scripts"},
            {"icon":"sound","label":"Audio"} ]   // 3-6 spokes
}}
```

7. `callout_art` - a single big focal illustration with one labeled subject and 2-4 arrows
   pointing to parts. Best when one picture (a mesh, a layer stack, a gizmo) tells the story.
```
{ "type":"callout_art", "spec": {
  "app":"blender", "title":"Anatomy of a Mesh", "subject":"cube_mesh",
  // subject one of: cube_mesh,sphere_mesh,layer_stack,gizmo,uv_map,bone_rig,
  //                 brush_stroke,canvas_frame,color_wheel,texture_tile,panel_ui
  "arrows":[ {"to":"corner","text":"Vertex - a point"}, {"to":"edge","text":"Edge - a line"},
             {"to":"side","text":"Face - a surface"} ]   // 2-4; 'to' is a free label hint
}}
```

## Content rules
- Plain ASCII only. No curly quotes, em dashes, emoji. Use - and ' and ".
- Big and simple: short sentences, concrete clicks and keys. Older players read this.
- Accurate for 2025-2026 versions of each app. Horizon section must cover the DESKTOP EDITOR
  (now "Horizon Studio"): opening it, the viewport, hierarchy, properties, gizmos, publishing,
  plus VR building. Do not invent menu items; if unsure, describe the action generally.
- Each section goes basics -> intermediate -> advanced across its 20 lessons.
- Vary the diagram `type` across a section (do not use the same type more than ~5 times).
