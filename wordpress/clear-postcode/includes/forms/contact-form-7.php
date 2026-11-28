<?php
/**
 * Contact Form 7: a [postcode] form tag ([postcode* name] when required). The finder formats and checks the postcode
 * as it is typed; on sending, the postcode is checked on the server with the same rules as checkout.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'wpcf7_init',
	function () {
		wpcf7_add_form_tag( array( 'postcode', 'postcode*' ), 'clear_postcode_cf7_field', array( 'name-attr' => true ) );
	}
);

/**
 * The postcode input.
 *
 * @param WPCF7_FormTag $tag The form tag.
 */
function clear_postcode_cf7_field( $tag ) {
	if ( empty( $tag->name ) ) {
		return '';
	}
	clear_postcode_enqueue_finder();
	$error = wpcf7_get_validation_error( $tag->name );
	$class = wpcf7_form_controls_class( $tag->type, 'wpcf7-text' );
	if ( $error ) {
		$class .= ' wpcf7-not-valid';
	}
	$atts = array(
		'type'          => 'text',
		'name'          => $tag->name,
		'class'         => $tag->get_class_option( $class ),
		'id'            => $tag->get_id_option(),
		'autocomplete'  => 'postal-code',
		'spellcheck'    => 'false',
		'maxlength'     => 12,
		'size'          => 12,
		'aria-required' => $tag->is_required() ? 'true' : 'false',
		'aria-invalid'  => $error ? 'true' : 'false',
		'placeholder'   => $tag->has_option( 'placeholder' ) || $tag->has_option( 'watermark' ) ? (string) reset( $tag->values ) : '',
		'value'         => '',
	);
	return sprintf( '<span class="wpcf7-form-control-wrap" data-name="%1$s"><input %2$s />%3$s</span>', esc_attr( $tag->name ), wpcf7_format_atts( $atts ), $error );
}

/**
 * Stop a form whose postcode is not a UK postcode (and, in strict mode, one not in the data or retired).
 *
 * @param WPCF7_Validation $result The validation so far.
 * @param WPCF7_FormTag    $tag    The postcode tag.
 */
function clear_postcode_cf7_validate( $result, $tag ) {
	// Contact Form 7 has verified the submission before its validation filters run.
	$value = isset( $_POST[ $tag->name ] ) ? sanitize_text_field( wp_unslash( $_POST[ $tag->name ] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing
	if ( '' === trim( $value ) ) {
		if ( $tag->is_required() ) {
			$result->invalidate( $tag, wpcf7_get_message( 'invalid_required' ) );
		}
		return $result;
	}
	$check = clear_postcode_validate( $value );
	if ( clear_postcode_blocks( $check['state'] ) ) {
		$result->invalidate( $tag, clear_postcode_message( __( 'Postcode', 'clear-postcode' ), $value, $check ) );
	}
	return $result;
}
add_filter( 'wpcf7_validate_postcode', 'clear_postcode_cf7_validate', 10, 2 );
add_filter( 'wpcf7_validate_postcode*', 'clear_postcode_cf7_validate', 10, 2 );
