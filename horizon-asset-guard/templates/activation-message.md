Hi {{BUYER_NAME}},

Here is your license for {{SKU}}, bound to world {{WORLDS}}{{#if EXPIRES}}, valid until {{EXPIRES}}{{/if}}.

How to activate (about one minute):

1. Open your world in Horizon Studio and select the AssetGuard entity (the empty object that has the AssetGuard script).
2. Paste the value(s) below into its properties exactly as given, with no extra spaces or line breaks{{#if SPLIT}} (the license is split into {{SPLIT}} props; each prop takes one chunk){{/if}}:

```
{{LICENSE_BLOCK}}
```

3. Press Reset (or Stop, then Play). The console prints `I00 licensed to {{BUYER_NAME}}` and, if you wired a Text gizmo to the statusText prop, it shows "Licensed to {{BUYER_NAME}}".

Good to know:

- The license only works in the world id(s) above. If you duplicate the world or move the game to another world, press Play there, copy the new `HAG-REQ-...` code from the console and send it to me for a free re-issue (up to 4 of your own worlds per license).
- If the console prints `E10`, a property cut the text: check that every prop holds its whole chunk and that nothing was pasted twice. `E12` means the license is for another world; send me the new request code.
- Until the license is in place the game runs in trial mode: everything works, but with the trial data tables.
- Keep this message: it is your proof of license. The terms are in LICENSE-BUYER.md inside your package (issued {{DATE}}).
