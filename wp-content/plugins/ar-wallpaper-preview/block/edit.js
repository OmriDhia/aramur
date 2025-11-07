/**
 * Block Edit component.
 */
import { __ } from '@wordpress/i18n';
import { useBlockProps, MediaUpload, MediaUploadCheck } from '@wordpress/block-editor';
import { Button, TextControl, PanelBody, ToggleControl, RangeControl } from '@wordpress/components';

export default function Edit( { attributes, setAttributes } ) {
	const { image, width_cm, height_cm, tiling, repeat_x, repeat_y, brightness, engine } = attributes;

	const blockProps = useBlockProps();

	const onSelectImage = ( media ) => {
		setAttributes( { image: media.url } );
	};

	return (
		<div { ...blockProps }>
			<PanelBody title={ __( 'AR Wallpaper Settings', 'ar-wallpaper-preview' ) }>
				<MediaUploadCheck>
					<MediaUpload
						onSelect={ onSelectImage }
						allowedTypes={ [ 'image' ] }
						value={ image }
						render={ ( { open } ) => (
							<Button onClick={ open } isPrimary>
								{ image ? __( 'Change Wallpaper Image', 'ar-wallpaper-preview' ) : __( 'Select Wallpaper Image', 'ar-wallpaper-preview' ) }
							</Button>
						) }
					/>
				</MediaUploadCheck>
				{ image && <p>{ __( 'Selected Image:', 'ar-wallpaper-preview' ) } <strong>{ image }</strong></p> }

				<TextControl
					label={ __( 'Wallpaper Width (cm)', 'ar-wallpaper-preview' ) }
					value={ width_cm }
					onChange={ ( val ) => setAttributes( { width_cm: parseFloat( val ) } ) }
					type="number"
				/>
				<TextControl
					label={ __( 'Wallpaper Height (cm)', 'ar-wallpaper-preview' ) }
					value={ height_cm }
					onChange={ ( val ) => setAttributes( { height_cm: parseFloat( val ) } ) }
					type="number"
				/>
				<ToggleControl
					label={ __( 'Enable Tiling', 'ar-wallpaper-preview' ) }
					checked={ tiling }
					onChange={ ( val ) => setAttributes( { tiling: val } ) }
				/>
				{ tiling && (
					<>
						<RangeControl
							label={ __( 'Repeat X', 'ar-wallpaper-preview' ) }
							value={ repeat_x }
							onChange={ ( val ) => setAttributes( { repeat_x: val } ) }
							min={ 1 }
							max={ 10 }
							step={ 1 }
						/>
						<RangeControl
							label={ __( 'Repeat Y', 'ar-wallpaper-preview' ) }
							value={ repeat_y }
							onChange={ ( val ) => setAttributes( { repeat_y: val } ) }
							min={ 1 }
							max={ 10 }
							step={ 1 }
						/>
					</>
				) }
				<RangeControl
					label={ __( 'Brightness', 'ar-wallpaper-preview' ) }
					value={ brightness }
					onChange={ ( val ) => setAttributes( { brightness: val } ) }
					min={ 0.5 }
					max={ 1.5 }
					step={ 0.05 }
				/>
				<TextControl
					label={ __( 'AR Engine Override (auto, webxr, arjs, canvas)', 'ar-wallpaper-preview' ) }
					value={ engine }
					onChange={ ( val ) => setAttributes( { engine: val } ) }
				/>
			</PanelBody>
			<div style={{ padding: '20px', border: '1px solid #ccc', textAlign: 'center' }}>
				<p><strong>{ __( 'AR Wallpaper Preview', 'ar-wallpaper-preview' ) }</strong></p>
				<p>{ image ? __( 'Image set. AR preview will appear on the frontend.', 'ar-wallpaper-preview' ) : __( 'Please select a wallpaper image.', 'ar-wallpaper-preview' ) }</p>
			</div>
		</div>
	);
}
