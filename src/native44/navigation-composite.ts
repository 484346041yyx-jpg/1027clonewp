import { z } from 'zod';
import type { Native44Component, Native44Composite, Native44Native } from './types.js';

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,55}$/);
const text = z.string().trim().min(1).max(500).refine(value => !/[<>\u0000-\u001f]/.test(value), 'Navigation labels are plain text');
const link = z.object({ label: text, url: z.string().url().refine(value => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }, 'Navigation requires a real HTTP destination without credentials') }).strict();
export const Native44DisclosureNavigationSchema = z.object({
  key, label: text,
  panels: z.array(z.object({ key, title: text, overview: link.optional(),
    columns: z.array(z.object({ title: text.optional(), links: z.array(link).min(1).max(100) }).strict()).min(1).max(8),
    footerLinks: z.array(link).max(20).optional(),
  }).strict()).min(1).max(30),
  footerLinks: z.array(link).max(20).optional(),
}).strict();
export type Native44DisclosureNavigation = z.infer<typeof Native44DisclosureNavigationSchema>;

/** A native composition, not a menu service or a script. Data and presentation
 * remain task inputs; Accordion and Tabs own their real interaction state. */
export function createNative44DisclosureNavigation(input: unknown): Native44Composite {
  const data = Native44DisclosureNavigationSchema.parse(input);
  if (new Set(data.panels.map(panel => panel.key)).size !== data.panels.length) throw Error('native44_navigation_duplicate_panel');
  const zero = { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true };
  const container = (suffix: string, children: Native44Component[], className: string): Native44Composite => ({
    kind: 'composite', key: `${data.key}_${suffix}`, role: 'navigation',
    settings: { content_width: 'full', flex_direction: 'column', padding: zero, css_classes: className }, children,
  });
  const links = (suffix: string, items: Array<z.infer<typeof link>>, className: string): Native44Native => ({
    kind: 'native', key: `${data.key}_${suffix}`, widgetType: 'wd_list', role: 'navigation',
    widgetSettings: { _css_classes: className, list_items: items.map(item => ({ list_content: item.label, link: { url: item.url } })), icon: { value: '', library: '' } },
  });
  const heading = (suffix: string, title: string): Native44Native => ({ kind: 'native', key: `${data.key}_${suffix}`, widgetType: 'heading', role: 'heading', widgetSettings: { title, header_size: 'h3', _css_classes: 'cwp-nav-heading' } });
  const panels = data.panels.map((panel, index) => {
    const columns = panel.columns.map((column, columnIndex) => container(`p${index}_c${columnIndex}`, [
      ...(column.title ? [heading(`p${index}_c${columnIndex}_title`, column.title)] : []),
      links(`p${index}_c${columnIndex}_links`, column.links, 'cwp-nav-links'),
    ], 'cwp-nav-column'));
    const row = container(`p${index}_columns`, columns, 'cwp-nav-columns'); row.settings!.flex_direction = 'row';
    return container(`panel${index}`, [heading(`p${index}_title`, panel.title),
      ...(panel.overview ? [links(`p${index}_overview`, [panel.overview], 'cwp-nav-overview')] : []), row,
      ...(panel.footerLinks?.length ? [links(`p${index}_footer`, panel.footerLinks, 'cwp-nav-panel-footer')] : []),
    ], 'cwp-nav-panel');
  });
  const tabs: Native44Native = { kind: 'native', key: `${data.key}_tabs`, role: 'navigation', widgetType: 'nested-tabs',
    widgetSettings: { tabs: data.panels.map(panel => ({ tab_title: panel.title })), tabs_direction: 'inline-start', breakpoint_selector: 'none', _css_classes: 'cwp-nav-tabs' }, children: panels };
  const content = container('content', [tabs, ...(data.footerLinks?.length ? [links('footer', data.footerLinks, 'cwp-nav-footer')] : [])], 'cwp-nav-content');
  const disclosure: Native44Native = { kind: 'native', key: `${data.key}_disclosure`, role: 'navigation', widgetType: 'nested-accordion',
    widgetSettings: { items: [{ item_title: data.label }], default_state: 'all_collapsed', max_items_expended: 'one', title_tag: 'span',
      accordion_item_title_icon_position: 'start', accordion_item_title_icon: { value: 'fas fa-bars', library: 'fa-solid' },
      accordion_item_title_icon_active: { value: 'fas fa-times', library: 'fa-solid' }, _css_classes: 'cwp-nav-disclosure' }, children: [content] };
  return container('root', [disclosure], 'cwp-disclosure-navigation');
}
