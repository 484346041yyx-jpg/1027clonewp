import type { TargetProductSnapshot } from '../../src/wordpress/product-contract.js';

/** Synthetic target data only. No learned site IDs, amounts or device defaults. */
export function currentProductFixture(origin = 'https://target.example', variable = false): TargetProductSnapshot {
  const price = { current: '23.50', regular: '28.00', sale: '23.50', html: '<del>28.00</del><ins>23.50</ins>', onSale: true };
  const stock = { status: 'instock' as const, managed: true, quantity: 7, purchasable: true, inStock: true, backordersAllowed: false };
  return { version: 1, provider: 'target-woocommerce-product-v1', targetOrigin: origin, readAt: new Date().toISOString(), woocommerceVersion: 'synthetic', currency: 'USD', product: {
    id: 81001, status: 'publish', type: variable ? 'variable' : 'simple', name: 'Synthetic target product', permalink: origin + '/product/synthetic/', sku: 'SYNTHETIC', description: '<p>Target description</p>', shortDescription: '<p>Target summary</p>', price, stock, soldIndividually: false,
    media: [{ id: 82001, url: origin + '/media/synthetic.jpg', alt: 'Synthetic image' }],
    attributes: variable ? [{ key: 'bottle-size', name: 'Bottle Size', label: 'Bottle size', options: ['Small', 'Large'], visible: true, variation: true }] : [],
    defaultAttributes: variable ? { 'bottle-size': 'Small' } : {},
    variations: variable ? [{ id: 81002, parentId: 81001, attributes: { 'bottle-size': 'Small' }, price: { ...price }, stock: { ...stock }, image: null }] : [], variationChildrenCount: variable ? 1 : 0,
    categories: [{ id: 83001, name: 'Synthetic category', slug: 'synthetic' }], tags: [], reviews: { enabled: true, average: 0, ratingCount: 0, reviewCount: 0 },
  } };
}
