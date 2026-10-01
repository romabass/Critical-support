import { Vec2, type Body, type Contact } from 'planck';

import type { AudioCue } from '../audio/AudioManager';
import type { AudioManager } from '../audio/AudioManager';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import { clamp, distance, pointInRect } from '../core/MathUtils';
import type { MaterialId } from '../data/MaterialProperties';
import type { LevelDefinition } from '../data/LevelData';
import type { ObjectiveContext, ObjectiveStatusSnapshot } from '../data/ObjectiveData';
import { getProjectile, type ProjectileData } from '../data/ProjectileData';
import { AnalysisSystem, type AnalysisReport } from './AnalysisSystem';
import { DebrisTracker } from './DebrisTracker';
import { ObjectiveSystem } from './ObjectiveSystem';
import { ScoringSystem, type Rank, type ScoreBreakdown } from './ScoringSystem';
import { ZoneController, type ZoneStatus } from './ZoneController';
import { BallisticsController } from '../physics/BallisticsController';
import { DestructionSystem } from '../physics/DestructionSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { ProjectileController, type ProjectileSnapshot } from '../physics/ProjectileController';
import { StructuralGraph } from '../physics/StructuralGraph';
import { StructuralElement, createElementBody } from '../physics/StructuralElement';
import { buildConnections, createWeldJoint } from '../physics/StructuralGraph';
import type { EffectSystem } from '../render/EffectSystem';
import type { CameraController } from '../render/CameraController';
import { Palette } from '../render/Palette';

export type SessionOutcome = 'running' | 'victory' | 'defeat';

export interface SessionResult {
  readonly won: boolean;
  readonly score: number;
  readonly breakdown: ScoreBreakdown;
  readonly rank: Rank;
  readonly shotsUsed: number;
  readonly generatorHealthPercent: number;
  readonly destroyedPercent: number;
  readonly redZoneMass: number;
  readonly greenZoneMass: number;
  readonly objectives: readonly ObjectiveStatusSnapshot[];
  readonly failureReason: string | null;
  readonly durationSeconds: number;
}

export interface SessionSnapshot {
  readonly level: LevelDefinition;
  readonly elements: readonly StructuralElement[];
  readonly graph: StructuralGraph;
  readonly zones: ZoneStatus[];
  readonly zonesRuntime: ZoneController;
  readonly objectives: readonly ObjectiveStatusSnapshot[];
  readonly objectiveSystem: ObjectiveSystem;
  readonly scoring: ScoringSystem;
  readonly analysis: AnalysisReport | null;
  readonly ballistics: BallisticsController;
  readonly projectile: ProjectileSnapshot | null;
  readonly shotsUsed: number;
  readonly maxShots: number;
  readonly shotsRemaining: number;
  readonly elapsedSeconds: number;
  readonly outcome: SessionOutcome;
  readonly generator: StructuralElement | null;
  readonly destroyedGroupRatio: number;
  readonly lastResult: SessionResult | null;
}

export interface SessionOptions {
  /** Минимальная скорость сближения, при которой удар считается ударом. */
  readonly minImpactSpeed?: number;
  /** Множитель времени для замедления. */
  readonly slowMotionFactor?: number;
  /** Сколько секунд ждать перед оценкой исхода после последнего действия. */
  readonly settleDelay?: number;
  readonly maxDebrisLifetime?: number;
}

const DEFAULT_OPTIONS: Required<SessionOptions> = {
  minImpactSpeed: 2.4,
  slowMotionFactor: 0.28,
  settleDelay: 1.4,
  maxDebrisLifetime: 26,
};

/**
 * Игровая сессия уровня: физика, разрушение, цели, зоны, счёт.
 * Не зависит от DOM: рендер и UI читают снимок сессии.
 */
export class GameSession {
  readonly level: LevelDefinition;
  readonly physics: PhysicsWorld;
  readonly graph: StructuralGraph;
  readonly destruction: DestructionSystem;
  readonly ballistics: BallisticsController;
  readonly projectiles: ProjectileController;
  readonly zones: ZoneController;
  readonly debris: DebrisTracker;
  readonly objectives: ObjectiveSystem;
  readonly scoring: ScoringSystem;
  readonly analysis: AnalysisSystem;

