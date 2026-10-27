// horizon-core.d.ts
// LOCAL STUB FOR TYPE-CHECKING ONLY; Horizon Studio provides the real types.
//
// This declares just the subset of 'horizon/core' that the asset-guard runtime
// (Guard, AssetGuard, GuardKeystone, GuardProbe) and the examples touch, so that
// `tsc -p tsconfig.test.json` can type-check runtime/ outside the editor. It is mapped
// in via `paths: { "horizon/core": ["types/horizon-core.d.ts"] }` and is never shipped:
// inside a world the editor's own types/horizon_core.d.ts wins. Shapes follow the
// 2.x typings as far as the research digest confirms them; anything marked [likely]
// there is typed loosely here on purpose, and the runtime feature-detects it anyway.

// The editor compiles scripts with a lib that has `console`; tsconfig.test.json uses
// lib ES2020 only, so the global is declared here rather than by pulling in DOM.
declare global {
  interface Console {
    log(...data: unknown[]): void;
    warn(...data: unknown[]): void;
    error(...data: unknown[]): void;
  }
  var console: Console;
}

// ---- property wrappers -----------------------------------------------------------

export declare class ReadableHorizonProperty<T> {
  get(): T;
}

export declare class HorizonProperty<T> extends ReadableHorizonProperty<T> {
  set(value: T): void;
}

export declare class HorizonSetProperty<T> {
  get(): T[];
  set(values: T[]): void;
  add(value: T): void;
  remove(value: T): void;
  contains(value: T): boolean;
  clear(): void;
  readonly length: number;
}

// ---- math -------------------------------------------------------------------------

export declare class Vec3 {
  x: number;
  y: number;
  z: number;
  constructor(x: number, y: number, z: number);
  static readonly zero: Vec3;
  static readonly one: Vec3;
  static readonly forward: Vec3;
  static readonly up: Vec3;
  static readonly right: Vec3;
  clone(): Vec3;
  add(v: Vec3): Vec3;
  sub(v: Vec3): Vec3;
  mul(scalar: number): Vec3;
  equals(v: Vec3): boolean;
  magnitude(): number;
  normalize(): Vec3;
  toString(): string;
}

export declare class Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
  constructor(x: number, y: number, z: number, w: number);
  static readonly zero: Quaternion;
  static readonly one: Quaternion;
  static readonly i: Quaternion;
  static readonly j: Quaternion;
  static readonly k: Quaternion;
  static fromEuler(euler: Vec3): Quaternion;
  clone(): Quaternion;
  toString(): string;
}

export declare class Color {
  r: number;
  g: number;
  b: number;
  constructor(r: number, g: number, b: number);
  static readonly red: Color;
  static readonly green: Color;
  static readonly blue: Color;
  static readonly white: Color;
  static readonly black: Color;
  clone(): Color;
  toString(): string;
}

// ---- players and entities ----------------------------------------------------------

export declare enum PlayerDeviceType {
  VR = 0,
  Mobile = 1,
  Desktop = 2,
}

export declare class Player {
  readonly id: number;
  readonly name: ReadableHorizonProperty<string>;
  readonly index: ReadableHorizonProperty<number>;
  readonly position: HorizonProperty<Vec3>;
  readonly rotation: HorizonProperty<Quaternion>;
  readonly isInBuildMode: ReadableHorizonProperty<boolean>;
  readonly deviceType: ReadableHorizonProperty<PlayerDeviceType>;
  toString(): string;
}

export declare class Entity {
  readonly id: bigint;
  readonly name: ReadableHorizonProperty<string>;
  readonly position: HorizonProperty<Vec3>;
  readonly rotation: HorizonProperty<Quaternion>;
  readonly scale: HorizonProperty<Vec3>;
  readonly owner: HorizonProperty<Player>;
  readonly tags: HorizonSetProperty<string>;
  constructor(id: bigint);
  exists(): boolean;
  as<T extends Entity>(entityClass: new (id: bigint) => T): T;
  toString(): string;
}

export declare class TextGizmo extends Entity {
  readonly text: HorizonProperty<string>;
}

// ---- assets and spawning ----------------------------------------------------------

export declare class AssetContentData {
  asText(): string;
  asJSON<T = unknown>(): T | null;
}

export declare class Asset {
  readonly id: bigint;
  readonly versionId: bigint;
  constructor(id: bigint, versionId?: bigint);
  as<T extends Asset>(assetClass: new (id: bigint, versionId?: bigint) => T): T;
  fetchAsData(options?: { skipCache: boolean }): Promise<AssetContentData>;
  toString(): string;
}

