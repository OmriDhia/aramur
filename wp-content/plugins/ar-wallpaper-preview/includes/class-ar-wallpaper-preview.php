<?php
/**
 * Main plugin class
 *
 * @package AR_Wallpaper_Preview
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class AR_Wallpaper_Preview {

    const VERSION = '1.0.0';
    const SCRIPT_HANDLE = 'ar-wallpaper-preview';
    const STYLE_HANDLE  = 'ar-wallpaper-preview';

    /**
     * Singleton instance
     *
     * @var AR_Wallpaper_Preview|null
     */
    protected static $instance = null;

    /**
     * Retrieve singleton instance
     *
     * @return AR_Wallpaper_Preview
     */
    public static function get_instance() {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    /**
     * Constructor
     */
    protected function __construct() {
        add_action( 'init', array( $this, 'register_shortcode' ) );
        add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );
        add_action( 'wp_footer', array( $this, 'render_modal_markup' ) );

        if ( function_exists( 'is_product' ) ) {
            add_action( 'woocommerce_single_product_summary', array( $this, 'render_button' ), 35 );
        }

        add_filter( 'script_loader_tag', array( $this, 'filter_script_type_module' ), 10, 3 );
    }

    /**
     * Register shortcode for manual placement.
     */
    public function register_shortcode() {
        add_shortcode( 'ar_wallpaper_preview', array( $this, 'shortcode_output' ) );
    }

    /**
     * Shortcode handler.
     *
     * @return string
     */
    public function shortcode_output() {
        $product_id = get_the_ID();
        $image_url  = $this->get_product_image_url( $product_id );

        return $this->get_button_markup( $image_url );
    }

    /**
     * Enqueue assets only on product pages.
     */
    public function enqueue_assets() {
        if ( ! is_singular( 'product' ) ) {
            return;
        }

        $plugin_url = plugin_dir_url( AR_WALLPAPER_PREVIEW_FILE );

        wp_enqueue_style(
            self::STYLE_HANDLE,
            $plugin_url . 'assets/css/ar-wallpaper-preview.css',
            array(),
            self::VERSION
        );

        wp_enqueue_script(
            self::SCRIPT_HANDLE,
            $plugin_url . 'assets/js/ar-wallpaper-preview.js',
            array(),
            self::VERSION,
            true
        );

        $localization = array(
            'strings'       => array(
                'instructions'       => __( 'Point your camera at your wall to preview the wallpaper.', 'ar-wallpaper-preview' ),
                'webxrNotSupported'  => __( 'Your device does not support WebXR. Showing fallback preview.', 'ar-wallpaper-preview' ),
                'secureContext'      => __( 'AR preview requires a secure (HTTPS) connection. Reload the page over HTTPS to enable camera and WebXR features.', 'ar-wallpaper-preview' ),
                'cameraDenied'       => __( 'Camera access was denied. Unable to show live preview.', 'ar-wallpaper-preview' ),
                'cameraPermission'   => __( 'Please allow camera access to enable the live preview.', 'ar-wallpaper-preview' ),
                'cameraBlocked'      => __( 'Camera access is blocked. Update your browser permissions to use the live preview.', 'ar-wallpaper-preview' ),
                'cameraUnavailable'  => __( 'No compatible camera was found. Showing static preview.', 'ar-wallpaper-preview' ),
                'fallbackPreview'    => __( 'Live camera preview is unavailable. Showing static background instead.', 'ar-wallpaper-preview' ),
                'snapshotReady'      => __( 'Snapshot ready! Long press or tap to save.', 'ar-wallpaper-preview' ),
                'startWebXR'         => __( 'Start AR Session', 'ar-wallpaper-preview' ),
                'fallbackTitle'      => __( 'Fallback Preview', 'ar-wallpaper-preview' ),
                'webxrTitle'         => __( 'WebXR Preview', 'ar-wallpaper-preview' ),
                'loadingWebXR'       => __( 'Preparing AR session…', 'ar-wallpaper-preview' ),
                'webxrFailed'        => __( 'Unable to start AR session. Using fallback preview instead.', 'ar-wallpaper-preview' ),
                'close'              => __( 'Close preview', 'ar-wallpaper-preview' ),
                'takeSnapshot'       => __( 'Take Snapshot', 'ar-wallpaper-preview' ),
                'scaleLabel'         => __( 'Preview size', 'ar-wallpaper-preview' ),
                'rotationLabel'      => __( 'Rotation', 'ar-wallpaper-preview' ),
            ),
            'settings'     => array(
                'defaultScale'      => apply_filters( 'ar_wallpaper_preview_default_scale', 1.2 ),
                'defaultRotation'   => apply_filters( 'ar_wallpaper_preview_default_rotation', 0 ),
                'overlayOpacity'    => apply_filters( 'ar_wallpaper_preview_overlay_opacity', 0.92 ),
            ),
        );

        wp_localize_script( self::SCRIPT_HANDLE, 'arWallpaperPreview', $localization );
    }

    /**
     * Render button in WooCommerce product summary.
     */
    public function render_button() {
        global $product;

        if ( ! $product ) {
            return;
        }

        $image_url = $this->get_product_image_url( $product->get_id() );

        echo $this->get_button_markup( $image_url ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
    }

    /**
     * Output modal markup at footer.
     */
    public function render_modal_markup() {
        if ( ! is_singular( 'product' ) ) {
            return;
        }

        ?>
        <div id="ar-wallpaper-modal" class="ar-wallpaper-modal" aria-hidden="true" role="dialog" aria-label="<?php echo esc_attr__( 'AR wallpaper preview', 'ar-wallpaper-preview' ); ?>">
            <div class="ar-wallpaper-modal__overlay" data-action="close"></div>
            <div class="ar-wallpaper-modal__dialog">
                <button type="button" class="ar-wallpaper-modal__close" aria-label="<?php echo esc_attr__( 'Close preview', 'ar-wallpaper-preview' ); ?>" data-action="close">&times;</button>
                <div class="ar-wallpaper-modal__header">
                    <h2 class="ar-wallpaper-modal__title"><?php esc_html_e( 'Preview in My Room', 'ar-wallpaper-preview' ); ?></h2>
                    <p class="ar-wallpaper-modal__subtitle"></p>
                </div>
                <div class="ar-wallpaper-modal__viewport">
                    <div class="ar-wallpaper-modal__webxr-message"></div>
                    <div class="ar-wallpaper-modal__webxr-container" hidden></div>
                    <div class="ar-wallpaper-modal__video-container">
                        <video class="ar-wallpaper-modal__video" playsinline muted autoplay></video>
                        <canvas class="ar-wallpaper-modal__canvas"></canvas>
                        <div class="ar-wallpaper-modal__wallpaper" aria-hidden="true"></div>
                        <div class="ar-wallpaper-modal__permission-message" hidden></div>
                    </div>
                </div>
                <div class="ar-wallpaper-modal__controls">
                    <div class="ar-wallpaper-modal__control">
                        <label>
                            <span class="ar-wallpaper-modal__label ar-wallpaper-modal__label--scale"></span>
                            <input type="range" min="0.5" max="3" step="0.1" class="ar-wallpaper-modal__scale" value="1">
                        </label>
                    </div>
                    <div class="ar-wallpaper-modal__control">
                        <label>
                            <span class="ar-wallpaper-modal__label ar-wallpaper-modal__label--rotation"></span>
                            <input type="range" min="-45" max="45" step="1" class="ar-wallpaper-modal__rotation" value="0">
                        </label>
                    </div>
                    <div class="ar-wallpaper-modal__control ar-wallpaper-modal__control--snapshot">
                        <button type="button" class="ar-wallpaper-modal__snapshot"></button>
                        <a class="ar-wallpaper-modal__snapshot-link" download="wallpaper-preview.png" hidden></a>
                    </div>
                    <div class="ar-wallpaper-modal__control ar-wallpaper-modal__control--webxr" hidden>
                        <button type="button" class="ar-wallpaper-modal__webxr-button"></button>
                    </div>
                </div>
            </div>
        </div>
        <?php
    }

    /**
     * Convert button markup.
     *
     * @param string $image_url Wallpaper image url.
     *
     * @return string
     */
    protected function get_button_markup( $image_url ) {
        if ( empty( $image_url ) ) {
            return '';
        }

        $button = sprintf(
            '<button type="button" class="ar-wallpaper-preview__btn" data-wallpaper-url="%1$s">%2$s</button>',
            esc_url( $image_url ),
            esc_html__( 'Preview in My Room', 'ar-wallpaper-preview' )
        );

        return $button;
    }

    /**
     * Retrieve product image url.
     *
     * @param int $product_id Product id.
     *
     * @return string
     */
    protected function get_product_image_url( $product_id ) {
        $image_id = get_post_thumbnail_id( $product_id );

        if ( ! $image_id ) {
            $gallery = get_post_meta( $product_id, '_product_image_gallery', true );
            if ( $gallery ) {
                $ids       = array_map( 'absint', explode( ',', $gallery ) );
                $first_id  = reset( $ids );
                $image_id  = $first_id ? $first_id : 0;
            }
        }

        if ( ! $image_id ) {
            return '';
        }

        $url = wp_get_attachment_image_url( $image_id, 'full' );

        return $url ? $url : '';
    }

    /**
     * Ensure plugin script is loaded as a module to allow dynamic imports.
     *
     * @param string $tag    Script tag.
     * @param string $handle Script handle.
     * @param string $src    Script src.
     *
     * @return string
     */
    public function filter_script_type_module( $tag, $handle, $src ) {
        if ( self::SCRIPT_HANDLE === $handle ) {
            $tag = '<script type="module" id="' . esc_attr( $handle ) . '-js" src="' . esc_url( $src ) . '"></script>';
        }

        return $tag;
    }
}