  readonly elements: StructuralElement[] = [];
  readonly protectedElements: Map<string, StructuralElement> = new Map();

  private shotsUsed = 0;
  private elapsed = 0;
  private settleTimer = 0;
  private outcome: SessionOutcome = 'running';
  private lastResult: SessionResult | null = null;
  private readonly options: Required<SessionOptions>;
  private aimLocked = false;
  private destroyedThisFrame: { id: string; x: number; y: number; material: MaterialId }[] = [];
  private damageThisFrame: { id: string; damage: number }[] = [];
  private contactPointsThisFrame: { x: number; y: number }[] = [];
  private pendingCollisions: { a: StructuralElement; b: StructuralElement; speed: number }[] = [];
  private stepIndex = 0;
  private readonly projectileHitsThisStep = new Map<string, number>();
  private readonly elementById = new Map<string, StructuralElement>();

  constructor(
    level: LevelDefinition,
    private readonly events: EventBus<GameEvents>,
    private readonly audio: AudioManager,
    private readonly effects: EffectSystem,
    private readonly camera: CameraController,
    options: SessionOptions = {},
  ) {
    this.level = level;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.physics = new PhysicsWorld({ environment: level.environment });
    this.graph = new StructuralGraph();
    this.destruction = new DestructionSystem(this.graph, this.events);
    this.ballistics = new BallisticsController(level.launcher, getProjectile(level.projectileId));
    this.ballistics.setGravity(level.environment.gravity);
    this.projectiles = new ProjectileController(this.physics.world);
    this.zones = new ZoneController(level.zones, this.events);
    this.debris = new DebrisTracker({ largeDebrisMass: level.largeDebrisMass ?? 50 });
    this.objectives = new ObjectiveSystem(level.objectives, this.events);
    this.scoring = new ScoringSystem(this.events);
    this.analysis = new AnalysisSystem(this.graph);

    this.buildWorld();
    this.wireContacts();
    this.wireEvents();
    this.camera.reset({
      centerX: level.camera?.centerX ?? level.launcher.x + 14,
      centerY: level.camera?.centerY ?? 8,
      zoom: level.camera?.zoom ?? 1,
    });
    this.graph.recompute();
  }

  // ───────────────────────────── построение мира ─────────────────────────────

  private buildWorld(): void {
    for (const def of this.level.elements) {
      const body = createElementBody(this.physics.world, def);
      const element = new StructuralElement(body, def);
      body.setUserData({ kind: 'element', id: element.id, element });
      this.elements.push(element);
      this.elementById.set(element.id, element);
      this.graph.addElement(element);
      if (element.protectable) this.protectedElements.set(element.id, element);
    }

    const connections = buildConnections(this.level.connections, (id) => this.elementById.get(id));
    for (const connection of connections) {
      const a = this.elementById.get(connection.aId);
      const b = this.elementById.get(connection.bId);
      if (!a || !b) continue;
      connection.attach(a, b);
      connection.joint = createWeldJoint(this.physics.world, a, b);
      this.graph.addConnection(connection);
    }

    this.camera.setBounds({
      minX: this.level.environment.leftBound,
      maxX: this.level.environment.rightBound,
      minY: this.level.environment.killY,
      maxY: this.level.environment.ceilingY,
      minZoom: 0.5,
      maxZoom: 2.4,
    });
  }

  private wireContacts(): void {
    // Скорость сближения фиксируется в pre-solve: в post-solve она уже погашена
    // решателем, и по ней нельзя оценить силу удара.
    const approachSpeeds = new WeakMap<object, number>();
    this.physics.world.on('pre-solve', (contact) => {
      approachSpeeds.set(contact, this.approachSpeed(contact));
    });

    this.physics.world.on('post-solve', (contact, impulse) => {
      const bodyA = contact.getFixtureA().getBody();
      const bodyB = contact.getFixtureB().getBody();
      const totalImpulse = impulse.normalImpulses.reduce((sum, i) => sum + i, 0);

      const elementA = this.elementFromBody(bodyA);
      const elementB = this.elementFromBody(bodyB);

      const projectileInvolved =
        (this.projectiles.active && this.bodyIsProjectile(bodyA)) ||
        (this.projectiles.active && this.bodyIsProjectile(bodyB));

      if (projectileInvolved) {
        this.handleProjectileContact(bodyA, bodyB, totalImpulse, approachSpeeds.get(contact) ?? 0);
        return;
      }

      if (elementA && elementB && elementA !== elementB && totalImpulse > 1) {
        const speed = approachSpeeds.get(contact) ?? this.approachSpeed(contact);
        this.pendingCollisions.push({ a: elementA, b: elementB, speed });
      }
    });
  }

