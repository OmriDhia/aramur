<?php
/**
 * Plugin Name: AR Wallpaper Preview
 * Description: Preview wallpapers in AR-like compositing with depth-first occlusion and segmentation fallback. Shortcode: [ar_wallpaper_preview background="URL"]
 * Version: 1.0.3
 * Author: Generated
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class AR_Wallpaper_Preview {
    const HANDLE = 'ar-wallpaper-preview-module';

    public function __construct() {
        add_shortcode( 'ar_wallpaper_preview', array( $this, 'shortcode' ) );
        // New shortcode for Elementor / manual placement: outputs only the Preview button
        add_shortcode( 'arwp_preview_button', array( $this, 'shortcode_button' ) );
        add_action( 'wp_enqueue_scripts', array( $this, 'maybe_enqueue_assets' ) );
        add_filter( 'script_loader_tag', array( $this, 'add_module_type' ), 10, 3 );

        // Render a "Preview in My Room" button on single product pages (WooCommerce)
        add_action( 'woocommerce_single_product_summary', array( $this, 'render_preview_button' ), 35 );
        add_action( 'woocommerce_after_add_to_cart_button', array( $this, 'render_preview_button' ), 10 );
        add_action( 'woocommerce_after_single_product_summary', array( $this, 'render_preview_button' ), 5 );

        // Fallback: inject button into product post content if the WooCommerce template hook isn't present (themes may override templates)
        add_filter( 'the_content', array( $this, 'maybe_inject_button_into_content' ), 20 );
    }

    public function maybe_enqueue_assets() {
        global $post;
        $should_enqueue = false;

        // Enqueue only when shortcode is present in post content
        // Also enable on single product pages so buttons injected by hooks or Elementor will have the scripts available.
        if ( ( $post && ( false !== strpos( $post->post_content, '[ar_wallpaper_preview' ) || false !== strpos( $post->post_content, '[arwp_preview_button' ) ) ) || ( function_exists( 'is_singular' ) && is_singular( 'product' ) ) ) {
            $should_enqueue = true;
        }

        if ( ! $should_enqueue ) {
            return;
        }

        $dir = plugin_dir_url( __FILE__ );

        // Register files
        // compositor is an ES module and should be loaded in the footer to ensure DOM/modal elements are present
        wp_register_script( self::HANDLE, $dir . 'js/compositor.js', array(), '1.0.0', true );
        wp_register_script( 'arwp-autoinject', $dir . 'js/auto-inject.js', array(), '1.0.0', true );
        wp_register_script( 'arwp-segmentation', $dir . 'js/segmentation.js', array(), '1.0.0', true );

        wp_enqueue_script( self::HANDLE );
        wp_enqueue_script( 'arwp-autoinject' );
        wp_enqueue_script( 'arwp-segmentation' );

        // Provide background URL guess to the auto-inject script (first product image by default when available)
        $bg = '';
        if ( $post ) {
            // If shortcode present we cannot know its attribute here; auto-inject uses button data-bg attribute instead.
            // As a sensible default, try the post thumbnail (useful on product pages where shortcode is used in template)
            $bg = get_the_post_thumbnail_url( $post->ID, 'full' ) ?: '';
        }
        // Provide a mediapipe/frontend configuration hint: prefer multi-class segmenter if available
        $mediapipe_cfg = array( 'preferMultiClass' => true );
        wp_localize_script( 'arwp-autoinject', 'ARWP_Data', array( 'bgUrl' => esc_url( $bg ), 'mediapipe' => $mediapipe_cfg ) );

        wp_enqueue_style( 'arwp-style', $dir . 'css/style.css', array(), '1.0.0' );
    }

    public function add_module_type( $tag, $handle, $src ) {
        if ( $handle === self::HANDLE ) {
            $tag = '<script type="module" src="' . esc_url( $src ) . '"></script>';
        }
        return $tag;
    }

    public function shortcode( $atts ) {
        $atts = shortcode_atts( array(
            'image' => '',
            'width' => '100%',
            'height' => '480px',
        ), $atts, 'ar_wallpaper_preview' );

        $bg = esc_url( $atts['image'] );
        // If no image provided and we're on a product, use the product first image
        if ( empty( $bg ) && function_exists( 'is_singular' ) && is_singular( 'product' ) ) {
            global $post;
            if ( $post ) {
                $bg = get_the_post_thumbnail_url( $post->ID, 'full' ) ?: '';
            }
        }

        ob_start();
        ?>
        <div class="arwp-root" data-bg="<?php echo esc_attr($bg); ?>" style="width:<?php echo esc_attr($atts['width']); ?>;height:<?php echo esc_attr($atts['height']); ?>;">
            <div class="arwp-canvas-wrap">
                <canvas class="arwp-wallpaper-canvas"></canvas>
                <canvas class="arwp-mask-canvas" style="display:none"></canvas>
                <canvas class="arwp-output-canvas"></canvas>
            </div>
            <video class="arwp-video" autoplay playsinline muted></video>

            <div class="arwp-controls">
                <label><input type="checkbox" class="arwp-toggle-occlusion" checked> Occlusion</label>
                <label>Feather <input type="range" class="arwp-feather" min="0" max="8" value="3"></label>
                <label>Quality
                    <select class="arwp-quality">
                        <option value="low">Low</option>
                        <option value="medium" selected>Medium</option>
                        <option value="high">High</option>
                    </select>
                </label>
            </div>
            <div class="arwp-loading">Initializing AR Wallpaper Preview…</div>
        </div>
        <?php
        return ob_get_clean();
    }

    // Shortcode handler used by Elementor Shortcode widget or manual placement
    public function shortcode_button( $atts ) {
        $atts = shortcode_atts( array(
            'background' => '',
        ), $atts, 'arwp_preview_button' );

        $bg = esc_url( $atts['background'] );

        $html  = '<div class="arwp-product-preview">';
        $html .= '<button type="button" class="arwp-open-btn button" data-bg="' . esc_attr( $bg ) . '" data-compositor-script="' . esc_url( plugin_dir_url( __FILE__ ) . 'js/compositor.js' ) . '">Preview in My Room</button>';
        $html .= '</div>';

        return $html;
    }

    public function render_preview_button() {
        if ( ! function_exists( 'get_the_ID' ) ) return;
        global $post;
        if ( ! $post ) return;
        if ( ! empty( $GLOBALS['arwp_button_inserted'] ) ) {
            return;
        }

        $bg = get_the_post_thumbnail_url( $post->ID, 'full' );
        $bg_attr = $bg ? esc_url( $bg ) : '';

        echo '<div class="arwp-product-preview">';
        echo '<button type="button" class="arwp-open-btn button" data-bg="' . esc_attr( $bg_attr ) . '" data-compositor-script="' . esc_url( plugin_dir_url( __FILE__ ) . 'js/compositor.js' ) . '">Preview in My Room</button>';
        echo "<!-- ARWP: Button injected -->";
        echo '</div>';

        $GLOBALS['arwp_button_inserted'] = true;
    }

    public function maybe_inject_button_into_content( $content ) {
        if ( ! function_exists( 'is_singular' ) || ! is_singular( 'product' ) ) {
            return $content;
        }

        if ( false !== strpos( $content, '[ar_wallpaper_preview' ) ) return $content;
        if ( false !== strpos( $content, 'arwp-open-btn' ) ) return $content;

        global $post;
        $bg = $post ? get_the_post_thumbnail_url( $post->ID, 'full' ) : '';

        $button_html = '<div class="arwp-product-preview">'
            . '<button type="button" class="arwp-open-btn button" data-bg="' . esc_attr( $bg ) . '" data-compositor-script="' . esc_url( plugin_dir_url( __FILE__ ) . 'js/compositor.js' ) . '">Preview in My Room</button>'
            . '</div>';

         return $content . $button_html;
     }
}

// Fallback: ensure shortcode is available even if the class didn't register early (helps Elementor templates)
if ( ! shortcode_exists( 'arwp_preview_button' ) ) {
    add_shortcode( 'arwp_preview_button', function( $atts ) {
        $atts = shortcode_atts( array( 'background' => '' ), $atts, 'arwp_preview_button' );
        $bg = esc_url( $atts['background'] );
        $script = esc_url( plugin_dir_url( __FILE__ ) . 'js/compositor.js' );
        return '<div class="arwp-product-preview"><button type="button" class="arwp-open-btn button" data-bg="' . esc_attr( $bg ) . '" data-compositor-script="' . $script . '">Preview in My Room</button></div>';
    } );
}

new AR_Wallpaper_Preview();
