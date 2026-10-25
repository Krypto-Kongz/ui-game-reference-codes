// DrawingBoardUI.ts
// Noesis drawing board: themes, brushes, animated ink, 2D physics, particles, and the
// bridge to the 3D world board (DrawingBoardWorld).
//
// Setup (see README.md):
//   * Attach to a Noesis UI gizmo that uses noesis/DrawingBoard.xaml.
//   * Set this script's execution mode to **Shared** (Noesis data contexts are per player).
//   * Optional: drag the 3D board entity (with DrawingBoardWorld) into the `worldBoard` prop.

import * as hz from 'horizon/core';
import { NoesisGizmo } from 'horizon/noesis';
import {
  DBEvents,
  BrushKind,
  BrushState,
  BeamPoint,
  WorldAction,
  clamp,
  hsvToHex,
  mixHex,
} from 'DrawingBoardShared';

// ---------------------------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------------------------

const SEG_POOL = 420; // max ink segments alive at once (ring buffer, oldest recycled)
const PARTICLES = 90;
const RIPPLES = 8;
const MAX_BODIES = 36;
const BODY_VERTS = 22; // collision vertices per physics body
const DEBRIS_MAX = 160;
const GRAVITY = 1500; // px / s^2
const RESTITUTION = 0.35;
const FRICTION = 0.45;
const SIZES = [2, 4, 8, 14, 24, 40];

// Shader FX presets (used by the optional ShaderFX add-on XAML; harmless without it).
const SHADER_FX = [
  { name: 'Shader FX: Off', pixel: 1, chroma: 0, pinch: 0, saturation: 1, noise: 0 },
  { name: 'Pixel Art', pixel: 8, chroma: 0, pinch: 0, saturation: 1.1, noise: 0 },
  { name: 'Glitch', pixel: 1, chroma: 0.012, pinch: 0, saturation: 1.2, noise: 0.18 },
  { name: 'Bulge', pixel: 1, chroma: 0, pinch: 0.45, saturation: 1, noise: 0 },
  { name: 'Noir', pixel: 1, chroma: 0, pinch: 0, saturation: 0, noise: 0.25 },
  { name: 'Dream', pixel: 1, chroma: 0.004, pinch: 0, saturation: 1.45, noise: 0.08 },
];

type Vis = 'Visible' | 'Collapsed';
const SHOW: Vis = 'Visible';
const HIDE: Vis = 'Collapsed';

type ToolId =
  | 'pen' | 'marker' | 'neon' | 'rainbow' | 'flow' | 'aurora' | 'pulse' | 'spray' | 'sparkle'
  | 'physics' | 'line' | 'rect' | 'ellipse' | 'eraser' | 'hand';

const TOOL_LABEL: Record<ToolId, string> = {
  pen: 'Pen', marker: 'Marker', neon: 'Neon', rainbow: 'Rainbow', flow: 'Liquid Flow',
  aurora: 'Aurora', pulse: 'Pulse', spray: 'Spray', sparkle: 'Stardust', physics: 'Physics Pen',
  line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse', eraser: 'Eraser', hand: 'Grab & Throw',
};

const BRUSH_OF_TOOL: Partial<Record<ToolId, BrushKind>> = {
  pen: 'solid', marker: 'marker', neon: 'neon', rainbow: 'rainbow', flow: 'flow', aurora: 'aurora',
  pulse: 'pulse', spray: 'spray', sparkle: 'sparkle', physics: 'physics',
};

// ---------------------------------------------------------------------------------------------
// Themes. Every color is a string the XAML binds to (#RRGGBB or #AARRGGBB).
// ---------------------------------------------------------------------------------------------

type Theme = {
  name: string; style: string;
  bgA: string; bgB: string; bgC: string;
  blobA: string; blobB: string; blobC: string; blobOp: number; blur: number;
  canvas: string; gridC: string; gridOp: number; floorC: string;
  panelA: string; panelB: string; panelSolid: string; edgeA: string; edgeB: string; sheenOp: number;
  shadowDark: string; shadowLight: string; shadowDarkOp: number; shadowLightOp: number;
  shadowBlur: number; shadowDepth: number; neoVis: Vis; dropVis: Vis;
  btnA: string; btnB: string; chip: string; chipOn: string; chipOnText: string;
  text: string; subtext: string; accent: string; accent2: string; accent3: string; glow: string;
  vignette: string; vignetteOp: number; scanOp: number;
  pal: string[];
};

function neo(dark: boolean): Pick<Theme, 'neoVis' | 'dropVis' | 'sheenOp'> {
  return { neoVis: SHOW, dropVis: HIDE, sheenOp: dark ? 0.04 : 0 };
}
function glass(sheen: number): Pick<Theme, 'neoVis' | 'dropVis' | 'sheenOp'> {
  return { neoVis: HIDE, dropVis: SHOW, sheenOp: sheen };
}

