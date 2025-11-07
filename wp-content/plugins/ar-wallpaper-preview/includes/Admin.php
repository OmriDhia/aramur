<?php
/**
 * Admin class.
 * Handles the plugin settings page.
 */
class ARWP_Admin {

	/**
	 * Constructor.
	 */
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'add_admin_menu' ) );
		add_action( 'admin_init', array( $this, 'settings_init' ) );
	}

	/**
	 * Add admin menu item.
	 */
	public function add_admin_menu() {
		add_options_page(
			__( 'AR Wallpaper Preview Settings', 'ar-wallpaper-preview' ),
			__( 'AR Wallpaper Preview', 'ar-wallpaper-preview' ),
			'manage_options',
			'ar-wallpaper-preview',
			array( $this, 'options_page' )
		);
	}

	/**
	 * Initialize settings.
	 */
	public function settings_init() {
		register_setting( 'arwp_settings_group', 'arwp_settings', array( $this, 'settings_validate' ) );

		add_settings_section(
			'arwp_main_section',
			__( 'General AR Settings', 'ar-wallpaper-preview' ),
			array( $this, 'settings_section_callback' ),
			'ar-wallpaper-preview'
		);

		// Default Wallpaper Size
		add_settings_field(
			'default_width_cm',
			__( 'Default Wallpaper Width (cm)', 'ar-wallpaper-preview' ),
			array( $this, 'text_input_callback' ),
			'ar-wallpaper-preview',
			'arwp_main_section',
			array(
				'id'    => 'default_width_cm',
				'label' => __( 'Default width of the wallpaper in centimeters.', 'ar-wallpaper-preview' ),
				'type'  => 'number',
			)
		);
		add_settings_field(
			'default_height_cm',
			__( 'Default Wallpaper Height (cm)', 'ar-wallpaper-preview' ),
			array( $this, 'text_input_callback' ),
			'ar-wallpaper-preview',
			'arwp_main_section',
			array(
				'id'    => 'default_height_cm',
				'label' => __( 'Default height of the wallpaper in centimeters.', 'ar-wallpaper-preview' ),
				'type'  => 'number',
			)
		);

		// Tiling
		add_settings_field(
			'enable_tiling',
			__( 'Enable Tiling by Default', 'ar-wallpaper-preview' ),
			array( $this, 'checkbox_callback' ),
			'ar-wallpaper-preview',
			'arwp_main_section',
			array(
				'id'    => 'enable_tiling',
				'label' => __( 'Check to enable wallpaper tiling/repeat by default.', 'ar-wallpaper-preview' ),
			)
		);

		// AR Engine Priority
		add_settings_field(
			'ar_engine_priority',
			__( 'AR Engine Priority', 'ar-wallpaper-preview' ),
			array( $this, 'text_input_callback' ),
			'ar-wallpaper-preview',
			'arwp_main_section',
			array(
				'id'    => 'ar_engine_priority',
				'label' => __( 'Comma-separated list of AR engines in order of preference (e.g., webxr,arjs,canvas_fallback).', 'ar-wallpaper-preview' ),
				'type'  => 'text',
			)
		);

		// Default Marker URL
		add_settings_field(
			'default_marker_url',
			__( 'Default AR Marker URL', 'ar-wallpaper-preview' ),
			array( $this, 'text_input_callback' ),
			'ar-wallpaper-preview',
			'arwp_main_section',
			array(
				'id'    => 'default_marker_url',
				'label' => __( 'URL to a default marker image for AR.js fallback mode.', 'ar-wallpaper-preview' ),
				'type'  => 'url',
			)
		);

		// Max Texture Resolution
		add_settings_field(
			'max_texture_resolution',
			__( 'Max Texture Resolution (px)', 'ar-wallpaper-preview' ),
			array( $this, 'text_input_callback' ),
			'ar-wallpaper-preview',
			'arwp_main_section',
			array(
				'id'    => 'max_texture_resolution',
				'label' => __( 'Maximum texture size (e.g., 2048) to prevent memory issues on mobile devices.', 'ar-wallpaper-preview' ),
				'type'  => 'number',
			)
		);
	}

	/**
	 * Settings section callback.
	 */
	public function settings_section_callback() {
		echo '<p>' . esc_html__( 'Configure the default settings for the AR Wallpaper Preview plugin.', 'ar-wallpaper-preview' ) . '</p>';
	}

	/**
	 * Text input field callback.
	 *
	 * @param array $args Field arguments.
	 */
	public function text_input_callback( $args ) {
		$options = get_option( 'arwp_settings' );
		$id      = $args['id'];
		$value   = isset( $options[ $id ] ) ? $options[ $id ] : '';
		$type    = isset( $args['type'] ) ? $args['type'] : 'text';

		printf(
			'<input type="%1$s" id="%2$s" name="arwp_settings[%2$s]" value="%3$s" class="regular-text" />',
			esc_attr( $type ),
			esc_attr( $id ),
			esc_attr( $value )
		);

		if ( isset( $args['label'] ) ) {
			printf( '<p class="description">%s</p>', esc_html( $args['label'] ) );
		}
	}

	/**
	 * Checkbox field callback.
	 *
	 * @param array $args Field arguments.
	 */
	public function checkbox_callback( $args ) {
		$options = get_option( 'arwp_settings' );
		$id      = $args['id'];
		$checked = isset( $options[ $id ] ) && 'yes' === $options[ $id ];

		printf(
			'<input type="checkbox" id="%1$s" name="arwp_settings[%1$s]" value="yes" %2$s />',
			esc_attr( $id ),
			checked( $checked, true, false )
		);

		if ( isset( $args['label'] ) ) {
			printf( '<label for="%1$s">%2$s</label>', esc_html( $args['label'] ) );
		}
	}

	/**
	 * Validate settings.
	 *
	 * @param array $input Input data.
	 * @return array Validated data.
	 */
	public function settings_validate( $input ) {
		$output = get_option( 'arwp_settings' );

		// Validate default_width_cm and default_height_cm
		$output['default_width_cm']  = isset( $input['default_width_cm'] ) ? absint( $input['default_width_cm'] ) : 300;
		$output['default_height_cm'] = isset( $input['default_height_cm'] ) ? absint( $input['default_height_cm'] ) : 250;

		// Validate enable_tiling
		$output['enable_tiling'] = isset( $input['enable_tiling'] ) ? 'yes' : 'no';

		// Validate ar_engine_priority
		$priority = isset( $input['ar_engine_priority'] ) ? sanitize_text_field( $input['ar_engine_priority'] ) : 'webxr,arjs,canvas_fallback';
		$engines = array_map( 'trim', explode( ',', $priority ) );
		$valid_engines = array( 'webxr', 'arjs', 'canvas_fallback' );
		$filtered_engines = array_filter( $engines, function( $engine ) use ( $valid_engines ) {
			return in_array( $engine, $valid_engines, true );
		} );
		$output['ar_engine_priority'] = implode( ',', $filtered_engines );
		if ( empty( $output['ar_engine_priority'] ) ) {
			$output['ar_engine_priority'] = 'webxr,arjs,canvas_fallback'; // Fallback to default
		}

		// Validate default_marker_url
		$output['default_marker_url'] = isset( $input['default_marker_url'] ) ? esc_url_raw( $input['default_marker_url'] ) : '';

		// Validate max_texture_resolution
		$output['max_texture_resolution'] = isset( $input['max_texture_resolution'] ) ? absint( $input['max_texture_resolution'] ) : 2048;

		return $output;
	}

	/**
	 * Options page display.
	 */
	public function options_page() {
		// Check user capability
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		// Show error/update messages
		settings_errors( 'arwp_settings_group' );
		?>
		<div class="wrap">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
			<form action="options.php" method="post">
				<?php
				settings_fields( 'arwp_settings_group' );
				do_settings_sections( 'ar-wallpaper-preview' );
				submit_button( __( 'Save Settings', 'ar-wallpaper-preview' ) );
				?>
			</form>
		</div>
		<?php
	}
}
