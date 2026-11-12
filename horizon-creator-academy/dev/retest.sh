set -e
../../horizon-asset-guard/node_modules/.bin/tsc -p tsconfig.json
for f in out/*.js; do sed -i -E 's/require\("(Academy[A-Za-z_]*)"\)/require(".\/\1")/g' "$f"; done
node run_test.mjs
