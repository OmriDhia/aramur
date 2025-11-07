/**
 * Block Save component.
 */
import { useBlockProps } from '@wordpress/block-editor';

export default function Save( { attributes } ) {
	const { image, width_cm, height_cm, tiling, repeat_x, repeat_y, brightness, engine } = attributes;

	const blockProps = useBlockProps.save();

	// The shortcode will handle the actual rendering on the frontend.
	// We construct the shortcode string here.
	let shortcode = `[ar_wallpaper_preview image="${image}"`;

	if ( width_cm ) {
		shortcode += ` width_cm="${width_cm}"`;
	}
	if ( height_cm ) {
		shortcode += ` height_cm="${height_cm}"`;
	}
	if ( tiling !== undefined ) {
		shortcode += ` tiling="${tiling ? 'true' : 'false'}"`;
	}
	if ( repeat_x ) {
		shortcode += ` repeat_x="${repeat_x}"`;
	}
	if ( repeat_y ) {
		shortcode += ` repeat_y="${repeat_y}"`;
	}
	if ( brightness ) {
		shortcode += ` brightness="${brightness}"`;
	}
	if ( engine ) {
		shortcode += ` engine="${engine}"`;
	}

	shortcode += ']';

	return (
		<div { ...blockProps }>
			{ shortcode }
		</div>
	);
}
