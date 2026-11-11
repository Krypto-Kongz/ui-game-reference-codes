// Local typing stub for compile checks only. Horizon Studio provides the real types
// (any world's scripts/types folder). Shaped like horizon/core 2.0.0 as far as the tool uses it.
// Horizon worlds declare console globally; real scripts use console.log everywhere.
declare var console: { log(...args: any[]): void; warn(...args: any[]): void; error(...args: any[]): void };
declare module 'horizon/core' {
  export interface ReadableHorizonProperty<T> { get(): T; }
  export interface WritableHorizonProperty<T, P = never> { set(value: T, options?: P): void; }
  export interface HorizonProperty<T> extends ReadableHorizonProperty<T>, WritableHorizonProperty<T> {}
  export class Vec3 { x: number; y: number; z: number; constructor(x: number, y: number, z: number); }
  export class Entity {
    readonly id: bigint;
    constructor(id: bigint);
    name: HorizonProperty<string>;
    position: HorizonProperty<Vec3>;
    parent: ReadableHorizonProperty<Entity | null>;
    children: ReadableHorizonProperty<Entity[]>;
    exists(): boolean;
    as<T extends Entity>(entityClass: new (id: bigint) => T): T;
  }
  export interface AudioOptions { fade: number; }
  export class AudioGizmo extends Entity {
    volume: WritableHorizonProperty<number, AudioOptions>;
    pitch: WritableHorizonProperty<number>;
    play(options?: AudioOptions): void;
    stop(options?: AudioOptions): void;
  }
  export class World {
    getEntitiesWithTags(tags: string[]): Entity[];
  }
  export interface IAsync { setTimeout(cb: () => void, ms?: number): number; clearTimeout(id: number): void; }
  export abstract class Component<TComponent = any, TProps = any> {
    static propsDefinition: {};
    readonly props: TProps;
    readonly entity: Entity;
    readonly world: World;
    readonly async: IAsync;
    preStart(): void;
    abstract start(): void;
    static register(componentClass: any, name?: string): void;
  }
}
