#!/usr/bin/env node
// hag.mjs - the horizon-asset-guard seller CLI (contract section 9). Node 18+, no npm
// dependencies; `typescript` is used by `hag doctor` only when it is installed.
// Every command lives in cli/lib/<command>.mjs; this file parses the command name, prints
// usage and turns thrown HagError / UsageError into exit codes (1 and 2).
import { HagError } from './lib/common.mjs';

export const USAGE = `hag - horizon-asset-guard seller CLI (Node 18+, no dependencies)

Usage: hag <command> [options]

State lives in .hag/ under the current directory (or $HAG_HOME): keys/<sku>.json (private
key, PKCS#8 PEM, encrypted when HAG_KEY_PASSPHRASE is set at keygen) and ledger.json.
Back it up; never ship it.

Commands
  keygen --sku <sku> [--e 65537|3] [--out <path to GuardKey.ts>] [--force]
      RSA-2048 keypair via node:crypto; writes/updates GuardKey.ts (keeps the existing
      GRACE_MS / KEYSTONE_ID / KEYSTONE_MODE / BAKED_LICENSE values if the file exists).
  buyer add --sku <sku> --id <buyerId> [--name "<display>"]
      Creates the ledger entry with a random watermark seed (wm) and content key (ck).
  build --sku <sku> --buyer <buyerId> --config <hag.config.json> --out <dir>
        [--runtime <dir>] [--core <GuardCore.ts>] [--guard-key <GuardKey.ts>] [--keep-comments] [--force]
      Reads { "sku", "data": { "<name>": "<path.json>" }, "marks": { "<name>.<path>": [min, max] } },
      watermarks and encrypts every table under the buyer's key, inlines the GuardCore region
      with per-buyer mangled names into <out>/scripts/GuardData_<name>.ts, copies the whole
      runtime/ tree (incl. crypto/) into <out>/scripts/ with a GuardKey.ts for the SKU, and
      writes <out>/BUYER-README.md and <out>/LICENSE-BUYER.md.
  issue --sku <sku> --buyer <buyerId> --req <HAG-REQ-...> [--req <...> up to 4]
        [--unbound] [--expires YYYY-MM-DD] [--json]
      Validates each request code's SKU and check characters, signs the license, appends it
      to the ledger, prints it and the activation message (split into <= 200-char chunks for
      the license / license2 / license3 props when longer than 250 chars).
  verify <license> [--sku <sku>] [--key <GuardKey.ts>] [--json]
      Offline signature check and decoded payload (exit 1 unless LICENSED).
  list [--json]
      Buyers, worlds, issue dates, builds, revocations, keystone-test ages.
  trace <path> [--out <trace-report.md>] [--top <n>] [--json]
      Scans a folder or file for GuardData_* modules or JSON dumps and scores every buyer
      (mangled names, _m keys, slack constants, blob hashes); prints ranked candidates with
      evidence and writes trace-report.md.
  revoke --buyer <id> [--reason "..."]
      Marks the buyer revoked; prints the unshare steps and the Meta IP report checklist.
  report --buyer <id> [--out <file>]
      Writes a Markdown evidence packet from the ledger and the last trace report.
  doctor [--dir <package dir>] [--skip-tsc]
      Runs test/lint-runtime.mjs rules, the size caps and tsc 4.7.4 (if installed) on the
      package (default: runtime/); refuses KEYSTONE_MODE 'degrade' without a keystone-test
      record newer than 90 days for that SKU. Exit 1 on any problem.
  keystone-test --sku <sku> --record "<T4|T5|erase|placed|T9>=<result>" [--record ...] [--note "..."] [--list]
      Stores a dated live-test record for the SKU. T4, T5, erase, placed and T9 are the
      keystone tests that gate KEYSTONE_MODE 'degrade'; T0, T1, T2, T7, T11 and T12 (the rest
      of docs/KEYSTONE-TEST.md) are accepted and kept in the ledger too.
  help [<command>]

Environment
  HAG_HOME             state directory (default ./.hag)
  HAG_KEY_PASSPHRASE   encrypts the private key at keygen; required by issue afterwards
  HAG_SELLER           seller name for LICENSE-BUYER.md / reports when the config has no "seller"
`;

const COMMANDS = {
  keygen: () => import('./lib/keygen.mjs').then((m) => m.keygen),
  buyer: () => import('./lib/buyer.mjs').then((m) => m.buyer),
  build: () => import('./lib/build.mjs').then((m) => m.build),
  issue: () => import('./lib/issue.mjs').then((m) => m.issue),
  verify: () => import('./lib/verify.mjs').then((m) => m.verify),
  list: () => import('./lib/list.mjs').then((m) => m.list),
  trace: () => import('./lib/trace.mjs').then((m) => m.trace),
  revoke: () => import('./lib/revoke.mjs').then((m) => m.revoke),
  report: () => import('./lib/report.mjs').then((m) => m.report),
  doctor: () => import('./lib/doctor.mjs').then((m) => m.doctor),
  'keystone-test': () => import('./lib/keystone.mjs').then((m) => m.keystoneTest),
};

// The usage lines of one command (from the first line naming it to the next command).
export function usageOf(command) {
  const lines = USAGE.split('\n');
  const start = lines.findIndex((l) => l.startsWith('  ' + command + ' ') || l === '  ' + command);
  if (start < 0) return USAGE;
  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith('      ') || lines[end].startsWith('        '))) end++;
  return lines.slice(start, end).join('\n');
}

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    const topic = command === 'help' ? rest[0] : undefined;
    console.log(topic && COMMANDS[topic] ? 'Usage:\n' + usageOf(topic) : USAGE.trimEnd());
    return 0;
  }
  if (command === '--version' || command === 'version') {
    console.log('hag (horizon-asset-guard) 1.0.0');
    return 0;
  }
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    console.error('hag: Node 18 or newer is required (running ' + process.versions.node + ')');
    return 1;
  }
  const load = COMMANDS[command];
  if (!load) {
    console.error('hag: unknown command "' + command + '"\n\n' + USAGE.trimEnd());
    return 2;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log('Usage:\n' + usageOf(command));
    return 0;
  }
  try {
    const run = await load();
    await run(rest);
    return 0;
  } catch (e) {
    if (e instanceof HagError) {
      if (e.message) console.error('hag ' + command + ': ' + e.message);
      if (e.exitCode === 2) console.error('\nUsage:\n' + usageOf(command));
      return e.exitCode;
    }
    console.error('hag ' + command + ': unexpected error: ' + (e && e.stack ? e.stack : e));
    return 1;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
