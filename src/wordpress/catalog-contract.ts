export interface PresentationRect { x: number; y: number; width: number; height: number }
export interface PresentationPaint {
  color?: string; backgroundColor?: string; borderColor?: string; borderWidth?: number;
  borderRadius?: number; opacity?: number; fontSize?: number; lineHeight?: number;
  fontWeight?: string; fontFamily?: string; textAlign?: string; boxShadow?: string;
}
export type CatalogSlotRole = 'image' | 'name' | 'rating' | 'price' | 'badge';
export interface CatalogTemplateSlot {
  role: CatalogSlotRole; rect: PresentationRect; visible: boolean; paint?: PresentationPaint;
  fit?: string; objectPosition?: string; maxLines?: number; overflow?: string;
  /** Dynamic copy can change painted text height; its allocated slot remains measured. */
  heightMode?: 'fixed' | 'content'; maxHeight?: number;
  /** Allocated source role region, including measured margins, rather than text glyph width. */
  geometryBasis?: 'allocation';
}
export interface CatalogCardLayout {
  rect: PresentationRect; domPath: string; visibleFraction: number; paint: PresentationPaint;
  slots: Array<CatalogTemplateSlot & { domPath: string; lineCount?: number; fullLineCount?: number;
    /** Independently measured from actual DOM bounds and computed margins, never source expectations. */
    allocationRect?: PresentationRect;
    allocationProof?: { kind: 'computed-margin-box'; domPath: string; marginTop: number; marginRight: number; marginBottom: number; marginLeft: number };
  }>;
  order: CatalogTemplateSlot['role'][]; evidence?: string[];
  hover?: { paint: PresentationPaint; evidence: string[] };
}

export interface CatalogRolePaint {
  color: string; fontSize: string; fontWeight: string; lineHeight: string; fontFamily: string;
  rect: { x: number; y: number; width: number; height: number };
  domPath?: string; visible?: boolean; evidence?: string[]; priceState?: 'regular' | 'sale' | 'old'; parts?: CatalogRolePaint[];
}

export interface CatalogProductEvidence {
  id: number; name: string; permalink: string; imageUrl: string; priceText?: string; imageVariants?: string[];
  onSale?: boolean;
  /** Actual DOM role paint is independent of the WooCommerce data record. */
  namePaint?: CatalogRolePaint; pricePaint?: CatalogRolePaint;
  cardLayout?: CatalogCardLayout;
}
export interface TargetCatalogEvidence {
  targetOrigin: string; evidence: string[]; products: CatalogProductEvidence[];
}
export interface CatalogRenderEvidence {
  viewport: string; blockId: string; widgetKey: string; widgetType: 'wd_products'; elementId: string;
  evidence: string[]; catalog: TargetCatalogEvidence; products: CatalogProductEvidence[];
  carousel?: { selector: string; initialized: boolean; visibleColumns: number; nextChanged?: boolean; slideCount?: number; loop?: boolean; cardWidth?: number };
}
