/** New profiles are opt-in identities. Missing identity always means the
 * historical four-viewport contract, including when resuming an old run. */
export const DESKTOP_BROWSER_PROFILE = 'desktop-browser-v1' as const;
export type Native44ReplicationProfile = typeof DESKTOP_BROWSER_PROFILE;
const desktop = [
  { name: 'desktop-wide', width: 1920, height: 1080, stage: 'desktop' as const },
  { name: 'desktop-narrow', width: 1440, height: 1000, stage: 'desktop' as const },
];
const historical = [...desktop, { name: 'tablet', width: 900, height: 1000, stage: 'responsive' as const }, { name: 'mobile', width: 390, height: 844, stage: 'responsive' as const }];
export function isDesktopBrowserProfile(value: unknown): value is Native44ReplicationProfile {
  if (value !== undefined && value !== DESKTOP_BROWSER_PROFILE) throw Error(`Unknown native44 replication profile: ${String(value)}`);
  return value === DESKTOP_BROWSER_PROFILE;
}
export function native44ProfileViewports(profile?: unknown) {
  return (isDesktopBrowserProfile(profile) ? desktop : historical).map(view => ({ ...view }));
}
export function assertNative44ProfileIdentity(...values: unknown[]): void {
  values.forEach(value => isDesktopBrowserProfile(value));
  if (values.some(value => value !== values[0])) throw Error('Native44 replication profile identity differs across bound artifacts');
}
