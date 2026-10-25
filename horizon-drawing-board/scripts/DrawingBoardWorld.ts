// DrawingBoardWorld.ts
// The 3D half of the drawing board. One player at a time claims the board; their client then
// owns this script plus a pool of glowing "ink dot" entities. They draw with:
//   * VR: hold either trigger and paint in the air (dots follow the controller tip, with haptics)
//   * Mobile / desktop: focused interaction - touch or click-drag on the board surface
// Dots can float (light painting), animate (rainbow / pulse), or drop as real physics objects.
//
// Setup (see README.md):
//   * Attach to the board surface entity (a flat cube/plane). Its forward (blue) axis must face
//     the players. Execution mode: **Local**.
//   * dotPool: an empty object whose children are the ink dots (small spheres). Each dot:
//     Motion = Interactive, Interaction = Physics, collidable, a tintable / emissive material.
//   * Optional: trail (Trail gizmo), sparkFx (Particle gizmo), drawSfx / popSfx (Sound gizmos).

import * as hz from 'horizon/core';
import LocalCamera from 'horizon/camera';
import { DBEvents, BrushState, BeamPoint, WorldAction, clamp, hexToColor, hexHue, hsvToHex } from 'DrawingBoardShared';

type WorldStroke = { dots: number[]; physics: boolean };
type Animated = { dot: number; kind: 'rainbow' | 'flow' | 'aurora' | 'pulse'; phase: number; color: string };

const PARK_DEPTH = -50; // parked dots wait far below the board

class DrawingBoardWorld extends hz.Component<typeof DrawingBoardWorld> {
  static propsDefinition = {
    dotPool: { type: hz.PropTypes.Entity },
    trail: { type: hz.PropTypes.Entity },
    sparkFx: { type: hz.PropTypes.Entity },
    drawSfx: { type: hz.PropTypes.Entity },
    popSfx: { type: hz.PropTypes.Entity },
    boardWidth: { type: hz.PropTypes.Number, default: 4 }, // meters
    boardHeight: { type: hz.PropTypes.Number, default: 2.25 },
    cameraDistance: { type: hz.PropTypes.Number, default: 3.4 },
    dotSpacing: { type: hz.PropTypes.Number, default: 0.035 },
    vrReach: { type: hz.PropTypes.Number, default: 0.1 }, // brush tip distance in front of the hand
    dotMinScale: { type: hz.PropTypes.Number, default: 0.025 },
    dotMaxScale: { type: hz.PropTypes.Number, default: 0.16 },
    glowBrightness: { type: hz.PropTypes.Number, default: 8 },
    animatedPerTick: { type: hz.PropTypes.Number, default: 24 }, // network budget for color animation
  };

  private dots: hz.Entity[] = [];
  private dotStroke: (WorldStroke | null)[] = [];
  private dotLive: boolean[] = [];
  private nextDot = 0;
  private strokes: WorldStroke[] = [];
  private cur: WorldStroke | null = null;
  private animated: Animated[] = [];
  private animCursor = 0;
  private time = 0;

  private player: hz.Player | null = null;
  private isVR = false;
  private brush: BrushState = { color: '#7CF7FF', kind: 'neon', size: 8, glow: true, mirror: 1, physics: false };
  private drawingHand: 'left' | 'right' | null = null;
  private lastPos: hz.Vec3 | null = null;
  private inputs: hz.PlayerInput[] = [];
  private beamQueue: BeamPoint[] = [];
  private dropQueue: number[] = [];
  private hapticTimer = 0;
  private savedState: { next: number; strokes: WorldStroke[]; live: boolean[] } | null = null;

