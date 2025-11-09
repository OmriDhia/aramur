# AR Wallpaper Preview

Adds a **Preview in My Room** button to WooCommerce product pages so shoppers can visualise wallpapers in Augmented Reality.

## Features

- **Smart Auto Wall Fit** – Detects vertical planes, aligns wallpaper to gravity, and keeps placement stable with pose smoothing.
- **Depth-first Occlusion** – Uses WebXR Depth API when available and falls back to segmentation/object masking with MediaPipe on unsupported devices.
- **Adaptive Controls** – Fit width/height, snap-to-center, scale, rotate, nudge, and quick reset for both 3D and canvas engines.
- **Performance-aware Pipelines** – Balanced / Battery Saver / Quality presets throttle ML workloads and reuse warm caches.
- Canvas-based fallback preview with live camera stream, drag, rotate, and scale controls.
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

## Smart AR wallpaper overview

| Capability | WebXR (Depth capable) | WebXR (no depth) | Canvas fallback |
| --- | --- | --- | --- |
| Auto wall fit | ✅ Pose-smoothed vertical plane snap | ✅ via hit-test ghost + tap | ✅ manual 4-point anchors |
| Occlusion | ✅ Depth compare shader | ✅ Segmentation/object masking | ✅ Segmentation/object masking |
| Light estimation | ✅ WebXR light probe | ⚠️ Ambient-only (uniform) | ⚠️ Manual brightness slider |
| Controls | Fit width/height, center, nudge, scale/rotate, snapshot | Same as depth with segmentation badge | Manual corners, fit buttons, snapshot |

### Device support

- **Android (Chrome, depth capable)** – Uses WebXR depth textures. Status tray shows *Depth occlusion* once the feed is active.
- **iOS Safari** – Runs through WebXR polyfill when available; otherwise segmentation fallback engages with a guidance badge.
- **Unsupported / desktop** – Falls back to canvas mode with manual anchors and segmentation-based occlusion when enabled.

### Performance presets

| Mode | Behaviour |
| --- | --- |
| Balanced | 30 FPS segmentation sampling, exponential pose smoothing, full resolution textures (default). |
| Battery Saver | Downscales segmentation mask and throttles inference to ~20 FPS. |
| Quality | Keeps full-resolution masks and enables denser plane sampling for tighter fits. |

### Demo shortcode snippet

```
[ar_wallpaper_preview image="https://example.com/wp-content/uploads/wallpaper.jpg" width_cm="320" height_cm="260" occlusion="depth" performance="quality"]
```

Use the snippet on any page or post to load the modal outside WooCommerce. The shortcode automatically pulls default sizing from the settings page if width/height values are omitted.
