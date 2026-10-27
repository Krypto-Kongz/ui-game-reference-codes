// ArenaExample.ts
// A small wave arena that shows the whole guard integration in one script. The wave table
// and the tunables are NOT in this file: they live in the encrypted GuardData_waves /
// GuardData_tunables modules that `hag build` makes for each buyer, and this script only ever
// asks the guard for them. In the licensed world it gets the real tables; with no license, a
// bad license or a duplicated world it gets the TRIAL_* fallbacks below and keeps running.
//
// Attach to an empty object under the game root, execution mode Default (server). Props:
//   banner      optional Text gizmo for the wave line ("Wave 3: Shieldwall")
//   enemyAsset  optional asset to spawn per enemy (left empty, the arena only logs)
//   spawnPoint  optional entity whose position is used for spawns (default: this entity)
//   autoStart   start wave 1 as soon as the guard reports ready (default true)
//
// Written to the same rules as runtime/ (TypeScript 4.7.4 / ES2020, number[] only, timers
// through this.async, every Horizon call feature-detected in try/catch, start() never throws)
// and checked by test/lint-runtime.mjs. See docs/INTEGRATION.md for the before/after.

import * as hz from 'horizon/core';
import { GuardedComponent, GuardState } from 'Guard';

type Wave = { name: string; enemies: number; intervalMs: number; enemyHp: number; speed: number; boss: boolean };

// Same content as examples/data/waves-trial.json. This is the only wave table that must work
// without a key, so it stays in code. Enough to evaluate the game, not to run a public world:
// two waves, no boss (the docs/INTEGRATION.md rule for every trial fallback).
const TRIAL_WAVES: Wave[] = [
  { name: 'Scouts', enemies: 4, intervalMs: 1800, enemyHp: 20, speed: 1.0, boss: false },
  { name: 'Raiders', enemies: 6, intervalMs: 1500, enemyHp: 30, speed: 1.05, boss: false },
];

// Fallbacks for guard.tune(): used value by value whenever a name is missing from the
// 'tunables' table or the table itself is unavailable. tune() always returns a finite number.
const TRIAL_TUNE = { spawnRate: 1.0, waveDelayMs: 4000, scorePerKill: 10, scorePerWave: 100 };

const log = (m: string): void => console.log('[Arena] ' + m);

class ArenaExample extends GuardedComponent<typeof ArenaExample> {
  static propsDefinition = {
    banner: { type: hz.PropTypes.Entity },
    enemyAsset: { type: hz.PropTypes.Asset },
    spawnPoint: { type: hz.PropTypes.Entity },
    autoStart: { type: hz.PropTypes.Boolean, default: true },
  };

  private waves: Wave[] = TRIAL_WAVES;
  private index = -1; // current wave, -1 before the first
  private alive = 0; // enemies still up in the current wave
  private score = 0;
  private spawned: hz.Entity[] = [];
  private keystone: hz.Entity[] | null = null;
  private waveEvent: hz.NetworkEvent<{ index: number; name: string; enemies: number; boss: boolean }> | null = null;
  private enemyDown: hz.LocalEvent<{ by: number }> | null = null;

  // GuardedComponent.preStart() enrolls this script as a sentinel; do not override it without
  // calling super.preStart().

  start(): void {
    try {
      // Network events are [likely] rather than [confirmed] in the research digest, so even
      // constructing them is guarded; a failure only means no broadcast, never a crash.
      this.waveEvent = new hz.NetworkEvent<{ index: number; name: string; enemies: number; boss: boolean }>('Arena_Wave');
      this.enemyDown = new hz.LocalEvent<{ by: number }>('Arena_EnemyDown');
      this.connectLocalBroadcastEvent(this.enemyDown, (p: { by: number }) => this.onEnemyDown(p.by));
    } catch (e) {
      log('events unavailable: ' + e);
    }
    // The guard verifies on a later frame; until onReady fires, data() would still answer
    // (synchronously, with the real table if it can unlock, else the fallback), but waiting
    // for onReady keeps the first wave from starting on trial data in a licensed world.
    this.guard.onReady((s: GuardState) => this.onGuardReady(s));
    this.guard.onTier((tier: number) => this.onTier(tier));
    this.guard.onKeystone((ents: hz.Entity[] | null) => this.onKeystone(ents));
  }

  // -------------------------------------------------------------------------------------------
  // Guard callbacks
  // -------------------------------------------------------------------------------------------

  private onGuardReady(s: GuardState): void {
    this.waves = this.guard.data<Wave[]>('waves', TRIAL_WAVES);
    const trial = this.waves === TRIAL_WAVES; // data() hands back the fallback object itself
    log('guard ' + s.state + ' (' + s.code + '), ' + this.waves.length + ' waves' + (trial ? ' [trial table]' : ''));
    if (s.state === 'TRIAL' || s.state === 'MISMATCH') log('activation code for the seller: ' + s.requestCode);
    this.setBanner(trial ? 'Trial build: ' + this.waves.length + ' waves' : 'Ready: ' + this.waves.length + ' waves');
    if (this.props.autoStart && this.index < 0) this.startWave(0);
  }