  /** Скорость сближения тел вдоль нормали контакта (для оценки энергии удара). */
  private approachSpeed(contact: Contact): number {
    const manifold = contact.getWorldManifold(null);
    if (!manifold || manifold.points.length === 0) return 0;
    const point = manifold.points[0];
    const normal = manifold.normal;
    const a = contact.getFixtureA().getBody();
    const b = contact.getFixtureB().getBody();
    const va = pointVelocity(a, point.x, point.y);
    const vb = pointVelocity(b, point.x, point.y);
    return Math.max(0, -((vb.x - va.x) * normal.x + (vb.y - va.y) * normal.y));
  }

  private bodyIsProjectile(body: unknown): boolean {
    const data = (body as { getUserData(): unknown }).getUserData() as
      { kind?: string } | null | undefined;
    return data?.kind === 'projectile';
  }

  private elementFromBody(body: unknown): StructuralElement | null {
    const data = (body as { getUserData(): unknown }).getUserData() as
      { kind?: string; element?: StructuralElement } | null | undefined;
    if (data?.kind !== 'element' || !data.element) return null;
    return data.element;
  }

  private handleProjectileContact(
    bodyA: unknown,
    bodyB: unknown,
    impulse: number,
    approachSpeed: number,
  ): void {
    if (!this.projectiles.active) return;
    const snapshot = this.projectiles.snapshot;
    if (!snapshot) return;
    // Касание без сближения (снаряд лежит или скользит) не наносит урон,
    // иначе один и тот же контакт каждую физическую итерацию «перебивал» бы элемент.
    if (approachSpeed < this.options.minImpactSpeed) return;

    const aIsProjectile = this.bodyIsProjectile(bodyA);
    const projectileBody = (aIsProjectile ? bodyA : bodyB) as Body;
    const otherBody = aIsProjectile ? bodyB : bodyA;

    const target = this.elementFromBody(otherBody);
    const position = this.projectiles.snapshot ? { x: snapshot.x, y: snapshot.y } : { x: 0, y: 0 };
    const velocity: Vec2 = projectileBody.getLinearVelocity();
    const speed = Math.hypot(velocity.x, velocity.y);
    const len = speed || 1;
    const direction = { x: velocity.x / len, y: velocity.y / len };

    // Один снаряд не должен наносить урон одному элементу дважды за шаг:
    // у контакта несколько точек, и post-solve приходит по каждой.
    if (target) {
      const key = target.id;
      if (this.projectileHitsThisStep.get(key) === this.stepIndex) return;
      this.projectileHitsThisStep.set(key, this.stepIndex);
    }

    this.contactPointsThisFrame.push({ x: position.x, y: position.y });
    const zone = DebrisTracker.zoneAt(position.x, position.y, this.zones.definitions);
    if (zone) {
      this.zones.registerProjectileHit(zone.id, 0.5 * snapshot.data.mass * speed * speed);
    }

    const report = this.destruction.applyProjectileImpact({
      projectile: snapshot.data,
      target,
      point: position,
      speed: Math.max(speed, approachSpeed),
      direction,
    });

    if (report.impulseMagnitude > 0 || report.damageApplied > 0) {
      this.audio.play(this.impactCue(speed, target?.material.visualStyle), { throttleMs: 35 });
      this.effects.addRing(
        position.x,
        position.y,
        0.7 + Math.min(2.4, speed * 0.08),
        target?.material.edgeColor ?? Palette.orange,
      );
      if (this.effects.quality.enableScreenShake) {
        this.camera.shake(Math.min(0.55, speed * 0.014));
      }
      if (target) {
        this.effects.debrisByStyle(target.material.visualStyle, position.x, position.y, 1);
        this.effects.addCrack(
          position.x,
          position.y,
          Math.atan2(direction.y, direction.x),
          0.5 + report.damageApplied / 120,
        );
      }
    }

    if (report.brokenConnections.length > 0) {
      this.audio.play('connection_break', { throttleMs: 60 });
      this.effects.burst({
        x: position.x,
        y: position.y,
        count: 10,
        kind: 'spark',
        speed: 6,
        life: 0.4,
        color: '#ffd58a',
      });
    }

    if (impulse > 6) this.projectiles.registerBounce();
    this.projectiles.applyReaction(position);
  }

