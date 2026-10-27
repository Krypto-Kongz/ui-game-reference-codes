// AssetGuard.ts
// The one component the seller drops into the game (server script, execution mode
// Default). It reads the license props, verifies the license on a later frame, publishes
// the result through the Guard registry, keeps an optional status text gizmo up to date,
// warms the encrypted data tables one per timer tick, starts the optional keystone spawn,
// and re-checks every ten minutes on a chained this.async.setTimeout (never setInterval).
//
// Props are exactly license / license2 / license3 / statusText. Policy (grace, keystone id
// and mode, baked license) lives in the generated GuardKey.ts, never in a prop, so a buyer
// cannot widen or misconfigure anything from the editor.
//
// Nothing in here may throw out of preStart()/start(): every step is wrapped, and any
// internal error leaves the guard UNVERIFIED at tier 0 with a console warning while the
// game keeps running on fallbacks. Never brick a legitimate buyer.

import * as hz from 'horizon/core';
import { Guard, GuardState, GuardStateName } from 'Guard';
import { evaluate, liveWorldId, nowSeconds, parseLicense, ParsedLicense, requestCode } from 'GuardCore';
import { BAKED_LICENSE, GRACE_MS, KEYSTONE_ID, KEYSTONE_MODE, PUB_E, PUB_N, SKU } from 'GuardKey';
import { GuardKeystone } from 'GuardKeystone';

const STEP1_MS = 300; // parse on a later frame, never inside start()
const STEP2_MS = 50; // the RSA verify (~22 ms in a slow interpreter) gets its own timer
const WARM_GAP_MS = 40; // one source per tick, at least a frame apart
const KEYSTONE_MS = 2000;
const RECHECK_MS = 600000;

const log = (m: string): void => console.log('[AssetGuard] ' + m);
const short = (s: string): string => (s.length > 12 ? s.slice(0, 12) + '...' : s);

// Network events are [likely] rather than [confirmed], so even constructing them is guarded.
let REQ: hz.NetworkEvent<{ name: string }> | null = null;
let RES: hz.NetworkEvent<{ name: string; json: string }> | null = null;
try {
  REQ = new hz.NetworkEvent<{ name: string }>('hag:req');
  RES = new hz.NetworkEvent<{ name: string; json: string }>('hag:res');
} catch (e) {
  REQ = null;
  RES = null;
}

class AssetGuard extends hz.Component<typeof AssetGuard> {
  static propsDefinition = {
    license: { type: hz.PropTypes.String, default: '' },
    license2: { type: hz.PropTypes.String, default: '' },
    license3: { type: hz.PropTypes.String, default: '' },
    statusText: { type: hz.PropTypes.Entity },
  };

  private raw = '';
  private parsed: ParsedLicense | null = null;
  private live: string | null = null;
  private req = '';
  private keystone: GuardKeystone | null = null;
  private lastState = '';

  preStart(): void {
    try {
      this.raw = this.readLicense();
      Guard.attach(this.world, this.raw);
    } catch (e) {
      log('W00 preStart failed: ' + e);
      try {
        Guard.attach(this.world, '');
      } catch (e2) {
        // the registry still works without a world
      }
    }
  }

  start(): void {
    try {
      this.listen();
      this.later(() => this.step1(), STEP1_MS);
    } catch (e) {
      this.fail(e);
    }
  }

