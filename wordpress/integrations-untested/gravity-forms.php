<?php
/**
 * Gravity Forms (paid; untested): the ZIP / Postal Code input of an Address field set to United Kingdom, and any
 * field with the CSS class clear-postcode, is checked on submit with the same rules as checkout. The finder takes the
 * Address field's postcode input by its autocomplete="postal-code" (Gravity Forms 2.5+ with autocomplete on).
 * Hooks: gform_field_validation (https://docs.gravityforms.com/gform_field_validation/), gform_enqueue_scripts.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Check the postcode of an Address or clear-postcode field.
 *
 * @param array    $result { is_valid, message }.
 * @param mixed    $value  The submitted value (an array of inputs for an Address field).
 * @param array    $form   The form.
 * @param GF_Field $field  The field.
 */
function clear_postcode_gf_validate( $result, $value, $form, $field ) {
	if ( empty( $result['is_valid'] ) ) {
		return $result;
	}
	$postcode = '';
	if ( 'address' === $field->type && is_array( $value ) ) {
		$country  = (string) rgar( $value, $field->id . '.6' );
		$postcode = in_array( $country, array( '', 'United Kingdom', 'UK', 'GB' ), true ) ? (string) rgar( $value, $field->id . '.5' ) : '';
	} elseif ( in_array( 'clear-postcode', preg_split( '/\s+/', (string) $field->cssClass ), true ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Gravity Forms names it.
		$postcode = is_string( $value ) ? $value : '';
	}
	if ( '' === trim( $postcode ) ) {
		return $result;
	}
	$check = clear_postcode_validate( $postcode );
	if ( clear_postcode_blocks( $check['state'] ) ) {
		$result['is_valid'] = false;
		$result['message']  = clear_postcode_message( __( 'Postcode', 'clear-postcode' ), $postcode, $check );
	}
	return $result;
}
add_filter( 'gform_field_validation', 'clear_postcode_gf_validate', 10, 4 );

add_action(
	'gform_enqueue_scripts',
	function () {
		clear_postcode_enqueue_finder();
	}
);