  // Tier 0 = full; 1 = trial policy (no license, mismatch, invalid, expired); 2 = a tampered
  // or revoked build, where the guard itself swaps some values for fallbacks at random.
  private onTier(tier: number): void {
    log('tier ' + tier);
    if (tier >= 1) this.setBanner('Trial build');
  }

  // The optional seller-owned keystone asset (docs/KEYSTONE-TEST.md). null = unavailable or
  // not configured: use whatever shipped with the asset instead.
  private onKeystone(ents: hz.Entity[] | null): void {
    this.keystone = ents;
    log(ents ? 'keystone spawned, ' + ents.length + ' root entities' : 'keystone unavailable, using shipped placeholders');
  }

  // -------------------------------------------------------------------------------------------
  // Waves
  // -------------------------------------------------------------------------------------------

  private startWave(i: number): void {
    const w = this.waves[i];
    if (!w) {
      log('arena cleared, score ' + this.score);
      this.setBanner('Cleared! Score ' + this.score);
      return;
    }
    this.index = i;
    this.alive = w.enemies;
    log('wave ' + (i + 1) + '/' + this.waves.length + ': ' + w.name + ', ' + w.enemies + ' enemies' + (w.boss ? ' (boss)' : ''));
    this.setBanner('Wave ' + (i + 1) + ': ' + w.name);
    // The boss arena's set pieces come from the keystone when it spawned; null means the
    // shipped placeholders stay visible (never a crash, never an empty arena).
    if (w.boss) log(this.keystone && this.keystone.length > 0 ? 'boss arena: keystone set pieces in place' : 'boss arena: keystone not available, shipped placeholders in use');
    try {
      if (this.waveEvent) this.sendNetworkBroadcastEvent(this.waveEvent, { index: i, name: w.name, enemies: w.enemies, boss: w.boss });
    } catch (e) {
      log('broadcast failed: ' + e);
    }
    // Tunables are read when needed, never cached across waves: at tier 2 the guard may
    // answer with the fallback for a while, and a cached copy would hide that on purpose.
    const rate = this.guard.tune('spawnRate', TRIAL_TUNE.spawnRate);
    const gap = Math.max(100, w.intervalMs / Math.max(0.1, rate));
    let n = 0;
    const next = (): void => {
      if (this.index !== i || n >= w.enemies) return;
      n++;
      this.spawnEnemy(w);
      if (n < w.enemies) this.later(next, gap);
    };
    next();
  }

  private spawnEnemy(w: Wave): void {
    const asset = this.props.enemyAsset;
    if (!asset) {
      log('would spawn ' + w.name + ' enemy (hp ' + w.enemyHp + ', speed ' + w.speed + '); set enemyAsset to spawn for real');
      return;
    }
    try {
      const anchor = this.props.spawnPoint || this.entity;
      const pos = anchor.position.get();
      this.world.spawnAsset(asset, pos).then(
        (ents: hz.Entity[]) => {
          for (let k = 0; k < ents.length; k++) this.spawned.push(ents[k]);
        },
        (e: any) => log('spawn failed: ' + e),
      );
    } catch (e) {
      log('spawn unavailable: ' + e);
    }
  }

  // Enemy scripts send Arena_EnemyDown (local broadcast) when they die; `by` is the player id.
  private onEnemyDown(by: number): void {
    if (this.alive <= 0) return;
    this.alive--;
    this.score += this.guard.tune('scorePerKill', TRIAL_TUNE.scorePerKill);
    if (this.alive > 0) return;
    this.score += this.guard.tune('scorePerWave', TRIAL_TUNE.scorePerWave);
    log('wave ' + (this.index + 1) + ' cleared by player ' + by + ', score ' + this.score);
    const wave = this.index;
    this.later(() => {
      if (this.index === wave) this.startWave(wave + 1);
    }, this.guard.tune('waveDelayMs', TRIAL_TUNE.waveDelayMs));
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  // Timers only through this.async (global timers never run in Horizon); a throwing callback
  // is logged instead of taking the script down.
  private later(fn: () => void, ms: number): void {
    try {
      this.async.setTimeout(() => {
        try {
          fn();
        } catch (e) {
          log('timer callback failed: ' + e);
        }
      }, ms);
    } catch (e) {
      log('timer unavailable: ' + e);
    }
  }

  // Feature-detected text gizmo: a missing prop, a non-text entity or a changed API all skip.
  private setBanner(text: string): void {
    try {
      const ent: any = this.props.banner;
      if (!ent || typeof ent.as !== 'function') return;
      const giz: any = ent.as(hz.TextGizmo);
      if (giz && giz.text && typeof giz.text.set === 'function') giz.text.set(text);
    } catch (e) {
      // no banner wired; the console line above is enough
    }
  }

  dispose(): void {
    this.index = -1;
    this.keystone = null;
    for (let k = 0; k < this.spawned.length; k++) {
      try {
        this.world.deleteAsset(this.spawned[k]);
      } catch (e) {
        // already gone
      }
    }
    this.spawned = [];
  }
}

hz.Component.register(ArenaExample);

export { ArenaExample, TRIAL_WAVES };
