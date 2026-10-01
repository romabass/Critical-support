import { clamp } from '../core/MathUtils';
import type { StructuralConnection } from '../physics/StructuralConnection';
import type { StructuralElement } from '../physics/StructuralElement';
import type { StructuralGraph } from '../physics/StructuralGraph';

export type AnalysisRole = 'stable' | 'critical_support' | 'protectable' | 'detached' | 'damaged';

export interface AnalysisHighlight {
  readonly elementId: string;
  readonly role: AnalysisRole;
  readonly label: string;
  readonly loadBearing: boolean;
  readonly stress: number;
  readonly healthRatio: number;
}

export interface ConnectionAnalysis {
  readonly connectionId: string;
  readonly stress: number;
  readonly critical: boolean;
  readonly broken: boolean;
}

export interface AnalysisReport {
  readonly active: boolean;
  readonly highlights: readonly AnalysisHighlight[];
  readonly connections: readonly ConnectionAnalysis[];
  readonly supportsCount: number;
  readonly criticalSupportsCount: number;
  readonly vulnerableCount: number;
  readonly detachedCount: number;
  readonly massAboveCriticalSupports: number;
  readonly summary: string;
  /** Оценка времени до обрушения, грубая: 0..1. */
  readonly collapseRisk: number;
}

export interface AnalysisBudgetConfig {
  /** Задел: лимит анализа в секундах работы системы. */
  readonly budgetSeconds?: number;
  /** Задел: стоимость анализа. */
  readonly costPerUse?: number;
}

/**
 * Режим анализа конструкции: подсветка ролей элементов и нагрузки связей.
 * Помогает игроку, но не выполняет уровень автоматически.
 * Изолирован в отдельном классе, чтобы позже добавить лимиты и стоимость.
 */
export class AnalysisSystem {
  private active = false;
  private usedSeconds = 0;
  private readonly budgetSeconds: number;
  private readonly costPerUse: number;
  private lastReport: AnalysisReport | null = null;

  constructor(
    private readonly graph: StructuralGraph,
    config: AnalysisBudgetConfig = {},
  ) {
    this.budgetSeconds = config.budgetSeconds ?? Number.POSITIVE_INFINITY;
    this.costPerUse = config.costPerUse ?? 0;
  }

  get isActive(): boolean {
    return this.active;
  }

  get consumedSeconds(): number {
    return this.usedSeconds;
  }

  get budgetRemaining(): number {
    return Math.max(0, this.budgetSeconds - this.usedSeconds);
  }

  /** Переключение режима анализа. Возвращает новое состояние. */
  toggle(): boolean {
    return this.setActive(!this.active);
  }

  setActive(value: boolean): boolean {
    if (value && this.budgetRemaining <= 0) return false;
    this.active = value;
    if (value) this.usedSeconds += this.costPerUse;
    return this.active;
  }

  /** Расчёт отчёта. Дёшево, поэтому вызывается каждый кадр при активном анализе. */
  analyze(dt: number): AnalysisReport {
    if (this.active) this.usedSeconds += dt;

    const highlights: AnalysisHighlight[] = [];
    const connections: ConnectionAnalysis[] = [];
    let supportsCount = 0;
    let criticalSupportsCount = 0;
    let vulnerableCount = 0;
    let massAboveCriticalSupports = 0;
    let criticalSupportY = Number.POSITIVE_INFINITY;

    for (const element of this.graph.elements) {
      if (element.isDestroyed) continue;
      let role: AnalysisRole = 'stable';
      if (element.protectable) role = 'protectable';
      else if (this.graph.isDetached(element.id)) role = 'detached';
      else if (element.critical && element.loadBearing) role = 'critical_support';
      else if (element.healthRatio < 0.6) role = 'damaged';

      if (element.loadBearing) supportsCount++;
      if (role === 'critical_support') {
        criticalSupportsCount++;
        criticalSupportY = Math.min(criticalSupportY, element.getPosition().y);
      }

      const stress = this.maxStressFor(element);
      if (stress > 0.75 && role === 'stable') vulnerableCount++;

      highlights.push({
        elementId: element.id,
        role,
        label: element.label,
        loadBearing: element.loadBearing,
        stress,
        healthRatio: element.healthRatio,
      });
    }

    for (const element of this.graph.elements) {
      if (element.isDestroyed) continue;
      if (
        criticalSupportY < Number.POSITIVE_INFINITY &&
        element.getPosition().y > criticalSupportY
      ) {
        massAboveCriticalSupports += element.mass;
      }
    }

    for (const connection of this.graph.connections) {
      connections.push({
        connectionId: connection.id,
        stress: connection.isBroken ? 0 : connection.stressRatio,
        critical: connection.critical,
        broken: connection.isBroken,
      });
    }

    const collapseRisk = this.estimateCollapseRisk(criticalSupportsCount, vulnerableCount);

    const report: AnalysisReport = {
      active: this.active,
      highlights,
      connections,
      supportsCount,
      criticalSupportsCount,
      vulnerableCount,
      detachedCount: this.graph.detachedCount,
      massAboveCriticalSupports,
      summary: `Опор: ${supportsCount}, критических: ${criticalSupportsCount}, уязвимых: ${vulnerableCount}, отсоединено: ${this.graph.detachedCount}`,
      collapseRisk,
    };

    this.lastReport = report;
    return report;
  }

  get report(): AnalysisReport | null {
    return this.lastReport;
  }

  /** Максимальная нагрузка на связи элемента, 0..1. */
  maxStressFor(element: StructuralElement): number {
    let stress = 0;
    for (const connection of this.graph.getConnectionsFor(element.id)) {
      if (connection.isBroken) continue;
      stress = Math.max(stress, connection.stressRatio);
    }
    return clamp(stress, 0, 1);
  }

  /** Оценка риска обрушения 0..1. */
  private estimateCollapseRisk(criticalSupports: number, vulnerable: number): number {
    if (criticalSupports === 0) return 1;
    const supportRisk = clamp(1 - (criticalSupports - 1) / 3, 0, 1);
    const stressRisk = clamp(vulnerable / 8, 0, 1);
    return clamp(supportRisk * 0.6 + stressRisk * 0.4, 0, 1);
  }

  /** Элементы, разрушение которых вызовет наибольшие последствия. */
  getPriorityTargets(limit = 3): AnalysisHighlight[] {
    if (!this.lastReport) return [];
    return [...this.lastReport.highlights]
      .filter((h) => h.role === 'critical_support' || h.role === 'damaged')
      .sort((a, b) => b.stress - a.stress)
      .slice(0, limit);
  }

  reset(): void {
    this.usedSeconds = 0;
    this.lastReport = null;
    this.active = false;
  }

  static describeConnection(connection: StructuralConnection): string {
    if (connection.isBroken) return 'разрушена';
    if (connection.stressRatio > 0.75) return 'на пределе';
    if (connection.stressRatio > 0.4) return 'нагружена';
    return 'стабильна';
  }
}
