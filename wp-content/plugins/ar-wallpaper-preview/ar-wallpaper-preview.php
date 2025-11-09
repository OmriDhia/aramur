<?php
/**
 * Plugin Name: AR Wallpaper Preview
 * Description: Adds an augmented reality wallpaper preview button to WooCommerce product pages.
 * Version: 1.0.0
 * Author: OpenAI Assistant
 * Text Domain: ar-wallpaper-preview
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

if ( ! defined( 'AR_WALLPAPER_PREVIEW_FILE' ) ) {
    define( 'AR_WALLPAPER_PREVIEW_FILE', __FILE__ );
}

require_once __DIR__ . '/includes/class-ar-wallpaper-preview.php';

function ar_wallpaper_preview_init() {
    if ( class_exists( 'AR_Wallpaper_Preview' ) ) {
        AR_Wallpaper_Preview::get_instance();
    }
}
add_action( 'plugins_loaded', 'ar_wallpaper_preview_init' );