const THEMES: Theme[] = [
  {
    name: 'Soft Clay', style: 'Neumorphism', ...neo(false),
    bgA: '#E6EBF3', bgB: '#E3E9F2', bgC: '#DAE1EC',
    blobA: '#C9D6FF', blobB: '#FFD6E8', blobC: '#CFF5EA', blobOp: 0.35, blur: 70,
    canvas: '#F1F4F9', gridC: '#1A6C7BFF', gridOp: 0.6, floorC: '#A3B1C6',
    panelA: '#E6EBF3', panelB: '#DFE5EF', panelSolid: '#E3E9F2', edgeA: '#FFFFFFFF', edgeB: '#33A3B1C6',
    shadowDark: '#A3B1C6', shadowLight: '#FFFFFF', shadowDarkOp: 0.85, shadowLightOp: 1, shadowBlur: 18, shadowDepth: 8,
    btnA: '#E9EEF5', btnB: '#DCE2EC', chip: '#E3E9F2', chipOn: '#6C7BFF', chipOnText: '#FFFFFF',
    text: '#4A5468', subtext: '#8792A6', accent: '#6C7BFF', accent2: '#FF7EB6', accent3: '#3DD6C6', glow: '#8C9BFF',
    vignette: '#5A6478', vignetteOp: 0.18, scanOp: 0.12,
    pal: ['#2E3440', '#6C7BFF', '#FF7EB6', '#3DD6C6', '#FFB86B', '#FF6B6B', '#9B8CFF', '#5AC8FA', '#7ED957', '#FFD93D', '#B0BAC9', '#FFFFFF'],
  },
  {
    name: 'Midnight Clay', style: 'Neumorphism', ...neo(true),
    bgA: '#2D313B', bgB: '#2B2F38', bgC: '#252931',
    blobA: '#3B4A7A', blobB: '#5A3B6E', blobC: '#2E5E5A', blobOp: 0.35, blur: 80,
    canvas: '#30343E', gridC: '#227AA2FF', gridOp: 0.6, floorC: '#1C1F25',
    panelA: '#2F333D', panelB: '#2A2E37', panelSolid: '#2B2F38', edgeA: '#1AFFFFFF', edgeB: '#00FFFFFF',
    shadowDark: '#16181D', shadowLight: '#3D424F', shadowDarkOp: 1, shadowLightOp: 0.9, shadowBlur: 18, shadowDepth: 7,
    btnA: '#30353F', btnB: '#282C34', chip: '#2B2F38', chipOn: '#7AA2FF', chipOnText: '#10131A',
    text: '#E6E9F0', subtext: '#8A93A6', accent: '#7AA2FF', accent2: '#FF79C6', accent3: '#50FA7B', glow: '#7AA2FF',
    vignette: '#000000', vignetteOp: 0.35, scanOp: 0.18,
    pal: ['#F8F8F2', '#7AA2FF', '#FF79C6', '#50FA7B', '#FFB86C', '#FF5555', '#BD93F9', '#8BE9FD', '#F1FA8C', '#6272A4', '#44475A', '#000000'],
  },
  {
    name: 'Frosted Aurora', style: 'Glassmorphism', ...glass(0.3),
    bgA: '#1A1446', bgB: '#3B1D6E', bgC: '#0E5A7A',
    blobA: '#FF5FD2', blobB: '#5F9BFF', blobC: '#3CFFD0', blobOp: 0.9, blur: 90,
    canvas: '#14FFFFFF', gridC: '#22FFFFFF', gridOp: 0.6, floorC: '#99FFFFFF',
    panelA: '#24FFFFFF', panelB: '#66140A3C', panelSolid: '#4D140A3C', edgeA: '#B3FFFFFF', edgeB: '#1AFFFFFF',
    shadowDark: '#0A0520', shadowLight: '#FFFFFF', shadowDarkOp: 0.35, shadowLightOp: 0, shadowBlur: 30, shadowDepth: 10,
    btnA: '#2EFFFFFF', btnB: '#33140A3C', chip: '#1FFFFFFF', chipOn: '#CCFFFFFF', chipOnText: '#2A1A5E',
    text: '#FFFFFF', subtext: '#CCFFFFFF', accent: '#7CF7FF', accent2: '#FF8AF0', accent3: '#B6FF7C', glow: '#7CF7FF',
    vignette: '#0A0520', vignetteOp: 0.4, scanOp: 0.15,
    pal: ['#FFFFFF', '#7CF7FF', '#FF8AF0', '#B6FF7C', '#FFD27C', '#FF7C9C', '#A88CFF', '#5F9BFF', '#3CFFD0', '#FFF67C', '#C0C0D8', '#1A1446'],
  },
  {
    name: 'Liquid Glass', style: 'Glassmorphism', ...glass(0.7),
    bgA: '#F6F0FF', bgB: '#E3F2FF', bgC: '#FFE9F3',
    blobA: '#A78BFA', blobB: '#60A5FA', blobC: '#F472B6', blobOp: 0.75, blur: 90,
    canvas: '#40FFFFFF', gridC: '#228B5CF6', gridOp: 0.6, floorC: '#998B5CF6',
    panelA: '#80FFFFFF', panelB: '#30FFFFFF', panelSolid: '#66FFFFFF', edgeA: '#FFFFFFFF', edgeB: '#40FFFFFF',
    shadowDark: '#6B5B95', shadowLight: '#FFFFFF', shadowDarkOp: 0.22, shadowLightOp: 0, shadowBlur: 30, shadowDepth: 10,
    btnA: '#80FFFFFF', btnB: '#33FFFFFF', chip: '#4DFFFFFF', chipOn: '#8B5CF6', chipOnText: '#FFFFFF',
    text: '#2A2440', subtext: '#6E6688', accent: '#8B5CF6', accent2: '#EC4899', accent3: '#06B6D4', glow: '#A78BFA',
    vignette: '#6B5B95', vignetteOp: 0.15, scanOp: 0.1,
    pal: ['#2A2440', '#8B5CF6', '#EC4899', '#06B6D4', '#F59E0B', '#EF4444', '#10B981', '#3B82F6', '#A78BFA', '#FDE047', '#94A3B8', '#FFFFFF'],
  },
  {
    name: 'Neon Cyberpunk', style: 'Neon', ...glass(0.08),
    bgA: '#05010F', bgB: '#120326', bgC: '#000814',
    blobA: '#FF00E5', blobB: '#00F0FF', blobC: '#7000FF', blobOp: 0.45, blur: 100,
    canvas: '#E60A0614', gridC: '#3300F0FF', gridOp: 0.8, floorC: '#00F0FF',
    panelA: '#D90E0820', panelB: '#E6070412', panelSolid: '#E60B0718', edgeA: '#FF00F0FF', edgeB: '#FFFF00E5',
    shadowDark: '#00F0FF', shadowLight: '#FF00E5', shadowDarkOp: 0.55, shadowLightOp: 0, shadowBlur: 22, shadowDepth: 0,
    btnA: '#1A0F2E', btnB: '#0E0820', chip: '#140B26', chipOn: '#00F0FF', chipOnText: '#05010F',
    text: '#E8F9FF', subtext: '#9AA7C7', accent: '#00F0FF', accent2: '#FF00E5', accent3: '#F9F871', glow: '#00F0FF',
    vignette: '#000000', vignetteOp: 0.55, scanOp: 0.25,
    pal: ['#FFFFFF', '#00F0FF', '#FF00E5', '#F9F871', '#39FF14', '#FF3131', '#BC13FE', '#FF8F00', '#00FFA3', '#FF6EC7', '#5A5A7A', '#05010F'],
  },
  {
    name: 'Vaporwave', style: 'Retro Gradient', ...glass(0.25),
    bgA: '#2D0B59', bgB: '#B6339E', bgC: '#FF9A8B',
    blobA: '#FF6AD5', blobB: '#C774E8', blobC: '#94D0FF', blobOp: 0.6, blur: 80,
    canvas: '#D91B0F3A', gridC: '#66FF6AD5', gridOp: 0.9, floorC: '#FF6AD5',
    panelA: '#8C3A1170', panelB: '#73B6339E', panelSolid: '#8C3A1170', edgeA: '#FFFFFFFF', edgeB: '#80FF6AD5',
    shadowDark: '#2D0B59', shadowLight: '#FFFFFF', shadowDarkOp: 0.45, shadowLightOp: 0, shadowBlur: 24, shadowDepth: 8,
    btnA: '#40FF6AD5', btnB: '#592D0B59', chip: '#33FFFFFF', chipOn: '#FFF27A', chipOnText: '#2D0B59',
    text: '#FFF3FD', subtext: '#F3C6EC', accent: '#FF6AD5', accent2: '#94D0FF', accent3: '#FFF27A', glow: '#FF6AD5',
    vignette: '#2D0B59', vignetteOp: 0.45, scanOp: 0.3,
    pal: ['#FFFFFF', '#FF6AD5', '#C774E8', '#AD8CFF', '#8795E8', '#94D0FF', '#FFF27A', '#FF9A8B', '#7CFFCB', '#FF71CE', '#01CDFE', '#2D0B59'],
  },
  {
    name: 'Sunset Gradient', style: 'Gradient', ...glass(0.45),
    bgA: '#FF5F6D', bgB: '#FFC371', bgC: '#FF8A5B',
    blobA: '#FFD86F', blobB: '#FC6262', blobC: '#FF9A8B', blobOp: 0.7, blur: 90,
    canvas: '#EBFFF8F0', gridC: '#22B23A48', gridOp: 0.5, floorC: '#B23A48',
    panelA: '#CCFFFFFF', panelB: '#8CFFF1E6', panelSolid: '#B3FFFFFF', edgeA: '#FFFFFFFF', edgeB: '#66FFB199',
    shadowDark: '#B23A48', shadowLight: '#FFFFFF', shadowDarkOp: 0.3, shadowLightOp: 0, shadowBlur: 26, shadowDepth: 8,
    btnA: '#E6FFFFFF', btnB: '#B3FFE7D6', chip: '#99FFFFFF', chipOn: '#FF5F6D', chipOnText: '#FFFFFF',
    text: '#5A2A27', subtext: '#9A5B52', accent: '#FF5F6D', accent2: '#FFA45B', accent3: '#6A4C93', glow: '#FF7A6D',
    vignette: '#B23A48', vignetteOp: 0.2, scanOp: 0.1,
    pal: ['#3D1F1C', '#FF5F6D', '#FFA45B', '#FFD86F', '#6A4C93', '#F72585', '#4CC9F0', '#43AA8B', '#F9C74F', '#F94144', '#C9ADA7', '#FFFFFF'],
  },
  {
    name: 'Ocean Deep', style: 'Glassmorphism', ...glass(0.3),
    bgA: '#021B2E', bgB: '#03396C', bgC: '#005B96',
    blobA: '#00C9FF', blobB: '#92FE9D', blobC: '#0077B6', blobOp: 0.55, blur: 100,
    canvas: '#CC021526', gridC: '#2200C9FF', gridOp: 0.7, floorC: '#00C9FF',
    panelA: '#8C063A5C', panelB: '#59031D30', panelSolid: '#99042A45', edgeA: '#9900C9FF', edgeB: '#1A00C9FF',
    shadowDark: '#000A14', shadowLight: '#00C9FF', shadowDarkOp: 0.5, shadowLightOp: 0, shadowBlur: 26, shadowDepth: 8,
    btnA: '#59075080', btnB: '#33031D30', chip: '#40075080', chipOn: '#00C9FF', chipOnText: '#021B2E',
    text: '#E0F7FF', subtext: '#8FC1D9', accent: '#00C9FF', accent2: '#92FE9D', accent3: '#FFD166', glow: '#00C9FF',
    vignette: '#000A14', vignetteOp: 0.5, scanOp: 0.2,
    pal: ['#FFFFFF', '#00C9FF', '#92FE9D', '#FFD166', '#EF476F', '#06D6A0', '#118AB2', '#90E0EF', '#CAF0F8', '#FF9F1C', '#4A6A80', '#021B2E'],
  },
  {
    name: 'Aurora Borealis', style: 'Glassmorphism', ...glass(0.4),
    bgA: '#020B1A', bgB: '#0B2A3C', bgC: '#123B2F',
    blobA: '#00FFA3', blobB: '#7B61FF', blobC: '#00D1FF', blobOp: 0.7, blur: 110,
    canvas: '#14FFFFFF', gridC: '#1A00FFA3', gridOp: 0.7, floorC: '#00FFA3',
    panelA: '#2BFFFFFF', panelB: '#0AFFFFFF', panelSolid: '#26FFFFFF', edgeA: '#9900FFA3', edgeB: '#1A7B61FF',
    shadowDark: '#000000', shadowLight: '#00FFA3', shadowDarkOp: 0.45, shadowLightOp: 0, shadowBlur: 30, shadowDepth: 10,
    btnA: '#26FFFFFF', btnB: '#0AFFFFFF', chip: '#1AFFFFFF', chipOn: '#00FFA3', chipOnText: '#020B1A',
    text: '#EFFFF8', subtext: '#A8D8C8', accent: '#00FFA3', accent2: '#7B61FF', accent3: '#00D1FF', glow: '#00FFA3',
    vignette: '#000000', vignetteOp: 0.5, scanOp: 0.2,
    pal: ['#FFFFFF', '#00FFA3', '#7B61FF', '#00D1FF', '#B8FF5C', '#FF5CA8', '#5CFFE4', '#C8A2FF', '#FFE45C', '#3DDC97', '#58708A', '#020B1A'],
  },
  {
    name: 'Retro Arcade', style: 'Pixel CRT', ...glass(0),
    bgA: '#000000', bgB: '#0D0221', bgC: '#000000',
    blobA: '#FF2A6D', blobB: '#05D9E8', blobC: '#D1F7FF', blobOp: 0.2, blur: 60,
    canvas: '#0D0221', gridC: '#3305D9E8', gridOp: 1, floorC: '#FF2A6D',
    panelA: '#F2160F36', panelB: '#F20D0221', panelSolid: '#F2160F36', edgeA: '#FFFF2A6D', edgeB: '#FF05D9E8',
    shadowDark: '#FF2A6D', shadowLight: '#05D9E8', shadowDarkOp: 0.6, shadowLightOp: 0, shadowBlur: 0, shadowDepth: 6,
    btnA: '#1E1446', btnB: '#120A2E', chip: '#1E1446', chipOn: '#05D9E8', chipOnText: '#0D0221',
    text: '#D1F7FF', subtext: '#8C9EC7', accent: '#05D9E8', accent2: '#FF2A6D', accent3: '#FFE66D', glow: '#05D9E8',
    vignette: '#000000', vignetteOp: 0.6, scanOp: 0.4,
    pal: ['#FFFFFF', '#05D9E8', '#FF2A6D', '#FFE66D', '#01FF89', '#FF6C11', '#B967FF', '#D1F7FF', '#FF71CE', '#7B2CBF', '#3A3A5A', '#000000'],
  },
  {
    name: 'Minimal Mono', style: 'Minimal', ...glass(0),
    bgA: '#FAFAFA', bgB: '#F4F4F4', bgC: '#FFFFFF',
    blobA: '#E0E0E0', blobB: '#EDEDED', blobC: '#D6D6D6', blobOp: 0.2, blur: 60,
    canvas: '#FFFFFF', gridC: '#14000000', gridOp: 0.8, floorC: '#111111',
    panelA: '#FFFFFF', panelB: '#FCFCFC', panelSolid: '#FFFFFF', edgeA: '#1F000000', edgeB: '#0D000000',
    shadowDark: '#000000', shadowLight: '#FFFFFF', shadowDarkOp: 0.08, shadowLightOp: 0, shadowBlur: 24, shadowDepth: 6,
    btnA: '#FFFFFF', btnB: '#F5F5F5', chip: '#F2F2F2', chipOn: '#111111', chipOnText: '#FFFFFF',
    text: '#111111', subtext: '#777777', accent: '#111111', accent2: '#FF3B30', accent3: '#007AFF', glow: '#007AFF',
    vignette: '#000000', vignetteOp: 0.08, scanOp: 0.08,
    pal: ['#111111', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#8E8E93', '#FFFFFF'],
  },
  {
    name: 'Candy Pastel', style: 'Neumorphism', ...neo(false),
    bgA: '#FFE9F4', bgB: '#FBEAF3', bgC: '#F2EAFB',
    blobA: '#FFB3D9', blobB: '#B3D9FF', blobC: '#B8F0C8', blobOp: 0.45, blur: 80,
    canvas: '#FFF6FA', gridC: '#1AFF8FC7', gridOp: 0.7, floorC: '#E0B8CF',
    panelA: '#FFEFF7', panelB: '#FBE6F1', panelSolid: '#FCEBF4', edgeA: '#FFFFFFFF', edgeB: '#33E0B8CF',
    shadowDark: '#E0B8CF', shadowLight: '#FFFFFF', shadowDarkOp: 0.85, shadowLightOp: 1, shadowBlur: 18, shadowDepth: 7,
    btnA: '#FFF3FA', btnB: '#FBE3F0', chip: '#FCEBF4', chipOn: '#FF8FC7', chipOnText: '#FFFFFF',
    text: '#7A4A68', subtext: '#B48AA4', accent: '#FF8FC7', accent2: '#8FC7FF', accent3: '#9BE7B0', glow: '#FF8FC7',
    vignette: '#E0B8CF', vignetteOp: 0.15, scanOp: 0.1,
    pal: ['#7A4A68', '#FF8FC7', '#8FC7FF', '#9BE7B0', '#FFD59E', '#FF9E9E', '#C9A7FF', '#9EF0FF', '#FFF59E', '#FFC4E1', '#D8C8D2', '#FFFFFF'],
  },
  {
    name: 'Molten Lava', style: 'Glow', ...glass(0.12),
    bgA: '#1A0500', bgB: '#3D0C02', bgC: '#120200',
    blobA: '#FF4D00', blobB: '#FFB800', blobC: '#FF0040', blobOp: 0.55, blur: 100,
    canvas: '#E0140400', gridC: '#22FF6A00', gridOp: 0.7, floorC: '#FF6A00',
    panelA: '#B3230800', panelB: '#D9120300', panelSolid: '#CC1C0600', edgeA: '#FFFF6A00', edgeB: '#33FF0040',
    shadowDark: '#FF4D00', shadowLight: '#FFB800', shadowDarkOp: 0.45, shadowLightOp: 0, shadowBlur: 24, shadowDepth: 0,
    btnA: '#2E0C02', btnB: '#1A0500', chip: '#2E0C02', chipOn: '#FF6A00', chipOnText: '#1A0500',
    text: '#FFE8D6', subtext: '#C89A80', accent: '#FF6A00', accent2: '#FFC300', accent3: '#FF0054', glow: '#FF6A00',
    vignette: '#000000', vignetteOp: 0.5, scanOp: 0.22,
    pal: ['#FFFFFF', '#FF6A00', '#FFC300', '#FF0054', '#FF8C42', '#FFD166', '#E63946', '#F4A261', '#FFE8D6', '#9D0208', '#6A4C3A', '#1A0500'],
  },
];

// ---------------------------------------------------------------------------------------------
// Data context shapes (field names match DrawingBoard.xaml bindings)
// ---------------------------------------------------------------------------------------------

type Seg = {
  x1: number; y1: number; x2: number; y2: number;
  c: string; gc: string; w: number; gw: number; o: number; k: string;
  vi: Vis; vg: Vis; vp: Vis;
};
type Particle = { x: number; y: number; s: number; o: number; r: number; c: string; v: Vis };
type Ripple = { l: number; t: number; d: number; o: number; c: string; v: Vis };

type Body = {
  segs: number[];
  lx1: number[]; ly1: number[]; lx2: number[]; ly2: number[]; // per-seg local endpoints
  px: number[]; py: number[]; pad: number[]; // collision vertices (local)
  cx: number; cy: number; velX: number; velY: number; a: number; av: number;
  m: number; I: number; r: number; still: number; sleeping: boolean; frozen: boolean;
};
type Debris = { i: number; mx: number; my: number; hx: number; hy: number; vx: number; vy: number; av: number; life: number };
type Stroke = { segs: number[]; gens: number[] };
type Pt = { x: number; y: number };
type ParticleSim = { vx: number; vy: number; spin: number; life: number; max: number; size: number; fall: number };
type RippleSim = { x: number; y: number; life: number; max: number; size: number };

class DrawingBoardUI extends hz.Component<typeof DrawingBoardUI> {
  static propsDefinition = {
    worldBoard: { type: hz.PropTypes.Entity },
    canvasWidth: { type: hz.PropTypes.Number, default: 1600 }, // used until SizeChanged reports the real size
    canvasHeight: { type: hz.PropTypes.Number, default: 900 },
    floorInset: { type: hz.PropTypes.Number, default: 150 }, // physics floor sits above the bottom dock
    wallInsetLeft: { type: hz.PropTypes.Number, default: 175 }, // physics walls sit inside the side panels
    wallInsetRight: { type: hz.PropTypes.Number, default: 295 },
    startTheme: { type: hz.PropTypes.Number, default: 2 },
    // If item-level field changes in collections don't refresh on your Horizon build, set to true:
    // the segment list is then re-assigned (throttled) instead of relying on per-item updates.
    reassignLists: { type: hz.PropTypes.Boolean, default: false },
  };

  private ctx: any = null;
  private segs: Seg[] = [];
  private parts: Particle[] = [];
  private ripples: Ripple[] = [];

  private segLive = new Uint8Array(SEG_POOL);
  private segGen = new Uint32Array(SEG_POOL);
  private segBody = new Int16Array(SEG_POOL).fill(-1);
  private nextSeg = 0;
  private liveCount = 0;

  private partSim: ParticleSim[] = [];
  private rippleSim: RippleSim[] = [];
  private nextPart = 0;
  private nextRipple = 0;

  private bodies: (Body | null)[] = [];
  private debris: Debris[] = [];
  private strokes: Stroke[] = [];
  private cur: Stroke | null = null;

  private W = 1600;
  private H = 900;
  private themeIndex = 0;
  private tool: ToolId = 'pen';
  private brushKind: BrushKind = 'solid';
  private color = '#FFFFFF';
  private size = 8;
  private glowOn = true;
  private sparkleOn = false;
  private mirror = 1;
  private gridOn = true;
  private vignetteOn = true;
  private crtOn = false;
  private bloom = 14;
  private minimized = false;
  private galleryOpen = false;
  private worldOwned = false;

  private down = false;
  private last: Pt = { x: 0, y: 0 };
  private anchor: Pt = { x: 0, y: 0 };
  private mouse: Pt = { x: 0, y: 0 };
  private mouseVel: Pt = { x: 0, y: 0 };
  private lastMoveTime = 0;
  private grab: { b: number; lx: number; ly: number } | null = null;
  private time = 0;
  private listDirty = false;
  private listTimer = 0;
  private hue = 0;
  private shaderFx = 0;

  start() {
    const local = this.world.getLocalPlayer();
    if (!local || local.id === this.world.getServerPlayer().id) {
      return; // Shared mode: the server copy draws nothing
    }
    this.W = this.props.canvasWidth;
    this.H = this.props.canvasHeight;
    this.themeIndex = clamp(Math.floor(this.props.startTheme), 0, THEMES.length - 1);

    this.buildContext();

    this.connectLocalBroadcastEvent(hz.World.onUpdate, (d: { deltaTime: number }) => this.tick(d.deltaTime));
    this.connectLocalBroadcastEvent(DBEvents.requestBrush, () => this.pushBrush());
    this.connectLocalBroadcastEvent(DBEvents.worldReady, (d: { ready: boolean }) => this.setWorldOwned(d.ready));
    this.connectNetworkBroadcastEvent(DBEvents.boardStatus, (d: { ownerId: number; ownerName: string }) => {
      const mine = d.ownerId === local.id;
      this.setWorldOwned(mine);
      if (!mine) this.ctx.ui.worldStatus = d.ownerId < 0 ? 'World board: free' : 'World board: ' + d.ownerName;
    });

    this.toast('Welcome! Pick a brush and draw anywhere');
  }

  // -------------------------------------------------------------------------------------------
  // Data context
  // -------------------------------------------------------------------------------------------

  private buildContext() {
    for (let i = 0; i < SEG_POOL; i++) {
      this.segs.push({ x1: 0, y1: 0, x2: 0, y2: 0, c: '#FFFFFF', gc: '#FFFFFF', w: 1, gw: 1, o: 1, k: 'solid', vi: HIDE, vg: HIDE, vp: HIDE });
    }
    for (let i = 0; i < PARTICLES; i++) {
      this.parts.push({ x: -100, y: -100, s: 1, o: 0, r: 0, c: '#FFFFFF', v: HIDE });
      this.partSim.push({ vx: 0, vy: 0, spin: 0, life: 0, max: 1, size: 1, fall: 0 });
    }
    for (let i = 0; i < RIPPLES; i++) {
      this.ripples.push({ l: 0, t: 0, d: 0, o: 0, c: '#FFFFFF', v: HIDE });
      this.rippleSim.push({ x: 0, y: 0, life: 0, max: 0.6, size: 90 });
    }

    const t = THEMES[this.themeIndex];
    this.color = t.accent;
    const pal: Record<string, string> = {};
    t.pal.forEach((c, i) => (pal['c' + i] = c));

    const sel: Record<string, boolean> = {};
    (Object.keys(TOOL_LABEL) as ToolId[]).forEach(id => (sel[id] = id === this.tool));
    const sizeSel: Record<string, boolean> = {};
    SIZES.forEach(s => (sizeSel['s' + s] = s === this.size));

    const model = {
      theme: this.themeFields(t),
      pal,
      sel,
      sizeSel,
      segs: this.segs,
      parts: this.parts,
      ripples: this.ripples,
      cursor: { l: 0, t: 0, d: this.size + 6, c: this.color, v: HIDE },
      prev: { lineV: HIDE, rectV: HIDE, ellV: HIDE, x1: 0, y1: 0, x2: 0, y2: 0, l: 0, t: 0, w: 0, h: 0, c: this.color },
      guides: { vV: HIDE, hV: HIDE, dV: HIDE, cx: this.W / 2, cy: this.H / 2, W: this.W, H: this.H, d1x1: 0, d1y1: 0, d1x2: 0, d1y2: 0, d2x1: 0, d2y1: 0, d2x2: 0, d2y2: 0 },
      ui: {
        toolName: TOOL_LABEL[this.tool],
        sizeLabel: this.size + ' px',
        color: this.color,
        colorGlow: this.color,
        inkCount: '0 / ' + SEG_POOL,
        bodyCount: '0 bodies',
        mirrorLabel: 'Mirror: Off',
        glowOn: this.glowOn,
        sparkleOn: this.sparkleOn,
        gridOn: this.gridOn,
        vignetteOn: this.vignetteOn,
        crtOn: this.crtOn,
        mirrorOn: false,
        bloom: this.bloom,
        bloomLabel: 'Bloom ' + this.bloom,
        gridOp: t.gridOp,
        vigOp: t.vignetteOp,
        crtOp: 0,
        floorY: this.H - this.props.floorInset,
        floorX: this.props.wallInsetLeft,
        floorW: this.W - this.props.wallInsetLeft - this.props.wallInsetRight,
        toast: '',
        toastFlip: false,
        themeFlip: false,
        shakeFlip: false,
        burstFlip: false,
        galleryOpen: false,
        galleryVis: HIDE,
        panelsVis: SHOW,
        orbVis: HIDE,
        hintVis: SHOW,
        worldStatus: 'World board: free',
        worldOwned: false,
        worldVis: HIDE, // world-only buttons
        themeName: t.name,
        themeStyle: t.style,
        themeIndexLabel: this.themeIndex + 1 + ' / ' + THEMES.length,
        // shader FX (ShaderFX add-on)
        fxName: SHADER_FX[0].name,
        fxOn: false,
        pixelSize: 1,
        chroma: 0,
        pinch: 0,
        pinchX: 0.5,
        pinchY: 0.5,
        saturation: 1,
        noise: 0,
      },

      // ---- commands (bound with Command="{Binding name}") ----
      setTool: (p: unknown) => this.setTool(String(p) as ToolId),
      setSize: (p: unknown) => this.setSize(Number(p)),
      setColor: (p: unknown) => this.setColor(String(p)),
      nextTheme: () => this.setTheme(this.themeIndex + 1),
      prevTheme: () => this.setTheme(this.themeIndex - 1),
      setTheme: (p: unknown) => { this.setTheme(Number(p)); this.toggleGallery(false); },
      toggleGallery: () => this.toggleGallery(!this.galleryOpen),
      undo: () => this.undo(),
      clear: () => this.clearAll(),
      gravity: () => this.gravityAll(),
      shake: () => this.shake(),
      explode: () => this.explode(),
      freeze: () => this.freeze(),
      toggleGlow: () => { this.glowOn = !this.glowOn; this.ctx.ui.glowOn = this.glowOn; this.pushBrush(); this.toast(this.glowOn ? 'Glow on' : 'Glow off'); },
      toggleSparkle: () => { this.sparkleOn = !this.sparkleOn; this.ctx.ui.sparkleOn = this.sparkleOn; this.toast(this.sparkleOn ? 'Stardust trail on' : 'Stardust trail off'); },
      cycleMirror: () => this.cycleMirror(),
      toggleGrid: () => { this.gridOn = !this.gridOn; this.ctx.ui.gridOn = this.gridOn; this.applyOverlays(); },
      toggleVignette: () => { this.vignetteOn = !this.vignetteOn; this.ctx.ui.vignetteOn = this.vignetteOn; this.applyOverlays(); },
      toggleCrt: () => { this.crtOn = !this.crtOn; this.ctx.ui.crtOn = this.crtOn; this.applyOverlays(); },
      bloomUp: () => this.setBloom(this.bloom + 6),
      bloomDown: () => this.setBloom(this.bloom - 6),
      toggleMinimize: () => this.setMinimized(!this.minimized),
      cycleShaderFx: () => this.cycleShaderFx(),
      worldDraw: () => this.claimWorld(),
      worldBeam: () => this.beamToWorld(),
      worldDrop: () => this.worldAction('drop'),
      worldExplode: () => this.worldAction('explode'),
      worldFreeze: () => this.worldAction('freeze'),
      worldClear: () => this.worldAction('clear'),
      worldUndo: () => this.worldAction('undo'),
      worldLeave: () => this.worldAction('leave'),

      // ---- canvas input (EventTrigger + InvokeCommandAction PassEventArgsToCommand) ----
      onDown: (args: unknown) => this.onDown(this.readPos(args)),
      onMove: (args: unknown) => this.onMove(this.readPos(args)),
      onUp: (args: unknown) => this.onUp(this.readPos(args)),
      onLeave: () => { if (this.down) this.onUp(this.mouse); this.ctx.cursor.v = HIDE; },
      onSize: (args: unknown) => this.onSize(args),
    };

    const gizmo = this.entity.as(NoesisGizmo);
    gizmo.dataContext = model;
    // Mutate the object the gizmo holds, so field writes refresh on the next frame.
    this.ctx = (gizmo.dataContext as any) ?? model;
    this.segs = this.ctx.segs;
    this.parts = this.ctx.parts;
    this.ripples = this.ctx.ripples;
    this.updateGuides();
  }

  private themeFields(t: Theme) {
    const { pal, ...rest } = t;
    return { ...rest };
  }

  // Event args arrive as plain objects. Be tolerant about their exact shape.
  private readPos(args: unknown): Pt {
    const a = args as any;
    const p = a?.position ?? a?.Position ?? a?.pos ?? a;
    const x = Number(p?.x ?? p?.X);
    const y = Number(p?.y ?? p?.Y);
    if (isNaN(x) || isNaN(y)) return { x: this.mouse.x, y: this.mouse.y };
    return { x, y };
  }

  private onSize(args: unknown) {
    const a = args as any;
    const s = a?.newSize ?? a?.NewSize ?? a?.size ?? a;
    const w = Number(s?.width ?? s?.Width);
    const h = Number(s?.height ?? s?.Height);
    if (w > 100 && h > 100) {
      this.W = w;
      this.H = h;
      this.ctx.ui.floorY = this.H - this.props.floorInset;
      this.ctx.ui.floorW = this.W - this.props.wallInsetLeft - this.props.wallInsetRight;
      this.updateGuides();
    }
  }

  // -------------------------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------------------------

  private setTool(id: ToolId) {
    if (!(id in TOOL_LABEL)) return;
    this.ctx.sel[this.tool] = false;
    this.tool = id;
    this.ctx.sel[id] = true;
    const kind = BRUSH_OF_TOOL[id];
    if (kind) this.brushKind = kind;
    this.ctx.ui.toolName = TOOL_LABEL[id];
    this.pushBrush();
    this.toast(TOOL_LABEL[id] + (kind === 'physics' ? ': strokes fall when you let go' : id === 'hand' ? ': grab ink bodies and fling them' : ''));
  }

  private setSize(s: number) {
    if (!SIZES.includes(s)) return;
    this.ctx.sizeSel['s' + this.size] = false;
    this.size = s;
    this.ctx.sizeSel['s' + s] = true;
    this.ctx.ui.sizeLabel = s + ' px';
    this.ctx.cursor.d = s + 6;
    this.pushBrush();
  }

  private setColor(p: string) {
    let c = p;
    if (p.length <= 3 && p[0] === 'p') c = THEMES[this.themeIndex].pal[Number(p.slice(1))] ?? this.color;
    if (c[0] !== '#') return;
    this.color = c;
    this.ctx.ui.color = c;
    this.ctx.ui.colorGlow = c;
    this.ctx.cursor.c = c;
    this.ctx.prev.c = c;
    this.pushBrush();
    if (this.ctx.cursor.v === SHOW) this.burst(this.mouse.x, this.mouse.y, c, 10);
  }

  private setTheme(i: number) {
    const n = THEMES.length;
    this.themeIndex = ((i % n) + n) % n;
    const t = THEMES[this.themeIndex];
    Object.assign(this.ctx.theme, this.themeFields(t));
    t.pal.forEach((c, k) => (this.ctx.pal['c' + k] = c));
    this.ctx.ui.themeName = t.name;
    this.ctx.ui.themeStyle = t.style;
    this.ctx.ui.themeIndexLabel = this.themeIndex + 1 + ' / ' + n;
    this.ctx.ui.themeFlip = !this.ctx.ui.themeFlip; // plays the ripple storyboard
    this.applyOverlays();
    this.setColor(t.accent);
    this.toast(t.name + ' - ' + t.style);
  }

  private toggleGallery(open: boolean) {
    this.galleryOpen = open;
    this.ctx.ui.galleryOpen = open;
    this.ctx.ui.galleryVis = open ? SHOW : HIDE;
  }

  private applyOverlays() {
    const t = THEMES[this.themeIndex];
    this.ctx.ui.gridOp = this.gridOn ? t.gridOp : 0;
    this.ctx.ui.vigOp = this.vignetteOn ? t.vignetteOp : 0;
    this.ctx.ui.crtOp = this.crtOn ? t.scanOp : 0;
  }

  private setBloom(v: number) {
    this.bloom = clamp(v, 0, 40);
    this.ctx.ui.bloom = this.bloom;
    this.ctx.ui.bloomLabel = 'Bloom ' + this.bloom;
  }

  private cycleMirror() {
    this.mirror = this.mirror === 1 ? 2 : this.mirror === 2 ? 4 : this.mirror === 4 ? 8 : 1;
    this.ctx.ui.mirrorOn = this.mirror > 1;
    this.ctx.ui.mirrorLabel = this.mirror === 1 ? 'Mirror: Off' : this.mirror === 8 ? 'Kaleido x8' : 'Mirror x' + this.mirror;
    this.updateGuides();
    this.pushBrush();
  }

  private updateGuides() {
    if (!this.ctx) return;
    const g = this.ctx.guides;
    const cx = this.W / 2, cy = (this.H - this.props.floorInset * 0.5) / 2;
    g.cx = cx; g.cy = cy; g.W = this.W; g.H = this.H;
    g.vV = this.mirror >= 2 ? SHOW : HIDE;
    g.hV = this.mirror >= 4 ? SHOW : HIDE;
    g.dV = this.mirror >= 8 ? SHOW : HIDE;
    const L = Math.max(this.W, this.H);
    g.d1x1 = cx - L; g.d1y1 = cy - L; g.d1x2 = cx + L; g.d1y2 = cy + L;
    g.d2x1 = cx - L; g.d2y1 = cy + L; g.d2x2 = cx + L; g.d2y2 = cy - L;
  }

  private cycleShaderFx() {
    this.shaderFx = (this.shaderFx + 1) % SHADER_FX.length;
    const f = SHADER_FX[this.shaderFx];
    const ui = this.ctx.ui;
    ui.fxName = f.name;
    ui.fxOn = this.shaderFx > 0;
    ui.pixelSize = f.pixel;
    ui.chroma = f.chroma;
    ui.pinch = f.pinch;
    ui.saturation = f.saturation;
    ui.noise = f.noise;
    this.toast(f.name);
  }

  private setMinimized(m: boolean) {
    this.minimized = m;
    this.ctx.ui.panelsVis = m ? HIDE : SHOW;
    this.ctx.ui.orbVis = m ? SHOW : HIDE;
  }

  private toast(msg: string) {
    if (!this.ctx) return;
    this.ctx.ui.toast = msg;
    this.ctx.ui.toastFlip = !this.ctx.ui.toastFlip;
  }

  private brushState(): BrushState {
    return { color: this.color, kind: this.brushKind, size: this.size, glow: this.glowOn, mirror: this.mirror, physics: this.brushKind === 'physics' };
  }

  private pushBrush() {
    this.sendLocalBroadcastEvent(DBEvents.brushChanged, { brush: this.brushState() });
  }

  // -------------------------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------------------------

  private onDown(p: Pt) {
    this.mouse = p;
    if (this.down) return; // mouse + touch can both report the same press
    this.down = true;
    this.anchor = p;
    this.last = p;
    this.mouseVel = { x: 0, y: 0 };
    this.ripple(p.x, p.y, this.color);
    this.ctx.ui.hintVis = HIDE;

    switch (this.tool) {
      case 'hand':
        this.tryGrab(p);
        return;
      case 'eraser':
        this.eraseAt(p);
        return;
      case 'line':
      case 'rect':
      case 'ellipse':
        this.updatePreview(p);
        return;
    }
    this.cur = { segs: [], gens: [] };
    this.paintStep(p, p);
  }

  private onMove(p: Pt) {
    const now = this.time;
    const dt = Math.max(1 / 120, now - this.lastMoveTime);
    this.lastMoveTime = now;
    const vx = (p.x - this.mouse.x) / dt, vy = (p.y - this.mouse.y) / dt;
    this.mouseVel.x = this.mouseVel.x * 0.5 + vx * 0.5;
    this.mouseVel.y = this.mouseVel.y * 0.5 + vy * 0.5;
    this.mouse = p;

    const c = this.ctx.cursor;
    c.l = p.x - c.d / 2;
    c.t = p.y - c.d / 2;
    c.v = SHOW;
    if (this.shaderFx === 3) {
      this.ctx.ui.pinchX = clamp(p.x / this.W, 0, 1);
      this.ctx.ui.pinchY = clamp(p.y / this.H, 0, 1);
    }

    if (!this.down) {
      this.flick(p);
      return;
    }
    switch (this.tool) {
      case 'hand':
        return; // handled in tick (spring)
      case 'eraser':
        this.eraseAt(p);
        return;
      case 'line':
      case 'rect':
      case 'ellipse':
        this.updatePreview(p);
        return;
    }
    const step = Math.max(3, this.size * 0.35);
    const dx = p.x - this.last.x, dy = p.y - this.last.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (this.brushKind === 'spray') {
      this.spray(p);
      this.last = p;
      return;
    }
    if (dist < step) return;
    this.paintStep(this.last, p);
    this.last = p;
  }

  private onUp(p: Pt) {
    if (!this.down) return;
    this.down = false;
    switch (this.tool) {
      case 'hand':
        this.grab = null;
        break;
      case 'line':
      case 'rect':
      case 'ellipse':
        this.commitShape(this.anchor, p);
        break;
    }
    if (this.cur && this.cur.segs.length) {
      this.strokes.push(this.cur);
      if (this.strokes.length > 200) this.strokes.shift();
      if (this.brushKind === 'physics' && this.tool !== 'eraser' && this.tool !== 'hand') {
        const b = this.makeBody(this.cur.segs);
        if (b) {
          b.velX = clamp(this.mouseVel.x * 0.35, -900, 900);
          b.velY = clamp(this.mouseVel.y * 0.35, -900, 900);
          this.addBody(b);
        }
      }
    }
    this.cur = null;
  }

  // -------------------------------------------------------------------------------------------
  // Ink
  // -------------------------------------------------------------------------------------------

  private mirrored(p: Pt): Pt[] {
    if (this.mirror === 1) return [p];
    const cx = this.ctx.guides.cx, cy = this.ctx.guides.cy;
    const dx = p.x - cx, dy = p.y - cy;
    if (this.mirror === 2) return [p, { x: cx - dx, y: p.y }];
    if (this.mirror === 4) return [p, { x: cx - dx, y: p.y }, { x: p.x, y: cy - dy }, { x: cx - dx, y: cy - dy }];
    // 8-way kaleidoscope: 4 rotations x 2 reflections
    return [
      { x: cx + dx, y: cy + dy }, { x: cx - dy, y: cy + dx }, { x: cx - dx, y: cy - dy }, { x: cx + dy, y: cy - dx },
      { x: cx - dx, y: cy + dy }, { x: cx + dy, y: cy + dx }, { x: cx + dx, y: cy - dy }, { x: cx - dy, y: cy - dx },
    ];
  }

  private paintStep(a: Pt, b: Pt) {
    const A = this.mirrored(a), B = this.mirrored(b);
    for (let i = 0; i < A.length; i++) this.addSeg(A[i], B[i], this.brushKind, this.color, this.size);
    if (this.brushKind === 'sparkle' || this.sparkleOn) {
      const n = this.brushKind === 'sparkle' ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const c = this.brushKind === 'sparkle' ? hsvToHex(this.hue + Math.random() * 0.15, 0.6, 1) : this.color;
        this.spawnParticle(b.x + (Math.random() - 0.5) * this.size * 2, b.y + (Math.random() - 0.5) * this.size * 2, c, (Math.random() - 0.5) * 80, -40 - Math.random() * 80, 0.5 + Math.random() * 0.7, 0.35 + Math.random() * 0.5, 60);
      }
    }
  }

  private spray(p: Pt) {
    const R = this.size * 2 + 10;
    const n = 3 + Math.floor(this.size / 6);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = R * Math.sqrt(Math.random()) * (0.4 + Math.random() * 0.6);
      const q = { x: p.x + Math.cos(ang) * rr, y: p.y + Math.sin(ang) * rr };
      const c = mixHex(this.color, Math.random() < 0.5 ? '#FFFFFF' : '#000000', Math.random() * 0.25);
      const w = 1.5 + Math.random() * (this.size * 0.3 + 1.5);
      for (const m of this.mirrored(q)) this.addSeg(m, m, 'spray', c, w);
    }
  }

  private allocSeg(): number {
    const i = this.nextSeg;
    this.nextSeg = (this.nextSeg + 1) % SEG_POOL;
    if (this.segBody[i] >= 0) this.detachFromBody(i);
    this.segGen[i]++;
    if (!this.segLive[i]) {
      this.segLive[i] = 1;
      this.liveCount++;
    }
    return i;
  }

  private addSeg(a: Pt, b: Pt, kind: BrushKind, color: string, size: number): number {
    const i = this.allocSeg();
    const s = this.segs[i];
    let c = color, gc = color, w = size, o = 1, k = 'solid';
    let glow = this.glowOn, pulse = false;
    switch (kind) {
      case 'marker': w = size * 1.8; o = 0.45; glow = false; break;
      case 'neon': c = mixHex(color, '#FFFFFF', 0.7); w = Math.max(2, size * 0.6); glow = true; break;
      case 'rainbow': k = 'rainbow'; break;
      case 'flow': k = 'flow'; break;
      case 'aurora': k = 'aurora'; break;
      case 'pulse': pulse = true; glow = true; break;
      case 'spray': glow = false; break;
      case 'sparkle': w = Math.max(2, size * 0.5); c = mixHex(color, '#FFFFFF', 0.35); break;
    }
    s.x1 = a.x; s.y1 = a.y; s.x2 = b.x; s.y2 = b.y;
    s.c = c; s.gc = gc; s.w = w; s.gw = w * 2.6 + 4; s.o = o; s.k = k;
    s.vi = pulse ? HIDE : SHOW;
    s.vg = glow && !pulse ? SHOW : HIDE;
    s.vp = pulse ? SHOW : HIDE;
    if (this.cur) {
      this.cur.segs.push(i);
      this.cur.gens.push(this.segGen[i]);
    }
    this.markList();
    return i;
  }

  private hideSeg(i: number) {
    if (!this.segLive[i]) return;
    if (this.segBody[i] >= 0) this.detachFromBody(i);
    const s = this.segs[i];
    s.vi = HIDE; s.vg = HIDE; s.vp = HIDE;
    this.segLive[i] = 0;
    this.liveCount--;
    this.markList();
  }

  private markList() {
    this.listDirty = true;
  }

  private commitShape(a: Pt, b: Pt) {
    const p = this.ctx.prev;
    p.lineV = HIDE; p.rectV = HIDE; p.ellV = HIDE;
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 4) return;
    this.cur = { segs: [], gens: [] };
    const pts: Pt[] = [];
    if (this.tool === 'line') {
      pts.push(a, b);
    } else if (this.tool === 'rect') {
      pts.push(a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a);
    } else {
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      const n = 36;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
      }
    }
    const kind = this.brushKind === 'spray' ? 'solid' : this.brushKind;
    for (let i = 1; i < pts.length; i++) {
      const A = this.mirrored(pts[i - 1]), B = this.mirrored(pts[i]);
      for (let m = 0; m < A.length; m++) this.addSeg(A[m], B[m], kind, this.color, this.size);
    }
    this.burst(b.x, b.y, this.color, 8);
  }

  private updatePreview(p: Pt) {
    const pr = this.ctx.prev;
    const a = this.anchor;
    pr.lineV = this.tool === 'line' ? SHOW : HIDE;
    pr.rectV = this.tool === 'rect' ? SHOW : HIDE;
    pr.ellV = this.tool === 'ellipse' ? SHOW : HIDE;
    pr.x1 = a.x; pr.y1 = a.y; pr.x2 = p.x; pr.y2 = p.y;
    pr.l = Math.min(a.x, p.x); pr.t = Math.min(a.y, p.y);
    pr.w = Math.abs(p.x - a.x); pr.h = Math.abs(p.y - a.y);
  }

  private eraseAt(p: Pt) {
    const R = Math.max(14, this.size * 1.5);
    for (let i = 0; i < SEG_POOL; i++) {
      if (!this.segLive[i]) continue;
      const s = this.segs[i];
      if (distToSeg(p.x, p.y, s.x1, s.y1, s.x2, s.y2) < R + s.w / 2) {
        this.hideSeg(i);
        if (Math.random() < 0.3) this.spawnParticle((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, s.gc, (Math.random() - 0.5) * 160, -Math.random() * 160, 0.5, 0.4, 300);
      }
    }
  }

  private undo() {
    while (this.strokes.length) {
      const st = this.strokes.pop()!;
      let any = false;
      st.segs.forEach((i, k) => {
        if (this.segGen[i] === st.gens[k] && this.segLive[i]) {
          const s = this.segs[i];
          if (k % 4 === 0) this.spawnParticle((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, s.gc, (Math.random() - 0.5) * 120, -60 - Math.random() * 120, 0.6, 0.45, 260);
          this.hideSeg(i);
          any = true;
        }
      });
      if (any) {
        this.toast('Undo');
        return;
      }
    }
    this.toast('Nothing to undo');
  }

  private clearAll() {
    // Crumble: the newest ink falls off the bottom of the screen, the rest fades out.
    this.bodies.forEach((b, i) => b && this.removeBody(i));
    let taken = 0;
    for (let n = 0; n < SEG_POOL; n++) {
      const i = (this.nextSeg - 1 - n + SEG_POOL) % SEG_POOL;
      if (!this.segLive[i]) continue;
      const s = this.segs[i];
      if (taken < DEBRIS_MAX) {
        taken++;
        const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
        this.debris.push({ i, mx, my, hx: (s.x2 - s.x1) / 2, hy: (s.y2 - s.y1) / 2, vx: (Math.random() - 0.5) * 500, vy: -200 - Math.random() * 400, av: (Math.random() - 0.5) * 12, life: 1.6 });
        this.segLive[i] = 0; // reserved by debris; hidden when it lands
        this.liveCount--;
      } else {
        this.hideSeg(i);
      }
    }
    this.strokes = [];
    this.ctx.ui.shakeFlip = !this.ctx.ui.shakeFlip;
    this.toast('Cleared');
  }

  // -------------------------------------------------------------------------------------------
  // 2D rigid-body physics on ink
  // -------------------------------------------------------------------------------------------

  private makeBody(ids: number[]): Body | null {
    ids = ids.filter(i => this.segLive[i] && this.segBody[i] < 0);
    if (!ids.length) return null;
    let sx = 0, sy = 0, sw = 0, wsum = 0;
    for (const i of ids) {
      const s = this.segs[i];
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) + s.w * 0.5 + 1;
      sx += ((s.x1 + s.x2) / 2) * len;
      sy += ((s.y1 + s.y2) / 2) * len;
      sw += len;
      wsum += s.w;
    }
    const cx = sx / sw, cy = sy / sw;
    const b: Body = {
      segs: [], lx1: [], ly1: [], lx2: [], ly2: [], px: [], py: [], pad: [],
      cx, cy, velX: 0, velY: 0, a: 0, av: 0, m: 1, I: 1, r: 0, still: 0, sleeping: false, frozen: false,
    };
    const verts: { x: number; y: number; p: number }[] = [];
    for (const i of ids) {
      const s = this.segs[i];
      b.segs.push(i);
      b.lx1.push(s.x1 - cx); b.ly1.push(s.y1 - cy);
      b.lx2.push(s.x2 - cx); b.ly2.push(s.y2 - cy);
      verts.push({ x: s.x1 - cx, y: s.y1 - cy, p: s.w / 2 + 1 });
      verts.push({ x: s.x2 - cx, y: s.y2 - cy, p: s.w / 2 + 1 });
    }
    const stepV = Math.max(1, Math.ceil(verts.length / BODY_VERTS));
    let r2sum = 0;
    for (let k = 0; k < verts.length; k += stepV) {
      const v = verts[k];
      b.px.push(v.x); b.py.push(v.y); b.pad.push(v.p);
    }
    for (const v of verts) {
      const d = Math.hypot(v.x, v.y) + v.p;
      if (d > b.r) b.r = d;
      r2sum += v.x * v.x + v.y * v.y;
    }
    b.m = Math.max(1, (sw * Math.max(2, wsum / ids.length)) / 200);
    b.I = b.m * (r2sum / verts.length + 60);
    return b;
  }

  private addBody(b: Body): number {
    let slot = this.bodies.indexOf(null);
    if (slot < 0) {
      if (this.bodies.length >= MAX_BODIES) {
        this.removeBody(0); // retire the oldest body (its ink stays where it is)
        slot = 0;
      } else {
        slot = this.bodies.length;
        this.bodies.push(null);
      }
    }
    this.bodies[slot] = b;
    for (const i of b.segs) this.segBody[i] = slot;
    this.updateBodyCount();
    return slot;
  }

  private removeBody(slot: number) {
    const b = this.bodies[slot];
    if (!b) return;
    for (const i of b.segs) if (this.segBody[i] === slot) this.segBody[i] = -1;
    this.bodies[slot] = null;
    this.updateBodyCount();
  }

  private detachFromBody(i: number) {
    const slot = this.segBody[i];
    this.segBody[i] = -1;
    const b = slot >= 0 ? this.bodies[slot] : null;
    if (!b) return;
    const k = b.segs.indexOf(i);
    if (k >= 0) {
      b.segs.splice(k, 1); b.lx1.splice(k, 1); b.ly1.splice(k, 1); b.lx2.splice(k, 1); b.ly2.splice(k, 1);
    }
    if (!b.segs.length) this.removeBody(slot);
  }

  private updateBodyCount() {
    const n = this.bodies.filter(b => b).length;
    this.ctx.ui.bodyCount = n + (n === 1 ? ' body' : ' bodies');
  }

  private wake(b: Body) {
    b.sleeping = false;
    b.frozen = false;
    b.still = 0;
  }

  private gravityAll(silent = false) {
    // Every loose stroke becomes a rigid body (long strokes are split so they tumble nicely).
    const seen = new Set<number>();
    const groups: number[][] = [];
    for (let s = this.strokes.length - 1; s >= 0; s--) {
      const st = this.strokes[s];
      const ids = st.segs.filter((i, k) => this.segGen[i] === st.gens[k] && this.segLive[i] && this.segBody[i] < 0 && !seen.has(i));
      ids.forEach(i => seen.add(i));
      for (let k = 0; k < ids.length; k += 40) groups.push(ids.slice(k, k + 40));
    }
    // Ink not tracked by a stroke (e.g. very old) is grouped by pool order.
    let loose: number[] = [];
    for (let i = 0; i < SEG_POOL; i++) {
      if (this.segLive[i] && this.segBody[i] < 0 && !seen.has(i)) {
        loose.push(i);
        if (loose.length === 30) { groups.push(loose); loose = []; }
      }
    }
    if (loose.length) groups.push(loose);
    let made = 0;
    for (const g of groups.slice(0, MAX_BODIES)) {
      const b = this.makeBody(g);
      if (b) {
        b.velX = (Math.random() - 0.5) * 60;
        this.addBody(b);
        made++;
      }
    }
    this.bodies.forEach(b => b && this.wake(b));
    if (!silent) this.toast(made ? 'Gravity! Grab & Throw tool lets you fling them' : 'Everything is already falling');
  }

  private shake() {
    this.bodies.forEach(b => {
      if (!b) return;
      this.wake(b);
      b.velX += (Math.random() - 0.5) * 900;
      b.velY -= 300 + Math.random() * 500;
      b.av += (Math.random() - 0.5) * 8;
    });
    this.ctx.ui.shakeFlip = !this.ctx.ui.shakeFlip;
    this.toast('Shake!');
  }

  private explode() {
    this.gravityAll(true);
    const ox = this.mouse.x || this.W / 2, oy = this.mouse.y || this.H / 2;
    this.bodies.forEach(b => {
      if (!b) return;
      this.wake(b);
      const dx = b.cx - ox, dy = b.cy - oy;
      const d = Math.max(30, Math.hypot(dx, dy));
      const k = 2200 * Math.min(1, 220 / d);
      b.velX += (dx / d) * k;
      b.velY += (dy / d) * k - 350;
      b.av += (Math.random() - 0.5) * 14;
    });
    this.burst(ox, oy, this.color, 24);
    this.ripple(ox, oy, this.color);
    this.ctx.ui.shakeFlip = !this.ctx.ui.shakeFlip;
    this.ctx.ui.burstFlip = !this.ctx.ui.burstFlip;
    this.toast('Boom!');
  }

  private freeze() {
    let any = false;
    this.bodies.forEach(b => {
      if (!b) return;
      b.velX = 0; b.velY = 0; b.av = 0; b.frozen = true;
      any = true;
    });
    this.toast(any ? 'Frozen in time (Gravity or Shake to resume)' : 'Nothing is moving');
  }

  private tryGrab(p: Pt) {
    let best = -1, bestD = 40;
    this.bodies.forEach((b, slot) => {
      if (!b) return;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      for (let k = 0; k < b.segs.length; k++) {
        const ax = b.cx + b.lx1[k] * c - b.ly1[k] * s, ay = b.cy + b.lx1[k] * s + b.ly1[k] * c;
        const bx = b.cx + b.lx2[k] * c - b.ly2[k] * s, by = b.cy + b.lx2[k] * s + b.ly2[k] * c;
        const d = distToSeg(p.x, p.y, ax, ay, bx, by);
        if (d < bestD) { bestD = d; best = slot; }
      }
    });
    if (best < 0) {
      // Grabbing loose ink turns its stroke into a body first.
      for (let s = this.strokes.length - 1; s >= 0 && best < 0; s--) {
        const st = this.strokes[s];
        for (let k = 0; k < st.segs.length; k++) {
          const i = st.segs[k];
          if (this.segGen[i] !== st.gens[k] || !this.segLive[i] || this.segBody[i] >= 0) continue;
          const g = this.segs[i];
          if (distToSeg(p.x, p.y, g.x1, g.y1, g.x2, g.y2) < 30) {
            const b = this.makeBody(st.segs.filter((j, m) => this.segGen[j] === st.gens[m]));
            if (b) best = this.addBody(b);
            break;
          }
        }
      }
    }
    if (best < 0) return;
    const b = this.bodies[best]!;
    this.wake(b);
    const c = Math.cos(-b.a), s = Math.sin(-b.a);
    const dx = p.x - b.cx, dy = p.y - b.cy;
    this.grab = { b: best, lx: dx * c - dy * s, ly: dx * s + dy * c };
  }

  private flick(p: Pt) {
    const sp = Math.hypot(this.mouseVel.x, this.mouseVel.y);
    if (sp < 250) return;
    this.bodies.forEach(b => {
      if (!b) return;
      if (Math.hypot(p.x - b.cx, p.y - b.cy) > b.r + 20) return;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      for (let k = 0; k < b.px.length; k++) {
        const rx = b.px[k] * c - b.py[k] * s, ry = b.px[k] * s + b.py[k] * c;
        if (Math.hypot(b.cx + rx - p.x, b.cy + ry - p.y) < b.pad[k] + 22) {
          this.wake(b);
          const jx = this.mouseVel.x * 0.5 * b.m, jy = this.mouseVel.y * 0.5 * b.m;
          b.velX += jx / b.m; b.velY += jy / b.m;
          b.av += (rx * jy - ry * jx) / b.I;
          return;
        }
      }
    });
  }

  private stepPhysics(dt: number) {
    const floor = this.H - this.props.floorInset;
    const L = this.props.wallInsetLeft;
    const R = this.W - this.props.wallInsetRight;
    const list = this.bodies;

    // grabbed body follows the cursor like a spring
    if (this.grab && this.down) {
      const b = list[this.grab.b];
      if (b) {
        const c = Math.cos(b.a), s = Math.sin(b.a);
        const rx = this.grab.lx * c - this.grab.ly * s, ry = this.grab.lx * s + this.grab.ly * c;
        const ax = b.cx + rx, ay = b.cy + ry;
        const vpx = b.velX - b.av * ry, vpy = b.velY + b.av * rx;
        const jx = ((this.mouse.x - ax) * 60 - vpx * 8) * b.m * dt;
        const jy = ((this.mouse.y - ay) * 60 - vpy * 8 - GRAVITY) * b.m * dt;
        b.velX += jx / b.m; b.velY += jy / b.m;
        b.av += (rx * jy - ry * jx) / b.I;
        b.av *= 0.96;
        this.wake(b);
      } else {
        this.grab = null;
      }
    }

    for (let bi = 0; bi < list.length; bi++) {
      const b = list[bi];
      if (!b || b.sleeping || b.frozen) continue;
      b.velY += GRAVITY * dt;
      b.cx += b.velX * dt;
      b.cy += b.velY * dt;
      b.a += b.av * dt;
      b.av *= 0.998;
    }

    // body vs body: vertex circles with rotational impulses
    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      if (!A) continue;
      for (let j = i + 1; j < list.length; j++) {
        const B = list[j];
        if (!B) continue;
        if ((A.sleeping || A.frozen) && (B.sleeping || B.frozen)) continue;
        const ddx = B.cx - A.cx, ddy = B.cy - A.cy;
        if (ddx * ddx + ddy * ddy > (A.r + B.r) * (A.r + B.r)) continue;
        this.collidePair(A, B);
      }
    }

    // walls and floor last, so stacked bodies can never be pushed through them
    for (let bi = 0; bi < list.length; bi++) {
      const b = list[bi];
      if (!b || b.sleeping || b.frozen) continue;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      let penFloor = 0, penL = 0, penR = 0, penTop = 0;
      for (let k = 0; k < b.px.length; k++) {
        const rx = b.px[k] * c - b.py[k] * s, ry = b.px[k] * s + b.py[k] * c;
        const x = b.cx + rx, y = b.cy + ry, pad = b.pad[k];
        if (y + pad > floor) { penFloor = Math.max(penFloor, y + pad - floor); this.contact(b, rx, ry, 0, -1); }
        if (x - pad < L) { penL = Math.max(penL, L + pad - x); this.contact(b, rx, ry, 1, 0); }
        if (x + pad > R) { penR = Math.max(penR, x + pad - R); this.contact(b, rx, ry, -1, 0); }
        if (y - pad < 0) { penTop = Math.max(penTop, pad - y); this.contact(b, rx, ry, 0, 1); }
      }
      b.cy -= penFloor; b.cy += penTop; b.cx += penL; b.cx -= penR;
    }

    // sleep + write segment positions
    for (let bi = 0; bi < list.length; bi++) {
      const b = list[bi];
      if (!b || b.sleeping) continue;
      if (!b.frozen) {
        const moving = Math.abs(b.velX) + Math.abs(b.velY) > 12 || Math.abs(b.av) > 0.08;
        b.still = moving ? 0 : b.still + dt;
        if (b.still > 0.7 && !(this.grab && this.grab.b === bi)) {
          b.sleeping = true;
          b.velX = 0; b.velY = 0; b.av = 0;
        }
      }
      this.writeBody(b);
    }
  }

  private contact(b: Body, rx: number, ry: number, nx: number, ny: number) {
    const vpx = b.velX - b.av * ry, vpy = b.velY + b.av * rx;
    const vn = vpx * nx + vpy * ny;
    if (vn >= 0) return;
    const invM = 1 / b.m, invI = 1 / b.I;
    const rn = rx * ny - ry * nx;
    const j = (-(1 + RESTITUTION) * vn) / (invM + rn * rn * invI);
    b.velX += j * nx * invM; b.velY += j * ny * invM; b.av += rn * j * invI;
    // friction
    const tx = -ny, ty = nx;
    const vpx2 = b.velX - b.av * ry, vpy2 = b.velY + b.av * rx;
    const vt = vpx2 * tx + vpy2 * ty;
    const rt = rx * ty - ry * tx;
    let jt = -vt / (invM + rt * rt * invI);
    const lim = FRICTION * j;
    jt = clamp(jt, -lim, lim);
    b.velX += jt * tx * invM; b.velY += jt * ty * invM; b.av += rt * jt * invI;
  }

  private collidePair(A: Body, B: Body) {
    const ca = Math.cos(A.a), sa = Math.sin(A.a), cb = Math.cos(B.a), sb = Math.sin(B.a);
    // resting (sleeping) and frozen bodies act as static until something hits them hard
    const stillA = A.frozen || A.sleeping, stillB = B.frozen || B.sleeping;
    const invMA = stillA ? 0 : 1 / A.m, invIA = stillA ? 0 : 1 / A.I;
    const invMB = stillB ? 0 : 1 / B.m, invIB = stillB ? 0 : 1 / B.I;
    if (invMA + invMB === 0) return;
    let hits = 0;
    for (let i = 0; i < A.px.length && hits < 4; i++) {
      const rax = A.px[i] * ca - A.py[i] * sa, ray = A.px[i] * sa + A.py[i] * ca;
      const ax = A.cx + rax, ay = A.cy + ray;
      for (let j = 0; j < B.px.length; j++) {
        const rbx = B.px[j] * cb - B.py[j] * sb, rby = B.px[j] * sb + B.py[j] * cb;
        const bx = B.cx + rbx, by = B.cy + rby;
        const dx = bx - ax, dy = by - ay;
        const rad = A.pad[i] + B.pad[j] + 3;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rad * rad) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d, ny = dy / d;
        // contact point offsets from each center (midpoint of the two vertices)
        const px = (ax + bx) / 2, py = (ay + by) / 2;
        const r1x = px - A.cx, r1y = py - A.cy, r2x = px - B.cx, r2y = py - B.cy;
        const v1x = A.velX - A.av * r1y, v1y = A.velY + A.av * r1x;
        const v2x = B.velX - B.av * r2y, v2y = B.velY + B.av * r2x;
        const vn = (v2x - v1x) * nx + (v2y - v1y) * ny;
        const pen = rad - d;
        const corr = (pen * 0.5) / (invMA + invMB);
        A.cx -= nx * corr * invMA; A.cy -= ny * corr * invMA;
        B.cx += nx * corr * invMB; B.cy += ny * corr * invMB;
        if (vn < 0) {
          const rn1 = r1x * ny - r1y * nx, rn2 = r2x * ny - r2y * nx;
          const jn = (-(1 + RESTITUTION) * vn) / (invMA + invMB + rn1 * rn1 * invIA + rn2 * rn2 * invIB);
          A.velX -= jn * nx * invMA; A.velY -= jn * ny * invMA; A.av -= rn1 * jn * invIA;
          B.velX += jn * nx * invMB; B.velY += jn * ny * invMB; B.av += rn2 * jn * invIB;
          if (A.sleeping && !A.frozen && jn / A.m > 120) this.wake(A);
          if (B.sleeping && !B.frozen && jn / B.m > 120) this.wake(B);
        }
        hits++;
        break;
      }
    }
  }

  private writeBody(b: Body) {
    const c = Math.cos(b.a), s = Math.sin(b.a);
    for (let k = 0; k < b.segs.length; k++) {
      const g = this.segs[b.segs[k]];
      g.x1 = b.cx + b.lx1[k] * c - b.ly1[k] * s;
      g.y1 = b.cy + b.lx1[k] * s + b.ly1[k] * c;
      g.x2 = b.cx + b.lx2[k] * c - b.ly2[k] * s;
      g.y2 = b.cy + b.lx2[k] * s + b.ly2[k] * c;
    }
    if (b.segs.length) this.markList();
  }

  private stepDebris(dt: number) {
    for (let n = this.debris.length - 1; n >= 0; n--) {
      const d = this.debris[n];
      d.vy += GRAVITY * dt;
      d.mx += d.vx * dt; d.my += d.vy * dt;
      d.life -= dt;
      const ang = d.av * dt, c = Math.cos(ang), s = Math.sin(ang);
      const hx = d.hx * c - d.hy * s, hy = d.hx * s + d.hy * c;
      d.hx = hx; d.hy = hy;
      const g = this.segs[d.i];
      if (d.life <= 0 || d.my > this.H + 80 || this.segLive[d.i]) {
        // landed (or slot reused by fresh ink)
        if (!this.segLive[d.i]) { g.vi = HIDE; g.vg = HIDE; g.vp = HIDE; }
        this.debris.splice(n, 1);
        continue;
      }
      g.x1 = d.mx - hx; g.y1 = d.my - hy; g.x2 = d.mx + hx; g.y2 = d.my + hy;
      g.o = clamp(d.life, 0, 1);
    }
    if (this.debris.length) this.markList();
  }

  // -------------------------------------------------------------------------------------------
  // Particles and ripples
  // -------------------------------------------------------------------------------------------

  private spawnParticle(x: number, y: number, c: string, vx: number, vy: number, life: number, size: number, fall: number) {
    const i = this.nextPart;
    this.nextPart = (this.nextPart + 1) % PARTICLES;
    const p = this.parts[i], sim = this.partSim[i];
    p.x = x; p.y = y; p.c = c; p.o = 1; p.s = size; p.r = Math.random() * 90; p.v = SHOW;
    sim.vx = vx; sim.vy = vy; sim.spin = (Math.random() - 0.5) * 400; sim.life = life; sim.max = life; sim.size = size; sim.fall = fall;
  }

  private burst(x: number, y: number, c: string, n: number) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 120 + Math.random() * 220;
      const col = Math.random() < 0.35 ? '#FFFFFF' : c;
      this.spawnParticle(x, y, col, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.5, 0.3 + Math.random() * 0.6, 200);
    }
  }

  private ripple(x: number, y: number, c: string) {
    const i = this.nextRipple;
    this.nextRipple = (this.nextRipple + 1) % RIPPLES;
    const sim = this.rippleSim[i];
    sim.x = x; sim.y = y; sim.life = sim.max = 0.6; sim.size = 70 + this.size * 2;
    const r = this.ripples[i];
    r.c = c; r.v = SHOW;
  }

  private stepParticles(dt: number) {
    for (let i = 0; i < PARTICLES; i++) {
      const sim = this.partSim[i];
      if (sim.life <= 0) continue;
      const p = this.parts[i];
      sim.life -= dt;
      if (sim.life <= 0) { p.v = HIDE; p.o = 0; continue; }
      sim.vy += sim.fall * dt;
      sim.vx *= 0.97; sim.vy *= 0.97;
      p.x += sim.vx * dt; p.y += sim.vy * dt;
      p.r += sim.spin * dt;
      const t = sim.life / sim.max;
      p.o = t;
      p.s = sim.size * (0.4 + 0.6 * Math.sin(t * Math.PI));
    }
    for (let i = 0; i < RIPPLES; i++) {
      const sim = this.rippleSim[i];
      if (sim.life <= 0) continue;
      const r = this.ripples[i];
      sim.life -= dt;
      if (sim.life <= 0) { r.v = HIDE; r.o = 0; continue; }
      const t = 1 - sim.life / sim.max;
      const d = sim.size * (0.15 + 0.85 * (1 - (1 - t) * (1 - t)));
      r.d = d; r.l = sim.x - d / 2; r.t = sim.y - d / 2; r.o = 0.8 * (1 - t);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  private tick(deltaTime: number) {
    if (!this.ctx) return;
    const dt = Math.min(deltaTime, 1 / 20);
    this.time += dt;
    this.hue = (this.hue + dt * 0.25) % 1;

    if (this.down && this.brushKind === 'spray' && this.cur) this.spray(this.mouse);

    const sub = 2;
    for (let i = 0; i < sub; i++) this.stepPhysics(dt / sub);
    if (this.debris.length) this.stepDebris(dt);
    this.stepParticles(dt);

    this.ctx.ui.inkCount = this.liveCount + ' / ' + SEG_POOL;

    if (this.props.reassignLists && this.listDirty) {
      this.listTimer -= dt;
      if (this.listTimer <= 0) {
        this.listTimer = 1 / 20;
        this.listDirty = false;
        this.ctx.segs = this.segs.slice();
        this.segs = this.ctx.segs;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // World board bridge
  // -------------------------------------------------------------------------------------------

  private setWorldOwned(mine: boolean) {
    this.worldOwned = mine;
    this.ctx.ui.worldOwned = mine;
    this.ctx.ui.worldVis = mine ? SHOW : HIDE;
    if (mine) {
      this.ctx.ui.worldStatus = 'World board: yours';
      this.pushBrush();
    }
  }

  private claimWorld() {
    const board = this.props.worldBoard;
    if (!board) {
      this.toast('No world board linked (set the worldBoard property)');
      return;
    }
    if (this.worldOwned) {
      this.toast('You already own the world board');
      return;
    }
    this.ctx.ui.worldStatus = 'World board: claiming...';
    this.toast('Claiming the world board...');
    this.sendNetworkEvent(board, DBEvents.claim, { player: this.world.getLocalPlayer() });
  }

  private worldAction(action: WorldAction) {
    if (!this.worldOwned) {
      this.toast('Claim the world board first (Draw in World)');
      return;
    }
    this.sendLocalBroadcastEvent(DBEvents.worldAction, { action });
    if (action === 'leave') this.setWorldOwned(false);
  }

  private beamToWorld() {
    if (!this.worldOwned) {
      this.toast('Claim the world board first (Draw in World)');
      return;
    }
    const live: number[] = [];
    for (let n = 0; n < SEG_POOL; n++) {
      const i = (this.nextSeg + n) % SEG_POOL; // oldest -> newest
      if (this.segLive[i]) live.push(i);
    }
    if (!live.length) {
      this.toast('Draw something first, then beam it to the board');
      return;
    }
    const step = Math.max(1, Math.ceil(live.length / 160));
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    const pick: number[] = [];
    for (let k = 0; k < live.length; k += step) {
      const s = this.segs[live[k]];
      const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
      minX = Math.min(minX, mx); maxX = Math.max(maxX, mx); minY = Math.min(minY, my); maxY = Math.max(maxY, my);
      pick.push(live[k]);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, (maxY - minY) * (16 / 9), 1);
    const points: BeamPoint[] = pick.map(i => {
      const s = this.segs[i];
      const kind: BrushKind = s.k === 'rainbow' || s.k === 'flow' || s.k === 'aurora' ? (s.k as BrushKind) : s.vp === SHOW ? 'pulse' : 'solid';
      return {
        u: (((s.x1 + s.x2) / 2 - cx) / span) * 0.9,
        v: (-((s.y1 + s.y2) / 2 - cy) / span) * 0.9 * (16 / 9),
        color: s.gc,
        kind,
        size: s.w,
        glow: s.vg === SHOW || s.vp === SHOW,
      };
    });
    this.sendLocalBroadcastEvent(DBEvents.beam, { points });
    this.toast('Beaming ' + points.length + ' points to the world board');
  }
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t - px, y = ay + dy * t - py;
  return Math.sqrt(x * x + y * y);
}

hz.Component.register(DrawingBoardUI);
