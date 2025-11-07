<?php
/**
 * Shortcode class.
 * Handles the [ar_wallpaper_preview] shortcode.
 */
class ARWP_Shortcode {

	/**
	 * Constructor.
	 */
	public function __construct() {
		add_shortcode( 'ar_wallpaper_preview', array( $this, 'render_shortcode' ) );
	}

	/**
	 * Render the shortcode.
	 *
	 * @param array $atts Shortcode attributes.
	 * @return string HTML output.
	 */
	public function render_shortcode( $atts ) {
		// This will be implemented in a later phase.
		$atts = shortcode_atts(
			array(
				'image'       => '',
				'width_cm'    => '',
				'height_cm'   => '',
				'tiling'      => '',
				'repeat_x'    => 1,
				'repeat_y'    => 1,
				'brightness'  => 1.0,
				'engine'      => 'auto',
			),
			$atts,
			'ar_wallpaper_preview'
		);

		if ( empty( $atts['image'] ) ) {
			return '<p style="color: red;">' . esc_html__( 'Error: The "image" attribute is required for the AR Wallpaper Preview shortcode.', 'ar-wallpaper-preview' ) . '</p>';
		}

		// Enqueue scripts and styles only when the shortcode is present.
		wp_enqueue_style( 'arwp-style', ARWP_PLUGIN_URL . 'assets/css/style.css', array(), ARWP_VERSION );
		wp_enqueue_script( 'arwp-entry', ARWP_PLUGIN_URL . 'build/index.js', array(), ARWP_VERSION, true );

		// Get settings from DB, merge with shortcode attributes.
		$settings = get_option( 'arwp_settings', array() );
		$data = array_merge( $settings, $atts );

		// Pass data to the frontend script.
		wp_localize_script( 'arwp-entry', 'arwpData', array(
			'image_url' => esc_url_raw( $data['image'] ),
			'width_cm'  => floatval( $data['width_cm'] ?: $settings['default_width_cm'] ),
			'height_cm' => floatval( $data['height_cm'] ?: $settings['default_height_cm'] ),
			'tiling'    => filter_var( $data['tiling'] ?: $settings['enable_tiling'], FILTER_VALIDATE_BOOLEAN ),
			'repeat_x'  => floatval( $data['repeat_x'] ),
			'repeat_y'  => floatval( $data['repeat_y'] ),
			'brightness'=> floatval( $data['brightness'] ),
			'engine_priority' => explode( ',', $settings['ar_engine_priority'] ),
			'max_texture_resolution' => intval( $settings['max_texture_resolution'] ),
			'user_engine_override' => sanitize_text_field( $data['engine'] ),
			'marker_url' => esc_url_raw( $settings['default_marker_url'] ),
			'i18n' => array(
				'unsupported_device' => __( 'Your device does not support the required AR features.', 'ar-wallpaper-preview' ),
				'guidance_overlay'   => __( 'Point your camera at a wall and slowly move your phone to detect a surface.', 'ar-wallpaper-preview' ),
				'move'               => __( 'Move', 'ar-wallpaper-preview' ),
				'rotate'             => __( 'Rotate', 'ar-wallpaper-preview' ),
				'scale'              => __( 'Scale', 'ar-wallpaper-preview' ),
				'tile'               => __( 'Tile', 'ar-wallpaper-preview' ),
				'light'              => __( 'Light', 'ar-wallpaper-preview' ),
				'reset'              => __( 'Reset', 'ar-wallpaper-preview' ),
				'snapshot'           => __( 'Snapshot', 'ar-wallpaper-preview' ),
				'place'              => __( 'Place', 'ar-wallpaper-preview' ),
			),
		) );

		// The container for the AR view.
		$output = '<div id="arwp-container" class="arwp-container" data-image="' . esc_attr( $atts['image'] ) . '">';
		$output .= '<div id="arwp-ui-controls" class="arwp-ui-controls"></div>';
		$output .= '<div id="arwp-guidance" class="arwp-guidance">' . esc_html__( 'Loading AR experience...', 'ar-wallpaper-preview' ) . '</div>';
		$output .= '</div>';

		return $output;
	}
}