  start() {
    const owner = this.entity.owner.get();
    const server = this.world.getServerPlayer();

    this.dots = this.props.dotPool ? this.props.dotPool.children.get() : [];
    this.dotStroke = this.dots.map(() => null);
    this.dotLive = this.dots.map(() => false);

    this.connectNetworkEvent(this.entity, DBEvents.claim, (d: { player: hz.Player }) => this.onClaim(d.player));
    this.connectNetworkEvent(this.entity, DBEvents.release, (d: { player: hz.Player }) => this.onRelease(d.player));

    if (owner.id === server.id) {
      // Server copy: the board is free. Dots stay where the last artist left them.
      // (If the owner leaves the world, ownership returns here and this runs again.)
      this.async.setTimeout(() => this.broadcastStatus(null), 500);
      return;
    }

    this.player = owner;
    this.restoreState();
    this.isVR = owner.deviceType.get() === hz.PlayerDeviceType.VR;

    this.connectLocalBroadcastEvent(DBEvents.brushChanged, (d: { brush: BrushState }) => (this.brush = d.brush));
    this.connectLocalBroadcastEvent(DBEvents.worldAction, (d: { action: WorldAction }) => this.onAction(d.action));
    this.connectLocalBroadcastEvent(DBEvents.beam, (d: { points: BeamPoint[] }) => {
      this.beamQueue.push(...d.points);
      this.play(this.props.popSfx);
    });
    this.connectLocalBroadcastEvent(hz.World.onUpdate, (d: { deltaTime: number }) => this.tick(d.deltaTime));

    if (this.isVR) this.setupVR();
    else this.setupFocused(owner);

    this.sendLocalBroadcastEvent(DBEvents.requestBrush, { from: 'world' });
    this.sendLocalBroadcastEvent(DBEvents.worldReady, { ready: true });
    this.broadcastStatus(owner);
  }

  // Carry the stroke bookkeeping across ownership changes.
  transferOwnership(_old: hz.Player, _new: hz.Player): hz.SerializableState {
    return { next: this.nextDot, strokes: this.strokes, live: this.dotLive } as unknown as hz.SerializableState;
  }

  receiveOwnership(state: hz.SerializableState | null, _old: hz.Player, _new: hz.Player) {
    if (state) this.savedState = state as unknown as { next: number; strokes: WorldStroke[]; live: boolean[] };
    this.restoreState();
  }

  private restoreState() {
    if (!this.savedState || !this.dots.length) return;
    this.nextDot = this.savedState.next % this.dots.length;
    this.strokes = this.savedState.strokes ?? [];
    this.strokes.forEach(s => s.dots.forEach(d => (this.dotStroke[d] = s)));
    (this.savedState.live ?? []).forEach((v, i) => i < this.dotLive.length && (this.dotLive[i] = v));
    this.savedState = null;
  }

  // -------------------------------------------------------------------------------------------
  // Ownership
  // -------------------------------------------------------------------------------------------

  private onClaim(player: hz.Player) {
    const owner = this.entity.owner.get();
    const server = this.world.getServerPlayer();
    if (owner.id !== server.id) {
      // Already in use: re-announce the current owner so the requester's UI shows it.
      this.broadcastStatus(owner);
      return;
    }
    this.transferAll(player);
  }

  private onRelease(player: hz.Player) {
    const owner = this.entity.owner.get();
    if (owner.id !== player.id) return;
    this.transferAll(this.world.getServerPlayer());
  }

  private transferAll(to: hz.Player) {
    const extras = [this.props.trail, this.props.sparkFx, this.props.drawSfx, this.props.popSfx];
    for (const e of this.dots) e.owner.set(to);
    for (const e of extras) if (e) e.owner.set(to);
    this.entity.owner.set(to); // restarts this script on the new owner's client
    this.broadcastStatus(to.id === this.world.getServerPlayer().id ? null : to);
  }

  private broadcastStatus(owner: hz.Player | null) {
    this.sendNetworkBroadcastEvent(DBEvents.boardStatus, owner ? { ownerId: owner.id, ownerName: owner.name.get() } : { ownerId: -1, ownerName: '' });
  }

  private leave() {
    this.endStroke();
    this.inputs.forEach(i => i.disconnect());
    this.inputs = [];
    const p = this.player;
    if (p && !this.isVR) {
      p.exitFocusedInteractionMode();
      LocalCamera.setCameraModeThirdPerson();
    }
    this.sendLocalBroadcastEvent(DBEvents.worldReady, { ready: false });
    if (p) this.onRelease(p);
  }

  // -------------------------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------------------------

  private setupVR() {
    const bind = (action: hz.PlayerInputAction, hand: 'left' | 'right') => {
      const input = hz.PlayerControls.connectLocalInput(action, hz.ButtonIcon.None, this);
      input.registerCallback((_a: hz.PlayerInputAction, pressed: boolean) => {
        if (pressed && !this.drawingHand) {
          this.drawingHand = hand;
          this.beginStroke(this.handTip(hand));
        } else if (!pressed && this.drawingHand === hand) {
          this.endStroke();
        }
      });
      this.inputs.push(input);
    };
    bind(hz.PlayerInputAction.RightTrigger, 'right');
    bind(hz.PlayerInputAction.LeftTrigger, 'left');
  }

