import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** User-owned component identities. Adding an identity requires changing this contract. */
export const NATIVE44_ALL_TYPES = [
  'text-editor', 'html', 'heading', 'woocommerce-products', 'wd_nested_carousel',
  'wd_text_block', 'slides', 'wd_products_tabs', 'wd_products_brands', 'wd_products',
  'wd_blog', 'wd_button', 'wd_wc_breadcrumb', 'wd_image_or_svg', 'accordion',
  'wd_title', 'wd_contact_form_7', 'wd_product_categories', 'wd_testimonials',
  'wd_banner_carousel', 'wd_wishlist', 'wd_page_heading', 'wd_compare',
  'wd_element_breadcrumbs', 'wd_infobox_carousel', 'wd_infobox', 'wd_extra_menu_list',
  'wd_sidebar', 'wd_counter', 'wd_list', 'wd_social_buttons', 'nested-tabs',
  'nested-accordion', 'social-icons', 'icon', 'image-box', 'wd_toggle', 'icon-box',
  'breadcrumbs', 'form', 'nested-carousel', 'button', 'divider', 'container',
] as const;
export type Native44WidgetType = typeof NATIVE44_ALL_TYPES[number];
/** Additive identities; this list alone does not grant an old task permission. */
export const CORE_SINGLE_PRODUCT_TYPES = ['wd_single_product_gallery','wd_single_product_title','wd_single_product_rating','wd_single_product_short_description','wd_single_product_price','wd_single_product_add_to_cart','wd_single_product_meta','wd_single_product_content','wd_single_product_additional_info_table','wd_single_product_tabs','wd_single_product_reviews','wd_wc_notices'] as const;
export const EXTENDED_NATIVE_TYPES = [...NATIVE44_ALL_TYPES, ...CORE_SINGLE_PRODUCT_TYPES] as const;
export type KnownNativeWidgetType = typeof EXTENDED_NATIVE_TYPES[number];
export function assertKnownNativeWidget(type: string): asserts type is KnownNativeWidgetType {
  if (!(EXTENDED_NATIVE_TYPES as readonly string[]).includes(type)) throw Error(`native44_component_not_allowed: ${type}`);
}
export const NATIVE44_WIDGETS = NATIVE44_ALL_TYPES.filter(type => type !== 'container');
export const NATIVE44_CATALOG_HASH = '5c459e861145db6968998aebbb724da274daa1a9a6e8aba54a6363668fa5e5c1';
export const NATIVE44_REQUIRED_ENVIRONMENT = Object.freeze({ woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' });
const allowed = new Set<string>(NATIVE44_ALL_TYPES);
export function assertAllowedWidget(type: string): asserts type is Native44WidgetType {
  if (!allowed.has(type)) throw new Error(`native44_component_not_allowed: ${type}`);
}
export function validateNative44Catalog(value: unknown): asserts value is { components: { componentType: Native44WidgetType; elementKind: string }[] } {
  if (!value || typeof value !== 'object' || !Array.isArray((value as any).components)) throw new Error('native44_catalog_invalid');
  const rows = (value as any).components as { componentType: string; elementKind: string }[];
  if (rows.length !== 44 || new Set(rows.map(row => row.componentType)).size !== 44) throw new Error('native44_catalog_count_or_duplicate');
  for (const [index, row] of rows.entries()) {
    assertAllowedWidget(row.componentType);
    if (row.componentType !== NATIVE44_ALL_TYPES[index] || row.elementKind !== (row.componentType === 'container' ? 'container' : 'widget')) throw new Error(`native44_catalog_identity_mismatch: ${index}`);
  }
}
export async function verifyNative44Catalog(path = 'D:/cloneWP/config/native44-component-set.json'): Promise<void> {
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== NATIVE44_CATALOG_HASH) throw new Error('native44_catalog_hash_mismatch');
  validateNative44Catalog(JSON.parse(bytes.toString('utf8')));
}
