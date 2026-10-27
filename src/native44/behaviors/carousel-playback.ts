/** Optional browser behavior. This module is not a deployment adapter and is
 * never injected into an existing page by the native44 writer. */
export interface CarouselPlaybackBinding {
  key: string;
  pageId: number;
  ownerId: string;
  buttonId: string;
  widgetType: 'nested-carousel';
  initialState: 'paused' | 'playing';
  playLabel: string;
  pauseLabel: string;
}
export interface CarouselPlaybackReceipt {
  key: string;
  status: 'ready' | 'failed';
  error?: string;
}
export interface CarouselPlaybackSession {
  receipts: CarouselPlaybackReceipt[];
  destroy(): void;
}

/** Self-contained so the reviewed browser asset is generated from this exact
 * implementation. No selectors, URLs, code strings or site-specific data are
 * accepted. The button wrapper must explicitly opt into this exact owner. */
export async function installCarouselPlaybackControllers(
  bindings: CarouselPlaybackBinding[],
  options: { runtimeTimeoutMs?: number; actionTimeoutMs?: number; pollMs?: number } = {},
): Promise<CarouselPlaybackSession> {
  type Runtime = {
    initialized: boolean; destroyed?: boolean; el: Element; slides: ArrayLike<Element>;
    realIndex: number; params: { autoplay?: { delay?: number } };
    autoplay: { running: boolean; paused?: boolean; start(): unknown; stop(): unknown; resume?(): unknown };
    on?(event: string, listener: () => void): void;
    off?(event: string, listener: () => void): void;
  };
  const id = /^[a-f0-9]{7}$/;
  const keyPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
  const timeout = Math.max(50, Math.min(10_000, options.runtimeTimeoutMs ?? 3000));
  const actionTimeout = Math.max(30, Math.min(2000, options.actionTimeoutMs ?? 400));
  const pollMs = Math.max(10, Math.min(250, options.pollMs ?? 40));
  const receipts: CarouselPlaybackReceipt[] = [];
  const cleanups: Array<() => void> = [];
  const claimedOwners = new Set<string>(), claimedButtons = new Set<string>(), claimedKeys = new Set<string>();
  const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  let destroyed = false;

  if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > 16 || bindings.some(binding => !binding || typeof binding !== 'object')) {
    return { receipts: [{ key: 'invalid-batch', status: 'failed', error: 'binding_invalid_or_ambiguous' }], destroy() {} };
  }

  // Validate the entire batch before touching any DOM. Duplicate bindings must
  // not leave the first instance active while silently rejecting the second.
  for (const binding of bindings) {
    const owner = `${binding.pageId}:${binding.ownerId}`, button = `${binding.pageId}:${binding.buttonId}`;
    if (!Number.isSafeInteger(binding.pageId) || binding.pageId < 1 || !keyPattern.test(binding.key) || !id.test(binding.ownerId) || !id.test(binding.buttonId) || binding.ownerId === binding.buttonId || binding.widgetType !== 'nested-carousel' || !['paused', 'playing'].includes(binding.initialState) || [binding.playLabel, binding.pauseLabel].some(label => typeof label !== 'string' || !label.trim() || label.length > 160 || /[<>\u0000-\u001f]/.test(label)) || claimedOwners.has(owner) || claimedButtons.has(button) || claimedKeys.has(binding.key)) {
      return { receipts: bindings.map(item => ({ key: item.key, status: 'failed', error: 'binding_invalid_or_ambiguous' })), destroy() {} };
    }
    claimedOwners.add(owner); claimedButtons.add(button); claimedKeys.add(binding.key);
  }

  for (const binding of bindings) {
    const receipt: CarouselPlaybackReceipt = { key: binding.key, status: 'failed' }; receipts.push(receipt);
    let runtime: Runtime | undefined, button: HTMLElement | undefined, marker: HTMLElement | undefined;
    let disposed = false, busy = false, desired = binding.initialState;
    let interval: ReturnType<typeof setInterval> | undefined;
    let releaseListeners = () => {};
    const fail = (code: string) => {
      if (disposed) return;
      disposed = true; receipt.status = 'failed'; receipt.error = code;
      if (interval) clearInterval(interval);
      releaseListeners();
      try { runtime?.autoplay.stop(); } catch { /* No alternate owner is tried. */ }
      marker?.setAttribute('data-clonewp-playback-state', 'unavailable');
      if (button) { button.setAttribute('aria-disabled', 'true'); button.setAttribute('aria-busy', 'false'); button.setAttribute('aria-pressed', 'false'); }
    };
    const originalClone = (node: Element) => Boolean(node.closest('.swiper-slide-duplicate,.slick-cloned,[data-clonewp-runtime-clone]'));
    const locate = () => {
      const pages = document.querySelectorAll(`[data-elementor-id="${binding.pageId}"]`);
      if (pages.length !== 1) throw Error('page_owner_ambiguous');
      const page = pages[0];
      const owners = page.querySelectorAll(`[data-id="${binding.ownerId}"]`);
      const markers = page.querySelectorAll(`[data-id="${binding.buttonId}"]`);
      // Never remove alleged clones from this count. A duplicate cannot hide
      // behind a user-supplied clone class or an unrelated Swiper instance.
      if (owners.length !== 1 || markers.length !== 1) throw Error('widget_owner_ambiguous');
      const owner = owners[0], controlMarker = markers[0] as HTMLElement;
      if (owner.getAttribute('data-widget_type') !== `${binding.widgetType}.default` || !['button.default', 'wd_button.default'].includes(controlMarker.getAttribute('data-widget_type') ?? '') || originalClone(owner) || originalClone(controlMarker) || owner.contains(controlMarker)) throw Error('widget_owner_invalid');
      if (controlMarker.getAttribute('data-clonewp-playback') !== binding.key || controlMarker.getAttribute('data-clonewp-carousel-owner') !== binding.ownerId) throw Error('button_opt_in_missing');
      const controls = [...controlMarker.querySelectorAll<HTMLElement>('button.elementor-button,a.elementor-button,button.btn,a.btn')].filter(node => node.closest('[data-widget_type]') === controlMarker);
      if (controls.length !== 1) throw Error('button_control_ambiguous');
      const control = controls[0];
      if (control.closest('form') || control instanceof HTMLButtonElement && control.type !== 'button' || control instanceof HTMLAnchorElement && ![null, '', '#'].includes(control.getAttribute('href'))) throw Error('button_control_has_business_action');
      const candidates = [owner, ...owner.querySelectorAll('*')].filter(node => node.closest('[data-widget_type]') === owner).map(node => ({ node, runtime: (node as Element & { swiper?: Runtime }).swiper })).filter(row => row.runtime?.initialized === true && row.runtime.destroyed !== true);
      const runtimes = [...new Set(candidates.map(row => row.runtime!))];
      if (runtimes.length > 1) throw Error('swiper_owner_ambiguous');
      const found = runtimes[0];
      if (found && (!candidates.some(row => row.node === found.el) || !owner.contains(found.el) || !found.slides || found.slides.length < 2 || !Array.from(found.slides).every(slide => found.el.contains(slide)) || !Number.isInteger(found.realIndex) || !found.autoplay || typeof found.autoplay.start !== 'function' || typeof found.autoplay.stop !== 'function' || typeof found.autoplay.running !== 'boolean' || !Number.isFinite(found.params?.autoplay?.delay) || Number(found.params.autoplay!.delay) < 20)) throw Error('swiper_playback_unavailable');
      return { owner, marker: controlMarker, button: control, runtime: found };
    };
    const assertCurrent = () => {
      const current = locate();
      if (!runtime || current.runtime !== runtime || current.button !== button || current.marker !== marker || runtime.destroyed) throw Error('playback_owner_changed');
      return current;
    };
    const render = () => {
      const { owner } = assertCurrent();
      const playing = desired === 'playing' && runtime!.autoplay.running;
      const actual = !runtime!.autoplay.running ? 'paused' : runtime!.autoplay.paused === true ? 'suspended' : 'playing';
      marker!.setAttribute('data-clonewp-playback-state', actual);
      marker!.setAttribute('data-clonewp-playback-intent', desired);
      button!.setAttribute('aria-pressed', String(playing));
      button!.setAttribute('aria-label', playing ? binding.pauseLabel : binding.playLabel);
      button!.setAttribute('aria-disabled', 'false');
      button!.setAttribute('aria-busy', String(busy));
      const labels = marker!.querySelectorAll('[data-clonewp-playback-label],.elementor-button-text');
      if (labels.length === 1) labels[0].textContent = playing ? binding.pauseLabel : binding.playLabel;
      const inside = runtime!.el.querySelector('.swiper-wrapper');
      inside?.setAttribute('aria-live', playing ? 'off' : 'polite');
      if (!owner.id) owner.id = `clonewp-carousel-${binding.pageId}-${binding.ownerId}`;
      if (document.querySelectorAll(`[id="${owner.id.replace(/[^a-zA-Z0-9_-]/g, '')}"]`).length !== 1 || !/^[a-zA-Z0-9_-]+$/.test(owner.id)) throw Error('carousel_dom_id_ambiguous');
      button!.setAttribute('aria-controls', owner.id);
    };
    const command = async (next: 'paused' | 'playing') => {
      if (busy || disposed || destroyed) return;
      busy = true; desired = next;
      try {
        assertCurrent();
        if (next === 'paused') runtime!.autoplay.stop();
        else {
          if (!runtime!.autoplay.running) runtime!.autoplay.start();
          if (runtime!.autoplay.paused === true && runtime!.autoplay.resume) runtime!.autoplay.resume();
        }
        const until = Date.now() + actionTimeout;
        while (Date.now() < until) {
          assertCurrent();
          // running=false is a stopped autoplay even when Swiper leaves its
          // paused flag stale. running=true/paused=true is suspended, not stopped.
          if (next === 'paused' ? !runtime!.autoplay.running : runtime!.autoplay.running && runtime!.autoplay.paused !== true) break;
          await delay(pollMs);
        }
        if (next === 'paused' ? runtime!.autoplay.running : !runtime!.autoplay.running || runtime!.autoplay.paused === true) throw Error('playback_command_timeout');
        busy = false; render();
      } catch (error) { fail(error instanceof Error ? error.message : 'playback_command_failed'); }
      finally { busy = false; }
    };
    try {
      let located = locate();
      const until = Date.now() + timeout;
      while (!located.runtime && Date.now() < until && !destroyed) { await delay(pollMs); located = locate(); }
      if (!located.runtime || destroyed) throw Error('swiper_initialization_timeout');
      runtime = located.runtime; button = located.button; marker = located.marker;
      if (marker.hasAttribute('data-clonewp-playback-attached')) throw Error('playback_already_attached');
      marker.setAttribute('data-clonewp-playback-attached', 'true');
      button.setAttribute('role', 'button'); button.setAttribute('tabindex', '0');
      const onClick = (event: Event) => { event.preventDefault(); void command(desired === 'playing' && runtime!.autoplay.running ? 'paused' : 'playing'); };
      const onKey = (event: KeyboardEvent) => { if (button instanceof HTMLAnchorElement && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) button.click(); } };
      const onRuntime = () => {
        if (disposed || busy) return;
        try {
          assertCurrent();
          // A later native Next/Previous action must not restart autoplay after
          // the user paused it. Preserve native movement and stop only its timer.
          if (desired === 'paused' && runtime!.autoplay.running) runtime!.autoplay.stop();
          render();
        } catch (error) { fail(error instanceof Error ? error.message : 'playback_owner_changed'); }
      };
      const events = ['autoplayStart', 'autoplayStop', 'autoplayPause', 'autoplayResume', 'slideChange', 'destroy'];
      button.addEventListener('click', onClick); button.addEventListener('keydown', onKey);
      events.forEach(event => runtime!.on?.(event, onRuntime));
      releaseListeners = () => { button?.removeEventListener('click', onClick); button?.removeEventListener('keydown', onKey); events.forEach(event => runtime?.off?.(event, onRuntime)); };
      await command(binding.initialState);
      if (!disposed) {
        receipt.status = 'ready'; delete receipt.error;
        interval = setInterval(onRuntime, pollMs);
        cleanups.push(() => { if (interval) clearInterval(interval); releaseListeners(); disposed = true; try { runtime?.autoplay.stop(); } catch {} marker?.removeAttribute('data-clonewp-playback-attached'); });
      }
    } catch (error) { fail(error instanceof Error ? error.message : 'playback_initialization_failed'); }
  }
  return { receipts, destroy() { destroyed = true; cleanups.forEach(cleanup => cleanup()); } };
}

/** Fixed source for the optional reviewed plugin asset. __name supports tsx's
 * harmless function-name annotations; no arbitrary function input is accepted. */
export function carouselPlaybackBrowserSource(): string {
  return `/* cloneWP generic carousel playback v1; locally prepared, not deployed. */\n(() => {\nconst __name = target => target;\nconst install = (${installCarouselPlaybackControllers.toString()});\nconst node = document.getElementById('clonewp-playback-bindings');\nif (!node || node.tagName !== 'SCRIPT' || node.type !== 'application/json') return;\nlet bindings; try { bindings = JSON.parse(node.textContent || '[]'); } catch { return; }\nif (!Array.isArray(bindings) || bindings.length > 16) return;\nvoid install(bindings).then(session => { window.dispatchEvent(new CustomEvent('clonewp:playback-ready', { detail: { receipts: session.receipts } })); });\n})();\n`;
}
