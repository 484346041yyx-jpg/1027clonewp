<?php
/**
 * Plugin Name: cloneWP Draft Carousel Playback
 * Description: Reviewed optional playback controls for explicitly opted-in owned draft pages only.
 * Version: 0.1.0
 * Requires PHP: 8.1
 *
 * Prepared source only. Installation, activation, and opt-in metadata writes
 * require a separate authorized deployment adapter. This file creates no data.
 */
defined('ABSPATH') || exit;

final class CloneWP_Draft_Carousel_Playback_V1 {
    private const ASSET_HASH = '__CLONEWP_FIXED_RUNTIME_SHA256__';
    private static $verified = null;

    /** Compare decoded JSON trees, preserving object/array and array order.
     * Numeric values use JSON number semantics rather than PHP's serializer.
     * The expected canonical bytes are separately SHA-256 checked. */
    public static function same_json($left, $right, int $depth = 0): bool {
        if ($depth > 40) return false;
        if (is_object($left) || is_object($right)) {
            if (!($left instanceof stdClass) || !($right instanceof stdClass)) return false;
            $a = get_object_vars($left); $b = get_object_vars($right);
            $ak = array_keys($a); $bk = array_keys($b);
            sort($ak, SORT_STRING); sort($bk, SORT_STRING);
            if ($ak !== $bk) return false;
            foreach ($ak as $key) if (!self::same_json($a[$key], $b[$key], $depth + 1)) return false;
            return true;
        }
        if (is_array($left) || is_array($right)) {
            if (!is_array($left) || !is_array($right) || !array_is_list($left) || !array_is_list($right) || count($left) !== count($right)) return false;
            foreach ($left as $index => $value) if (!self::same_json($value, $right[$index], $depth + 1)) return false;
            return true;
        }
        if ((is_int($left) || is_float($left)) && (is_int($right) || is_float($right))) {
            return is_finite((float) $left) && is_finite((float) $right) && abs($left) <= 9007199254740991 && abs($right) <= 9007199254740991 && (float) $left === (float) $right;
        }
        return gettype($left) === gettype($right) && $left === $right;
    }

    private static function exact_keys(array $value, array $expected): bool {
        $keys = array_keys($value); sort($keys, SORT_STRING); sort($expected, SORT_STRING);
        return $keys === $expected;
    }

    private static function inventory(array $nodes, array &$out, int $depth = 0): bool {
        if ($depth > 16) return false;
        foreach ($nodes as $node) {
            if (!is_array($node) || !isset($node['id']) || !is_string($node['id']) || !preg_match('/^[a-f0-9]{7}$/D', $node['id']) || isset($out[$node['id']]) || count($out) >= 2500) return false;
            $out[$node['id']] = $node;
            $children = $node['elements'] ?? [];
            if (!is_array($children) || !self::inventory($children, $out, $depth + 1)) return false;
        }
        return true;
    }

