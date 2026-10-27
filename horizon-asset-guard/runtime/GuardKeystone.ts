// GuardKeystone.ts
// Optional seller-owned keystone: an asset the seller only *shares* with the buyer, spawned
// by id from the server about two seconds after start. If the platform validates spawns
// against the seller's share state (live tests T4/T5 in docs/KEYSTONE-TEST.md), unsharing
// or erasing that asset switches off the keystone content in every copy at once.
//
// Spawn-error policy (contract section 6): ExceedsCapacity, Unknown, Cancelled, a rejected
// promise and a 20 s timeout are transient and get three retries with 5/15/45 s backoff.
// Only UnauthorizedContent or InvalidAsset on every attempt counts as "unavailable"; even
// then this never touches the license verdict: Guard.setKeystone(null) tells the game to
// use shipped placeholders, and only KEYSTONE_MODE 'degrade' starts a seed-jittered 3 to
// 20 minute clock before tier 2. 'warn' logs and stops. UnauthorizedContent is reported as
// a possible FBS/CMI world-type mismatch, the only observed cause in the wild.
//
// Not a component: AssetGuard constructs it with itself as host so every timer runs on the
// host's this.async and dies with it. Never throws.

import * as hz from 'horizon/core';
import { Guard, guardJitterMs, guardTimeout } from 'Guard';
import { KEYSTONE_ID, KEYSTONE_MODE } from 'GuardKey';

const BACKOFF_MS = [5000, 15000, 45000];
const SPAWN_TIMEOUT_MS = 20000;
const ATTEMPTS = 1 + BACKOFF_MS.length;
const log = (m: string): void => console.log('[GuardKeystone] ' + m);

function errorName(err: any): string {
  try {
    const E: any = (hz as any).SpawnError;
    if (E && typeof err === 'number') {
      for (const k in E) if (E[k] === err && typeof k === 'string' && isNaN(Number(k))) return k;
    }
  } catch (e) {
    // enum unavailable; fall through
  }
  return String(err);
}

export class GuardKeystone {
  private host: any;
  private attempt = 0;
  private hardFails = 0;
  private ctl: any = null;
  private finished = false;

  constructor(host: any) {
    this.host = host;
  }

  start(): void {
    try {
      if (KEYSTONE_ID === '0' || KEYSTONE_MODE === 'off') return;
      // The bare BigInt token is forbidden in runtime code (a missing global would be a
      // ReferenceError); the constructor is looked up by name and feature-detected instead.
      const g: any = typeof globalThis === 'object' ? globalThis : null;
      const B: any = g ? g['BigInt'] : undefined;
      if (typeof B !== 'function') {
        log('W03 keystone skipped: no big integer support in this runtime, cannot build an asset id');
        this.finish(false);
        return;
      }
      if (!(hz as any).SpawnController || !(hz as any).Asset) {
        log('W03 keystone skipped: SpawnController or Asset unavailable');
        this.finish(false);
        return;
      }
      this.attempt = 0;
      this.hardFails = 0;
      this.trySpawn(B);
    } catch (e) {
      log('W03 keystone failed to start: ' + e);
      this.finish(false);
    }
  }

  private position(): any {
    try {
      const p = this.host.entity.position.get();
      if (p) return p;
    } catch (e) {
      // no readable position; spawn at the origin
    }
    try {
      return (hz as any).Vec3.zero || new hz.Vec3(0, 0, 0);
    } catch (e) {
      return new hz.Vec3(0, 0, 0);
    }
  }

  private rotation(): any {
    try {
      return (hz as any).Quaternion.one || new hz.Quaternion(0, 0, 0, 1);
    } catch (e) {
      return new hz.Quaternion(0, 0, 0, 1);
    }
  }

  private scale(): any {
    try {
      return (hz as any).Vec3.one || new hz.Vec3(1, 1, 1);
    } catch (e) {
      return new hz.Vec3(1, 1, 1);
    }
  }

