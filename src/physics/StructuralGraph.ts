import { WeldJoint, Vec2 } from 'planck';

import type { ConnectionDefinition } from '../data/LevelData';
import { StructuralConnection } from './StructuralConnection';
import type { StructuralElement } from './StructuralElement';

export interface GraphSnapshot {
  readonly totalElements: number;
  readonly totalConnections: number;
  readonly activeConnections: number;
  readonly detachedCount: number;
  readonly detachedIds: readonly string[];
  readonly anchoredCount: number;
  readonly lastComputeMs: number;
  readonly computeCount: number;
  readonly pendingRecompute: boolean;
}

/**
 * Граф конструкции: элементы как узлы, связи как рёбра, основание как корни.
 * Пересчёт выполняется по событию (разрушение), а не каждый кадр.
 */
export class StructuralGraph {
  private readonly elementsById = new Map<string, StructuralElement>();
  private readonly connectionsById = new Map<string, StructuralConnection>();
  private readonly adjacency = new Map<string, Set<string>>();
  private detached = new Set<string>();
  private lastComputeMs = 0;
  private computeCount = 0;
  private pendingRecompute = true;
  private recomputeTimer = 0;
  private readonly recomputeDelay: number;

  constructor(options: { recomputeDelaySeconds?: number } = {}) {
    this.recomputeDelay = options.recomputeDelaySeconds ?? 0.08;
  }

  addElement(element: StructuralElement): void {
    this.elementsById.set(element.id, element);
    let set = this.adjacency.get(element.id);
    if (!set) {
      set = new Set();
      this.adjacency.set(element.id, set);
    }
    this.pendingRecompute = true;
  }

  addConnection(connection: StructuralConnection): void {
    this.connectionsById.set(connection.id, connection);
    const a = this.adjacency.get(connection.aId);
    if (a) a.add(connection.bId);
    const b = this.adjacency.get(connection.bId);
    if (b) b.add(connection.aId);
    this.pendingRecompute = true;
  }

  getElement(id: string): StructuralElement | undefined {
    return this.elementsById.get(id);
  }

  getConnection(id: string): StructuralConnection | undefined {
    return this.connectionsById.get(id);
  }

  get elements(): StructuralElement[] {
    return [...this.elementsById.values()];
  }

  get connections(): StructuralConnection[] {
    return [...this.connectionsById.values()];
  }

  get elementCount(): number {
    return this.elementsById.size;
  }

  get connectionCount(): number {
    return this.connectionsById.size;
  }

  get activeConnectionCount(): number {
    let count = 0;
    for (const c of this.connectionsById.values()) if (!c.isBroken) count++;
    return count;
  }

  get detachedIds(): readonly string[] {
    return [...this.detached];
  }

  get detachedCount(): number {
    return this.detached.size;
  }

  isDetached(id: string): boolean {
    return this.detached.has(id);
  }

  /** Элементы, потерявшие связь с основанием. */
  getDetachedElements(): StructuralElement[] {
    const result: StructuralElement[] = [];
    for (const id of this.detached) {
      const el = this.elementsById.get(id);
      if (el && !el.isDestroyed) result.push(el);
    }
    return result;
  }

  /** Элементы, всё ещё связанные с основанием. */
  getSupportedElements(): StructuralElement[] {
    return this.elements.filter((el) => !this.detached.has(el.id));
  }

  getAnchoredElements(): StructuralElement[] {
    return this.elements.filter((el) => el.anchored);
  }

  /** Соседи элемента по целым связям. */
  getNeighbors(id: string): string[] {
    const set = this.adjacency.get(id);
    if (!set) return [];
    const out: string[] = [];
    for (const neighborId of set) {
      const connection = this.findConnection(id, neighborId);
      if (connection && !connection.isBroken) out.push(neighborId);
    }
    return out;
  }

  findConnection(aId: string, bId: string): StructuralConnection | undefined {
    const set = this.adjacency.get(aId);
    if (!set || !set.has(bId)) return undefined;
    for (const c of this.connectionsById.values()) {
      if (c.isBroken) continue;
      if ((c.aId === aId && c.bId === bId) || (c.aId === bId && c.bId === aId)) return c;
    }
    return undefined;
  }

  getConnectionsFor(elementId: string): StructuralConnection[] {
    return this.connections.filter((c) => c.aId === elementId || c.bId === elementId);
  }

