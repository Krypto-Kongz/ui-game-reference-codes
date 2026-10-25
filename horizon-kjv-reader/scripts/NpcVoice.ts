// NpcVoice.ts
// The only file that talks to Horizon's NPC API (horizon/npc). Everything else calls this wrapper.
//
// Horizon's AI NPC methods are looked up at runtime because their exact names have changed
// between releases and are not all publicly documented. Each capability tries the known
// spellings in order and degrades gracefully:
//   speak(text)            exact text-to-speech, bypassing the AI's own wording
//   stop()                 stop speaking
//   setContext(key, text)  facts the AI should know right now (the passage on screen)
//   perceive(text)         a one-off event the AI is told about
//   elicit(instruction)    ask the AI to say something now (used for "Explain this verse")
//   aiAvailable()          false for players outside the AI NPC regions or under 18
//
// If your build exposes different names, add them to the lists below; nothing else changes.
// Requires: Scripts > Settings > API > enable "horizon/npc", then recompile.

import { Entity } from 'horizon/core';
import * as NpcModule from 'horizon/npc';

type AnyFn = (...args: any[]) => any;

export class NpcVoice {
  private npc: any = null;
  private conv: any = null;
  private aiOk: boolean | null = null;
  readonly log: string[] = [];

  constructor(entity: Entity) {
    const mod: any = NpcModule;
    const NpcClass = mod?.Npc ?? mod?.NPC ?? mod?.default?.Npc;
    try {
      this.npc = NpcClass ? (entity as any).as(NpcClass) : entity;
    } catch (e) {
      this.npc = entity;
      this.note('Npc cast failed: ' + e);
    }
    this.conv = this.npc?.conversation ?? this.npc?.getConversation?.() ?? this.npc;
  }

  private note(msg: string) {
    this.log.push(msg);
    if (this.log.length > 40) this.log.shift();
    console.log('[NpcVoice] ' + msg);
  }

  private find(names: string[]): { fn: AnyFn; self: any } | null {
    for (const target of [this.conv, this.npc]) {
      if (!target) continue;
      for (const n of names) {
        if (typeof target[n] === 'function') return { fn: target[n] as AnyFn, self: target };
      }
    }
    return null;
  }

  /** Speaks exact text. Resolves when the API's promise resolves (or immediately if it has none). */
  async speak(text: string): Promise<boolean> {
    const m = this.find(['speak', 'say', 'speakText']);
    if (!m) {
      this.note('no speak() method found');
      return false;
    }
    try {
      await m.fn.call(m.self, text);
      return true;
    } catch (e) {
      this.note('speak failed: ' + e);
      return false;
    }
  }

  stop() {
    const m = this.find(['stopSpeaking', 'stop', 'cancelSpeech']);
    try {
      m?.fn.call(m.self);
    } catch (e) {
      this.note('stop failed: ' + e);
    }
  }

  setContext(key: string, text: string): boolean {
    const m = this.find(['setDynamicContext', 'setContext', 'addDynamicContext']);
    if (!m) return false;
    try {
      m.fn.call(m.self, key, text);
      return true;
    } catch (e) {
      // AI APIs throw when the instance includes players who can't use AI NPCs.
      this.aiOk = false;
      this.note('setContext failed: ' + e);
      return false;
    }
  }

  perceive(text: string): boolean {
    const m = this.find(['addEventPerception', 'addPerception', 'perceive']);
    if (!m) return false;
    try {
      m.fn.call(m.self, text);
      return true;
    } catch (e) {
      this.note('perceive failed: ' + e);
      return false;
    }
  }

  async elicit(instruction: string): Promise<boolean> {
    const m = this.find(['elicitResponse', 'elicit', 'respond']);
    if (!m) return false;
    try {
      await m.fn.call(m.self, instruction);
      return true;
    } catch (e) {
      this.note('elicit failed: ' + e);
      return false;
    }
  }

  /** Best-effort check that AI conversation works for everyone in this instance. */
  async aiAvailable(): Promise<boolean> {
    const mod: any = NpcModule;
    const checks: (() => any)[] = [
      () => mod?.NpcConversation?.isAiAvailable?.(),
      () => mod?.Npc?.isAiAvailable?.(),
      () => this.conv?.isAiAvailable?.(),
      () => this.npc?.isAiAvailable?.(),
    ];
    for (const check of checks) {
      try {
        const r = await check();
        if (typeof r === 'boolean') return (this.aiOk = r);
      } catch (_e) {
        // try the next spelling
      }
    }
    if (this.aiOk === false) return false;
    // No explicit check exposed: AI counts as available if context can be set without throwing.
    return (this.aiOk = this.setContext('reader_probe', 'The reader is ready.'));
  }
}
