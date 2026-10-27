# DEMO ONLY: never use this key for real sales

`demo-private.json` is the private half of the sample RSA-2048 key whose public half is checked in as `runtime/GuardKey.ts` (SKU `demo`). It is published on purpose so that the examples and docs can sign a `demo` license; that also means anyone can.

- A license for SKU `demo` proves nothing.
- Run `hag keygen --sku <your-sku>` for anything you sell. The real private key lives in `.hag/keys/<sku>.json` on your machine, encrypted with `HAG_KEY_PASSPHRASE`, and never in a world, a repository or a message.
- If you regenerate the demo key (`hag keygen --sku demo --out runtime/GuardKey.ts`), this file no longer matches `GuardKey.ts`; regenerate it with the same tool or delete it.

Fields: `sku`, `alg`, `created`, `e` (public exponent), `n` (modulus, base64url, identical to `PUB_N` in `GuardKey.ts`), `encrypted` (`false`), `privateKeyPem` (PKCS#8). These are the fields of a `.hag/keys/<sku>.json` record; copying this file to `$HAG_HOME/keys/demo.json` lets `hag issue --sku demo` sign licenses that the checked-in `GuardKey.ts` accepts.
