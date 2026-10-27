import { hashBrowserCaptureFacts, type BrowserCaptureTransaction, type CaptureTransactionState } from '../../src/replica-v2/capture-transaction.js';

/** Synthetic protocol fixture only. It is never evidence that a live browser was observed. */
export function browserCaptureTransactionFixture(nowMs: number, raster: { sha256: string; width: number; height: number }): BrowserCaptureTransaction {
  const at = (offset: number) => new Date(nowMs - 10_000 + offset).toISOString();
  const binding = { browserId: 'fixture-instance', tabId: 'fixture-tab', frameId: 'fixture-frame' };
  const document = { key: 'fixture-document', revision: 'fixture-revision', styleHash: hashBrowserCaptureFacts('actual-fixture-css') };
  const viewport = { width: raster.width, height: raster.height, clientWidth: raster.width, devicePixelRatio: 1, visualWidth: raster.width, visualHeight: raster.height, visualScale: 1 };
  const carousel = { owner: 'fixture-carousel', initialized: true, logicalIndex: 0, visibleIds: ['item-a'], counter: '1 / 2', transform: 'matrix(1,0,0,1,0,0)', animating: false, autoplayRunning: false, autoplayPaused: false };
  const state = (offset: number): CaptureTransactionState => ({
    observedAt: at(offset), document: { ...document }, viewport: { ...viewport },
    geometryHash: hashBrowserCaptureFacts('actual-fixture-geometry'), interactionHash: hashBrowserCaptureFacts('actual-fixture-focus-hover'), overlayHash: hashBrowserCaptureFacts([]),
    fonts: { ready: true, failed: 0, fingerprint: hashBrowserCaptureFacts('actual-fixture-fonts'), glyphProof: 'observed' },
    media: { ready: true, failed: 0, fingerprint: hashBrowserCaptureFacts('actual-fixture-media') },
    carousels: [{ ...carousel, visibleIds: [...carousel.visibleIds] }], runningAnimations: 0, scroll: { x: 0, y: 0 }, coverage: { geometry: true, visibleMedia: true, carouselInventory: true },
  });
  const envelope = (index: number) => ({ binding: { ...binding }, startedAt: at(index * 1000), finishedAt: at(index * 1000 + 500), requestBytes: 1024, responseBytes: 1024 });
  return {
    version: 2, kind: 'browser-capture-transaction', startedAt: at(0), binding,
    expected: { url: 'https://example.com/reference/', document, viewport, carouselOwners: ['fixture-carousel'], fontProof: 'actual-glyphs' },
    attempts: [
      { ...envelope(0), stage: 'url', outcome: 'ok', data: { actualUrl: 'https://example.com/reference/' } },
      { ...envelope(1), stage: 'dom', outcome: 'ok', data: { actualUrl: 'https://example.com/reference/', document: { ...document }, readyState: 'complete', bodyPresent: true } },
      { ...envelope(2), stage: 'baseline', outcome: 'ok', data: { state: state(2250) } },
      { ...envelope(3), stage: 'layout', outcome: 'ok', data: { state: state(3250) } },
      { ...envelope(4), stage: 'screenshot', outcome: 'ok', data: { before: state(4100), after: state(4400), artifact: { sha256: raster.sha256, width: raster.width, height: raster.height, mode: 'viewport' } } },
      { ...envelope(5), stage: 'restore', outcome: 'ok', data: { state: state(5250) } },
    ],
  };
}