  // One attempt with a fresh controller (a failed controller's state is not trusted for a
  // retry). The first settle wins: the promise, the readable state after it, or the timeout.
  private trySpawn(B: any): void {
    const n = this.attempt;
    let settled = false;
    const settle = (ok: boolean, err: any): void => {
      if (settled || this.finished) return;
      settled = true;
      this.onResult(ok, err, B);
    };
    try {
      this.disposeCtl();
      this.ctl = new hz.SpawnController(new hz.Asset(B(KEYSTONE_ID)), this.position(), this.rotation(), this.scale());
      guardTimeout(this.host, () => settle(false, 'timeout'), SPAWN_TIMEOUT_MS);
      const p: any = this.ctl.spawn();
      if (p && typeof p.then === 'function') {
        p.then(
          () => settle(this.spawnOk(), this.spawnErr()),
          (e: any) => settle(false, this.spawnErr(e)),
        );
      } else {
        settle(this.spawnOk(), this.spawnErr());
      }
      log('spawn attempt ' + (n + 1) + '/' + ATTEMPTS + ' for keystone ' + KEYSTONE_ID);
    } catch (e) {
      settle(false, e);
    }
  }

  private spawnErr(fallback?: any): any {
    try {
      const err = this.ctl.spawnError.get();
      const E: any = (hz as any).SpawnError;
      if (E && err !== E.None) return err;
    } catch (e) {
      // unreadable
    }
    return fallback === undefined ? null : fallback;
  }

  private spawnOk(): boolean {
    const E: any = (hz as any).SpawnError;
    const err = this.spawnErr();
    if (err !== null && !(E && err === E.None)) return false;
    try {
      const S: any = (hz as any).SpawnState;
      const st = this.ctl.currentState.get();
      if (S && st !== S.Active) return false;
    } catch (e) {
      // state unreadable: a resolved spawn() counts as success
    }
    return true;
  }

  private onResult(ok: boolean, err: any, B: any): void {
    if (ok) {
      let ents: any[] = [];
      try {
        ents = this.ctl.rootEntities.get() || [];
      } catch (e) {
        ents = [];
      }
      log('keystone spawned, ' + ents.length + ' root entities');
      this.finished = true;
      Guard.setKeystone(ents);
      return;
    }
    const E: any = (hz as any).SpawnError;
    const hard = !!E && (err === E.UnauthorizedContent || err === E.InvalidAsset);
    if (hard) this.hardFails++;
    let why = errorName(err);
    if (E && err === E.UnauthorizedContent) why += ' (possible FBS/CMI world-type mismatch, not a license problem)';
    log('W03 spawn attempt ' + (this.attempt + 1) + ' failed: ' + why);
    if (this.attempt + 1 < ATTEMPTS) {
      const wait = BACKOFF_MS[this.attempt];
      this.attempt++;
      try {
        guardTimeout(this.host, () => this.trySpawn(B), wait);
        return;
      } catch (e) {
        log('W03 retry timer failed: ' + e);
      }
    }
    this.finish(this.hardFails === ATTEMPTS);
  }

  // Gives up: the game gets null (use shipped placeholders). Only a hard failure on every
  // attempt feeds the degrade clock, and only in 'degrade' mode.
  private finish(unavailable: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.disposeCtl();
    log('W03 keystone unavailable' + (unavailable ? ' (unauthorized or invalid on every attempt)' : ' (transient errors)') + '; placeholders in use');
    try {
      Guard.setKeystone(null);
    } catch (e) {
      // registry unavailable
    }
    if (!unavailable) return;
    if (KEYSTONE_MODE === 'degrade') {
      const delay = guardJitterMs('keystone', 180000, 1200000);
      try {
        guardTimeout(this.host, () => Guard.degrade('keystone unavailable'), delay);
      } catch (e) {
        log('W03 degrade timer failed: ' + e);
      }
    } else {
      log('W03 KEYSTONE_MODE is warn: no content change');
    }
  }

  private disposeCtl(): void {
    const c = this.ctl;
    this.ctl = null;
    if (!c) return;
    try {
      if (typeof c.dispose === 'function') {
        const p: any = c.dispose();
        if (p && typeof p.then === 'function') p.then(undefined, () => undefined);
      }
    } catch (e) {
      // already disposed
    }
  }

  dispose(): void {
    this.finished = true;
    this.disposeCtl();
  }
}