  private impactCue(speed: number, style?: string): AudioCue {
    if (style === 'glass') return 'glass_shatter';
    if (style === 'wood') return 'wood_break';
    if (speed > 22) return 'impact_hard';
    return 'impact_soft';
  }

  private wireEvents(): void {
    this.events.on('element:destroyed', ({ elementId, kind }) => {
      const element = this.elementById.get(elementId);
      if (!element) return;
      const pos = element.getPosition();
      this.destroyedThisFrame.push({
        id: elementId,
        x: pos.x,
        y: pos.y,
        material: element.material.id,
      });

      this.effects.debrisByStyle(
        element.material.visualStyle,
        pos.x,
        pos.y,
        element.mass > 40 ? 1.6 : 1,
      );
      this.audio.play(this.breakCueFor(element.material.id), { throttleMs: 45 });
      if (element.mass > 60 && this.effects.quality.enableScreenShake) {
        this.camera.shake(0.28);
      }
      if (element.protectable) {
        this.audio.play('generator_hit');
      }
      void kind;
    });

    this.events.on('element:damaged', ({ elementId, damage }) => {
      this.damageThisFrame.push({ id: elementId, damage });
    });
  }

  private breakCueFor(material: MaterialId): AudioCue {
    switch (material) {
      case 'glass':
        return 'glass_shatter';
      case 'wood':
        return 'wood_break';
      case 'steel':
        return 'steel_break';
      case 'generator':
        return 'generator_hit';
      case 'concrete':
        return 'concrete_break';
      default:
        return 'impact_soft';
    }
  }

  // ───────────────────────────── управление ─────────────────────────────

  /** Обновление прицеливания по экранным координатам курсора. */
  aimAtScreenPoint(sx: number, sy: number, maxPull = 8.5): void {
    if (this.outcome !== 'running') return;
    const world = this.camera.screenToWorld(sx, sy);
    this.aimAtWorldPoint(world.x, world.y, maxPull);
  }

  /** Обновление прицеливания по мировым координатам. */
  aimAtWorldPoint(wx: number, wy: number, maxPull = 8.5): void {
    if (this.aimLocked) return;
    const origin = this.ballistics.origin;
    const dx = wx - origin.x;
    const dy = wy - origin.y;
    const pull = distance(origin.x, origin.y, wx, wy);
    const power = this.ballistics.powerFromDistance(pull, maxPull);
    this.ballistics.setPower(power);

    if (pull > 0.4) {
      // Угол вверх по горизонтали; курсор ниже оси даёт небольшой наклон вниз.
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      this.ballistics.setAngle(angle);
    }
  }

  /** Ручная установка угла и силы (используется в тестах и отладке). */
  setAim(angleDeg: number, power: number): void {
    this.ballistics.setAngle(angleDeg);
    this.ballistics.setPower(power);
  }

  /** Запуск снаряда. Возвращает false, если запуск невозможен. */
  fire(): boolean {
    if (this.outcome !== 'running') return false;
    if (this.shotsUsed >= this.level.maxShots) return false;
    if (this.projectiles.active) return false;

    const solution = this.ballistics.solve();
    const origin = this.ballistics.origin;
    const muzzleOffset = 0.9;
    const dir = this.ballistics.directionVector();
    const spawn = {
      x: origin.x + dir.x * muzzleOffset,
      y: origin.y + dir.y * muzzleOffset,
    };

    this.projectiles.spawn(this.projectileData, spawn, solution.velocity);
    this.shotsUsed++;
    this.aimLocked = true;
    this.settleTimer = 0;

    this.audio.play('launch');
    this.effects.burst({
      x: spawn.x,
      y: spawn.y,
      count: 12,
      kind: 'dust',
      speed: 5,
      spread: 0.9,
      angle: Math.atan2(solution.velocity.y, solution.velocity.x),
      life: 0.5,
    });
    if (this.effects.quality.enableScreenShake) this.camera.shake(0.16);

    this.events.emit('shot:fired', {
      index: this.shotsUsed,
      angleDeg: this.ballistics.angleDeg,
      power: this.ballistics.power,
      speed: solution.speed,
    });

    this.refreshObjectives();
    return true;
  }

