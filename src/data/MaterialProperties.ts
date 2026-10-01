import type { MaterialVisualStyle } from '../render/Palette';

/** Категория получаемого урона. Влияет на масштабирование урона материалом. */
export type DamageKind = 'impact' | 'projectile' | 'collapse' | 'chain' | 'env' | 'critical';

export type MaterialId = 'glass' | 'wood' | 'concrete' | 'steel' | 'generator' | 'ground';

export type BreakStyle = 'shatter' | 'splinter' | 'chunk' | 'bend' | 'none';

export interface MaterialProperties {
  readonly id: MaterialId;
  /** Отображаемое имя для UI и отладки. */
  readonly label: string;
  /** Базовая плотность (кг/м² в 2D-модели). */
  readonly density: number;
  /** Запас прочности элемента до разрушения (условные HP). */
  readonly strength: number;
  /** Коэффициент получаемого урона: <1 — сопротивляется, >1 — уязвим. */
  readonly damageTaken: number;
  /** Передаётся в физический трение фикстуры. */
  readonly friction: number;
  /** Передаётся в физическую упругость фикстуры. */
  readonly restitution: number;
  readonly baseColor: string;
  readonly edgeColor: string;
  readonly visualStyle: MaterialVisualStyle;
  readonly breakStyle: BreakStyle;
  /** Доля импульса, которую материал передаёт соседним элементам. */
  readonly impulseTransfer: number;
  /** Порог энергии удара, выше которого элемент трескается визуально. */
  readonly crackThreshold: number;
  /** Разрушаем ли материал вообще. */
  readonly destructible: boolean;
}

const MATERIALS: Record<MaterialId, MaterialProperties> = {
  glass: {
    id: 'glass',
    label: 'Стекло',
    density: 1.6,
    strength: 18,
    damageTaken: 1.9,
    friction: 0.25,
    restitution: 0.05,
    baseColor: '#7fc9d6',
    edgeColor: '#bfe8ef',
    visualStyle: 'glass',
    breakStyle: 'shatter',
    impulseTransfer: 0.35,
    crackThreshold: 4,
    destructible: true,
  },
  wood: {
    id: 'wood',
    label: 'Дерево',
    density: 0.85,
    strength: 70,
    damageTaken: 1.25,
    friction: 0.62,
    restitution: 0.08,
    baseColor: '#a9763f',
    edgeColor: '#c99657',
    visualStyle: 'wood',
    breakStyle: 'splinter',
    impulseTransfer: 0.55,
    crackThreshold: 22,
    destructible: true,
  },
  concrete: {
    id: 'concrete',
    label: 'Бетон',
    density: 2.6,
    strength: 190,
    damageTaken: 0.78,
    friction: 0.78,
    restitution: 0.02,
    baseColor: '#9aa3a8',
    edgeColor: '#c2cbd0',
    visualStyle: 'concrete',
    breakStyle: 'chunk',
    impulseTransfer: 0.85,
    crackThreshold: 55,
    destructible: true,
  },
  steel: {
    id: 'steel',
    label: 'Сталь',
    density: 3.1,
    strength: 340,
    damageTaken: 0.4,
    friction: 0.45,
    restitution: 0.18,
    baseColor: '#8e9aa6',
    edgeColor: '#c7d3dd',
    visualStyle: 'steel',
    breakStyle: 'bend',
    impulseTransfer: 0.92,
    crackThreshold: 120,
    destructible: true,
  },
  generator: {
    id: 'generator',
    label: 'Генератор',
    density: 4.2,
    strength: 260,
    damageTaken: 0.62,
    friction: 0.6,
    restitution: 0.04,
    baseColor: '#3f9a5a',
    edgeColor: '#7fd3a0',
    visualStyle: 'machine',
    breakStyle: 'chunk',
    impulseTransfer: 0.9,
    crackThreshold: 45,
    destructible: false,
  },
  ground: {
    id: 'ground',
    label: 'Основание',
    density: 6,
    strength: 100000,
    damageTaken: 0,
    friction: 0.85,
    restitution: 0.02,
    baseColor: '#2a3138',
    edgeColor: '#4a545d',
    visualStyle: 'concrete',
    breakStyle: 'none',
    impulseTransfer: 1,
    crackThreshold: Number.POSITIVE_INFINITY,
    destructible: false,
  },
};

export function getMaterial(id: MaterialId): MaterialProperties {
  const material = MATERIALS[id];
  if (!material) throw new Error(`Неизвестный материал: ${id}`);
  return material;
}

export function allMaterials(): MaterialProperties[] {
  return Object.values(MATERIALS);
}

/** Урон с учётом материала и вида повреждения. */
export function computeDamage(
  material: MaterialProperties,
  rawDamage: number,
  kind: DamageKind = 'impact',
): number {
  if (rawDamage <= 0) return 0;
  const kindFactor =
    kind === 'critical' ? 2.5 : kind === 'projectile' ? 1.35 : kind === 'collapse' ? 0.7 : 1;
  const result = rawDamage * material.damageTaken * kindFactor;
  return material.destructible || kind === 'critical' ? result : result * 0.5;
}

/** Порог энергии удара для появления трещин. */
export function crackEnergyFor(material: MaterialProperties, speed: number, mass: number): number {
  const kinetic = 0.5 * mass * speed * speed;
  return kinetic > material.crackThreshold ? kinetic : 0;
}
