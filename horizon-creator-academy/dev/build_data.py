#!/usr/bin/env python3
# build_data.py - turns dev/content/*.json into ASCII TypeScript data modules the panel uses.
# Splits per section so each script stays well under the 40 KB Horizon limit.
#   python3 build_data.py <content_dir> <scripts_dir>
import sys, os, json, re

ORDER = ['blender', 'photoshop', 'canva', 'horizon']
COLORS = {'blender': 'E87D0D', 'photoshop': '31A8FF', 'canva': '7D2AE8', 'horizon': '0A84FF'}
LEVELS = {'Start': '2EB88A', 'Build': 'F0A828', 'Pro': 'E24C5C'}

def esc(s):
    s = str(s)
    try:
        s.encode('ascii')
    except UnicodeEncodeError:
        raise SystemExit('NON-ASCII in content: ' + repr(s))
    return s.replace('\\', '\\\\').replace("'", "\\'")

def lesson_ts(l):
    steps = ', '.join("'" + esc(x) + "'" for x in l['steps'])
    kw = ', '.join("'" + esc(x) + "'" for x in l.get('keywords', []))
    ch = ', '.join("'" + esc(x) + "'" for x in l['quiz']['choices'])
    lvl = l.get('level', 'Build')
    return ("  { id: '%s', title: '%s', subtitle: '%s', level: '%s', levelColor: '%s', minutes: %d,\n"
            "    img: '%s.png', steps: [%s], tip: '%s', keywords: [%s],\n"
            "    quiz: { q: '%s', choices: [%s], answer: %d } }") % (
        esc(l['id']), esc(l['title']), esc(l['subtitle']), esc(lvl), LEVELS.get(lvl, 'F0A828'),
        int(l.get('minutes', 2)), esc(l['id']), steps, esc(l.get('tip', '')), kw,
        esc(l['quiz']['q']), ch, int(l['quiz']['answer']))

def main(content_dir, scripts_dir):
    os.makedirs(scripts_dir, exist_ok=True)
    present = []
    for key in ORDER:
        path = os.path.join(content_dir, key + '.json')
        if not os.path.exists(path):
            print('skip (missing):', key)
            continue
        data = json.load(open(path))
        lessons = data['lessons']
        body = ',\n'.join(lesson_ts(l) for l in lessons)
        mod = ("// AcademyData_%s.ts - generated. Library script (do not attach). Plain ASCII.\n"
               "import { Section } from 'AcademyTypes';\n\n"
               "export const SECTION_%s: Section = {\n"
               "  key: '%s', label: '%s', color: '%s', blurb: '%s',\n"
               "  lessons: [\n%s\n  ]\n};\n") % (
            key.capitalize(), key.upper(), key, esc(data.get('label', key.capitalize())),
            COLORS[key], esc(data.get('blurb', '')), body)
        out = os.path.join(scripts_dir, 'AcademyData_%s.ts' % key.capitalize())
        open(out, 'w').write(mod)
        print('wrote %s (%d lessons, %d bytes)' % (out, len(lessons), len(mod)))
        present.append(key)

    # types module
    types = ("// AcademyTypes.ts - shared types for the Academy data + panel. Library script.\n"
             "export interface Quiz { q: string; choices: string[]; answer: number; }\n"
             "export interface Lesson {\n"
             "  id: string; title: string; subtitle: string; level: string; levelColor: string;\n"
             "  minutes: number; img: string; steps: string[]; tip: string; keywords: string[]; quiz: Quiz;\n"
             "}\n"
             "export interface Section { key: string; label: string; color: string; blurb: string; lessons: Lesson[]; }\n")
    open(os.path.join(scripts_dir, 'AcademyTypes.ts'), 'w').write(types)

    # index assembler
    imports = '\n'.join("import { SECTION_%s } from 'AcademyData_%s';" % (k.upper(), k.capitalize()) for k in present)
    arr = ', '.join('SECTION_' + k.upper() for k in present)
    idx = ("// AcademyData.ts - assembles every section. Library script (do not attach).\n"
           "import { Section } from 'AcademyTypes';\n%s\n\n"
           "export const SECTIONS: Section[] = [%s];\n") % (imports, arr)
    open(os.path.join(scripts_dir, 'AcademyData.ts'), 'w').write(idx)
    print('wrote index with sections:', present)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
