# Creator Academy - Made For Horizons By Kryptoart3D

An in-world teaching panel for Meta Horizon Worlds: a shared Noesis screen that teaches
Blender, Photoshop, Canva, and building in Horizon (VR + desktop editor / Horizon Studio).
80 illustrated lessons, an on-screen search keyboard, bookmarks, and a group quiz with a
leaderboard. One shared screen - whoever taps changes the page for everyone.

## What ships (the zip / this folder)
- `Scripts/` - AcademyGame (server brain, Default), AcademyPanel (Shared), and the lesson data.
- `NoesisProject/` - AcademyPanel.xaml + 80 lesson illustrations (PNG).
- `Sounds/` - six synthesized UI sounds (WAV).

## Build tools (dev/, not shipped)
- `illus.py` - flat-diagram illustration engine (7 archetypes).
- `build_data.py` - turns `content/*.json` into the TypeScript data modules.
- `build_xaml.py` - generates AcademyPanel.xaml.
- `make_sounds.py` - the UI sounds. `preview_panel.py` - HTML preview mockups.
- `content/*.json` - the 80 lessons. `SCHEMA.md` - the content + diagram contract.
- `run_test.mjs` + `types/` - headless test: compiles the scripts (TS 4.7.4 strict) and
  simulates the server + panel through every view (87 checks).

## Rebuild
```
cd dev
python3 build_data.py content ../Scripts
python3 illus.py build content ../NoesisProject
python3 build_xaml.py ../NoesisProject/AcademyPanel.xaml
python3 make_sounds.py ../Sounds
bash retest.sh        # compile + headless test
```
