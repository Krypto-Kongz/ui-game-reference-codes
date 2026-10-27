// templates.mjs
// Loads horizon-asset-guard/templates/*.md and fills `{{NAME}}` placeholders. A placeholder
// with no value becomes an empty string so a template never leaks a raw `{{...}}` to a
// buyer; `{{#if NAME}}...{{/if}}` blocks are kept only when NAME is non-empty.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HagError, TEMPLATES_DIR, readText } from './common.mjs';

export function templatePath(name) {
  return join(TEMPLATES_DIR, name);
}

export function loadTemplate(name) {
  const path = templatePath(name);
  if (!existsSync(path)) throw new HagError('template ' + path + ' is missing');
  return readText(path);
}

export function fillTemplate(text, vars) {
  const v = (k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k]));
  let out = text.replace(/\{\{#if ([A-Z0-9_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (whole, key, body) => (v(key) !== '' ? body : ''));
  out = out.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, key) => v(key));
  return out;
}

export function renderTemplate(name, vars) {
  return fillTemplate(loadTemplate(name), vars);
}
