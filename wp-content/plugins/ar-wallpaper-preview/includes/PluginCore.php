<?php
/**
 * PluginCore class.
 * Handles activation, deactivation, and main plugin setup.
 */
class ARWP_PluginCore {

	/**
	 * Singleton instance.
	 *
	 * @var ARWP_PluginCore
	 */
	protected static $instance = null;

	/**
	 * Get the singleton instance.
	 *
	 * @return ARWP_PluginCore
	 */
	public static function instance() {
		if ( is_null( self::$instance ) ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->setup_hooks();
		$this->includes();
	}

	/**
	 * Setup hooks.
	 */
	protected function setup_hooks() {
		add_action( 'plugins_loaded', array( $this, 'load_textdomain' ) );
		add_action( 'init', array( $this, 'init' ) );
	}

	/**
	 * Include necessary files.
	 */
	protected function includes() {
		// Admin class is included in the main file.
		// Shortcode class is included in the main file.
	}

	/**
	 * Plugin initialization.
	 */
	public function init() {
		// Initialize Admin settings.
		new ARWP_Admin();

		// Initialize Shortcode.
		new ARWP_Shortcode();

		// Register Gutenberg Block.
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Register the Gutenberg Block.
	 */
	public function register_block() {
		if ( ! function_exists( 'register_block_type' ) ) {
			return;
		}

		register_block_type( ARWP_PLUGIN_DIR . 'block' );
	}

	/**
	 * Load plugin textdomain.
	 */
	public function load_textdomain() {
		load_plugin_textdomain( 'ar-wallpaper-preview', false, basename( ARWP_PLUGIN_DIR ) . '/languages/' );
	}

	/**
	 * Activation hook.
	 */
	public static function activate() {
		// Set default options on activation.
		$default_options = array(
			'default_width_cm'  => 300,
			'default_height_cm' => 250,
			'enable_tiling'     => 'yes',
			'ar_engine_priority' => 'webxr,arjs,canvas_fallback',
			'default_marker_url' => '',
			'max_texture_resolution' => 2048, // Max texture size in pixels (e.g., 2048x2048)
		);
		add_option( 'arwp_settings', $default_options );
	}

	/**
	 * Deactivation hook.
	 */
	public static function deactivate() {
		// Clean up options on deactivation.
		// delete_option( 'arwp_settings' ); // Keep for easy re-activation, but can be uncommented for full cleanup.
	}
}
