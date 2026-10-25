// BibleShared.ts
// Network events between each player's Bible panel (BibleReaderUI, Shared mode) and the one shared
// reader NPC (BibleReaderNpc, server). Attach to nothing.

import { NetworkEvent, Player } from 'horizon/core';

export type ReaderState = {
  state: 'idle' | 'reading';
  b: number;
  c: number;
  v: number; // verse being spoken now (0 while announcing)
  from: number;
  to: number;
  requester: string;
  requesterId: number;
  queue: number; // passages waiting after this one
  ai: boolean; // Bible Q&A (AI conversation) available for everyone present
  aiNote: string;
};

export const BibleEvents = {
  // panel -> reader (sent to the NPC entity)
  hello: new NetworkEvent<{ player: Player }>('KJV_Hello'),
  read: new NetworkEvent<{ player: Player; b: number; c: number; from: number; to: number }>('KJV_Read'),
  stop: new NetworkEvent<{ player: Player }>('KJV_Stop'),
  focus: new NetworkEvent<{ player: Player; b: number; c: number; v: number }>('KJV_Focus'),
  explain: new NetworkEvent<{ player: Player; b: number; c: number; v: number }>('KJV_Explain'),
  saveBookmarks: new NetworkEvent<{ player: Player; keys: string[] }>('KJV_SaveBookmarks'),
  // reader -> every panel
  state: new NetworkEvent<ReaderState>('KJV_State'),
  bookmarks: new NetworkEvent<{ playerId: number; keys: string[] }>('KJV_Bookmarks'),
  notice: new NetworkEvent<{ playerId: number; text: string }>('KJV_Notice'),
};

export const IDLE_STATE: ReaderState = {
  state: 'idle', b: 0, c: 1, v: 0, from: 0, to: 0, requester: '', requesterId: -1, queue: 0, ai: false, aiNote: '',
};