  /** Разблокировка прицеливания (после паузы или завершения полёта). */
  unlockAim(): void {
    this.aimLocked = false;
  }

  get aimLockedOut(): boolean {
    return this.aimLocked;
  }

  get shotsRemaining(): number {
    return Math.max(0, this.level.maxShots - this.shotsUsed);
  }

  get projectileData(): ProjectileData {
    return getProjectile(this.level.projectileId);
  }

  // ───────────────────────────── симуляция ─────────────────────────────

  /** Один кадр симуляции. dt в секундах. */
  step(dt: number, timeScale = 1): void {
    this.stepIndex++;
    if (this.outcome !== 'running' && !this.projectiles.active) {
      this.effects.update(dt);
      return;
    }

    const scaled = dt * timeScale;
    this.elapsed += scaled;

    const before = this.collidersSnapshot();
    const steps = this.physics.step(scaled);
    this.updateConnectionLoads(before);

    if (this.graph.update(scaled)) {
      this.onGraphRecompute();
    }

    this.processCollisions();
    this.processDestroyed();
    this.processZones();

    if (this.projectiles.active) {
      const result = this.projectiles.update(dt, this.level.environment);
      if (this.effects.quality.enableTrails) {
        const snap = this.projectiles.snapshot;
        if (snap) this.effects.trailStep(snap.x, snap.y, snap.angle, 0);
      }
      if (result.expired) {
        this.aimLocked = false;
        this.events.emit('shot:expired', {
          shotsUsed: this.shotsUsed,
          maxShots: this.level.maxShots,
        });
        if (this.shotsUsed >= this.level.maxShots) {
          this.settleTimer = 0;
        }
      }
    }

    this.processOutOfWorld();
    this.refreshObjectives();

    if (this.analysis.isActive) this.analysis.analyze(dt);

    this.effects.update(dt);

    if (this.outcome === 'running' && !this.projectiles.active) {
      this.settleTimer += dt;
      if (this.settleTimer >= this.options.settleDelay) this.evaluateOutcome();
    } else if (this.projectiles.active) {
      this.settleTimer = 0;
    }

    this.destroyedThisFrame.length = 0;
    this.damageThisFrame.length = 0;
    this.contactPointsThisFrame.length = 0;
    void steps;
  }

  private collidersSnapshot(): Map<string, { x: number; y: number }> {
    const map = new Map<string, { x: number; y: number }>();
    for (const element of this.elements) {
      if (element.isDestroyed) continue;
      const p = element.getPosition();
      map.set(element.id, { x: p.x, y: p.y });
    }
    return map;
  }

  /** Оценка нагрузки на связи по смещению элементов относительно предыдущего кадра. */
  private updateConnectionLoads(previous: Map<string, { x: number; y: number }>): void {
    const gravityForceScale = 0.02;
    for (const connection of this.graph.connections) {
      if (connection.isBroken) continue;
      const a = this.elementById.get(connection.aId);
      const b = this.elementById.get(connection.bId);
      if (!a || !b || a.isDestroyed || b.isDestroyed) continue;

      const pa = a.getPosition();
      const pb = b.getPosition();
      const prevA = previous.get(a.id) ?? pa;
      const prevB = previous.get(b.id) ?? pb;

      // Относительное удлинение связи ≈ нагрузка.
      const nowLen = distance(pa.x, pa.y, pb.x, pb.y);
      const prevLen = distance(prevA.x, prevA.y, prevB.x, prevB.y);
      const stretch = Math.abs(nowLen - prevLen) * 60;

      // Оседлая нагрузка: вес элемента плюс вес элементов, которые он держит.
      const supported = this.supportedMassFor(connection);
      const staticLoad = supported * this.level.environment.gravity * gravityForceScale;

      const broken = connection.registerLoad(staticLoad + stretch);
      if (broken) this.destruction.onConnectionBroken(connection, a.id);
    }
  }

