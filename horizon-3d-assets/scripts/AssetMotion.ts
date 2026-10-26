// AssetMotion.ts
// Script-driven motion for the static versions of the Sunbeams and JellyFish assets, so they come
// alive in Horizon even without imported FBX animation. Attach one component per entity.
//
//   JellyFishSwim  - bell pulse (squash/stretch), bob, slow drift loop and spin
//   SunbeamSway    - slow sway/turn and a gentle brightness + length "breathing" shimmer
//   BubbleDrift    - bubbles rise, shrinking away at the top and growing back at the bottom
//
// Setup: on each entity set Motion = Animated (scripted movement) and attach the component.
// Horizon is Y-up; the FBX files were exported with that orientation.

import * as hz from 'horizon/core';

const TAU = Math.PI * 2;

abstract class Ambient<T> extends hz.Component<T> {
  protected basePos = hz.Vec3.zero;
  protected baseRot = hz.Quaternion.one;
  protected baseScale = hz.Vec3.one;
  protected t = 0;

  start() {
    this.basePos = this.entity.position.get();
    this.baseRot = this.entity.rotation.get();
    this.baseScale = this.entity.scale.get();
    this.t = this.phase() * 1000;
    this.connectLocalBroadcastEvent(hz.World.onUpdate, (d: { deltaTime: number }) => {
      this.t += Math.min(d.deltaTime, 0.1);
      this.step(this.t);
    });
  }

  // A negative phase prop means "pick one at random" so copies don't move in unison.
  protected phase(): number {
    const p = (this.props as any).phase as number;
    return p >= 0 ? p : Math.random();
  }

  protected abstract step(t: number): void;
}

export class JellyFishSwim extends Ambient<typeof JellyFishSwim> {
  static propsDefinition = {
    period: { type: hz.PropTypes.Number, default: 3.0 }, // seconds per swim stroke
    pulse: { type: hz.PropTypes.Number, default: 0.14 }, // bell squeeze amount
    bob: { type: hz.PropTypes.Number, default: 0.06 }, // metres of rise per stroke
    driftRadius: { type: hz.PropTypes.Number, default: 0.25 }, // metres; 0 = stay put
    driftPeriod: { type: hz.PropTypes.Number, default: 40 }, // seconds per drift loop
    spinSpeed: { type: hz.PropTypes.Number, default: 5 }, // degrees per second
    phase: { type: hz.PropTypes.Number, default: -1 },
  };

  protected step(t: number) {
    const p = this.props;
    const s = (t / p.period) % 1;
    const k = Math.pow((1 - Math.cos(TAU * s)) / 2, 1.4); // 0..1 contraction
    const b = this.baseScale;
    this.entity.scale.set(new hz.Vec3(b.x * (1 - p.pulse * 0.6 * k), b.y * (1 + p.pulse * 0.45 * k), b.z * (1 - p.pulse * 0.6 * k)));
    const d = (t / p.driftPeriod) * TAU;
    const rise = p.bob * Math.sin(TAU * s - 1.1);
    this.entity.position.set(this.basePos.add(new hz.Vec3(Math.cos(d) * p.driftRadius, rise + Math.sin(d * 2) * p.bob, Math.sin(d) * p.driftRadius)));
    const tilt = hz.Quaternion.fromEuler(new hz.Vec3(3 * Math.sin(TAU * s), t * p.spinSpeed, 2 * Math.cos(TAU * s)));
    this.entity.rotation.set(this.baseRot.mul(tilt));
  }
}

export class SunbeamSway extends Ambient<typeof SunbeamSway> {
  static propsDefinition = {
    period: { type: hz.PropTypes.Number, default: 14 }, // seconds per sway cycle
    swayDegrees: { type: hz.PropTypes.Number, default: 4 },
    turnSpeed: { type: hz.PropTypes.Number, default: 1.5 }, // degrees per second around the vertical
    shimmer: { type: hz.PropTypes.Number, default: 0.3 }, // brightness variation (0 = off)
    phase: { type: hz.PropTypes.Number, default: -1 },
  };

  private mesh: hz.MeshEntity | null = null;

  start() {
    super.start();
    try {
      this.mesh = this.entity.as(hz.MeshEntity);
    } catch (_e) {
      this.mesh = null;
    }
  }

  protected step(t: number) {
    const p = this.props;
    const s = (t / p.period) * TAU;
    const rot = hz.Quaternion.fromEuler(new hz.Vec3(p.swayDegrees * Math.sin(s), t * p.turnSpeed, p.swayDegrees * 0.6 * Math.sin(s * 0.7 + 1)));
    this.entity.rotation.set(this.baseRot.mul(rot));
    const breathe = 1 + 0.03 * Math.sin(s * 1.3);
    const b = this.baseScale;
    this.entity.scale.set(new hz.Vec3(b.x, b.y * breathe, b.z));
    if (this.mesh && p.shimmer > 0) {
      const glow = 1 + p.shimmer * (0.5 + 0.5 * Math.sin(s * 2.1)) * (0.6 + 0.4 * Math.sin(s * 0.37));
      try {
        this.mesh.style.brightness.set(glow);
      } catch (_e) {
        this.mesh = null; // this material doesn't expose brightness; keep the motion only
      }
    }
  }
}

export class BubbleDrift extends Ambient<typeof BubbleDrift> {
  static propsDefinition = {
    riseHeight: { type: hz.PropTypes.Number, default: 2.5 }, // metres risen before looping
    riseSpeed: { type: hz.PropTypes.Number, default: 0.18 }, // metres per second
    sway: { type: hz.PropTypes.Number, default: 0.08 }, // metres of side-to-side wobble
    phase: { type: hz.PropTypes.Number, default: -1 },
  };

  protected step(t: number) {
    const p = this.props;
    const travel = (t * p.riseSpeed) % p.riseHeight;
    const f = travel / p.riseHeight; // 0..1 through the climb
    const env = Math.min(1, f / 0.12) * Math.min(1, (1 - f) / 0.12); // grow in, shrink out: hides the loop
    const b = this.baseScale;
    const sz = Math.max(0.001, env);
    this.entity.scale.set(new hz.Vec3(b.x * sz, b.y * sz, b.z * sz));
    this.entity.position.set(this.basePos.add(new hz.Vec3(p.sway * Math.sin(t * 1.3), travel, p.sway * Math.cos(t * 0.9))));
  }
}

hz.Component.register(JellyFishSwim);
hz.Component.register(SunbeamSway);
hz.Component.register(BubbleDrift);
