// BibleReaderNpc.ts
// The one shared Reader. Attach to the AI NPC gizmo (execution mode: Default / server).
//
// * Reads Scripture with exact text-to-speech, verse by verse, from a shared queue that every
//   player's panel can add to. Each verse being spoken is broadcast so panels highlight it.
// * Keeps the AI's context on the passage being read or looked at, so spoken questions to the
//   NPC ("What does this verse mean?") are answered against the exact KJV wording.
// * "Explain" asks the AI for a short, text-grounded explanation (when AI is available).
// * Saves each player's bookmarks to a persistent player variable (optional).

import * as hz from 'horizon/core';
import { BibleEvents, ReaderState, IDLE_STATE } from 'BibleShared';
import { NpcVoice } from 'NpcVoice';
import {
  BOOKS, verseText, verseCount, heading, refLabel, spokenRef, speechText, speechSeconds, plainText,
} from 'BibleIndex';

type Job =
  | { kind: 'read'; playerId: number; name: string; b: number; c: number; from: number; to: number }
  | { kind: 'explain'; playerId: number; name: string; b: number; c: number; v: number };

// Guidance for the AI. Also paste a version of this into the NPC gizmo's personality settings.
export const READER_RULES = [
  'You are the Reader, a guide to the King James Version (KJV) of the Bible.',
  'Only discuss the Bible: its text, books, people, places, events, and history.',
  'Be strictly factual. When you quote Scripture, quote the KJV wording exactly and give the reference.',
  'Clearly separate what the text says from interpretation or church tradition, and say which is which.',
  'If the Bible does not say something, or you are not sure, say so plainly. Never invent verses or details.',
  'Do not preach, give personal opinions, or take sides between denominations.',
  'Politely decline questions that are not about the Bible.',
  'Keep answers short: two to four sentences unless asked for more.',
].join(' ');

class BibleReaderNpc extends hz.Component<typeof BibleReaderNpc> {
  static propsDefinition = {
    maxQueue: { type: hz.PropTypes.Number, default: 6 },
    perPlayerQueue: { type: hz.PropTypes.Number, default: 2 },
    maxVersesPerRequest: { type: hz.PropTypes.Number, default: 60 },
    announceReference: { type: hz.PropTypes.Boolean, default: true },
    pauseBetweenVerses: { type: hz.PropTypes.Number, default: 0.35 },
    anyoneCanStop: { type: hz.PropTypes.Boolean, default: true },
    bookmarksVariable: { type: hz.PropTypes.String, default: 'KJVReader:bookmarks' },
  };

  private voice!: NpcVoice;
  private queue: Job[] = [];
  private running = false;
  private stopFlag = false;
  private voiceWarned = false;
  private state: ReaderState = { ...IDLE_STATE };