  // The license may be split across three props (editor string limits); the pieces are
  // concatenated in order with whitespace trimmed. Empty props fall back to the baked
  // license from GuardKey.ts, which is '' unless the seller pre-bound this build.
  private readLicense(): string {
    const p: any = this.props || {};
    const parts = [p.license, p.license2, p.license3];
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      const v = parts[i];
      if (typeof v === 'string') out += v.replace(/\s+/g, '');
    }
    if (!out && typeof BAKED_LICENSE === 'string') out = BAKED_LICENSE.replace(/\s+/g, '');
    return out;
  }

  // Every timer callback is wrapped so a throwing step degrades to UNVERIFIED instead of
  // killing the script.
  private later(fn: () => void, ms: number): void {
    try {
      this.async.setTimeout(() => {
        try {
          fn();
        } catch (e) {
          this.fail(e);
        }
      }, ms);
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: any): void {
    log('W00 internal error, running unverified at tier 0: ' + e);
    try {
      Guard.setState(this.make('UNVERIFIED', 0, 'W00', String(e), null));
    } catch (e2) {
      // nothing left to do
    }
  }

  private make(state: GuardStateName, tier: 0 | 1 | 2, code: string, detail: string, buyer: string | null): GuardState {
    return {
      state: state,
      tier: tier,
      code: code,
      detail: detail,
      worldId: this.live,
      requestCode: this.req,
      buyer: buyer,
      verifiedAt: nowSeconds() || 1,
    };
  }

  // Step 1: world id, request code, structural parse. Cheap; no RSA here.
  private step1(): void {
    this.live = liveWorldId(this.world);
    this.req = requestCode(SKU, this.live);
    if (this.live === null) log('W02 world id unreadable; binding falls open to the licensed world');
    if (!this.raw) {
      log('I01 no license, trial mode. Activation request code: ' + this.req);
      this.applyTrial();
      this.afterVerify();
      return;
    }
    this.parsed = parseLicense(this.raw);
    if (!this.parsed.ok) log('E10 ' + this.parsed.detail + ' (license starts ' + short(this.raw) + ')');
    this.later(() => this.step2(), STEP2_MS);
  }

  // Step 2: signature, SKU, world binding and expiry, then publish.
  private step2(): void {
    if (!this.parsed) this.parsed = parseLicense(this.raw);
    const ev = evaluate(this.parsed, PUB_N, PUB_E, SKU, this.live, nowSeconds());
    this.apply(ev);
    this.afterVerify();
  }

  private applyTrial(): void {
    const grace = typeof GRACE_MS === 'number' && GRACE_MS > 0;
    Guard.setState(this.make('TRIAL', grace ? 0 : 1, 'I01', 'no license', null));
    this.status('Trial — activation code: ' + this.req);
    if (grace) {
      this.later(() => {
        if (Guard.state.state === 'TRIAL' && Guard.state.tier === 0) {
          log('I01 grace period over, trial tier 1');
          Guard.setState(this.make('TRIAL', 1, 'I01', 'no license, grace elapsed', null));
        }
      }, GRACE_MS);
    }
  }

  private apply(ev: { state: string; code: string; detail: string }): void {
    const payload = this.parsed && this.parsed.payload ? this.parsed.payload : null;
    const buyer = payload ? payload.n || payload.b || null : null;
    const key = ev.state + '/' + ev.code;
    const changed = key !== this.lastState;
    this.lastState = key;
    if (ev.state === 'LICENSED') {
      if (changed) log('I00 licensed to ' + (buyer || 'buyer'));
      Guard.setState(this.make('LICENSED', 0, 'I00', ev.detail, buyer));
      this.status('Licensed to ' + (buyer || 'buyer'));
    } else if (ev.state === 'MISMATCH') {
      if (changed) {
        const bound = payload ? payload.w.join(', ') : '?';
        log('E12 license is for another world. live world: ' + (this.live || 'NOWID') + ', licensed: ' + bound);
        log('E12 duplicated your world? send this code to the seller for a free re-issue: ' + this.req);
      }
      Guard.setState(this.make('MISMATCH', 1, 'E12', ev.detail, buyer));
      this.status('License is for another world — code: ' + this.req);
    } else if (ev.state === 'EXPIRED') {
      if (changed) log('E13 license expired' + (payload ? ' at ' + payload.e : '') + '; data stays unlocked, policy tier 1');
      Guard.setState(this.make('EXPIRED', 1, 'E13', ev.detail, buyer));
      this.status('License expired — code: ' + this.req);
    } else {
      if (changed) log(ev.code + ' license rejected: ' + ev.detail + '. Trial mode. Request code: ' + this.req);
      Guard.setState(this.make('INVALID', 1, ev.code, ev.detail, buyer));
      this.status('License invalid (' + ev.code + ') — code: ' + this.req);
    }
  }

  // After the first verdict: warm the registered tables one per tick (only when a key can
  // exist), start the keystone, and begin the ten-minute recheck chain.
  private afterVerify(): void {
    const s = Guard.state.state;
    if (s === 'LICENSED' || s === 'EXPIRED') {
      const names = Guard.sources();
      let i = 0;
      const warmNext = (): void => {
        if (i >= names.length) return;
        Guard.warm(names[i++]);
        this.later(warmNext, WARM_GAP_MS);
      };
      this.later(warmNext, WARM_GAP_MS);
    }
    if (KEYSTONE_ID !== '0' && KEYSTONE_MODE !== 'off' && !this.keystone) {
      this.later(() => {
        this.keystone = new GuardKeystone(this);
        this.keystone.start();
      }, KEYSTONE_MS);
    }
    this.later(() => this.recheck(), RECHECK_MS);
  }

  // Periodic re-evaluation: picks up expiry and a world id that becomes readable, and
  // refreshes the status text. Chained timers only (section 5: setInterval has an
  // unresolved non-firing report).
  private recheck(): void {
    try {
      this.live = liveWorldId(this.world);
      this.req = requestCode(SKU, this.live);
      if (!this.raw) {
        const cur = Guard.state;
        this.status('Trial — activation code: ' + this.req);
        Guard.setState(this.make('TRIAL', cur.tier === 2 ? 1 : cur.tier, 'I01', 'no license', null));
      } else {
        this.parsed = parseLicense(this.raw);
        this.apply(evaluate(this.parsed, PUB_N, PUB_E, SKU, this.live, nowSeconds()));
      }
    } catch (e) {
      this.fail(e);
    }
    this.later(() => this.recheck(), RECHECK_MS);
  }

  // Optional status line on a text gizmo wired to the statusText prop. Feature-detected:
  // a missing gizmo, a non-text entity or a changed API all just skip the line.
  private status(text: string): void {
    try {
      const ent: any = this.props.statusText;
      if (!ent || typeof ent.as !== 'function') return;
      const cls: any = (hz as any).TextGizmo;
      if (!cls) return;
      const giz: any = ent.as(cls);
      if (giz && giz.text && typeof giz.text.set === 'function') giz.text.set(text);
    } catch (e) {
      log('status text unavailable: ' + e);
    }
  }

  // Client components (Local/Shared execution) never receive the key; they broadcast
  // 'hag:req' and this server component answers 'hag:res' with the decrypted JSON of that
  // table, or '' when it is not available so the client keeps its trial value.
  private listen(): void {
    try {
      if (!REQ || !RES || typeof this.connectNetworkBroadcastEvent !== 'function') return;
      this.connectNetworkBroadcastEvent(REQ, (p: { name: string }) => this.onRequest(p));
    } catch (e) {
      log('W11 network events unavailable: ' + e);
    }
  }

  private onRequest(p: { name: string }): void {
    try {
      if (!RES || !p || typeof p.name !== 'string' || !p.name) return;
      const none = {};
      const v = Guard.data<any>(p.name, none);
      const json = v === none ? '' : JSON.stringify(v);
      this.sendNetworkBroadcastEvent(RES, { name: p.name, json: json });
    } catch (e) {
      log('W11 reply failed: ' + e);
    }
  }
}

hz.Component.register(AssetGuard);

export { AssetGuard };