    private static function verify() {
        if (self::$verified !== null) return self::$verified;
        self::$verified = false;
        // No public/published page and no anonymous visitor can opt into this
        // review package, even if stale metadata is copied to another page.
        $page_id = (int) get_queried_object_id();
        if (!$page_id || !is_preview() || !is_user_logged_in() || get_post_type($page_id) !== 'page' || get_post_status($page_id) !== 'draft' || !current_user_can('edit_post', $page_id)) return false;
        $manifest = get_post_meta($page_id, '_clonewp_playback_v1', true);
        if (!is_array($manifest) || !self::exact_keys($manifest, ['version', 'kind', 'pageId', 'runId', 'documentHash', 'canonicalDocumentJSON', 'runtimeSha256', 'bindings']) || ($manifest['version'] ?? null) !== 1 || ($manifest['kind'] ?? null) !== 'clonewp-carousel-playback-opt-in' || ($manifest['pageId'] ?? null) !== $page_id || !is_string($manifest['runId']) || !preg_match('/^[a-zA-Z0-9_-]{4,100}$/D', $manifest['runId']) || get_post_meta($page_id, '_clonewp_run_id', true) !== $manifest['runId']) return false;
        $owned_pages = get_posts(['post_type' => 'page', 'post_status' => 'any', 'fields' => 'ids', 'numberposts' => 2, 'meta_key' => '_clonewp_run_id', 'meta_value' => $manifest['runId']]);
        if (count($owned_pages) !== 1 || (int) $owned_pages[0] !== $page_id || !is_string($manifest['documentHash']) || !preg_match('/^[a-f0-9]{64}$/D', $manifest['documentHash']) || !is_string($manifest['canonicalDocumentJSON']) || strlen($manifest['canonicalDocumentJSON']) > 8 * 1024 * 1024 || !hash_equals($manifest['documentHash'], hash('sha256', $manifest['canonicalDocumentJSON']))) return false;
        if ($manifest['runtimeSha256'] !== self::ASSET_HASH || !is_file(__DIR__ . '/carousel-playback.js') || !hash_equals(self::ASSET_HASH, hash_file('sha256', __DIR__ . '/carousel-playback.js'))) return false;
        if (!class_exists('Elementor\\Plugin')) return false;
        $doc = \Elementor\Plugin::$instance->documents->get($page_id);
        if (!$doc || !$doc->is_built_with_elementor() || (int) $doc->get_id() !== $page_id) return false;
        $elements = $doc->get_elements_data();
        $actual = json_decode(wp_json_encode(['elements' => $elements, 'settings' => $doc->get_settings()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $expected = json_decode($manifest['canonicalDocumentJSON']);
        if (json_last_error() !== JSON_ERROR_NONE || !($expected instanceof stdClass) || !self::same_json($actual, $expected)) return false;
        $inventory = [];
        if (!is_array($elements) || !self::inventory($elements, $inventory) || !is_array($manifest['bindings']) || !array_is_list($manifest['bindings']) || count($manifest['bindings']) < 1 || count($manifest['bindings']) > 16) return false;
        $owners = []; $buttons = []; $keys = [];
        foreach ($manifest['bindings'] as $binding) {
            if (!is_array($binding) || !self::exact_keys($binding, ['key', 'pageId', 'ownerId', 'buttonId', 'widgetType', 'initialState', 'playLabel', 'pauseLabel']) || ($binding['pageId'] ?? null) !== $page_id || !is_string($binding['key']) || !preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/D', $binding['key']) || !is_string($binding['ownerId']) || !preg_match('/^[a-f0-9]{7}$/D', $binding['ownerId']) || !is_string($binding['buttonId']) || !preg_match('/^[a-f0-9]{7}$/D', $binding['buttonId']) || $binding['ownerId'] === $binding['buttonId'] || isset($owners[$binding['ownerId']]) || isset($buttons[$binding['buttonId']]) || isset($keys[$binding['key']]) || $binding['widgetType'] !== 'nested-carousel' || !in_array($binding['initialState'], ['paused', 'playing'], true)) return false;
            foreach (['playLabel', 'pauseLabel'] as $label) if (!is_string($binding[$label]) || !trim($binding[$label]) || strlen($binding[$label]) > 640 || preg_match('/[<>\x00-\x1f]/', $binding[$label])) return false;
            $owner = $inventory[$binding['ownerId']] ?? null; $button = $inventory[$binding['buttonId']] ?? null;
            if (!$owner || !$button || ($owner['widgetType'] ?? null) !== 'nested-carousel' || !in_array($button['widgetType'] ?? null, ['button', 'wd_button'], true)) return false;
            $link = $button['settings']['link']['url'] ?? '';
            if (!in_array($link, ['', '#'], true)) return false;
            $owners[$binding['ownerId']] = true; $buttons[$binding['buttonId']] = true; $keys[$binding['key']] = true;
        }
        self::$verified = $manifest;
        return $manifest;
    }

    public static function enqueue(): void {
        $manifest = self::verify();
        if (!$manifest || !wp_script_is('elementor-frontend', 'registered')) return;
        wp_enqueue_script('clonewp-draft-carousel-playback-v1', plugins_url('carousel-playback.js', __FILE__), ['elementor-frontend'], self::ASSET_HASH, true);
    }

    public static function widget_attributes($widget): void {
        $manifest = self::verify();
        if (!$manifest || !method_exists($widget, 'get_document')) return;
        $document = $widget->get_document();
        if (!$document || (int) $document->get_id() !== $manifest['pageId']) return;
        foreach ($manifest['bindings'] as $binding) if ($widget->get_id() === $binding['buttonId'] && in_array($widget->get_name(), ['button', 'wd_button'], true)) {
            $widget->add_render_attribute('_wrapper', ['data-clonewp-playback' => $binding['key'], 'data-clonewp-carousel-owner' => $binding['ownerId']]);
        }
    }

    public static function inert_bindings(): void {
        $manifest = self::verify();
        if (!$manifest || !wp_script_is('clonewp-draft-carousel-playback-v1', 'enqueued')) return;
        // canonical document bytes and run metadata never enter frontend HTML.
        echo '<script type="application/json" id="clonewp-playback-bindings">' . wp_json_encode($manifest['bindings'], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES) . '</script>';
    }
}

add_action('wp_enqueue_scripts', ['CloneWP_Draft_Carousel_Playback_V1', 'enqueue'], 100);
add_action('elementor/frontend/widget/before_render', ['CloneWP_Draft_Carousel_Playback_V1', 'widget_attributes'], 9);
add_action('wp_footer', ['CloneWP_Draft_Carousel_Playback_V1', 'inert_bindings'], 1);
