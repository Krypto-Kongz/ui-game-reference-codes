# Integration in 10 minutes

You have a game whose scripts hold the real content as constants: wave tables, loot tables, tuning numbers, level layouts. After this, those tables live in encrypted modules that `hag build` makes for each buyer, and your scripts ask the guard for them. In a licensed world they get the real tables; anywhere else they get the trial fallback you chose, and the game keeps running.

The complete result of this page is `examples/ArenaExample.ts`; it compiles under the same rules as the runtime and passes `test/lint-runtime.mjs`.

## Step 1: drop the guard entity (1 minute)

1. Copy everything from `runtime/` (including `runtime/crypto/`) into the world's scripts folder. All scripts in a world share one flat namespace, so the imports (`from 'Sha256'`) resolve as they are.
2. Create an empty object under your game root. Attach `AssetGuard.ts`. Execution mode **Default** (server). It is the only guard entity in the world.
3. Its props, and only these:

| Prop | Type | Use |
|---|---|---|
| `license` | String | The buyer pastes the license here. |
| `license2`, `license3` | String | Overflow when the editor cuts long strings (`hag issue` prints the license already split). |
| `statusText` | Entity | Optional. A Text gizmo that shows `Licensed to Ana`, `Trial — activation code: HAG-REQ-...` or `License is for another world — code: HAG-REQ-...`. |

Nothing else is a prop on purpose: grace, keystone id and mode live in the generated `GuardKey.ts`, so a buyer cannot widen them from the Properties panel.

## Step 2: swap the base class (1 minute)

```ts
import { GuardedComponent } from 'Guard';

class Arena extends GuardedComponent<typeof Arena> {   // was: extends hz.Component<typeof Arena>
  ...
}
```

