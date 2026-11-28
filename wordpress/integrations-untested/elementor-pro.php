<?php
/**
 * Elementor Pro forms (paid; untested): a field whose ID contains "postcode" is checked on submit with the same rules
 * as checkout, and the finder loads with the form. Give the field the autocomplete of a postcode field too (Advanced,
 * Custom attributes: autocomplete|postal-code) for the finder to take it.
 * Hooks: elementor_pro/forms/validation (https://developers.elementor.com/docs/hooks/forms/),
 * elementor/frontend/after_enqueue_scripts.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Check every postcode field of a submitted form.
 *
 * @param \ElementorPro\Modules\Forms\Classes\Form_Record  $record       The submission.
 * @param \ElementorPro\Modules\Forms\Classes\Ajax_Handler $ajax_handler Where errors go.
 */
function clear_postcode_elementor_validate( $record, $ajax_handler ) {
	foreach ( (array) $record->get( 'fields' ) as $id => $field ) {
		$value = isset( $field['value'] ) ? (string) $field['value'] : '';
		if ( false === stripos( (string) $id, 'postcode' ) || '' === trim( $value ) ) {
			continue;
		}
		$check = clear_postcode_validate( $value );
		if ( clear_postcode_blocks( $check['state'] ) ) {
			$ajax_handler->add_error( $id, clear_postcode_message( __( 'Postcode', 'clear-postcode' ), $value, $check ) );
		}
	}
}
add_action( 'elementor_pro/forms/validation', 'clear_postcode_elementor_validate', 10, 2 );

add_action(
	'elementor/frontend/after_enqueue_scripts',
	function () {
		clear_postcode_enqueue_finder();
	}
);
