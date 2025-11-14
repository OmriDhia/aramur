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
                                'image'        => '',
                                'width_cm'     => '',
                                'height_cm'    => '',
                                'tiling'       => '',
                                'repeat_x'     => 1,
                                'repeat_y'     => 1,
                                'brightness'   => 1.0,
                                'engine'       => 'auto',
                                'occlusion'    => '',
                                'performance'  => '',
                                'auto_wall_fit'=> '',
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
                $auto_wall_fit = isset( $data['auto_wall_fit'] ) ? $data['auto_wall_fit'] : ( isset( $settings['auto_wall_fit'] ) ? $settings['auto_wall_fit'] : 'yes' );
                $occlusion_mode = ! empty( $data['occlusion'] ) ? sanitize_text_field( $data['occlusion'] ) : ( isset( $settings['occlusion_mode'] ) ? $settings['occlusion_mode'] : 'depth' );
                $performance_mode = ! empty( $data['performance'] ) ? sanitize_text_field( $data['performance'] ) : ( isset( $settings['performance_mode'] ) ? $settings['performance_mode'] : 'balanced' );

                $mediapipe_defaults = array(
                        'moduleSources'       => array(
                                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3',
                                'https://unpkg.com/@mediapipe/tasks-vision@0.10.3?module',
                        ),
                        'wasmRoots'           => array(
                                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm',
                                'https://unpkg.com/@mediapipe/tasks-vision@0.10.3/wasm',
                        ),
                        'segmenterModels'     => array(
                                'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.task',
                        ),
                        'objectDetectorModels' => array(
                                'https://storage.googleapis.com/mediapipe-models/object_detector/lite-model/float16/1/lite-model.task',
                        ),
                );

                $mediapipe_config = apply_filters( 'arwp_mediapipe_config', $mediapipe_defaults, $atts, $settings );
                $mediapipe_config = wp_parse_args( is_array( $mediapipe_config ) ? $mediapipe_config : array(), $mediapipe_defaults );

                $sanitize_url_array = static function( $urls ) {
                        if ( ! is_array( $urls ) ) {
                                $urls = array();
                        }
                        return array_values( array_filter( array_map( 'esc_url_raw', $urls ) ) );
                };

                $mediapipe_config = array(
                        'moduleSources'        => $sanitize_url_array( $mediapipe_config['moduleSources'] ),
                        'wasmRoots'            => $sanitize_url_array( $mediapipe_config['wasmRoots'] ),
                        'segmenterModels'      => $sanitize_url_array( $mediapipe_config['segmenterModels'] ),
                        'objectDetectorModels' => $sanitize_url_array( $mediapipe_config['objectDetectorModels'] ),
                );

                wp_localize_script( 'arwp-entry', 'arwpData', array(
                        'image_url'    => esc_url_raw( $data['image'] ),
                        'width_cm'     => floatval( $data['width_cm'] ?: $settings['default_width_cm'] ),
                        'height_cm'    => floatval( $data['height_cm'] ?: $settings['default_height_cm'] ),
                        'tiling'       => filter_var( $data['tiling'] ?: $settings['enable_tiling'], FILTER_VALIDATE_BOOLEAN ),
                        'repeat_x'     => floatval( $data['repeat_x'] ),
                        'repeat_y'     => floatval( $data['repeat_y'] ),
                        'brightness'   => floatval( $data['brightness'] ),
                        'engine_priority' => explode( ',', $settings['ar_engine_priority'] ),
                        'max_texture_resolution' => intval( $settings['max_texture_resolution'] ),
                        'user_engine_override' => sanitize_text_field( $data['engine'] ),
                        'marker_url'   => esc_url_raw( $settings['default_marker_url'] ),
                        'auto_wall_fit'=> filter_var( $auto_wall_fit, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE ) ?? ( 'yes' === $auto_wall_fit ),
                        'occlusion_mode' => $occlusion_mode,
                        'performance_mode' => $performance_mode,
                        'mediapipe'     => $mediapipe_config,
                        'i18n' => array(
                                'unsupported_device' => __( 'Your device does not support the required AR features.', 'ar-wallpaper-preview' ),
                                'guidance_overlay'   => __( 'Point your camera at a wall and slowly move your phone to detect a surface.', 'ar-wallpaper-preview' ),
                                'guidance_confirmed' => __( 'Wallpaper locked. Use nudge controls to fine-tune.', 'ar-wallpaper-preview' ),
                                'canvas_guidance'    => __( 'Drag the corner handles to match your wall. Use Fit buttons for quick alignment.', 'ar-wallpaper-preview' ),
                                'move'               => __( 'Move', 'ar-wallpaper-preview' ),
                                'rotate'             => __( 'Rotate', 'ar-wallpaper-preview' ),
                                'scale'              => __( 'Scale', 'ar-wallpaper-preview' ),
                                'tile'               => __( 'Tile', 'ar-wallpaper-preview' ),
                                'light'              => __( 'Light', 'ar-wallpaper-preview' ),
                                'reset'              => __( 'Reset', 'ar-wallpaper-preview' ),
                                'snapshot'           => __( 'Snapshot', 'ar-wallpaper-preview' ),
                                'place'              => __( 'Place', 'ar-wallpaper-preview' ),
                                'fit_width'          => __( 'Fit Width', 'ar-wallpaper-preview' ),
                                'fit_height'         => __( 'Fit Height', 'ar-wallpaper-preview' ),
                                'center'             => __( 'Center', 'ar-wallpaper-preview' ),
                                'scale_up'           => __( 'Scale +', 'ar-wallpaper-preview' ),
                                'scale_down'         => __( 'Scale −', 'ar-wallpaper-preview' ),
                                'rotate_left'        => __( 'Rotate ◀', 'ar-wallpaper-preview' ),
                                'rotate_right'       => __( 'Rotate ▶', 'ar-wallpaper-preview' ),
                                'performance_label'  => __( 'Mask performance', 'ar-wallpaper-preview' ),
                                'performance_quality'=> __( 'Quality', 'ar-wallpaper-preview' ),
                                'performance_balanced'=> __( 'Balanced', 'ar-wallpaper-preview' ),
                                'performance_battery'=> __( 'Battery Saver', 'ar-wallpaper-preview' ),
                                'confirm'            => __( 'Confirm', 'ar-wallpaper-preview' ),
                                'status_initialising'=> __( 'Initialising…', 'ar-wallpaper-preview' ),
                                'status_unsupported' => __( 'Unsupported', 'ar-wallpaper-preview' ),
                                'status_webxr_ready' => __( 'WebXR ready', 'ar-wallpaper-preview' ),
                                'status_canvas'      => __( '2D fallback', 'ar-wallpaper-preview' ),
                                'status_searching'   => __( 'Scanning wall…', 'ar-wallpaper-preview' ),
                                'status_wall_detected' => __( 'Wall detected', 'ar-wallpaper-preview' ),
                                'status_depth'       => __( 'Depth occlusion', 'ar-wallpaper-preview' ),
                                'status_segmentation'=> __( 'Segmentation mask', 'ar-wallpaper-preview' ),
                                'status_segmentation_fail' => __( 'Occlusion fallback inactive', 'ar-wallpaper-preview' ),
                                'status_light_estimation' => __( 'Light estimation', 'ar-wallpaper-preview' ),
                                'status_canvas_occlusion' => __( 'Canvas occlusion', 'ar-wallpaper-preview' ),
                                'camera_error'       => __( 'Camera access failed.', 'ar-wallpaper-preview' ),
                                'image_load_error'   => __( 'Wallpaper image failed to load.', 'ar-wallpaper-preview' ),
                        ),
                ) );

                // The container for the AR view.
                $output  = '<div id="arwp-container" class="arwp-container" data-image="' . esc_attr( $atts['image'] ) . '">';
                $output .= '<div id="arwp-status-tray" class="arwp-status-tray" aria-live="polite"></div>';
                $output .= '<div id="arwp-ui-controls" class="arwp-ui-controls"></div>';
                $output .= '<div id="arwp-guidance" class="arwp-guidance">' . esc_html__( 'Loading AR experience...', 'ar-wallpaper-preview' ) . '</div>';
                $output .= '</div>';

                return $output;
        }
}
