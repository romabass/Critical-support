import { describe, expect, it } from 'vitest';

import {
  LevelValidationError,
  validateLevel,
  type LevelDefinition,
} from '../../src/data/LevelData';
import {
  allMaterials,
  computeDamage,
  getMaterial,
  crackEnergyFor,
} from '../../src/data/MaterialProperties';
import {
  getProjectile,
  registeredProjectiles,
  type ProjectileId,
} from '../../src/data/ProjectileData';
import { LevelManager } from '../../src/levels/LevelManager';

const base = await new LevelManager().load('water_tower_01');

/** structuredClone сохраняет readonly-типы, поэтому мутируем через промежуточный объект. */
function clone(): {
  -readonly [K in keyof LevelDefinition]: LevelDefinition[K] extends readonly (infer U)[]
    ? U[]
    : LevelDefinition[K];
} {
  return structuredClone(base) as never;
}

describe('материалы', () => {
  it('содержит весь набор материалов уровня', () => {
    expect(
      allMaterials()
        .map((m) => m.id)
        .sort(),
    ).toEqual(['concrete', 'generator', 'glass', 'ground', 'steel', 'wood'].sort());
  });

  it('бросает на неизвестный материал', () => {
    expect(() => getMaterial('пластик' as never)).toThrow();
  });

  it('сталь получает меньше урона, чем стекло', () => {
    expect(computeDamage(getMaterial('steel'), 100, 'projectile')).toBeLessThan(
      computeDamage(getMaterial('glass'), 100, 'projectile'),
    );
  });

  it('неразрушимые материалы не доходят до нуля', () => {
    const before = computeDamage(getMaterial('generator'), 100, 'collapse');
    const after = computeDamage(getMaterial('generator'), 100, 'collapse');
    expect(after).toBe(before);
    expect(computeDamage(getMaterial('ground'), 100, 'collapse')).toBe(0);
  });

  it('трещины появляются только при достаточной энергии', () => {
    expect(crackEnergyFor(getMaterial('glass'), 20, 1000)).toBeGreaterThan(0);
    expect(crackEnergyFor(getMaterial('glass'), 0.1, 0.001)).toBe(0);
  });
});

describe('снаряды', () => {
  it('возвращает снаряд уровня', () => {
    expect(getProjectile('concrete_impact_ball').id).toBe('concrete_impact_ball');
  });

  it('бросает на неизвестный снаряд', () => {
    expect(() => getProjectile('rock' as ProjectileId)).toThrow();
  });

  it('ограничивает урон по материалам', () => {
    const p = getProjectile('concrete_impact_ball');
    expect(p.damageByMaterial.glass ?? 0).toBeGreaterThan(p.damageByMaterial.steel ?? 0);
    expect(p.impulseByMaterial.glass ?? 0).toBeGreaterThan(p.impulseByMaterial.steel ?? 0);
    for (const projectile of registeredProjectiles()) {
      expect(projectile.maxSpeed).toBeGreaterThan(projectile.minSpeed);
      expect(projectile.mass).toBeGreaterThan(0);
    }
  });
});

describe('валидация уровня', () => {
  it('принимает эталонный уровень', () => {
    expect(() => validateLevel(base)).not.toThrow();
  });

  it('требует уникальные идентификаторы элементов', () => {
    const level = clone();
    const duplicate = { ...level.elements[1] };
    level.elements.push(duplicate);
    expect(() => validateLevel(level)).toThrow(LevelValidationError);
  });

  it('ловит связи на несуществующие элементы', () => {
    const level = clone();
    level.connections[0] = { ...level.connections[0], b: 'нет_такого' };
    expect(() => validateLevel(level)).toThrow(/нет элемента/);
  });

  it('ловит самоссылающуюся связь', () => {
    const level = clone();
    const id = level.elements[1].id;
    level.connections[0] = { id: 'c_self', a: id, b: id, kind: 'weld', strength: 100 };
    expect(() => validateLevel(level)).toThrow();
  });

  it('ловит некорректные размеры и координаты', () => {
    const level = clone();
    level.elements[1] = { ...level.elements[1], width: 0, height: -2 };
    expect(() => validateLevel(level)).toThrow();
  });

  it('ловит цель на неизвестную группу', () => {
    const level = clone();
    level.objectives = [
      { type: 'destroy_group', group: 'несуществующая', minimumPercent: 80, label: 'x', weight: 1 },
    ];
    expect(() => validateLevel(level)).toThrow();
  });

  it('ловит красную зону без лимита', () => {
    const level = clone();
    level.zones = level.zones.map((z) => (z.kind === 'red' ? { ...z, maximumDebrisMass: 0 } : z));
    expect(() => validateLevel(level)).toThrow();
  });

  it('ловит объект вне игровой области по killY', () => {
    const level = clone();
    level.environment = { ...level.environment, killY: 40 };
    expect(() => validateLevel(level)).toThrow();
  });

  it('требует положительные задержки и лимиты', () => {
    const level = clone();
    level.zones = level.zones.map((z) => (z.kind === 'red' ? { ...z, maximumDebrisMass: 0 } : z));
    expect(() => validateLevel(level)).toThrow();
  });
});

describe('LevelManager', () => {
  it('возвращает зарегистрированные уровни', async () => {
    const manager = new LevelManager();
    expect(manager.levelIds).toContain('water_tower_01');
    expect(manager.has('water_tower_01')).toBe(true);
    expect(manager.has('нет_такого')).toBe(false);
    expect(manager.defaultLevelId).toBe('water_tower_01');
  });

  it('кэширует загруженный уровень', async () => {
    const manager = new LevelManager();
    const first = await manager.load();
    const second = await manager.load();
    expect(first).toBe(second);
    expect(manager.getLoaded('water_tower_01')).toBe(first);
  });

  it('бросает на незарегистрированный уровень', async () => {
    await expect(new LevelManager().load('нет_такого')).rejects.toThrow();
  });

  it('уровень соответствует заявленному числу запусков', () => {
    expect(base.maxShots).toBe(3);
    expect(base.launcher.minPower).toBeLessThan(base.launcher.maxPower);
    expect(base.zones.some((z) => z.kind === 'red')).toBe(true);
    expect(base.zones.some((z) => z.kind === 'green')).toBe(true);
  });
});
