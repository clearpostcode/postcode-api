<?php
/**
 * WPForms: a Single Line Text field with the CSS class clear-postcode is a UK postcode field. The finder formats and
 * checks it as it is typed; on submit it is checked on the server with the same rules as checkout.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Is this WPForms field a postcode field?
 *
 * @param array $field The field's settings.
 */
function clear_postcode_wpforms_is_postcode( $field ) {
	$classes = isset( $field['css'] ) ? preg_split( '/\s+/', (string) $field['css'] ) : array();
	return in_array( 'clear-postcode', $classes, true );
}

/**
 * Load the finder with a form that has a postcode field.
 *
 * @param array $form_data The form.
 */
function clear_postcode_wpforms_output( $form_data ) {
	foreach ( isset( $form_data['fields'] ) ? (array) $form_data['fields'] : array() as $field ) {
		if ( clear_postcode_wpforms_is_postcode( $field ) ) {
			clear_postcode_enqueue_finder();
			return;
		}
	}
}
add_action( 'wpforms_frontend_output_before', 'clear_postcode_wpforms_output' );

/**
 * Stop an entry whose postcode is not a UK postcode (and, in strict mode, one not in the data or retired).
 *
 * @param array $fields    The submitted fields, by id.
 * @param array $entry     The raw entry.
 * @param array $form_data The form.
 */
function clear_postcode_wpforms_validate( $fields, $entry, $form_data ) {
	$process = function_exists( 'wpforms' ) ? wpforms()->obj( 'process' ) : null;
	if ( ! $process ) {
		return;
	}
	foreach ( (array) $form_data['fields'] as $id => $field ) {
		$value = isset( $fields[ $id ]['value'] ) ? (string) $fields[ $id ]['value'] : '';
		if ( ! clear_postcode_wpforms_is_postcode( $field ) || '' === trim( $value ) ) {
			continue; // An empty required field is WPForms' own error.
		}
		$check = clear_postcode_validate( $value );
		if ( clear_postcode_blocks( $check['state'] ) ) {
			$process->errors[ $form_data['id'] ][ $id ] = clear_postcode_message( __( 'Postcode', 'clear-postcode' ), $value, $check );
		}
	}
}
add_action( 'wpforms_process', 'clear_postcode_wpforms_validate', 10, 3 );