  /** Масса, которую связь фактически несёт (элемент + зависимые). */
  private supportedMassFor(connection: { aId: string; bId: string }): number {
    let mass = 0;
    for (const element of this.elements) {
      if (element.isDestroyed) continue;
      const p = element.getPosition();
      const a = this.elementById.get(connection.aId);
      const b = this.elementById.get(connection.bId);
      if (!a || !b) continue;
      const midX = (a.getPosition().x + b.getPosition().x) / 2;
      const midY = (a.getPosition().y + b.getPosition().y) / 2;
      if (p.y > midY + 0.4 && Math.abs(p.x - midX) < 3.2) mass += element.mass;
    }
    return mass;
  }

  private processCollisions(): void {
    if (this.pendingCollisions.length === 0) return;
    for (const collision of this.pendingCollisions) {
      this.destruction.applyElementCollision(collision.a, collision.b, collision.speed);
    }
    this.pendingCollisions.length = 0;
    if (this.graph.snapshot().pendingRecompute) this.graph.markDirty();
  }

  private processDestroyed(): void {
    for (const item of this.destroyedThisFrame) {
      const zone = DebrisTracker.zoneAt(item.x, item.y, this.zones.definitions);
      const element = this.elementById.get(item.id);
      if (!element) continue;
      this.debris.register(element, zone?.id ?? null, this.elapsed);
    }
  }

  /** Проверка осевших обломков и зачёт их массы в зоны. */
  private processZones(): void {
    for (const element of this.elements) {
      if (!element.isDestroyed) continue;
      const p = element.getPosition();
      const zone = DebrisTracker.zoneAt(p.x, p.y, this.zones.definitions);
      const settled = p.y <= this.level.environment.groundY + element.halfExtents.height + 0.35;
      this.debris.update(element, zone?.id ?? null, settled, this.elapsed);
      if (settled && zone) {
        this.zones.registerDebris(
          zone.id,
          element.mass,
          element.mass >= (this.level.largeDebrisMass ?? 50),
          element.id,
        );
      }
    }
  }

  private processOutOfWorld(): void {
    const killY = this.level.environment.killY;
    const left = this.level.environment.leftBound - 6;
    const right = this.level.environment.rightBound + 6;
    for (const element of this.elements) {
      if (element.isDestroyed) continue;
      const p = element.getPosition();
      if (p.y < killY || p.x < left || p.x > right) {
        this.destruction.handleOutOfBounds(element, killY);
        this.debris.markOutOfWorld(element.id);
      }
    }
  }

  private onGraphRecompute(): void {
    const snapshot = this.graph.snapshot();
    this.events.emit('graph:recomputed', {
      detachedCount: snapshot.detachedCount,
      activeConnections: snapshot.activeConnections,
    });

    const newlyDetached = this.graph.consumeNewlyDetached();
    if (newlyDetached.length > 0) {
      for (const id of newlyDetached) {
        const element = this.elementById.get(id);
        if (!element || element.isDestroyed) continue;
        // Отсоединённый элемент переходит в свободное падение: снимаем сварку.
        for (const connection of this.graph.getConnectionsFor(id)) {
          if (connection.joint) {
            this.physics.world.destroyJoint(connection.joint);
            connection.joint = null;
          }
        }
      }
      this.events.emit('graph:detached', { elementIds: newlyDetached });
      this.audio.play('connection_break', { throttleMs: 80 });
      this.refreshObjectives();
    }
  }

  // ───────────────────────────── цели и исход ─────────────────────────────