  private handTip(hand: 'left' | 'right'): hz.Vec3 {
    const h = hand === 'left' ? this.player!.leftHand : this.player!.rightHand;
    return h.position.get().add(h.forward.get().mul(this.props.vrReach));
  }

  private setupFocused(player: hz.Player) {
    player.enterFocusedInteractionMode();
    const n = this.entity.forward.get();
    const camPos = this.entity.position.get().add(n.mul(this.props.cameraDistance));
    LocalCamera.setCameraModeFixed({
      position: camPos,
      rotation: hz.Quaternion.lookRotation(n.mul(-1), hz.Vec3.up),
      duration: 0.6,
    });

    type FI = { interactionInfo: { interactionIndex: number; screenPosition: hz.Vec3; worldRayOrigin: hz.Vec3; worldRayDirection: hz.Vec3 }[] };
    const first = (d: FI) => (d.interactionInfo && d.interactionInfo.length ? d.interactionInfo[0] : null);

    this.connectLocalBroadcastEvent(hz.PlayerControls.onFocusedInteractionInputStarted, (d: FI) => {
      const i = first(d);
      const p = i ? this.rayToBoard(i.worldRayOrigin, i.worldRayDirection) : null;
      if (p) this.beginStroke(p);
    });
    this.connectLocalBroadcastEvent(hz.PlayerControls.onFocusedInteractionInputMoved, (d: FI) => {
      const i = first(d);
      if (!i || !this.cur) return;
      const p = this.rayToBoard(i.worldRayOrigin, i.worldRayDirection);
      if (p) this.extendStroke(p);
    });
    this.connectLocalBroadcastEvent(hz.PlayerControls.onFocusedInteractionInputEnded, () => this.endStroke());

    // If the player leaves focused interaction with the built-in exit button, release the board.
    const exited = (hz.CodeBlockEvents as any).OnPlayerExitedFocusedInteraction;
    if (exited) {
      this.connectCodeBlockEvent(this.entity, exited, (p: hz.Player) => {
        if (this.player && p.id === this.player.id) this.leave();
      });
    }
  }

  // Ray / board-plane intersection. Returns a point just in front of the surface, or null.
  private rayToBoard(origin: hz.Vec3, dir: hz.Vec3): hz.Vec3 | null {
    const n = this.entity.forward.get();
    const c = this.entity.position.get();
    const denom = dir.dot(n);
    if (Math.abs(denom) < 1e-4) return null;
    const t = c.sub(origin).dot(n) / denom;
    if (t <= 0) return null;
    const hit = origin.add(dir.mul(t));
    const rel = hit.sub(c);
    const u = rel.dot(this.entity.right.get()), v = rel.dot(this.entity.up.get());
    if (Math.abs(u) > this.props.boardWidth / 2 || Math.abs(v) > this.props.boardHeight / 2) return null;
    return hit.add(n.mul(0.03));
  }

  private boardPoint(u: number, v: number): hz.Vec3 {
    const c = this.entity.position.get();
    return c
      .add(this.entity.right.get().mul(u * this.props.boardWidth))
      .add(this.entity.up.get().mul(v * this.props.boardHeight))
      .add(this.entity.forward.get().mul(0.03));
  }

  // -------------------------------------------------------------------------------------------
  // Strokes
  // -------------------------------------------------------------------------------------------

  private beginStroke(p: hz.Vec3) {
    if (!this.dots.length) return;
    this.cur = { dots: [], physics: this.brush.physics };
    this.strokes.push(this.cur);
    if (this.strokes.length > 120) this.strokes.shift();
    this.lastPos = null;
    this.extendStroke(p);
    this.spark(p);
    this.play(this.props.drawSfx);
    const trail = this.props.trail?.as(hz.TrailGizmo);
    if (trail) {
      this.props.trail!.position.set(p);
      trail.play();
    }
  }

  private extendStroke(p: hz.Vec3) {
    if (!this.cur) return;
    const spacing = this.props.dotSpacing * (0.6 + this.brush.size / 16);
    if (!this.lastPos) {
      this.placeDot(p, this.brush.color, this.brush.kind, this.brush.size, this.brush.glow);
      this.lastPos = p;
      return;
    }
    const gap = p.sub(this.lastPos);
    const dist = gap.magnitude();
    if (dist < spacing) return;
    const steps = Math.min(6, Math.floor(dist / spacing)); // fill gaps from fast strokes
    for (let s = 1; s <= steps; s++) {
      const q = this.lastPos.add(gap.mul(s / steps));
      this.placeDot(q, this.brush.color, this.brush.kind, this.brush.size, this.brush.glow);
    }
    this.lastPos = p;
    this.props.trail?.position.set(p);
  }