export declare enum SpawnError {
  None = 0,
  ExceedsCapacity = 1,
  Cancelled = 2,
  InvalidAsset = 3,
  UnauthorizedContent = 4,
  InvalidParams = 5,
  Unknown = 6,
}

export declare enum SpawnState {
  NotReady = 0,
  Unloaded = 1,
  Loading = 2,
  Paused = 3,
  Loaded = 4,
  Spawning = 5,
  Active = 6,
  Unloading = 7,
  Disposed = 8,
}

export declare class SpawnController {
  readonly rootEntities: ReadableHorizonProperty<Entity[]>;
  readonly currentState: ReadableHorizonProperty<SpawnState>;
  readonly spawnError: ReadableHorizonProperty<SpawnError>;
  constructor(asset: Asset, position: Vec3, rotation: Quaternion, scale: Vec3);
  load(): Promise<void>;
  spawn(): Promise<void>;
  pause(): Promise<void>;
  unload(): Promise<void>;
  dispose(): Promise<void>;
}

// ---- world --------------------------------------------------------------------------

export declare class World {
  readonly id: ReadableHorizonProperty<bigint>;
  readonly name: ReadableHorizonProperty<string>;
  getPlayers(): Player[];
  getServerPlayer(): Player;
  getLocalPlayer(): Player;
  getEntitiesWithTags(tags: string[]): Entity[];
  spawnAsset(asset: Asset, position: Vec3, rotation?: Quaternion, scale?: Vec3): Promise<Entity[]>;
  deleteAsset(entity: Entity, fullDelete?: boolean): Promise<undefined>;
}

// ---- events -------------------------------------------------------------------------

export declare class LocalEvent<TPayload extends object = Record<string, never>> {
  readonly name: string;
  constructor(name?: string);
}

export declare class NetworkEvent<TPayload extends object = Record<string, never>> {
  readonly name: string;
  constructor(name: string);
}

export declare class CodeBlockEvent<TPayload extends unknown[]> {
  readonly name: string;
  constructor(name: string, expectedTypes: string[]);
}

export declare const CodeBlockEvents: {
  readonly OnPlayerEnterWorld: CodeBlockEvent<[player: Player]>;
  readonly OnPlayerExitWorld: CodeBlockEvent<[player: Player]>;
  readonly OnPlayerEnterTrigger: CodeBlockEvent<[enteredBy: Player]>;
  readonly OnPlayerExitTrigger: CodeBlockEvent<[exitedBy: Player]>;
  readonly OnEntityEnterTrigger: CodeBlockEvent<[enteredBy: Entity]>;
  readonly OnEntityExitTrigger: CodeBlockEvent<[exitedBy: Entity]>;
  readonly OnGrabStart: CodeBlockEvent<[isRightHand: boolean, player: Player]>;
  readonly OnGrabEnd: CodeBlockEvent<[player: Player]>;
  readonly OnIndexTriggerDown: CodeBlockEvent<[player: Player]>;
  readonly OnIndexTriggerUp: CodeBlockEvent<[player: Player]>;
  readonly OnButton1Down: CodeBlockEvent<[player: Player]>;
  readonly OnButton2Down: CodeBlockEvent<[player: Player]>;
  readonly OnAssetSpawned: CodeBlockEvent<[entity: Entity, asset: Asset]>;
  readonly OnAssetDespawned: CodeBlockEvent<[entity: Entity, asset: Asset]>;
  readonly OnAssetSpawnFailed: CodeBlockEvent<[asset: Asset]>;
};

export declare type EventSubscription = {
  disconnect(): void;
};

// ---- components ---------------------------------------------------------------------

export declare type PropTypeName =
  | 'number'
  | 'string'
  | 'boolean'
  | 'Vec3'
  | 'Color'
  | 'Entity'
  | 'Quaternion'
  | 'Player'
  | 'Asset'
  | 'Array<number>'
  | 'Array<string>'
  | 'Array<boolean>'
  | 'Array<Vec3>'
  | 'Array<Color>'
  | 'Array<Entity>'
  | 'Array<Quaternion>'
  | 'Array<Player>'
  | 'Array<Asset>';

