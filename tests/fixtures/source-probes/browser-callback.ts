/** Keep esbuild's function-name metadata helper lexical when Playwright sends
 * a trusted local callback to a browser. No page globals or DOM are changed.
 * Arguments still travel through Playwright's ordinary serialization.
 */
export function serializableBrowserCallback<T extends (...args: any[]) => any>(callback: T): T {
  if (typeof callback !== 'function') throw Error('A trusted browser callback is required');
  const source = Function.prototype.toString.call(callback);
  if (source.includes('[native code]') || source.length > 250_000) throw Error('Browser callback must have bounded JavaScript source');
  // Construct this body from JavaScript text so the transpiler cannot lift its
  // private __name helper out of the function Playwright actually serializes.
  return new Function(`return function clonewpObservedBrowserCallback(...args) {
    const __name = (target, value) => Object.defineProperty(target, "name", { value, configurable: true });
    return (${source})(...args);
  };`)() as T;
}
