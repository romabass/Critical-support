import type { MaterialId } from './MaterialProperties';
import type { ProjectileId } from './ProjectileData';
import type { ObjectiveData } from './ObjectiveData';

export type ElementShapeKind = 'box' | 'circle' | 'polygon';

export type ElementRole =
  'block' | 'beam' | 'panel' | 'support' | 'foundation' | 'machine' | 'decoration' | 'ground';

export interface ElementDefinition {
  readonly id: string;
  readonly material: MaterialId;
  readonly shape: ElementShapeKind;
  /** Центр в метрах. */
  readonly x: number;
  readonly y: number;
  /** Габариты: для box — width/height, для circle — radius, для polygon — vertices. */
  readonly width: number;
  readonly height: number;
  readonly radius?: number;
  readonly angle?: number;
  readonly vertices?: readonly { x: number; y: number }[];
  readonly group?: string;
  readonly role: ElementRole;
  /** Несущий элемент: разрушение вызывает пересчёт графа. */
  readonly loadBearing?: boolean;
  /** Критическая опора — при разрушении рушится всё, что выше. */
  readonly critical?: boolean;
  /** Защищаемый объект (генератор). */
  readonly protectable?: boolean;
  /** Собственный запас прочности; если не задан — берётся из материала. */
  readonly health?: number;
  /** Якорь конструкции: считается присоединённым к основанию всегда. */
  readonly anchored?: boolean;
  readonly label?: string;
}

export interface ConnectionDefinition {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  /** Прочность связи в ньютонах. */
  readonly strength?: number;
  /** Тип связи: сварка, болтовое соединение, раствор. */
  readonly kind?: 'weld' | 'bolt' | 'mortar';
  /** Связь считается критической опорой для анализа. */
  readonly critical?: boolean;
  readonly breakImpulse?: number;
}

export interface ZoneDefinition {
  readonly id: string;
  readonly kind: 'red' | 'green';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label?: string;
  /** Предельная масса крупных обломков в красной зоне (кг). */
  readonly maximumDebrisMass?: number;
  /** Минимальная масса для бонуса в зелёной зоне (кг). */
  readonly targetDebrisMass?: number;
}

export interface EnvironmentDefinition {
  readonly groundY: number;
  readonly leftBound: number;
  readonly rightBound: number;
  readonly ceilingY: number;
  /** Ниже этого уровня элемент считается потерянным. */
  readonly killY: number;
  readonly gravity: number;
}

export interface LevelDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly briefing: readonly string[];
  readonly maxShots: number;
  readonly projectileId: ProjectileId;
  readonly launcher: {
    readonly x: number;
    readonly y: number;
    readonly minAngleDeg: number;
    readonly maxAngleDeg: number;
    readonly defaultAngleDeg: number;
    readonly minPower: number;
    readonly maxPower: number;
  };
  readonly environment: EnvironmentDefinition;
  readonly elements: readonly ElementDefinition[];
  readonly connections: readonly ConnectionDefinition[];
  readonly zones: readonly ZoneDefinition[];
  readonly objectives: readonly ObjectiveData[];
  /** Объекты, потеря которых немедленно означают поражение. */
  readonly criticalObjects?: readonly string[];
  /** Порог «крупного» обломка по массе (кг). */
  readonly largeDebrisMass?: number;
  readonly camera?: {
    readonly centerX: number;
    readonly centerY: number;
    readonly zoom?: number;
  };
  readonly parShots?: number;
}

export class LevelValidationError extends Error {
  constructor(
    message: string,
    readonly levelId: string,
  ) {
    super(`Уровень "${levelId}": ${message}`);
    this.name = 'LevelValidationError';
  }
}

const SHOT_LIMIT = 20;
const BOUND_LIMIT = 500;