// Each member is typed as its own string literal so that a static
// `propsDefinition = { x: { type: PropTypes.Number, default: 1 } }` keeps the literal and
// `this.props.x` resolves to `number` through PropsFromDefinitions below.
export declare const PropTypes: {
  readonly Number: 'number';
  readonly String: 'string';
  readonly Boolean: 'boolean';
  readonly Vec3: 'Vec3';
  readonly Color: 'Color';
  readonly Entity: 'Entity';
  readonly Quaternion: 'Quaternion';
  readonly Player: 'Player';
  readonly Asset: 'Asset';
  readonly NumberArray: 'Array<number>';
  readonly StringArray: 'Array<string>';
  readonly BooleanArray: 'Array<boolean>';
  readonly Vec3Array: 'Array<Vec3>';
  readonly ColorArray: 'Array<Color>';
  readonly EntityArray: 'Array<Entity>';
  readonly QuaternionArray: 'Array<Quaternion>';
  readonly PlayerArray: 'Array<Player>';
  readonly AssetArray: 'Array<Asset>';
};

// Reference props (Entity, Player, Asset) have no default and arrive as undefined when the
// slot is left empty in the editor, which is why they are typed optional.
export declare type PropTypeFromEnum<T> = T extends 'number'
  ? number
  : T extends 'string'
  ? string
  : T extends 'boolean'
  ? boolean
  : T extends 'Vec3'
  ? Vec3
  : T extends 'Color'
  ? Color
  : T extends 'Quaternion'
  ? Quaternion
  : T extends 'Entity'
  ? Entity | undefined
  : T extends 'Player'
  ? Player | undefined
  : T extends 'Asset'
  ? Asset | undefined
  : T extends 'Array<number>'
  ? number[]
  : T extends 'Array<string>'
  ? string[]
  : T extends 'Array<boolean>'
  ? boolean[]
  : T extends 'Array<Vec3>'
  ? Vec3[]
  : T extends 'Array<Color>'
  ? Color[]
  : T extends 'Array<Quaternion>'
  ? Quaternion[]
  : T extends 'Array<Entity>'
  ? Entity[]
  : T extends 'Array<Player>'
  ? Player[]
  : T extends 'Array<Asset>'
  ? Asset[]
  : unknown;

export declare type PropsFromDefinitions<T> = {
  readonly [K in keyof T]: T[K] extends { type: infer P } ? PropTypeFromEnum<P> : never;
};

export declare type ComponentWithConstructor<TProps> = {
  propsDefinition: TProps;
  new (): Component<any>;
};

export interface IAsync {
  setTimeout(callback: () => void, timeout?: number): number;
  clearTimeout(id: number): void;
  setInterval(callback: () => void, timeout?: number): number;
  clearInterval(id: number): void;
}

// `class X extends Component<typeof X>` is the shape every script uses: the class itself is
// the type argument so that `this.props` is derived from its static `propsDefinition`.
export declare abstract class Component<TComponent = any, TSerializableState = unknown> {
  static propsDefinition: Record<string, unknown>;
  readonly props: TComponent extends { propsDefinition: infer D } ? PropsFromDefinitions<D> : Record<string, unknown>;
  readonly entity: Entity;
  readonly world: World;
  readonly async: IAsync;

  preStart(): void;
  abstract start(): void;
  dispose(): void;
  receiveOwnership(state: TSerializableState | null, fromPlayer: Player, toPlayer: Player): void;
  transferOwnership(fromPlayer: Player, toPlayer: Player): TSerializableState;

  connectCodeBlockEvent<TPayload extends unknown[]>(
    target: Entity | Player,
    event: CodeBlockEvent<TPayload>,
    callback: (...payload: TPayload) => void,
  ): EventSubscription;
  connectLocalEvent<TPayload extends object>(target: Entity, event: LocalEvent<TPayload>, callback: (payload: TPayload) => void): EventSubscription;
  sendLocalEvent<TPayload extends object>(target: Entity, event: LocalEvent<TPayload>, data: TPayload): void;
  connectLocalBroadcastEvent<TPayload extends object>(event: LocalEvent<TPayload>, callback: (payload: TPayload) => void): EventSubscription;
  sendLocalBroadcastEvent<TPayload extends object>(event: LocalEvent<TPayload>, data: TPayload): void;
  connectNetworkEvent<TPayload extends object>(
    target: Entity | Player,
    event: NetworkEvent<TPayload>,
    callback: (payload: TPayload) => void,
  ): EventSubscription;
  sendNetworkEvent<TPayload extends object>(target: Entity | Player, event: NetworkEvent<TPayload>, data: TPayload, players?: Player[]): void;
  connectNetworkBroadcastEvent<TPayload extends object>(event: NetworkEvent<TPayload>, callback: (payload: TPayload) => void): EventSubscription;
  sendNetworkBroadcastEvent<TPayload extends object>(event: NetworkEvent<TPayload>, data: TPayload, players?: Player[]): void;

  static register<TProps>(componentClass: ComponentWithConstructor<TProps>, componentName?: string): void;
}
