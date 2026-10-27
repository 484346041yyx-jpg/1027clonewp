<?php
defined('ABSPATH') || exit;
add_action('admin_post_clonewp_test_setup', function () {
    current_user_can('manage_options') && current_user_can('manage_woocommerce') || wp_die('无权限。', '', ['response' => 403]);
    check_admin_referer('clonewp_test_setup');
    try {
        $service = clonewp_reset_service(); $status = $service->status();
        if ($status['baseline'] || $status['pending']) throw new RuntimeException('基准已冻结或存在未决操作，不能重新初始化。');
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        foreach (['elementor/elementor.php', 'elementor-pro/elementor-pro.php', 'woocommerce/woocommerce.php', 'woodmart-core/woodmart-core.php', 'novamira/novamira.php'] as $plugin) {
            if (!is_plugin_active($plugin)) throw new RuntimeException('缺少启用的依赖：' . $plugin);
        }
        $theme = wp_get_theme();
        if ($theme->get_stylesheet() !== 'woodmart' && $theme->get_template() !== 'woodmart') throw new RuntimeException('请先启用 WoodMart 主题。');
        // A named lock protects the complete setup action, including partial-response reconciliation.
        global $wpdb;
        $lock = 'clonewp_setup_' . substr(hash('sha256', home_url()), 0, 24);
        if ((int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock)) !== 1) throw new RuntimeException('初始化正在进行。');
        try {
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/media.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';
            $specs = [
                ['sku' => 'CLONEWP-TEST-001', 'name' => '测试商品 01 · 玻璃瓶', 'price' => '19.00', 'sale' => '15.00'],
                ['sku' => 'CLONEWP-TEST-002', 'name' => '测试商品 02 · 护肤罐', 'price' => '29.00'],
                ['sku' => 'CLONEWP-TEST-003', 'name' => '测试商品 03 · 按压瓶', 'price' => '39.00'],
                ['sku' => 'CLONEWP-TEST-004', 'name' => '测试商品 04 · 礼盒', 'price' => '49.00'],
                ['sku' => 'CLONEWP-TEST-005', 'name' => '测试商品 05 · 补充装', 'price' => '59.00', 'out' => true],
                ['sku' => 'CLONEWP-TEST-006', 'name' => '测试商品 06 · 组合装', 'price' => '69.00'],
            ];
            $category = get_term_by('slug', 'clonewp-test-products', 'product_cat');
            if (!$category) { $created = wp_insert_term('复刻测试商品', 'product_cat', ['slug' => 'clonewp-test-products']); if (is_wp_error($created)) throw new RuntimeException('测试分类创建失败。'); $categoryId = $created['term_id']; }
            else $categoryId = $category->term_id;
            foreach ($specs as $index => $spec) {
                $id = wc_get_product_id_by_sku($spec['sku']);
                if ($id) {
                    if (get_post_meta($id, '_clonewp_test_seed', true) !== 'v1') throw new RuntimeException('测试 SKU 被其他商品占用，未覆盖。');
                    $product = wc_get_product($id);
                } else {
                    $product = new WC_Product_Simple(); $product->set_name($spec['name']); $product->set_sku($spec['sku']);
                    $product->set_status('publish'); $product->set_regular_price($spec['price']);
                    if (isset($spec['sale'])) $product->set_sale_price($spec['sale']);
                    $product->set_description('固定测试站示例商品，仅用于布局、商品查询、轮播和编辑测试。');
                    $product->set_short_description('cloneWP 基准测试商品'); $product->set_virtual(true);
                    $product->set_stock_status(!empty($spec['out']) ? 'outofstock' : 'instock');
                    $product->set_category_ids([(int) $categoryId]); $product->update_meta_data('_clonewp_test_seed', 'v1'); $id = $product->save();
                    if (!$id) throw new RuntimeException('测试商品保存失败。');
                }
                if (!$product->get_image_id()) {
                    $asset = __DIR__ . '/assets/product-' . ($index + 1) . '.png';
                    $temporary = wp_tempnam('clonewp-product-' . ($index + 1) . '.png');
                    if (!$temporary || !copy($asset, $temporary)) throw new RuntimeException('测试图片准备失败。');
                    $attachment = media_handle_sideload(['name' => 'clonewp-test-' . ($index + 1) . '.png', 'tmp_name' => $temporary], $id, $spec['name']);
                    if (is_wp_error($attachment)) { @unlink($temporary); throw new RuntimeException('测试图片导入失败。'); }
                    update_post_meta($attachment, '_wp_attachment_image_alt', $spec['name']);
                    update_post_meta($attachment, '_clonewp_test_seed', 'v1');
                    $product->set_image_id($attachment); $product->save();
                }
            }
            WC_Install::create_pages();
            update_option('blogname', 'cloneWP 固定测试站'); update_option('blogdescription', '参考网站复刻与组件测试环境');
            update_option('timezone_string', 'Asia/Taipei'); update_option('permalink_structure', '/%postname%/'); update_option('blog_public', '0');
            update_option('woocommerce_currency', 'USD'); update_option('woocommerce_calc_taxes', 'no');
            update_option('elementor_cpt_support', array_values(array_unique(array_merge((array) get_option('elementor_cpt_support', ['post', 'page']), ['page', 'cms_block']))));
            $shop = wc_get_page_id('shop'); if ($shop > 0) { update_option('show_on_front', 'page'); update_option('page_on_front', $shop); }
            foreach ([1 => 'Hello world!', 2 => 'Sample Page'] as $postId => $title) {
                $post = get_post($postId); if ($post && $post->post_title === $title && $post->post_status !== 'trash') wp_trash_post($postId);
            }
            $comment = get_comment(1); if ($comment && $comment->comment_author === 'A WordPress Commenter') wp_trash_comment(1);
            flush_rewrite_rules(false);
            update_option('clonewp_test_seed_version', 'v1', false);
        } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); }
        wp_safe_redirect(admin_url('tools.php?page=clonewp-test-reset')); exit;
    } catch (Throwable $e) { wp_die(esc_html($e->getMessage()), '测试站初始化未完成', ['back_link' => true]); }
});
