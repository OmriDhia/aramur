<?php
/**
 * Plugin Name: AR Wallpaper Preview
 * Plugin URI: https://example.com/ar-wallpaper-preview
 * Description: Lets shoppers preview wallpapers on their real walls using their phone camera with WebXR, AR.js, and canvas fallback.
 * Version: 1.0.0
 * Author: Manus AI
 * Author URI: https://manus.im
 * License: GPL2
 * Text Domain: ar-wallpaper-preview
 * Domain Path: /languages
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ARWP_VERSION', '1.0.0' );
define( 'ARWP_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'ARWP_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// Include core classes.
require_once ARWP_PLUGIN_DIR . 'includes/Admin.php';
require_once ARWP_PLUGIN_DIR . 'includes/Shortcode.php';
require_once ARWP_PLUGIN_DIR . 'includes/PluginCore.php';

/**
 * The main function responsible for returning the one and only ARWP instance.
 *
 * @return ARWP_PluginCore
 */
function arwp_run() {
	return ARWP_PluginCore::instance();
}

// Start the plugin.
arwp_run();

// Activation and Deactivation hooks
register_activation_hook( __FILE__, array( 'ARWP_PluginCore', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'ARWP_PluginCore', 'deactivate' ) );
