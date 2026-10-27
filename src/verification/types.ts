import type { Cookie } from 'playwright';

export interface Viewport { name: string; width: number; height: number;deviceProfile?:'desktop'|'mobile'|'touch';deviceScaleFactor?:number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface SourceElementEvidence {
  id: string;
  parentId?: string | null;
  effectiveOpacity?: number;
  renderedFonts?: RenderedFontUsage[];
  kind: string;
  tag?: string;
  text?: string;
  directText?: string;
  style: Record<string, string>;
  rect: Rect;
  image?: { url: string; alt?: string; naturalWidth?: number; naturalHeight?: number; objectFit?: string; objectPosition?: string };
  link?: { href: string };
}
export interface RenderedFontUsage {familyName:string;postScriptName:string;isCustomFont:boolean;glyphCount:number}
export interface SourceViewportEvidence extends Viewport {
  elements: SourceElementEvidence[];
  pageHeight?: number;
  screenshotPath?: string;
  warnings?: string[];
  interactions?: SourceInteractionEvidence[];
}
export interface SourceInteractionEvidence {
  sourceNodeId: string; tag: string; role: string; text: string;
  href?: string; expanded?: string; controls?: string; disabled: boolean; evidence?: string;
  controlledContentText?: string;
}
export interface ImportedMediaEvidence { sourceUrl: string; url: string; attachmentId: number; variants?: string[]; bakedOpacity?: number }
export interface ComparisonOptions {
  assetMap?: ImportedMediaEvidence[];
  expectedMediaURLs?: Record<string, string[]>;
}
export interface ToggleState { expanded: string | null; detailsOpen: boolean | null; contentVisible: boolean | null }
export interface TargetInteractionEvidence {
  sourceNodeId: string; targetId?: string; kind: 'toggle';
  status: 'verified' | 'failed' | 'unverified' | 'unsupported';
  clicked: boolean; restored: boolean; before?: ToggleState; after?: ToggleState; restoration?: ToggleState; error?: string;
  scopeRestoration?: Array<{ text: string; before: ToggleState; after: ToggleState }>;
  controlledContentText?: string;
}
export interface SourceEvidence { viewports: SourceViewportEvidence[]; url?: string; complete?: boolean; warnings?: string[] }
export interface ElementBinding { sourceId?: string; targetId?: string; selector?: string; kind?: string }
export type ElementMap = Record<string, string | ElementBinding> | Array<ElementBinding & { sourceId: string }>;
export interface ScopedBrowserAuth { cookies?: Cookie[] }
export interface VerificationIssue {
  code: string;
  status: 'mismatch' | 'unverified' | 'unsupported';
  severity: 'error' | 'warning';
  message: string;
  viewport?: string;
  sourceId?: string;
  targetId?: string;
  expected?: unknown;
  actual?: unknown;
}
export interface TargetImageEvidence {
  url: string;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  rect: Rect;
  objectFit: string;
  objectPosition: string;
  alt: string;
}
export interface TargetElementEvidence {
  sourceId: string;
  targetId?: string;
  selector: string;
  found: boolean;
  count: number;
  nativeElement: boolean;
  effectiveOpacity?: number;
  renderedFonts?: RenderedFontUsage[];
  fontText?:string;
  fontDomPath?:string;
  paintLayers?:Array<{rect:Rect;style:Record<string,string>;role:'root'|'content'|'background';effectiveOpacity:number}>;
  widgetType?: string;
  tag?: string;
  text: string;
  visible: boolean;
  rect: Rect;
  contentRect?: Rect;
  style: Record<string, string>;
  images: TargetImageEvidence[];
  media?: Array<{ url: string; origin: 'image' | 'background' | 'pseudo' | 'svg-image' }>;
  href?: string;
  disabled?: boolean;
  expanded?: string;
}
export interface TargetViewportEvidence extends Viewport {
  networkPolicy?:{mode:'read-only';allowedMethods:['GET','HEAD'];blockedMutationRequests:number;webSocketsBlocked:true};
  deviceFacts?:{profile:'desktop'|'mobile'|'touch';innerWidth:number;clientWidth:number;devicePixelRatio:number;touch:boolean;coarsePointer:boolean};
  screenshotGeometry?:{status:'changed-after-screenshot'|'unchanged';changedFacts:string[];gaps:Array<{code:string;message:string}>};
  screenshotCapture?:import('./layout-stable-screenshot.js').LayoutStableScreenshotReceipt;
  url: string;
  title: string;
  pageHeight: number;
  screenshotPath: string;
  evidencePath: string;
  elements: TargetElementEvidence[];
  overflow: Array<{ selector: string; rect: Rect }>;
  clipping: Array<{ selector: string; axis: string; scrollSize: number; clientSize: number }>;
  imageFailures: Array<{ url: string; alt: string }>;
  consoleErrors: string[];
  pageErrors: string[];
  responseStatus: number | null;
  interactions?: TargetInteractionEvidence[];
  previewChromeAdjusted?: boolean;
  canvasShell?: {bodyPageId?:number;bodyPaddingBottom:string;visibleToolbarCount:number};
}
export interface NativeEditabilityCheck { sourceId: string; field: string; selected: boolean; changed: boolean; saved: boolean; frontendConfirmed: boolean; restored: boolean }
export interface NativeEditabilityReport {
  status: 'verified' | 'unverified' | 'failed';
  requiredFields?: string[];
  verifiedFields?: string[];
  checks: NativeEditabilityCheck[];
  issues: VerificationIssue[];
  screenshots: string[];
}
export interface VerificationReport {
  version: 1;
  passed: boolean;
  visualPassed: boolean;
  status: 'passed' | 'needs-review' | 'failed';
  issues: VerificationIssue[];
  screenshots: Array<{ viewport: string; target: string; source?: string; heatmap?: string }>;
  measurements: TargetViewportEvidence[];
  editability: NativeEditabilityReport;
  coverage: Array<{ viewport: string; expected: number; matched: number }>;
  repairSummary: string;
}