`this.guard` is now available in every method. `GuardedComponent.preStart()` enrolls the script as a sentinel (a cheap periodic cross-check on the guard's own timers); if you override `preStart()`, call `super.preStart()`.

A script that cannot change its base class (it extends something else, or it is one of the Noesis UI panels) gets the same API with one line in `preStart()`:

```ts
private guard = Guard.for(this);
```

## Step 3: move the protected data out of code (5 minutes)

Put each table in a JSON file and name it in `hag.config.json`:

```json
{
  "sku": "mygame",
  "data": { "waves": "data/waves.json", "tunables": "data/tunables.json" },
  "marks": { "tunables.respawnDelay": [1.9, 2.1], "tunables.critChance": [0.14, 0.16] }
}
```

- `data` names become the names you ask the guard for: `this.guard.data('waves', ...)`.
- `tunables` is a plain `{ "name": number }` object; `this.guard.tune('name', fallback)` reads from it.
- `marks` lists numbers that may vary a little per buyer (a watermark that survives a plaintext dump). Only list values where the slack really does not matter to play.

Keep a **trial** version of every table in code (`examples/data/waves-trial.json` is the pattern). The rule for a trial fallback: enough to evaluate the game, not enough to run a public world. First level only, no boss, no leaderboard tables, no late-game loot. The trial is what every unlicensed, duplicated or tampered copy plays, so make it something you would be happy to give away.

Then replace the constants.

### Before

A wave arena the way most Horizon game scripts are written (the style of `horizon-kjv-reader/scripts/BibleReaderUI.ts`: props, private fields, `start()`, private methods):

```ts
// WaveArena.ts
import * as hz from 'horizon/core';

type Wave = { name: string; enemies: number; intervalMs: number; enemyHp: number; speed: number; boss: boolean };

const WAVES: Wave[] = [
  { name: 'Scouts', enemies: 4, intervalMs: 1800, enemyHp: 20, speed: 1.0, boss: false },
  { name: 'Raiders', enemies: 6, intervalMs: 1500, enemyHp: 30, speed: 1.05, boss: false },
  // ... six more, ending with the boss
  { name: 'The Warden', enemies: 1, intervalMs: 0, enemyHp: 900, speed: 0.8, boss: true },
];
const TUNING = { spawnRate: 1.0, waveDelayMs: 4000, scorePerKill: 10, scorePerWave: 100 };

class WaveArena extends hz.Component<typeof WaveArena> {
  static propsDefinition = {
    banner: { type: hz.PropTypes.Entity },
    autoStart: { type: hz.PropTypes.Boolean, default: true },
  };

  private index = -1;
  private alive = 0;
  private score = 0;

  start(): void {
    if (this.props.autoStart) this.startWave(0);
  }

  private startWave(i: number): void {
    const w = WAVES[i];
    if (!w) return;
    this.index = i;
    this.alive = w.enemies;
    const gap = w.intervalMs / TUNING.spawnRate;
    // ... spawn w.enemies enemies, one every `gap` ms, on this.async.setTimeout
  }

  private onEnemyDown(): void {
    this.alive--;
    this.score += TUNING.scorePerKill;
    if (this.alive > 0) return;
    this.score += TUNING.scorePerWave;
    this.async.setTimeout(() => this.startWave(this.index + 1), TUNING.waveDelayMs);
  }
}

hz.Component.register(WaveArena);
```

Everything a buyer wants is in `WAVES` and `TUNING`, in plain text, in a file they can copy.

### After

The same script, guarded. Changed lines are marked with `// <-`.

```ts
// ArenaExample.ts
import * as hz from 'horizon/core';
import { GuardedComponent, GuardState } from 'Guard';                       // <-

type Wave = { name: string; enemies: number; intervalMs: number; enemyHp: number; speed: number; boss: boolean };

// Only the TRIAL table stays in code (same content as data/waves-trial.json): two waves, no boss.
const TRIAL_WAVES: Wave[] = [                                                 // <-
  { name: 'Scouts', enemies: 4, intervalMs: 1800, enemyHp: 20, speed: 1.0, boss: false },
  { name: 'Raiders', enemies: 6, intervalMs: 1500, enemyHp: 30, speed: 1.05, boss: false },
];
const TRIAL_TUNE = { spawnRate: 1.0, waveDelayMs: 4000, scorePerKill: 10, scorePerWave: 100 }; // <- fallbacks only

class ArenaExample extends GuardedComponent<typeof ArenaExample> {          // <-
  static propsDefinition = {
    banner: { type: hz.PropTypes.Entity },
    autoStart: { type: hz.PropTypes.Boolean, default: true },
  };

  private waves: Wave[] = TRIAL_WAVES;                                        // <-
  private index = -1;
  private alive = 0;
  private score = 0;

  start(): void {
    this.guard.onReady((s: GuardState) => this.onGuardReady(s));             // <-
    this.guard.onTier((tier: number) => { if (tier >= 1) this.setBanner('Trial build'); }); // <-
    this.guard.onKeystone((ents: hz.Entity[] | null) => {                   // <- optional, step 4
      if (!ents) console.log('[Arena] keystone unavailable, using shipped placeholders');
    });
  }

  private onGuardReady(s: GuardState): void {                                // <-
    this.waves = this.guard.data<Wave[]>('waves', TRIAL_WAVES);               // <- real table or the fallback
    if (s.state === 'TRIAL' || s.state === 'MISMATCH') console.log('[Arena] activation code: ' + s.requestCode);
    if (this.props.autoStart && this.index < 0) this.startWave(0);
  }

  private startWave(i: number): void {
    const w = this.waves[i];                                                  // <-
    if (!w) return;
    this.index = i;
    this.alive = w.enemies;
    const rate = this.guard.tune('spawnRate', TRIAL_TUNE.spawnRate);          // <- read when needed, not cached
    const gap = Math.max(100, w.intervalMs / Math.max(0.1, rate));
    // ... spawn w.enemies enemies, one every `gap` ms, on this.async.setTimeout
  }

  private onEnemyDown(): void {
    this.alive--;
    this.score += this.guard.tune('scorePerKill', TRIAL_TUNE.scorePerKill);  // <-
    if (this.alive > 0) return;
    this.score += this.guard.tune('scorePerWave', TRIAL_TUNE.scorePerWave);  // <-
    this.async.setTimeout(() => this.startWave(this.index + 1), this.guard.tune('waveDelayMs', TRIAL_TUNE.waveDelayMs)); // <-
  }
}

hz.Component.register(ArenaExample);
```

That is the whole change: the real tables are gone from the file, the script reads them through `this.guard`, and there is no `if (licensed)` anywhere for anyone to flip.

## Step 4 (optional): keystone (2 minutes)

If the seller configured a keystone (`KEYSTONE_ID` in `GuardKey.ts`), the guard spawns the seller-owned asset about two seconds after start and reports the result:

```ts
this.guard.onKeystone((ents: hz.Entity[] | null) => {
  if (!ents) { /* keep the shipped placeholder props visible */ return; }
  // ents are the root entities of the spawned asset: move them into place, parent, etc.
});
```

`null` means not configured, not available, or failed on every retry. The game must look fine either way; the keystone is an upgrade, never a dependency. Read `KEYSTONE-TEST.md` before you rely on it for anything.

## The API (contract section 4)

Every method is reachable as `this.guard.*` from a `GuardedComponent`, as `Guard.for(this).*` from any component, or as the static `Guard.*`.

| Call | Returns | Notes |
|---|---|---|
| `data<T>(name, fallback)` | `T` | The decrypted table named in `hag.config.json`, or `fallback`. Synchronous. Cached after the first unlock; the first call before `onReady` does the unlock on the spot (slow but correct). Returns the very same `fallback` object when falling back, so `result === fallback` tells you which it was. |
| `tune(name, fallback)` | `number` | `tunables[name]` times the tier factor, always finite. Read it when you need it rather than caching it; at tier 2 the guard swaps individual values for the fallback on purpose. |
| `onReady(cb)` | | `cb(state)` once the verify has run (about 350 ms after start). Called immediately if already ready, and again after a Reset. |
| `ready()` | `Promise<GuardState>` | Same moment as `onReady`. |
| `onTier(cb)` | | `cb(tier)` whenever the tier changes; 0 full, 1 trial policy, 2 tampered/revoked. |
| `onKeystone(cb)` | | `cb(entities | null)` once the keystone spawn settles. |
| `state` | `GuardState` | `{ state, tier, code, detail, worldId, requestCode, buyer, verifiedAt }`. For status lines only; never gate content on it. |
| `enroll(id?)` | | Called for you by `GuardedComponent.preStart()`. |
| `request<T>(name, fallback, cb)` | | For **Local** or **Shared** (client) scripts: see below. |

`GuardState.state` is one of `UNVERIFIED`, `LICENSED`, `TRIAL`, `MISMATCH`, `INVALID`, `EXPIRED`; `code` is the diagnostic (`I00`, `I01`, `E10` to `E14`, `W00`, `W02`).

## Client scripts (Local or Shared execution mode)

Only the server holds the content key. A per-player script (a Noesis panel in Shared mode, a Local controller) asks the server guard for an already-decrypted table and uses the fallback until the reply arrives:

```ts
this.guard.request<Wave[]>('waves', TRIAL_WAVES, (waves, live) => {
  this.waves = waves;      // the real table when live === true, else the fallback
  this.rebuildPanel();
});
```

Under the hood this is a `hag:req` network broadcast answered by `AssetGuard` with `hag:res`; it times out to the fallback after five seconds. On the server it answers locally and synchronously.

## What the console shows after integration

Licensed world:

```
[AssetGuard] I00 licensed to Ana
[Arena] guard LICENSED (I00), 8 waves
[Arena] wave 1/8: Scouts, 4 enemies
[Arena] tier 0
```

No license yet (or a duplicated world with the old license):

```
[AssetGuard] I01 no license, trial mode. Activation request code: HAG-REQ-demo-456-67W9
[Arena] guard TRIAL (I01), 2 waves [trial table]
[Arena] activation code for the seller: HAG-REQ-demo-456-67W9
[Arena] wave 1/2: Scouts, 4 enemies
[Arena] tier 1
```

Any `[AssetGuard] W00 internal error, running unverified at tier 0: ...` line means the runtime hit something unexpected; the game runs with full function on fallbacks and the message is what to send to the seller.

## Rules of thumb

- **Never read `state` to decide what to show the player.** Read data and tunables. A boolean is one line for a cracker to flip; a table is not.
- **Trial content must be real content.** A world that shows an empty arena in trial mode is a broken-looking product; a world that shows two good waves is a demo.
- **Do not call `data()` or `tune()` from a per-frame callback before `onReady`.** Before the first unlock each call tries to unlock (an RSA verify, about 22 ms in a slow interpreter). After `onReady` they are cached lookups and fine to call often.
- **Do not cache tunables across long stretches** if you want tier 2 to mean anything; read them at the point of use.
- **Keep timers on `this.async`.** Global `setTimeout` compiles and never runs in Horizon.
- **Do not touch `GuardKey.ts` or `GuardData_*.ts` by hand.** They are generated; `hag build` replaces them per buyer.
- The runtime rules the guard itself follows (TypeScript 4.7.4, ES2020 minus eval, Proxy and typed arrays, `number[]` bytes, feature detection) are a good standard for your own scripts too; `node test/lint-runtime.mjs <folder>` checks any folder.
