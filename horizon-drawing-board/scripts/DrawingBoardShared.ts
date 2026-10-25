// DrawingBoardShared.ts
// Events, types and color helpers shared by DrawingBoardUI (Noesis panel, Shared mode)
// and DrawingBoardWorld (3D board, Local mode). Attach this file to nothing; it is imported.

import { LocalEvent, NetworkEvent, Player, Color } from 'horizon/core';

export type BrushKind =
  | 'solid'
  | 'marker'
  | 'neon'
  | 'rainbow'
  | 'flow'
  | 'aurora'
  | 'pulse'
  | 'spray'
  | 'sparkle'
  | 'physics';

export type BrushState = {
  color: string; // #RRGGBB
  kind: BrushKind;
  size: number; // UI pixels (2..40)
  glow: boolean;
  mirror: number; // 1, 2, 4 or 8
  physics: boolean;
};

// One sampled point of a 2D drawing, normalized to the board: u,v in [-0.5, 0.5], v up.
export type BeamPoint = { u: number; v: number; color: string; kind: BrushKind; size: number; glow: boolean };

export type WorldAction = 'drop' | 'explode' | 'freeze' | 'clear' | 'undo' | 'leave';

export const DBEvents = {
  // UI -> World (same client)
  brushChanged: new LocalEvent<{ brush: BrushState }>('DB_BrushChanged'),
  worldAction: new LocalEvent<{ action: WorldAction }>('DB_WorldAction'),
  beam: new LocalEvent<{ points: BeamPoint[] }>('DB_Beam'),
  // World -> UI (same client)
  requestBrush: new LocalEvent<{ from: string }>('DB_RequestBrush'),
  worldReady: new LocalEvent<{ ready: boolean }>('DB_WorldReady'),
  // Network: claim / release the 3D board, and tell everyone who owns it
  claim: new NetworkEvent<{ player: Player }>('DB_Claim'),
  release: new NetworkEvent<{ player: Player }>('DB_Release'),
  boardStatus: new NetworkEvent<{ ownerId: number; ownerName: string }>('DB_BoardStatus'),
};

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function hex2(n: number): string {
  const s = Math.round(clamp(n, 0, 255)).toString(16).toUpperCase();
  return s.length < 2 ? '0' + s : s;
}

// Accepts #RGB, #RRGGBB or #AARRGGBB. Returns 0..255 channels.
export function parseHex(hex: string): { a: number; r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length === 6) h = 'FF' + h;
  const n = parseInt(h, 16);
  if (isNaN(n) || h.length !== 8) return { a: 255, r: 255, g: 255, b: 255 };
  return { a: (n >>> 24) & 255, r: (n >>> 16) & 255, g: (n >>> 8) & 255, b: n & 255 };
}

export function rgbHex(r: number, g: number, b: number): string {
  return '#' + hex2(r) + hex2(g) + hex2(b);
}

// h in [0,1), s,v in [0,1]
export function hsvToHex(h: number, s: number, v: number): string {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = v, g = t, b = p;
  switch (i % 6) {
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return rgbHex(r * 255, g * 255, b * 255);
}

export function mixHex(a: string, b: string, t: number): string {
  const A = parseHex(a);
  const B = parseHex(b);
  return rgbHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

// #AARRGGBB with the given alpha (0..1)
export function withAlpha(hex: string, alpha: number): string {
  const c = parseHex(hex);
  return '#' + hex2(alpha * 255) + hex2(c.r) + hex2(c.g) + hex2(c.b);
}

export function hexToColor(hex: string): Color {
  const c = parseHex(hex);
  return new Color(c.r / 255, c.g / 255, c.b / 255);
}

// Hue (0..1) of a hex color, used to start rainbow cycles from the chosen color.
export function hexHue(hex: string): number {
  const c = parseHex(hex);
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h / 6) % 1 + 1) % 1;
}
