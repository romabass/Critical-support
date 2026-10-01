/**
 * Именованные цвета промышленной палитры «Критическая опора».
 * Единая точка правды для рендерера, UI и отладочной панели.
 */

export const Palette = {
  graphiteDark: '#12161a',
  graphite: '#1b2127',
  graphiteLight: '#262e36',
  steel: '#7d8b98',
  steelBright: '#b9c6d1',
  concrete: '#9aa3a8',
  concreteDark: '#6d767b',
  wood: '#a9763f',
  woodDark: '#7a5329',
  glass: '#7fc9d6',
  steelBeam: '#8e9aa6',
  generator: '#3f9a5a',
  generatorDamaged: '#c8912f',
  generatorCritical: '#b8442f',

  orange: '#e8823a',
  orangeDim: '#a35a24',
  green: '#3fae62',
  greenDim: '#2a7644',
  red: '#d0402f',
  redDim: '#8c2a1f',
  yellow: '#e5c04a',
  blue: '#3f7fd0',

  textPrimary: '#e6edf3',
  textSecondary: '#9aa7b2',
  textMuted: '#66737e',
} as const;

export type PaletteKey = keyof typeof Palette;

/** Тип цветового профиля элемента конструкции. */
export type MaterialVisualStyle = 'concrete' | 'steel' | 'wood' | 'glass' | 'machine';
