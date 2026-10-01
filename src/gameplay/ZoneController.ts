import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import { clamp } from '../core/MathUtils';
import type { ZoneDefinition } from '../data/LevelData';

export type ZoneKind = 'red' | 'green';

export interface ZoneRuntime {
  readonly definition: ZoneDefinition;
  debrisMass: number;
  largeDebrisMass: number;
  debrisCount: number;
  projectileHits: number;
  /** Суммарная энергия попаданий снарядов — используется как «ущерб зоне». */
  impactEnergy: number;
  breached: boolean;
  /** Идентификаторы учтённых обломков: защита от двойного счёта. */
  registeredIds: Set<string>;
}

export interface ZoneStatus {
  readonly id: string;
  readonly kind: ZoneKind;
  readonly label: string;
  readonly debrisMass: number;
  readonly debrisCount: number;
  readonly largeDebrisMass: number;
  readonly projectileHits: number;
  readonly limit: number | null;
  readonly fillRatio: number;
  readonly breached: boolean;
  readonly rect: { x: number; y: number; width: number; height: number };
}

/**
 * Контроль зон: красная (опасность) и зелёная (безопасная).
 * Считает массу обломков, попадания снарядов и переполнение.
 */
export class ZoneController {
  private readonly zones = new Map<string, ZoneRuntime>();

  constructor(
    definitions: readonly ZoneDefinition[],
    private readonly events: EventBus<GameEvents>,
  ) {
    for (const def of definitions) {
      this.zones.set(def.id, {
        definition: def,
        debrisMass: 0,
        largeDebrisMass: 0,
        debrisCount: 0,
        projectileHits: 0,
        impactEnergy: 0,
        breached: false,
        registeredIds: new Set<string>(),
      });
    }
  }

  get all(): ZoneRuntime[] {
    return [...this.zones.values()];
  }

  get(id: string): ZoneRuntime | undefined {
    return this.zones.get(id);
  }

  get definitions(): ZoneDefinition[] {
    return this.all.map((z) => z.definition);
  }

  get redZones(): ZoneRuntime[] {
    return this.all.filter((z) => z.definition.kind === 'red');
  }

  get greenZones(): ZoneRuntime[] {
    return this.all.filter((z) => z.definition.kind === 'green');
  }

  /** Регистрирует осевший обломок в зоне (обломок входит в счёт один раз). */
  registerDebris(zoneId: string, mass: number, isLarge: boolean, debrisId: string): void {
    const zone = this.zones.get(zoneId);
    if (!zone) return;
    if (zone.registeredIds.has(debrisId)) return;
    zone.registeredIds.add(debrisId);

    zone.debrisMass += mass;
    zone.debrisCount++;
    if (isLarge) zone.largeDebrisMass += mass;

    if (zone.definition.kind === 'red') {
      this.events.emit('zone:red_exceeded', {
        debrisMass: zone.largeDebrisMass,
        limit: zone.definition.maximumDebrisMass ?? 0,
      });
    } else {
      this.events.emit('zone:green_updated', {
        debrisMass: zone.debrisMass,
        pieces: zone.debrisCount,
      });
    }
    this.updateBreach(zone);
  }

  /** Попадание снаряда в зону. */
  registerProjectileHit(zoneId: string, energy: number): void {
    const zone = this.zones.get(zoneId);
    if (!zone) return;
    zone.projectileHits++;
    zone.impactEnergy += Math.max(0, energy);
    if (zone.definition.kind === 'red') this.updateBreach(zone);
  }

  private updateBreach(zone: ZoneRuntime): void {
    const limit = zone.definition.maximumDebrisMass;
    if (limit === undefined || zone.definition.kind !== 'red') return;
    const wasBreached = zone.breached;
    zone.breached = zone.largeDebrisMass > limit;
    if (zone.breached && !wasBreached) {
      this.events.emit('notice', {
        text: 'Красная зона переполнена обломками',
        severity: 'danger',
      });
    }
  }

  get isRedBreached(): boolean {
    return this.redZones.some((z) => z.breached);
  }

  redDebrisMass(): number {
    return this.redZones.reduce((sum, z) => sum + z.largeDebrisMass, 0);
  }

  redTotalDebrisMass(): number {
    return this.redZones.reduce((sum, z) => sum + z.debrisMass, 0);
  }

  greenDebrisMass(): number {
    return this.greenZones.reduce((sum, z) => sum + z.debrisMass, 0);
  }

  redProjectileHits(): number {
    return this.redZones.reduce((sum, z) => sum + z.projectileHits, 0);
  }

  status(id: string): ZoneStatus | null {
    const zone = this.zones.get(id);
    if (!zone) return null;
    const def = zone.definition;
    const limit = def.maximumDebrisMass ?? null;
    return {
      id: def.id,
      kind: def.kind,
      label: def.label ?? (def.kind === 'red' ? 'Запретная зона' : 'Безопасная зона'),
      debrisMass: zone.debrisMass,
      debrisCount: zone.debrisCount,
      largeDebrisMass: zone.largeDebrisMass,
      projectileHits: zone.projectileHits,
      limit,
      fillRatio: limit !== null && limit > 0 ? clamp(zone.largeDebrisMass / limit, 0, 10) : 0,
      breached: zone.breached,
      rect: { x: def.x, y: def.y, width: def.width, height: def.height },
    };
  }

  statuses(): ZoneStatus[] {
    return this.all
      .map((z) => this.status(z.definition.id))
      .filter((z): z is ZoneStatus => z !== null);
  }

  reset(): void {
    for (const zone of this.zones.values()) {
      zone.debrisMass = 0;
      zone.largeDebrisMass = 0;
      zone.debrisCount = 0;
      zone.projectileHits = 0;
      zone.impactEnergy = 0;
      zone.breached = false;
      zone.registeredIds = new Set<string>();
    }
  }

  /** Сводка по зонам для отладочной панели. */
  summary(): string {
    return this.statuses()
      .map((s) => `${s.id}: ${Math.round(s.debrisMass)}кг/${s.limit ?? '—'} (${s.debrisCount})`)
      .join(' | ');
  }
}