  /**
   * Помечает пересчёт. Сам пересчёт выполняется в update, чтобы пакетные
   * разрушения в одном кадре не вызывали лишнюю работу.
   */
  markDirty(): void {
    this.pendingRecompute = true;
  }

  /** Плановый пересчёт с задержкой. Вызывается каждый кадр. */
  update(dt: number): boolean {
    if (!this.pendingRecompute) return false;
    if (this.recomputeTimer > 0) {
      this.recomputeTimer -= dt;
      return false;
    }
    this.recomputeTimer = this.recomputeDelay;
    this.recompute();
    return true;
  }

  /** Немедленный пересчёт (после завершения разрушения или по запросу). */
  recompute(): GraphSnapshot {
    const start = performance.now();
    const visited = new Set<string>();
    const queue: string[] = [];

    for (const element of this.elementsById.values()) {
      if (element.anchored && !element.isDestroyed) {
        visited.add(element.id);
        queue.push(element.id);
      }
    }

    while (queue.length > 0) {
      const currentId = queue.shift() as string;
      const element = this.elementsById.get(currentId);
      if (element && element.isDestroyed) continue;
      const neighbors = this.adjacency.get(currentId);
      if (!neighbors) continue;
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        const connection = this.findConnection(currentId, neighborId);
        if (!connection) continue;
        const neighbor = this.elementsById.get(neighborId);
        if (!neighbor || neighbor.isDestroyed) continue;
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }

    const nextDetached = new Set<string>();
    for (const element of this.elementsById.values()) {
      if (element.anchored) continue;
      if (element.isDestroyed) continue;
      if (!visited.has(element.id)) nextDetached.add(element.id);
    }

    const newlyDetached: string[] = [];
    for (const id of nextDetached) {
      if (!this.detached.has(id)) newlyDetached.push(id);
    }

    this.detached = nextDetached;
    this.pendingRecompute = false;
    this.computeCount++;
    this.lastComputeMs = performance.now() - start;
    this.lastNewlyDetached = newlyDetached;
    return this.snapshot();
  }

  private lastNewlyDetached: string[] = [];

  /** Элементы, отсоединившиеся именно при последнем пересчёте. */
  consumeNewlyDetached(): string[] {
    if (this.lastNewlyDetached.length === 0) return [];
    const out = this.lastNewlyDetached;
    this.lastNewlyDetached = [];
    return out;
  }

  snapshot(): GraphSnapshot {
    let anchoredCount = 0;
    for (const element of this.elementsById.values()) if (element.anchored) anchoredCount++;
    return {
      totalElements: this.elementsById.size,
      totalConnections: this.connectionsById.size,
      activeConnections: this.activeConnectionCount,
      detachedCount: this.detached.size,
      detachedIds: [...this.detached],
      anchoredCount,
      lastComputeMs: this.lastComputeMs,
      computeCount: this.computeCount,
      pendingRecompute: this.pendingRecompute,
    };
  }

  /** Полный сброс для перезапуска уровня. */
  reset(): void {
    this.detached = new Set();
    this.lastNewlyDetached = [];
    this.pendingRecompute = true;
    this.recomputeTimer = 0;
  }

  destroyJointsFor(elementId: string): void {
    for (const connection of this.getConnectionsFor(elementId)) {
      if (connection.joint) {
        connection.joint = null;
      }
    }
  }
}

/** Создаёт физическое сварное соединение planck между двумя элементами. */
export function createWeldJoint(
  world: { createJoint(joint: WeldJoint): unknown },
  a: StructuralElement,
  b: StructuralElement,
): WeldJoint {
  const pa = a.getPosition();
  const pb = b.getPosition();
  const mid = Vec2((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
  const joint = new WeldJoint(
    {
      frequencyHz: 0,
      dampingRatio: 0,
    },
    a.body,
    b.body,
    mid,
  );
  world.createJoint(joint);
  return joint;
}

/** Собирает связи уровня в объекты {@link StructuralConnection}. */
export function buildConnections(
  definitions: readonly ConnectionDefinition[],
  lookup: (id: string) => StructuralElement | undefined,
): StructuralConnection[] {
  const out: StructuralConnection[] = [];
  for (const def of definitions) {
    const a = lookup(def.a);
    const b = lookup(def.b);
    if (!a || !b) continue;
    out.push(
      new StructuralConnection({
        id: def.id,
        a,
        b,
        kind: def.kind,
        critical: def.critical,
        strength: def.strength,
        breakImpulse: def.breakImpulse,
      }),
    );
  }
  return out;
}
