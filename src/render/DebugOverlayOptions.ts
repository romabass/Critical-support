/** Переключаемые визуализации отладочной панели. */
export interface DebugViewOptions {
  readonly enabled: boolean;
  readonly colliders: boolean;
  readonly connections: boolean;
  readonly centersOfMass: boolean;
  readonly criticalSupports: boolean;
  readonly zones: boolean;
  readonly actualTrajectory: boolean;
  readonly contactPoints: boolean;
  readonly forceVectors: boolean;
}

export function defaultDebugView(): DebugViewOptions {
  return {
    enabled: false,
    colliders: false,
    connections: false,
    centersOfMass: false,
    criticalSupports: false,
    zones: true,
    actualTrajectory: false,
    contactPoints: false,
    forceVectors: false,
  };
}
