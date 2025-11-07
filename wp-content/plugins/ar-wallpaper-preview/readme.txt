=== AR Wallpaper Preview ===
Contributors: manus-ai
Tags: ar, webxr, augmented reality, wallpaper, preview, three.js, ar.js, gutenberg, shortcode
Requires at least: 5.8
Tested up to: 6.4
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPL2
License URI: https://www.gnu.org/licenses/gpl-2.0.html

An advanced WordPress plugin that allows shoppers to preview wallpapers on their real walls using their phone camera with WebXR, AR.js, and canvas fallback support.

== Description ==

The **AR Wallpaper Preview** plugin provides a seamless augmented reality experience for visualizing wallpapers in a real-world environment. It intelligently detects the user's device capabilities and falls back to the best available technology, ensuring maximum compatibility.

**Features:**

*   **WebXR (Primary):** Uses Three.js and the WebXR Device API for high-fidelity, scaled, and interactive placement on detected surfaces (walls/floors).
*   **AR.js (Fallback):** Provides a fallback for devices that support camera access but not full WebXR, using marker-based or simplified markerless AR.
*   **Canvas Fallback (Last Resort):** A 2D canvas-based solution that allows users to manually adjust a perspective-warped image over the live camera feed.
*   **Shortcode & Gutenberg Block:** Easily embed the AR preview on any product page using `[ar_wallpaper_preview image="<URL>"]` or the dedicated Gutenberg block.
*   **Customization:** Users can adjust scale, rotation, tiling, and brightness of the virtual wallpaper.
*   **Admin Settings:** Configure default sizes, AR engine priority, and performance limits (max texture resolution).

== Installation ==

1.  Upload the `ar-wallpaper-preview` folder to the `/wp-content/plugins/` directory.
2.  Activate the plugin through the 'Plugins' menu in WordPress.
3.  (Optional) Configure the default settings under **Settings -> AR Wallpaper Preview**.

== Usage ==

### Shortcode

Use the shortcode on any post or page:

`[ar_wallpaper_preview image="https://example.com/wallpaper.jpg" width_cm="300" height_cm="250" tiling="true" repeat_x="2" repeat_y="2" brightness="1.2"]`

**Attributes:**

*   `image` (required): Absolute URL to the wallpaper image.
*   `width_cm`: Width of the wallpaper in centimeters (defaults to Admin setting).
*   `height_cm`: Height of the wallpaper in centimeters (defaults to Admin setting).
*   `tiling`: `true` or `false` to enable/disable tiling (defaults to Admin setting).
*   `repeat_x`: Number of times to repeat the texture horizontally (default: 1).
*   `repeat_y`: Number of times to repeat the texture vertically (default: 1).
*   `brightness`: Brightness multiplier (0.5 to 1.5, default: 1.0).
*   `engine`: Override the engine priority (`auto`, `webxr`, `arjs`, `canvas`).

### Gutenberg Block

Search for the "AR Wallpaper Preview" block in the editor. The block provides a user-friendly interface to select the image and configure all the attributes listed above.

== Compatibility ==

| Feature | Browser/OS | Notes |
| :--- | :--- | :--- |
| **WebXR** | Chrome (Android), Edge (Android), Firefox Reality | Requires a device with ARCore/ARKit support and a compatible browser. |
| **AR.js** | Most modern mobile browsers | Requires camera access. Markerless mode is a simplified approximation. |
| **Canvas Fallback** | All modern browsers | Requires camera access. Placement is manual and approximate (no true perspective). |

== Changelog ==

= 1.0.0 =
* Initial release with WebXR, AR.js, and Canvas Fallback engines.
* Full shortcode and Gutenberg block support.
* Admin settings for configuration and performance tuning.
* i18n ready.