  private buildObjectiveContext(): ObjectiveContext {
    const groupStats = new Map<
      string,
      { total: number; destroyed: number; totalMass: number; destroyedMass: number }
    >();
    for (const element of this.elements) {
      if (!element.group) continue;
      const entry = groupStats.get(element.group) ?? {
        total: 0,
        destroyed: 0,
        totalMass: 0,
        destroyedMass: 0,
      };
      entry.total++;
      entry.totalMass += element.mass;
      if (element.isDestroyed) {
        entry.destroyed++;
        entry.destroyedMass += element.mass;
      }
      groupStats.set(element.group, entry);
    }

    const objectDamagePercent = new Map<string, number>();
    for (const [id, element] of this.protectedElements) {
      objectDamagePercent.set(id, element.damagePercent);
    }

    const zoneDebrisMass = new Map<string, number>();
    const safeZoneDebrisMass = new Map<string, number>();
    for (const status of this.zones.statuses()) {
      zoneDebrisMass.set(status.id, status.largeDebrisMass);
      safeZoneDebrisMass.set(status.id, status.debrisMass);
    }

    const materialDamagePercent = new Map<MaterialId, number>();
    for (const material of ['glass', 'wood', 'concrete', 'steel', 'generator'] as MaterialId[]) {
      let total = 0;
      let count = 0;
      for (const element of this.elements) {
        if (element.material.id !== material) continue;
        total += element.damagePercent;
        count++;
      }
      materialDamagePercent.set(material, count > 0 ? total / count : 0);
    }

    return {
      groupStats,
      objectDamagePercent,
      zoneDebrisMass,
      safeZoneDebrisMass,
      materialDamagePercent,
      shotsUsed: this.shotsUsed,
      elapsedSeconds: this.elapsed,
    };
  }

  refreshObjectives(): ObjectiveStatusSnapshot[] {
    return this.objectives.update(this.buildObjectiveContext());
  }

  get destroyedGroupRatio(): number {
    const targetGroup = this.level.objectives.find((o) => o.type === 'destroy_group')?.group;
    if (!targetGroup) return 0;
    let total = 0;
    let destroyed = 0;
    for (const element of this.elements) {
      if (element.group !== targetGroup) continue;
      total++;
      if (element.isDestroyed) destroyed++;
    }
    return total > 0 ? destroyed / total : 0;
  }

  /** Первичная проверка немедленных условий поражения. */
  private checkImmediateDefeat(): string | null {
    const generator = this.generatorElement;
    if (generator && generator.damagePercent >= 99) {
      return `Генератор получил критический урон (${generator.damagePercent.toFixed(0)}%)`;
    }
    if (this.zones.isRedBreached) {
      const red = this.zones.redZones[0];
      return `Красная зона переполнена: ${Math.round(red?.largeDebrisMass ?? 0)} кг`;
    }
    for (const id of this.level.criticalObjects ?? []) {
      const element = this.elementById.get(id);
      if (!element) continue;
      if (element.isDestroyed) return `Важный объект ${id} разрушен`;
      const p = element.getPosition();
      if (
        p.x < this.level.environment.leftBound ||
        p.x > this.level.environment.rightBound ||
        p.y < this.level.environment.killY
      ) {
        return `Важный объект ${id} покинул игровую область`;
      }
    }
    return null;
  }

  private evaluateOutcome(): void {
    if (this.outcome !== 'running') return;

    this.refreshObjectives();

    const immediate = this.checkImmediateDefeat();
    const objectiveViolation = this.objectives.hasViolation ? this.objectives.failureReason : null;

    const shotsExhausted = this.shotsUsed >= this.level.maxShots && !this.projectiles.active;
    const requiredComplete = this.level.objectives
      .filter((o) => o.type !== 'limit_shots' && o.type !== 'time_limit')
      .every((o) => {
        const snapshot = this.objectives.statuses().find((s) => s.type === o.type);
        return snapshot ? !snapshot.violated : true;
      });

    const completion = this.objectives.completionRatio;
    const primaryDone = this.level.objectives
      .filter((o) => o.type === 'destroy_group')
      .every((o) => {
        const target = o.minimumPercent ?? 80;
        return this.destroyedGroupRatio * 100 >= target - 1e-6;
      });

    let won: boolean;
    let reason: string | null = null;

    if (immediate) {
      won = false;
      reason = immediate;
    } else if (objectiveViolation) {
      won = false;
      reason = objectiveViolation;
    } else if (primaryDone && completion >= 0.99 && requiredComplete) {
      won = true;
    } else if (shotsExhausted) {
      won = false;
      reason = 'Запуски закончились, цель не выполнена';
    } else {
      // Ещё можно попробовать: ждём следующего действия игрока.
      return;
    }

    this.outcome = won ? 'victory' : 'defeat';
    this.lastResult = this.computeResult(won, reason);
    this.audio.play(won ? 'victory' : 'defeat');
    this.events.emit('level:completed', { levelId: this.level.id, won });
  }