  start() {
    this.voice = new NpcVoice(this.entity);
    const ev = BibleEvents;
    this.connectNetworkEvent(this.entity, ev.hello, d => this.onHello(d.player));
    this.connectNetworkEvent(this.entity, ev.read, d => this.onRead(d.player, d.b, d.c, d.from, d.to));
    this.connectNetworkEvent(this.entity, ev.stop, d => this.onStop(d.player));
    this.connectNetworkEvent(this.entity, ev.focus, d => this.onFocus(d.player, d.b, d.c, d.v));
    this.connectNetworkEvent(this.entity, ev.explain, d => this.onExplain(d.player, d.b, d.c, d.v));
    this.connectNetworkEvent(this.entity, ev.saveBookmarks, d => this.onSaveBookmarks(d.player, d.keys));
    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerEnterWorld, (_p: hz.Player) => this.refreshAi());
    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerExitWorld, (_p: hz.Player) => this.refreshAi());

    this.voice.setContext('reader_rules', READER_RULES);
    this.refreshAi();
  }

  // -------------------------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------------------------

  private onHello(player: hz.Player) {
    this.broadcast();
    this.loadBookmarks(player);
  }

  private onRead(player: hz.Player, b: number, c: number, from: number, to: number) {
    if (!BOOKS[b] || c < 1 || c > BOOKS[b].chapters.length) return;
    const n = verseCount(b, c);
    from = Math.max(1, Math.min(from || 1, n));
    to = Math.max(from, Math.min(to || n, n));
    const capped = Math.min(to, from + this.props.maxVersesPerRequest - 1);
    if (!this.admit(player)) return;
    this.queue.push({ kind: 'read', playerId: player.id, name: player.name.get(), b, c, from, to: capped });
    if (capped < to) this.notify(player, `Reading verses ${from}-${capped}; request the rest after.`);
    else if (this.running) this.notify(player, `Added ${refLabel(b, c, from, capped)} to the queue.`);
    this.run();
  }

  private onExplain(player: hz.Player, b: number, c: number, v: number) {
    if (!verseText(b, c, v)) return;
    if (!this.state.ai) {
      this.notify(player, 'AI answers are not available for everyone here, so the Reader will read the verse instead.');
      this.onRead(player, b, c, v, v);
      return;
    }
    if (!this.admit(player)) return;
    this.queue.push({ kind: 'explain', playerId: player.id, name: player.name.get(), b, c, v });
    if (this.running) this.notify(player, `The Reader will explain ${refLabel(b, c, v)} next.`);
    this.run();
  }

  private admit(player: hz.Player): boolean {
    if (this.queue.length >= this.props.maxQueue) {
      this.notify(player, 'The reading queue is full. Please try again in a moment.');
      return false;
    }
    const mine = this.queue.filter(j => j.playerId === player.id).length;
    if (mine >= this.props.perPlayerQueue) {
      this.notify(player, 'You already have passages waiting in the queue.');
      return false;
    }
    return true;
  }

  private onStop(player: hz.Player) {
    if (!this.running) return;
    if (!this.props.anyoneCanStop && player.id !== this.state.requesterId) {
      this.notify(player, 'Only the person who asked for this passage can stop it.');
      return;
    }
    this.stopFlag = true;
    this.voice.stop();
  }

  private onFocus(player: hz.Player, b: number, c: number, v: number) {
    const text = verseText(b, c, v);
    if (!text) return;
    this.voice.setContext('viewed_passage',
      `${player.name.get()} is looking at ${refLabel(b, c, v)} (KJV): "${plainText(text)}"`);
  }

  // -------------------------------------------------------------------------------------------
  // Reading loop
  // -------------------------------------------------------------------------------------------

  private async run() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const job = this.queue.shift()!;
      this.stopFlag = false;
      if (job.kind === 'read') await this.read(job);
      else await this.explain(job);
    }
    this.running = false;
    this.state = { ...this.state, state: 'idle', v: 0, queue: 0, requester: '', requesterId: -1 };
    this.broadcast();
  }

  private async read(job: Extract<Job, { kind: 'read' }>) {
    const { b, c, from, to } = job;
    this.passageContext(b, c, from, to);
    this.setState({ state: 'reading', b, c, v: 0, from, to, requester: job.name, requesterId: job.playerId });
    if (this.props.announceReference) {
      await this.say(spokenRef(b, c, from === 1 && to === verseCount(b, c) ? 0 : from, from === to ? 0 : to) + '.');
    }
    for (let v = from; v <= to && !this.stopFlag; v++) {
      this.setState({ v });
      const head = heading(b, c, v);
      if (head) await this.say(head);
      if (this.stopFlag) break;
      await this.say(speechText(verseText(b, c, v)));
      if (v < to) await this.wait(this.props.pauseBetweenVerses);
    }
  }

  private async explain(job: Extract<Job, { kind: 'explain' }>) {
    const { b, c, v } = job;
    this.passageContext(b, c, Math.max(1, v - 2), Math.min(verseCount(b, c), v + 2));
    this.setState({ state: 'reading', b, c, v, from: v, to: v, requester: job.name, requesterId: job.playerId });
    const ok = await this.voice.elicit(
      `${job.name} asked you to explain ${refLabel(b, c, v)}. First read the verse exactly as written in ` +
      `the current passage context. Then, in at most three sentences, explain what the text says using only ` +
      `the verse and its surrounding verses. Label any interpretation as interpretation. If unsure, say so.`);
    if (!ok) {
      // No elicit API: fall back to reading the verse verbatim.
      await this.say(spokenRef(b, c, v) + '.');
      await this.say(speechText(verseText(b, c, v)));
    } else {
      await this.wait(Math.min(20, 4 + speechSeconds(verseText(b, c, v)) * 2));
    }
  }

  private passageContext(b: number, c: number, from: number, to: number) {
    let text = '';
    for (let v = from; v <= to && text.length < 1800; v++) text += `${v} ${plainText(verseText(b, c, v))} `;
    this.voice.setContext('current_passage', `The passage now open is ${refLabel(b, c, from, to)} (KJV): ${text.trim()}`);
  }

  // Speak, then make sure enough time passed for the words to be heard even if the API's promise
  // resolves as speech *starts* (or there is no voice at all).
  private async say(text: string) {
    const t0 = Date.now();
    const ok = await this.voice.speak(text);
    if (!ok && !this.voiceWarned) {
      this.voiceWarned = true;
      console.warn('BibleReaderNpc: NPC speech unavailable; highlighting will still follow the passage.');
    }
    const elapsed = (Date.now() - t0) / 1000;
    const estimate = speechSeconds(text);
    if (elapsed < estimate * 0.6) await this.wait(estimate - elapsed);
  }

  private wait(seconds: number): Promise<void> {
    return new Promise(resolve => this.async.setTimeout(resolve, Math.max(0, seconds) * 1000));
  }

  // -------------------------------------------------------------------------------------------
  // State, AI availability, notices, bookmarks
  // -------------------------------------------------------------------------------------------

  private setState(patch: Partial<ReaderState>) {
    this.state = { ...this.state, ...patch, queue: this.queue.length };
    this.broadcast();
  }

  private broadcast() {
    this.sendNetworkBroadcastEvent(BibleEvents.state, { ...this.state, queue: this.queue.length });
  }

  private async refreshAi() {
    const ok = await this.voice.aiAvailable();
    this.state = {
      ...this.state,
      ai: ok,
      aiNote: ok ? 'Ask the Reader about any passage' : 'Reading aloud only (AI answers unavailable here)',
    };
    this.broadcast();
  }

  private notify(player: hz.Player, text: string) {
    this.sendNetworkBroadcastEvent(BibleEvents.notice, { playerId: player.id, text });
  }

  private loadBookmarks(player: hz.Player) {
    try {
      const stored: any = (this.world as any).persistentStorage?.getPlayerVariable(player, this.props.bookmarksVariable);
      const keys = Array.isArray(stored?.keys) ? stored.keys.map(String).slice(0, 50) : [];
      this.sendNetworkBroadcastEvent(BibleEvents.bookmarks, { playerId: player.id, keys });
    } catch (_e) {
      // Persistent variable not set up; bookmarks last for this visit only.
    }
  }

  private onSaveBookmarks(player: hz.Player, keys: string[]) {
    try {
      (this.world as any).persistentStorage?.setPlayerVariable(player, this.props.bookmarksVariable, { keys: keys.slice(0, 50) });
    } catch (_e) {
      // Persistent variable not set up; ignore.
    }
  }
}

hz.Component.register(BibleReaderNpc);
