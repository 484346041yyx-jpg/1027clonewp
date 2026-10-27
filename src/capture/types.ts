import type { Browser } from 'playwright';

export interface CaptureViewport { name: string; width: number; height: number }
export interface SourceRect { x: number; y: number; width: number; height: number }
export interface RenderedFontUsage { familyName: string; postScriptName: string; isCustomFont: boolean; glyphCount: number }
export interface SourceElement {
  id: string;
  parentId: string | null;
  tag: string;
  domPath: string;
  text: string;
  directText: string;
  attributes: Record<string, string>;
  style: Record<string, string>;
  rect: SourceRect;
  kind: 'container' | 'text' | 'image' | 'button' | 'link' | 'input' | 'icon';
  /** Raw SVG descendants retain evidence but belong to one visual image atom at the outer SVG root. */
  primaryOwnerId?: string;
  /** Product of computed opacity on this node and its DOM ancestors; optional only for older capture files. */
  effectiveOpacity?: number;
  /** Actual fonts used for rendered glyphs, measured through Chromium CDP; absent means unproven. */
  renderedFonts?: RenderedFontUsage[];
  sectionId?: string;
  image?: { url: string; alt: string; naturalWidth: number; naturalHeight: number; objectFit: string; objectPosition: string };
  link?: { href: string };
}
export interface SourceSection {
  id: string;
  sourceNodeId: string;
  viewport: string;
  label: string;
  tag: string;
  rect: SourceRect;
  screenshotPath: string;
  atomIds: string[];
}
export interface SourceAsset {
  url: string;
  kind: 'image' | 'background' | 'font';
  sourceNodeIds: string[];
  viewports: string[];
  objectFit?: string;
  objectPosition?: string;
  alt?: string;
  /** Outer SVG node opacity already painted into the frozen SVG/raster; excludes DOM ancestor opacity. */
  bakedOpacity?: number;
  /** Exact computed paint properties frozen into SVG nodes before rasterization. */
  bakedEffects?: string[];
}
export interface SourceInteraction {
  sourceNodeId: string;
  tag: string;
  role: string;
  text: string;
  href?: string;
  expanded?: string;
  controls?: string;
  controlledContentText?: string;
  controlledContentEvidence?: 'Already-loaded DOM text; hidden state and interaction behavior are unverified';
  controlledContentTruncated?: boolean;
  disabled: boolean;
  evidence: 'DOM state only; behavior requires separate validation';
}
export interface CapturedViewport extends CaptureViewport {
  url: string;
  title: string;
  pageHeight: number;
  screenshotPath: string;
  domPath: string;
  evidencePath: string;
  elements: SourceElement[];
  sections: SourceSection[];
  interactions: SourceInteraction[];
  assets: SourceAsset[];
  warnings: string[];
}
export interface SourceCapture {
  version: 1;
  url: string;
  title: string;
  capturedAt: string;
  viewports: CapturedViewport[];
  sections: SourceSection[];
  assets: SourceAsset[];
  warnings: string[];
  complete: true;
  evidenceNotice: string;
  artifactPath: string;
}
export interface CaptureOptions {
  url: string;
  runDir: string;
  viewports?: CaptureViewport[];
  maxSections?: number;
  maxPageHeight?: number;
  maxElements?: number;
  timeoutMs?: number;
  allowLocalForTests?: boolean;
  browser?: Browser;
}
