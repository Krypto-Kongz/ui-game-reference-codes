// Local stub of horizon/core for compile + headless tests only. Horizon provides the real types.
declare module 'horizon/core' {
  export interface ReadableHorizonProperty<T> { get(): T; }
  export interface WritableHorizonProperty<T> { set(v: T): void; }
  export class Player { readonly id: number; name: ReadableHorizonProperty<string>; }
  export class Entity { readonly id: bigint; as<T>(c: new (...a: any[]) => T): T; }
  export class NetworkEvent<T> { constructor(name: string); readonly __t?: T; }
  export class LocalEvent<T> { constructor(name?: string); readonly __t?: T; }
  export const CodeBlockEvents: { OnPlayerEnterWorld: any; OnPlayerExitWorld: any };
  export interface PersistentStorage {
    getPlayerVariable(p: Player, key: string): any;
    setPlayerVariable(p: Player, key: string, value: any): void;
  }
  export interface Leaderboards { setScoreForPlayer(name: string, p: Player, score: number, override: boolean): void; }
  export class World {
    getPlayers(): Player[];
    getLocalPlayer(): Player;
    getServerPlayer(): Player;
    persistentStorage: PersistentStorage;
    leaderboards: Leaderboards;
  }
  export interface IAsync {
    setTimeout(cb: () => void, ms?: number): number;
    setInterval(cb: () => void, ms?: number): number;
    clearTimeout(id: number): void;
    clearInterval(id: number): void;
  }
  export abstract class Component<TProps = any> {
    static propsDefinition: any;
    readonly entity: Entity;
    readonly world: World;
    readonly props: any;
    readonly async: IAsync;
    preStart(): void;
    abstract start(): void;
    connectNetworkBroadcastEvent<T>(e: NetworkEvent<T>, cb: (data: T) => void): void;
    sendNetworkBroadcastEvent<T>(e: NetworkEvent<T>, data: T): void;
    connectCodeBlockEvent(target: Entity, e: any, cb: (...a: any[]) => void): void;
    static register(c: any): void;
  }
}
declare module 'horizon/noesis' {
  export class NoesisGizmo { dataContext: any; }
}
declare var console: { log(...a: any[]): void; warn(...a: any[]): void; error(...a: any[]): void };
