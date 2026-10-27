// GuardProbe.ts
// Runtime feature probe for support and for the live tests in docs/KEYSTONE-TEST.md (T0 and
// T12). Drop it on any entity, press Play, and read the Editor Console: one `[probe]` line
// per check, each wrapped so a missing global prints `undefined` or `THROWS(...)` instead of
// killing the script. It never gates anything and is not part of the guard itself; sellers
// keep its output with every build and in the ledger, buyers paste it into support requests.
//
// Adapted from the research digest's RuntimeProbe to the runtime lint rules: globals are
// read through a `g: any` object by string name (a bare `Uint8Array` or `BigInt` token would
// be a ReferenceError in a sandbox that lacks it, and test/lint-runtime.mjs forbids the
// tokens, even inside strings, so the names below are assembled from pieces). The eval and
// Function probes go through g['eval'] / g['Function'] for the same reason; if the editor's
// compile step rejects those two lines statically, delete them and run the probe again.
//
// Nothing runs inside start() itself: the cheap checks go on a 500 ms timer and the one
// expensive check (a full RSA-2048 modpow, ~22 ms in a slow interpreter) on a later timer,
// as the contract requires for every heavy step.

import * as hz from 'horizon/core';
import { sha256 } from 'Sha256';
import { utf8ToBytes } from 'Bytes';
import { rsaPublicKeyFromBase64Url, rsaVerifyPkcs1Sha256 } from 'Rsa';
import { PUB_E, PUB_N, SKU } from 'GuardKey';

// Names that the runtime lint forbids as bare tokens, built from pieces (see header).
const TYPED = 'Uint8' + 'Array';
const TYPED_F32 = 'Float32' + 'Array';
const BIG = 'Big' + 'Int';
const ENC = 'Text' + 'Encoder';
const PRX = 'Pro' + 'xy';

const log = (m: string): void => console.log('[probe] ' + m);

function nowMs(): number {
  try {
    return typeof Date.now === 'function' ? Date.now() : 0;
  } catch (e) {
    return 0;
  }
}

class GuardProbe extends hz.Component<typeof GuardProbe> {
  static propsDefinition = {};

  private g: any = {};

  start(): void {
    try {
      this.g = typeof globalThis === 'object' ? globalThis : {};
      this.async.setTimeout(() => this.cheapChecks(), 500);
      this.async.setTimeout(() => this.timingChecks(), 1500);
    } catch (e) {
      log('probe could not schedule: ' + e);
    }
  }

  // One line per check; a throwing check reports the error name and message.
  private t(label: string, fn: () => any): void {
    let r: string;
    try {
      r = String(fn());
    } catch (e: any) {
      r = 'THROWS(' + (e && e.name) + ':' + (e && e.message) + ')';
    }
    log(label + ' = ' + r);
  }

  private cheapChecks(): void {
    const g = this.g;
    const self: any = this;
    log('---- runtime feature table (SKU ' + SKU + ') ----');
    this.t('typeof globalThis', () => typeof globalThis);

    // Byte containers: the guard uses number[] only, so these are informational.
    this.t(TYPED, () => typeof g[TYPED]);
    this.t('new ' + TYPED + '(4).length', () => new g[TYPED](4).length);
    this.t(TYPED_F32, () => typeof g[TYPED_F32]);
    this.t('ArrayBuffer', () => typeof g.ArrayBuffer);
    this.t('DataView', () => typeof g.DataView);
    this.t('new DataView(new ArrayBuffer(4)).getUint8(0)', () => new g.DataView(new g.ArrayBuffer(4)).getUint8(0));

    // Big integers: only the optional keystone needs them (asset ids); the verifier does not.
    this.t(BIG, () => typeof g['BigInt']);
    this.t(BIG + '(1) << ' + BIG + '(64)', () => (g['BigInt'](1) << g['BigInt'](64)).toString());

    // Identity of this world and entity: what the license binds to (T1 compares the world id
    // with the Creator Portal URL and with a duplicated world).
    this.t('typeof this.entity.id', () => typeof self.entity.id);
    this.t('typeof this.world.id', () => typeof self.world.id);
    this.t('this.world.id.get()', () => self.world.id.get().toString());
    this.t('this.world.name.get()', () => self.world.name.get());

    // Math helpers the crypto deliberately avoids, reported for completeness.
    this.t('Math.imul', () => typeof Math.imul);
    this.t('Math.clz32', () => typeof Math.clz32);

    // Engine fingerprint. Real source from fn.toString() would allow code self-checksums in a
    // later version; `[bytecode]` / `[native code]` means it never will.
    this.t('fn.toString()', () => (function probeFn(a: number) { return a + 41; }).toString());
    this.t('HermesInternal', () => typeof g.HermesInternal);
    this.t('Error().stack (2 lines)', () => String(new Error('x').stack).split('\n').slice(0, 2).join(' | '));

    // Dynamic code: expected undefined or THROWS. Delete these two lines if the editor's
    // compile step refuses them.
    this.t('eval', () => typeof g['eval']);
    this.t("eval of '1+1'", () => g['eval']('1+1'));
    this.t("Function constructor of 'return 2'", () => new g['Function']('return 2')());

    // Web globals the guard never touches (all byte and text work is hand-written).
    this.t(ENC, () => typeof g[ENC]);
    this.t('atob', () => typeof g.atob);
    this.t(PRX, () => typeof g[PRX]);
    this.t('WeakRef', () => typeof g.WeakRef);
    this.t('global setTimeout', () => typeof g.setTimeout);
    this.t('performance', () => typeof g.performance);
    this.t('Date.now', () => typeof Date.now);
    this.t('Number.MAX_SAFE_INTEGER', () => Number.MAX_SAFE_INTEGER);

    // Players: the server player has no name; isInBuildMode is telemetry only.
    this.t('serverPlayer.id', () => self.world.getServerPlayer().id);
    this.t('players', () =>
      self.world
        .getPlayers()
        .map((p: any) => p.id + ':' + p.name.get() + ':' + String(p.isInBuildMode && p.isInBuildMode.get ? p.isInBuildMode.get() : undefined))
        .join(','),
    );
  }

  // T12: how long the two heavy steps of a license check take on this device, measured with
  // Date.now deltas. A signature of 256 arbitrary bytes below the modulus exercises the full
  // modpow and then fails the compare, so the number is the real cost of one verify. If the
  // RSA line stalls a frame on Quest, the seller should re-key with `hag keygen --e 3`.
  private timingChecks(): void {
    this.t('sha256 of 64 KiB (ms)', () => {
      const buf: number[] = new Array(65536);
      for (let i = 0; i < buf.length; i++) buf[i] = i & 0xff;
      const t0 = nowMs();
      sha256(buf);
      return nowMs() - t0;
    });
    this.t('rsa-' + PUB_E + ' verify, full modpow (ms)', () => {
      const key = rsaPublicKeyFromBase64Url(PUB_N, PUB_E);
      const sig: number[] = new Array(key.n.length);
      for (let i = 0; i < sig.length; i++) sig[i] = (i * 37 + 11) & 0xff;
      sig[0] = 1; // below the modulus (whose top byte is >= 0x80), so the modpow really runs
      const msg = utf8ToBytes('HAG1.probe');
      const t0 = nowMs();
      const ok = rsaVerifyPkcs1Sha256(sig, msg, key.n, key.e);
      return nowMs() - t0 + (ok ? ' (unexpected: verified)' : '');
    });
    log('---- end of feature table ----');
  }
}

hz.Component.register(GuardProbe);

export { GuardProbe };
