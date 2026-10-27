/** Neutral observation/measurement contracts shared by source and delivery.
 * No browser, authentication, persistence or comparison implementation belongs here. */
export interface Native44CompareGap {
  category: 'structure' | 'media' | 'query' | 'interaction' | 'evidence' | 'conflict';
  moduleKey?: string; viewport?: string; detail: string; blocking: boolean;
}
export interface Native44MeasuredModule {
  key: string; count: number; visible: boolean; box?: { x: number; y: number; width: number; height: number };
  css?: Record<string, string>; media?: Array<{ url: string; drawable: boolean | null; kind: string }>;
  visual?: Native44VisualModule;
  state?: { carouselIndex?: number; expanded?: boolean; hover?: boolean };
  carouselRuntimeCount?: number;
}

/** Actual rendered styles, keyed by visible copy rather than site-specific CSS classes. */
export interface Native44VisualControl {
  width: number; height: number; background: string; color: string;
  borderBottomWidth: string; beforeContent: string; afterContent: string;
}
export interface Native44VisualText {
  text: string; color: string; fontSize: string; lineHeight: string;
  /** Horizontal position relative to the owning module, independent of page scroll. */
  x?: number;
  /** Rendered text box and wrapping result, sampled at the same CSS viewport. */
  width?: number; height?: number; lineCount?: number; whiteSpace?: string;
  control?: Native44VisualControl;
}
export interface Native44VisualProgress { x: number; width: number; height: number; background: string; fillFraction: number | null; }
export interface Native44VisualArrow { side: 'prev' | 'next'; x: number; width: number; height: number; background: string; color: string; borderRadius: string; iconWidth: number | null; iconHeight: number | null; }
export interface Native44VisualMediaGeometry { x: number; y: number; width: number; height: number; }
/** Visible painted rectangles, independent of widget names and CSS classes. */
export interface Native44VisualPaint {
  x: number; y: number; width: number; height: number;
  background: string; backgroundImage: 'none' | 'gradient' | 'image';
  borderWidth: string; borderColor: string; borderRadius: string; boxShadow: string; opacity: string;
}
export interface Native44VisualModule {
  /** First opaque solid layer behind the module; null if an image/gradient obscures it. */
  solidBackground: string | null;
  texts: Native44VisualText[];
  progress?: Native44VisualProgress[];
  arrows?: Native44VisualArrow[];
  mediaGeometry?: Native44VisualMediaGeometry[];
  paintLayers?: Native44VisualPaint[];
}
