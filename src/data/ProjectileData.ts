import type { MaterialId } from './MaterialProperties';

/** Тип формы снаряда/элемента. */
export type ProjectileShape = 'circle' | 'polygon';

export type ProjectileId =
  | 'concrete_impact_ball'
  | 'magnetic_slug'
  | 'drill_bit'
  | 'explosive_charge'
  | 'cutting_pulse'
  | 'light_penetrator'
  | 'drone';

/** Анимационные события снаряда — расширяемый набор, логика их обрабатывает. */
export type ProjectileEffectKind =
  | 'none'
  | 'impact_burst'
  | 'magnet_pull'
  | 'drill_pierce'
  | 'explosion'
  | 'cut_line'
  | 'pierce_streak'
  | 'drone_seek';

export interface ProjectileData {
  readonly id: ProjectileId;
  readonly name: string;
  readonly description: string;
  /** Радиус в метрах (для circle) / половина ширины (для polygon). */
  readonly radius: number;
  readonly mass: number;
  readonly density: number;
  readonly shape: ProjectileShape;
  /** Минимальная скорость запуска при нулевой силе. */
  readonly minSpeed: number;
  /** Скорость при максимальной силе. */
  readonly maxSpeed: number;
  /** Максимальный импульс, который снаряд способен передать за контакт. */
  readonly impulse: number;
  /** Базовая сила повреждения до учёта материала цели. */
  readonly damage: number;
  /** Множитель импульса по материалу цели (ключ — материал). */
  readonly impulseByMaterial: Partial<Record<MaterialId, number>>;
  /** Множитель повреждения по материалу цели. */
  readonly damageByMaterial: Partial<Record<MaterialId, number>>;
  readonly friction: number;
  readonly restitution: number;
  /** Снижение прочности соединений в радиусе действия. */
  readonly connectionBreakRadius: number;
  /** Сила ослабления соединений в радиусе (0..1). */
  readonly connectionWeaken: number;
  /** Максимум отскоков до исчезновения снаряда. */
  readonly maxBounces: number;
  /** Время жизни в секундах; по истечении снаряд исчезает. */
  readonly lifetime: number;
  readonly effect: ProjectileEffectKind;
  /** Линейное затухание (аэродинамическое сопротивление). */
  readonly linearDamping: number;
  readonly trailLength: number;
  /** Скорость смены цвета следа следа (визуальный стиль). */
  readonly trailColor: string;
}

const BALL: ProjectileData = {
  id: 'concrete_impact_ball',
  name: 'Ударный бетонный шар',
  description:
    'Тяжёлый энергоёмкий снаряд. Разбивает стекло, проламывает дерево, ' +
    'пробивает бетон и смещает стальные балки. Слабо отскакивает.',
  radius: 0.34,
  mass: 34,
  density: 8.4,
  shape: 'circle',
  minSpeed: 8,
  maxSpeed: 46,
  impulse: 1250,
  damage: 62,
  impulseByMaterial: {
    glass: 1.6,
    wood: 1.35,
    concrete: 1.0,
    steel: 0.7,
    generator: 0.9,
    ground: 0.4,
  },
  damageByMaterial: {
    glass: 2.2,
    wood: 1.6,
    concrete: 1.0,
    steel: 0.55,
    generator: 1.0,
    ground: 0.3,
  },
  friction: 0.35,
  restitution: 0.16,
  connectionBreakRadius: 1.6,
  connectionWeaken: 0.55,
  maxBounces: 3,
  lifetime: 9,
  effect: 'impact_burst',
  linearDamping: 0.045,
  trailLength: 12,
  trailColor: '#e8823a',
};

/**
 * Реестр снарядов. Зарегистрированы только те, что реализованы в MVP,
 * остальные описаны как задел расширения (см. docs/GAME_DESIGN.md).
 */
const REGISTRY: Partial<Record<ProjectileId, ProjectileData>> = {
  concrete_impact_ball: BALL,
};

export function getProjectile(id: ProjectileId): ProjectileData {
  const data = REGISTRY[id];
  if (!data) throw new Error(`Снаряд "${id}" не зарегистрирован`);
  return data;
}

export function isProjectileRegistered(id: ProjectileId): boolean {
  return Boolean(REGISTRY[id]);
}

export function registeredProjectiles(): ProjectileData[] {
  return Object.values(REGISTRY);
}

/** Планируемые типы снарядов для документации и UI-подсказок. */
export const UPCOMING_PROJECTILES: readonly ProjectileId[] = [
  'magnetic_slug',
  'drill_bit',
  'explosive_charge',
  'cutting_pulse',
  'light_penetrator',
  'drone',
];