  private endStroke() {
    this.drawingHand = null;
    this.props.trail?.as(hz.TrailGizmo).stop();
    this.props.drawSfx?.as(hz.AudioGizmo).stop();
    const st = this.cur;
    this.cur = null;
    if (st && st.physics) this.queueDrop(st.dots);
  }

  private placeDot(pos: hz.Vec3, color: string, kind: BrushState['kind'], size: number, glow: boolean) {
    const n = this.dots.length;
    const idx = this.nextDot;
    this.nextDot = (this.nextDot + 1) % n;
    const e = this.dots[idx];

    // recycle: remove from its old stroke / animation list
    this.animated = this.animated.filter(a => a.dot !== idx);
    const old = this.dotStroke[idx];
    if (old) {
      const k = old.dots.indexOf(idx);
      if (k >= 0) old.dots.splice(k, 1);
    }
    this.dotStroke[idx] = this.cur;
    this.dotLive[idx] = true;
    if (this.cur) this.cur.dots.push(idx);

    const scale = clamp(this.props.dotMinScale + (size / 40) * (this.props.dotMaxScale - this.props.dotMinScale), 0.01, 1);
    const phys = e.as(hz.PhysicalEntity);
    safe(() => phys.zeroVelocity());
    safe(() => phys.gravityEnabled.set(false));
    safe(() => phys.locked.set(true));
    e.position.set(pos);
    e.scale.set(new hz.Vec3(scale, scale, scale));
    e.visible.set(true);
    safe(() => e.collidable.set(true));

    this.tint(e, color, glow || kind === 'neon' || kind === 'pulse' || kind === 'rainbow' || kind === 'flow' || kind === 'aurora');
    if (kind === 'rainbow' || kind === 'flow' || kind === 'aurora' || kind === 'pulse') {
      this.animated.push({ dot: idx, kind, phase: (this.time * 0.6 + idx * 0.013) % 1, color });
    }
    if (this.isVR && this.drawingHand) {
      this.hapticTimer -= 1;
      if (this.hapticTimer <= 0) {
        this.hapticTimer = 3;
        const hand = this.drawingHand === 'left' ? this.player!.leftHand : this.player!.rightHand;
        safe(() => hand.playHaptics(25, hz.HapticStrength.Light, hz.HapticSharpness.Soft));
      }
    }
  }

  private tint(e: hz.Entity, hex: string, glow: boolean) {
    const mesh = e.as(hz.MeshEntity);
    safe(() => mesh.style.tintColor.set(hexToColor(hex)));
    safe(() => mesh.style.tintStrength.set(1));
    safe(() => mesh.style.brightness.set(glow ? this.props.glowBrightness : 1));
  }

  private park(idx: number) {
    const e = this.dots[idx];
    const phys = e.as(hz.PhysicalEntity);
    safe(() => phys.zeroVelocity());
    safe(() => phys.gravityEnabled.set(false));
    safe(() => phys.locked.set(true));
    safe(() => e.collidable.set(false));
    e.visible.set(false);
    e.position.set(this.entity.position.get().add(new hz.Vec3(0, PARK_DEPTH, 0)));
    this.dotStroke[idx] = null;
    this.dotLive[idx] = false;
  }

  private queueDrop(dots: number[]) {
    this.dropQueue.push(...dots);
  }

  private release(idx: number, impulse: hz.Vec3) {
    const e = this.dots[idx];
    const phys = e.as(hz.PhysicalEntity);
    safe(() => phys.locked.set(false));
    safe(() => phys.gravityEnabled.set(true));
    safe(() => phys.applyForce(impulse, hz.PhysicsForceMode.VelocityChange));
  }

  // -------------------------------------------------------------------------------------------
  // Actions from the UI
  // -------------------------------------------------------------------------------------------

