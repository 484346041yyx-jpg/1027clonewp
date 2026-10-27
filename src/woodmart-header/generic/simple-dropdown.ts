import type { HeaderModuleMenu } from './contract.js';

export interface SimpleDropdownPresentation {
  itemKey: string;
  width: number;
  offset: number;
  itemHeight: number;
  paddingX: number;
  paddingBottom: number;
  backgroundColor: string;
  textColor: string;
  hoverColor: string;
  shadow: boolean;
}

const color = /^#[0-9a-fA-F]{6}$/;

export function validateSimpleDropdowns(menu: HeaderModuleMenu): void {
  if (menu.dropdowns === undefined) return;
  if (!Array.isArray(menu.dropdowns) || menu.dropdowns.length > 30) throw Error('woodmart_header_module_dropdowns_invalid');
  const seen = new Set<string>();
  for (const entry of menu.dropdowns) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'backgroundColor,hoverColor,itemHeight,itemKey,offset,paddingBottom,paddingX,shadow,textColor,width' ||
      typeof entry.itemKey !== 'string' || seen.has(entry.itemKey) ||
      !menu.items.some(item => item.parentKey === entry.itemKey) ||
      !Number.isInteger(entry.width) || entry.width < 200 || entry.width > 800 ||
      !Number.isInteger(entry.offset) || entry.offset < -30 || entry.offset > 30 ||
      !Number.isInteger(entry.itemHeight) || entry.itemHeight < 24 || entry.itemHeight > 80 ||
      !Number.isInteger(entry.paddingX) || entry.paddingX < 0 || entry.paddingX > 80 ||
      !Number.isInteger(entry.paddingBottom) || entry.paddingBottom < 0 || entry.paddingBottom > 80 ||
      !color.test(entry.backgroundColor) || !color.test(entry.textColor) || !color.test(entry.hoverColor) ||
      typeof entry.shadow !== 'boolean') throw Error('woodmart_header_module_dropdowns_invalid');
    seen.add(entry.itemKey);
  }
}

export function compileSimpleDropdownCSS(menus: HeaderModuleMenu[], ids: Record<string, Record<string, number>>): string {
  const rules: string[] = [];
  for (const menu of menus) for (const entry of menu.dropdowns ?? []) {
    const itemId = ids[menu.key]?.[entry.itemKey];
    if (!Number.isSafeInteger(itemId) || itemId < 1) throw Error('woodmart_header_module_dropdown_item_unresolved');
    const selector = `:header .wd-nav-main>li.menu-item-${itemId}.menu-item-has-children`;
    rules.push(`${selector}>.wd-dropdown-menu{width:${entry.width}px!important;min-width:${entry.width}px!important;margin-top:${entry.offset}px!important;padding:0 0 ${entry.paddingBottom}px!important;border-radius:0!important;background:${entry.backgroundColor}!important;box-shadow:${entry.shadow?'2px 3px 6px 2px rgba(0,0,0,.1)':'none'}!important}`);
    rules.push(`${selector}>.wd-dropdown-menu>.container{width:100%;padding:0 ${entry.paddingX}px!important}`);
    rules.push(`${selector}>.wd-dropdown-menu .wd-sub-menu>li>a{display:block;min-height:${entry.itemHeight}px;padding:${entry.itemHeight-21}px 0 0!important;color:${entry.textColor}!important;font-size:15px;line-height:21px;white-space:normal}`);
    rules.push(`${selector}>.wd-dropdown-menu .wd-sub-menu>li>a:hover{color:${entry.hoverColor}!important}`);
  }
  return rules.join('');
}
