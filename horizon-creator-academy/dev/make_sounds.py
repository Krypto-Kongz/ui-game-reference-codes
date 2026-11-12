#!/usr/bin/env python3
# make_sounds.py - synthesized UI sounds for the Creator Academy panel (44.1 kHz mono 16-bit WAV).
# Soft, even-loudness clicks and chimes. Output into ../Sounds.
import sys, os, struct, math, numpy as np

SR = 44100
def wav(path, sig):
    sig = np.clip(sig, -1, 1)
    sig = (sig * 32767).astype('<i2')
    with open(path, 'wb') as f:
        data = sig.tobytes()
        f.write(b'RIFF'); f.write(struct.pack('<I', 36 + len(data))); f.write(b'WAVE')
        f.write(b'fmt '); f.write(struct.pack('<IHHIIHH', 16, 1, 1, SR, SR * 2, 2, 16))
        f.write(b'data'); f.write(struct.pack('<I', len(data))); f.write(data)
    print('wrote', path)

def env(n, a=0.005, d=0.12):
    t = np.arange(n) / SR
    e = np.ones(n)
    ai = int(a * SR); di = n - ai
    e[:ai] = np.linspace(0, 1, ai)
    e[ai:] = np.exp(-np.linspace(0, 1, di) / d)
    return e

def tone(freq, dur, a=0.005, d=0.12, vol=0.5, harm=(1.0,)):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    for i, h in enumerate(harm):
        s += h * np.sin(2 * math.pi * freq * (i + 1) * t)
    s /= sum(harm)
    return s * env(n, a, d) * vol

def main(out):
    os.makedirs(out, exist_ok=True)
    # tap - short soft click
    wav(os.path.join(out, 'SF_tap.wav'), tone(660, 0.09, d=0.05, vol=0.42, harm=(1.0, 0.3)))
    # page - a two-note rise when a new lesson opens
    a = tone(523, 0.10, d=0.07, vol=0.4); b = tone(784, 0.14, d=0.10, vol=0.4)
    page = np.concatenate([a, b]); wav(os.path.join(out, 'SF_page.wav'), page)
    # open - warm confirm chord
    n = int(0.33 * SR); t = np.arange(n) / SR
    chord = sum(np.sin(2 * math.pi * f * t) for f in (523, 659, 784)) / 3 * env(n, 0.006, 0.16) * 0.42
    wav(os.path.join(out, 'SF_open.wav'), chord)
    # correct - bright happy ding
    c = np.concatenate([tone(784, 0.10, d=0.07, vol=0.45), tone(1046, 0.22, d=0.14, vol=0.45, harm=(1.0, 0.25))])
    wav(os.path.join(out, 'SF_correct.wav'), c)
    # wrong - soft low buzz (not harsh)
    n = int(0.22 * SR); t = np.arange(n) / SR
    wrong = (np.sin(2 * math.pi * 196 * t) + 0.5 * np.sin(2 * math.pi * 185 * t)) / 1.5 * env(n, 0.005, 0.10) * 0.4
    wav(os.path.join(out, 'SF_wrong.wav'), wrong)
    # win - three-note fanfare for the quiz result
    win = np.concatenate([tone(523, 0.12, d=0.09, vol=0.44), tone(659, 0.12, d=0.09, vol=0.44),
                          tone(1046, 0.30, d=0.18, vol=0.46, harm=(1.0, 0.3, 0.1))])
    wav(os.path.join(out, 'SF_win.wav'), win)

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '../Sounds')