/** Проверка целостности данных уровня. Вызывается до создания физики. */
export function validateLevel(level: LevelDefinition): void {
  const fail = (message: string): never => {
    throw new LevelValidationError(message, level.id);
  };

  if (!level.id) fail('отсутствует id');
  if (!level.title) fail('отсутствует title');
  if (level.maxShots < 1 || level.maxShots > SHOT_LIMIT) fail('maxShots вне диапазона 1..20');
  if (level.elements.length === 0) fail('нет элементов конструкции');

  const ids = new Set<string>();
  for (const element of level.elements) {
    if (ids.has(element.id)) fail(`дубликат id элемента: ${element.id}`);
    ids.add(element.id);
    if (element.width <= 0 || element.height <= 0)
      fail(`некорректный размер элемента ${element.id}`);
    if (Math.abs(element.x) > BOUND_LIMIT || Math.abs(element.y) > BOUND_LIMIT) {
      fail(`элемент ${element.id} вне разумных границ`);
    }
    if (element.shape === 'circle' && (!element.radius || element.radius <= 0)) {
      fail(`круглый элемент ${element.id} без радиуса`);
    }
  }

  const connectionIds = new Set<string>();
  for (const connection of level.connections) {
    if (connectionIds.has(connection.id)) fail(`дубликат id связи: ${connection.id}`);
    connectionIds.add(connection.id);
    if (!ids.has(connection.a)) fail(`связь ${connection.id}: нет элемента ${connection.a}`);
    if (!ids.has(connection.b)) fail(`связь ${connection.id}: нет элемента ${connection.b}`);
    if (connection.a === connection.b)
      fail(`связь ${connection.id}: соединяет элемент с самим собой`);
  }

  const groups = new Set<string>();
  for (const element of level.elements) {
    if (element.group) groups.add(element.group);
  }

  const zoneIds = new Set<string>();
  for (const zone of level.zones) {
    if (zoneIds.has(zone.id)) fail(`дубликат id зоны: ${zone.id}`);
    zoneIds.add(zone.id);
    if (zone.width <= 0 || zone.height <= 0) fail(`некорректный размер зоны ${zone.id}`);
    if (zone.kind === 'red' && (zone.maximumDebrisMass ?? 0) <= 0) {
      fail(`красная зона ${zone.id} без положительного лимита обломков`);
    }
    if (zone.kind === 'green' && (zone.targetDebrisMass ?? 0) < 0) {
      fail(`зелёная зона ${zone.id} с отрицательной целевой массой`);
    }
  }

  const env = level.environment;
  if (env.gravity <= 0) fail('гравитация должна быть положительной');
  if (env.groundY >= env.ceilingY) fail('groundY должен быть ниже ceilingY');
  if (env.leftBound >= env.rightBound) fail('границы мира некорректны');
  if (env.killY >= env.groundY) fail('killY должен быть ниже groundY');

  for (const element of level.elements) {
    if (element.x < env.leftBound || element.x > env.rightBound) {
      fail(`элемент ${element.id} вне горизонтальных границ мира`);
    }
    if (element.y < env.killY) {
      fail(`элемент ${element.id} ниже killY — он разрушится сразу при старте`);
    }
    if (element.y > env.ceilingY && element.role !== 'ground') {
      fail(`элемент ${element.id} выше потолка мира`);
    }
  }

  for (const objective of level.objectives) {
    if (objective.type === 'destroy_group') {
      const group = objective.group;
      if (!group) fail('цель destroy_group без группы');
      else if (!groups.has(group)) {
        fail(`цель destroy_group ссылается на группу без элементов: ${group}`);
      }
    }
    if (objective.type === 'protect_object' && !objective.objectId) {
      fail('цель protect_object без objectId');
    }
    const protectTarget = objective.objectId;
    if (
      objective.type === 'protect_object' &&
      protectTarget !== undefined &&
      !ids.has(protectTarget)
    ) {
      fail(`protect_object ссылается на несуществующий элемент ${protectTarget}`);
    }
    const zoneTarget = objective.zoneId ?? '';
    if (objective.type === 'zone_debris_limit') {
      if (!zoneTarget) fail('zone_debris_limit без zoneId');
      if (!zoneIds.has(zoneTarget)) fail(`зона ${zoneTarget} не объявлена`);
    }
    if (objective.minimumPercent !== undefined) {
      if (objective.minimumPercent < 0 || objective.minimumPercent > 100) {
        fail('minimumPercent вне 0..100');
      }
    }
    if (objective.maximumDamage !== undefined) {
      if (objective.maximumDamage < 0 || objective.maximumDamage > 100) {
        fail('maximumDamage вне 0..100');
      }
    }
  }

  for (const id of level.criticalObjects ?? []) {
    if (!ids.has(id)) fail(`criticalObject ${id} не найден среди элементов`);
  }
}