  /** Принудительная оценка исхода (используется в тестах и по таймауту). */
  forceEvaluate(): SessionResult | null {
    this.evaluateOutcome();
    return this.lastResult;
  }

  private computeResult(won: boolean, failureReason: string | null): SessionResult {
    const generator = this.generatorElement;
    const generatorHealthRatio = generator ? generator.healthRatio : 1;
    const redZone = this.zones.redZones[0];
    const greenZone = this.zones.greenZones[0];

    const breakdown = this.scoring.compute({
      won,
      shotsUsed: this.shotsUsed,
      parShots: this.level.parShots ?? this.level.maxShots,
      objectivesCompletion: this.objectives.completionRatio,
      generatorHealthRatio,
      redZoneDebrisMass: redZone?.largeDebrisMass ?? 0,
      redZoneLimit: redZone?.definition.maximumDebrisMass ?? 0,
      greenZoneDebrisMass: greenZone?.debrisMass ?? 0,
      greenZoneTarget: greenZone?.definition.targetDebrisMass ?? 0,
      destroyedGroupRatio: this.destroyedGroupRatio,
      unusedShots: this.shotsRemaining,
      maxShots: this.level.maxShots,
      timeSeconds: this.elapsed,
    });

    return {
      won,
      score: breakdown.total,
      breakdown,
      rank: this.scoring.rank,
      shotsUsed: this.shotsUsed,
      generatorHealthPercent: generatorHealthRatio * 100,
      destroyedPercent: this.destroyedGroupRatio * 100,
      redZoneMass: redZone?.largeDebrisMass ?? 0,
      greenZoneMass: greenZone?.debrisMass ?? 0,
      objectives: this.objectives.statuses(),
      failureReason,
      durationSeconds: this.elapsed,
    };
  }

  // ───────────────────────────── доступ ─────────────────────────────

  get generatorElement(): StructuralElement | null {
    for (const element of this.elements) if (element.protectable) return element;
    return null;
  }

  /** Накопленный урон защищаемого объекта в процентах. */
  objectDamagePercent(objectId: string): number {
    return this.protectedElements.get(objectId)?.damagePercent ?? 0;
  }

  get shotsUsedCount(): number {
    return this.shotsUsed;
  }

  get elapsedSeconds(): number {
    return this.elapsed;
  }

  get sessionOutcome(): SessionOutcome {
    return this.outcome;
  }

  get result(): SessionResult | null {
    return this.lastResult;
  }

  /** Зоны, в которых сейчас находится точка (для подсветки). */
  zoneAtPoint(x: number, y: number): string | null {
    return DebrisTracker.zoneAt(x, y, this.zones.definitions)?.id ?? null;
  }

  /** Проверка попадания точки в прямоугольник зоны (используется в тестах). */
  static pointInZone(
    x: number,
    y: number,
    zone: { x: number; y: number; width: number; height: number },
  ): boolean {
    return pointInRect(x, y, zone);
  }

  snapshot(): SessionSnapshot {
    return {
      level: this.level,
      elements: this.elements,
      graph: this.graph,
      zones: this.zones.statuses(),
      zonesRuntime: this.zones,
      objectives: this.objectives.statuses(),
      objectiveSystem: this.objectives,
      scoring: this.scoring,
      analysis: this.analysis.report,
      ballistics: this.ballistics,
      projectile: this.projectiles.snapshot,
      shotsUsed: this.shotsUsed,
      maxShots: this.level.maxShots,
      shotsRemaining: this.shotsRemaining,
      elapsedSeconds: this.elapsed,
      outcome: this.outcome,
      generator: this.generatorElement,
      destroyedGroupRatio: this.destroyedGroupRatio,
      lastResult: this.lastResult,
    };
  }

  destroy(): void {
    this.projectiles.clear();
    this.physics.clear();
  }
}

export { clamp };

/** Скорость точки тела в мировых координатах. */
function pointVelocity(body: Body, x: number, y: number): { x: number; y: number } {
  const v = body.getLinearVelocityFromWorldPoint(Vec2(x, y));
  return { x: v.x, y: v.y };
}