  private visibleDots(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.dots.length; i++) if (this.dotLive[i]) out.push(i);
    return out;
  }

  private onAction(action: WorldAction) {
    switch (action) {
      case 'drop':
        this.queueDrop(this.visibleDots());
        this.play(this.props.popSfx);
        break;
      case 'explode': {
        const c = this.entity.position.get();
        for (const i of this.visibleDots()) {
          const d = this.dots[i].position.get().sub(c);
          const len = Math.max(0.2, d.magnitude());
          const out = d.mul(1 / len).add(this.entity.forward.get().mul(0.8)).add(hz.Vec3.up.mul(0.6));
          this.release(i, out.mul(3 + Math.random() * 3));
        }
        this.spark(c);
        this.play(this.props.popSfx);
        break;
      }
      case 'freeze':
        this.dropQueue = [];
        for (const i of this.visibleDots()) {
          const phys = this.dots[i].as(hz.PhysicalEntity);
          safe(() => phys.zeroVelocity());
          safe(() => phys.gravityEnabled.set(false));
          safe(() => phys.locked.set(true));
        }
        break;
      case 'clear':
        this.dropQueue = [];
        this.beamQueue = [];
        this.animated = [];
        for (let i = 0; i < this.dots.length; i++) this.park(i);
        this.strokes = [];
        this.play(this.props.popSfx);
        break;
      case 'undo': {
        const st = this.strokes.pop();
        if (st) {
          st.dots.forEach(i => this.park(i));
          const gone = new Set(st.dots);
          this.animated = this.animated.filter(a => !gone.has(a.dot));
        }
        break;
      }
      case 'leave':
        this.leave();
        break;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  private tick(deltaTime: number) {
    this.time += deltaTime;

    if (this.drawingHand && this.cur) this.extendStroke(this.handTip(this.drawingHand));

    // Beam: "print" queued points onto the board a few per frame, with sparks.
    for (let k = 0; k < 6 && this.beamQueue.length; k++) {
      const b = this.beamQueue.shift()!;
      if (!this.cur) {
        this.cur = { dots: [], physics: false };
        this.strokes.push(this.cur);
      }
      const p = this.boardPoint(b.u, b.v);
      this.placeDot(p, b.color, b.kind, b.size, b.glow);
      if (k === 0 && Math.random() < 0.25) this.spark(p);
      if (!this.beamQueue.length) this.cur = null;
    }

    // Drops are staggered so the network isn't flooded and the art "crumbles" nicely.
    for (let k = 0; k < 10 && this.dropQueue.length; k++) {
      const i = this.dropQueue.shift()!;
      const side = this.entity.forward.get().mul(0.3 + Math.random() * 0.6);
      const jitter = new hz.Vec3((Math.random() - 0.5) * 0.8, Math.random() * 0.8, (Math.random() - 0.5) * 0.8);
      this.release(i, side.add(jitter));
    }

    // Color animation: a budgeted round-robin over animated dots.
    const n = this.animated.length;
    if (n) {
      const budget = Math.min(n, this.props.animatedPerTick);
      for (let k = 0; k < budget; k++) {
        this.animCursor = (this.animCursor + 1) % n;
        const a = this.animated[this.animCursor];
        const e = this.dots[a.dot];
        let hex = a.color;
        const t = this.time;
        switch (a.kind) {
          case 'rainbow': hex = hsvToHex(a.phase + t * 0.35, 0.9, 1); break;
          case 'flow': hex = hsvToHex(hexHue(a.color) + Math.sin(t * 2 + a.phase * 12) * 0.08, 0.8, 1); break;
          case 'aurora': hex = hsvToHex(0.38 + Math.sin(t * 0.7 + a.phase * 8) * 0.17, 0.85, 1); break;
          case 'pulse': {
            const mesh = e.as(hz.MeshEntity);
            const glow = 1 + (Math.sin(t * 6 + a.phase * 6) * 0.5 + 0.5) * this.props.glowBrightness;
            safe(() => mesh.style.brightness.set(glow));
            continue;
          }
        }
        safe(() => e.as(hz.MeshEntity).style.tintColor.set(hexToColor(hex)));
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // FX helpers
  // -------------------------------------------------------------------------------------------

  private spark(p: hz.Vec3) {
    const fx = this.props.sparkFx;
    if (!fx) return;
    fx.position.set(p);
    safe(() => fx.as(hz.ParticleGizmo).play());
  }

  private play(e: hz.Entity | undefined) {
    if (!e) return;
    safe(() => e.as(hz.AudioGizmo).play());
  }
}

function safe(fn: () => void) {
  try {
    fn();
  } catch (_e) {
    // Entity lacks this capability (e.g. not a physics object); skip it.
  }
}

hz.Component.register(DrawingBoardWorld);
