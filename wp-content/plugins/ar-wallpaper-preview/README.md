# AR Wallpaper Preview

Adds a **Preview in My Room** button to WooCommerce product pages so shoppers can visualise wallpapers in Augmented Reality.

## Features

- WebXR plane detection preview with hit-test placement when supported.
- Canvas-based fallback preview with live camera stream, drag, rotate, and scale controls.
- Lazy loads WebXR dependencies only when the modal opens.
- Snapshot capture for saving the composed preview.

## Automatic integration

The plugin hooks into `woocommerce_single_product_summary` at priority `35`, so the button renders automatically on every single product page.

## Shortcode

Use the shortcode in templates or content areas:

```php
echo do_shortcode( '[ar_wallpaper_preview]' );
```

This outputs the button for the current product if it has a featured image.

## Manual template hook example

If you prefer adding the button to a custom location via PHP:

```php
add_action( 'woocommerce_after_single_product_summary', function() {
    echo do_shortcode( '[ar_wallpaper_preview]' );
}, 5 );
```

## Filters

| Filter | Description | Default |
| --- | --- | --- |
| `ar_wallpaper_preview_default_scale` | Initial wallpaper scale multiplier. | `1.2` |
| `ar_wallpaper_preview_default_rotation` | Initial rotation (degrees). | `0` |
| `ar_wallpaper_preview_overlay_opacity` | Wallpaper overlay opacity in fallback mode. | `0.92` |

Activate the plugin from the WordPress admin to start using the feature.
