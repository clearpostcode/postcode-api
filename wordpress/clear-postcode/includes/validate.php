<?php
/**
 * Postcode validation: one call to /v1/postcodes/{postcode}/validate, and what it means for an order.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * A UK postcode as people type it: trimmed, single spaces, upper case.
 *
 * @param string $postcode The postcode as typed.
 */
function clear_postcode_normalise( $postcode ) {
	return strtoupper( trim( preg_replace( '/\s+/', ' ', (string) $postcode ) ) );
}

/**
 * Validate one postcode. Definite answers are cached for 12 hours; an error (no answer, a refused key) is not.
 *
 * @param string $postcode The postcode as typed.
 * @return array{state: string, postcode: string, replaced_by: string} state: valid | invalid_format | unknown |
 *         terminated | not_covered | error.
 */
function clear_postcode_validate( $postcode ) {
	$postcode = clear_postcode_normalise( $postcode );
	$cache_id = 'clear_postcode_v_' . md5( $postcode );
	$cached   = get_transient( $cache_id );
	if ( is_array( $cached ) && isset( $cached['state'], $cached['replaced_by'] ) ) {
		return $cached;
	}
	$res    = clear_postcode_api_get( '/postcodes/' . rawurlencode( $postcode ) . '/validate' );
	$result = array(
		'state'       => 'error',
		'postcode'    => $postcode,
		'replaced_by' => '',
	);
	if ( 400 === $res['status'] && 'invalid_postcode' === clear_postcode_problem_code( $res['json'] ) ) {
		$result['state'] = 'invalid_format';
	} elseif ( 200 === $res['status'] && isset( $res['json']['data'] ) && is_array( $res['json']['data'] ) ) {
		$d = $res['json']['data'];
		if ( ! empty( $d['postcode'] ) ) {
			$result['postcode'] = (string) $d['postcode'];
		}
		if ( ! empty( $d['replaced_by'] ) ) {
			$result['replaced_by'] = (string) $d['replaced_by'];
		}
		if ( isset( $d['format_valid'] ) && false === $d['format_valid'] ) {
			$result['state'] = 'invalid_format';
		} elseif ( isset( $d['coverage'] ) && 'not_covered' === $d['coverage'] ) {
			$result['state'] = 'not_covered'; // Northern Ireland: the format is checked.
		} elseif ( isset( $d['known'] ) && false === $d['known'] ) {
			$result['state'] = 'unknown';
		} elseif ( isset( $d['status'] ) && 'terminated' === $d['status'] ) {
			$result['state'] = 'terminated';
		} elseif ( ! empty( $d['valid'] ) ) {
			$result['state'] = 'valid';
		}
	}
	if ( 'error' !== $result['state'] ) {
		set_transient( $cache_id, $result, 12 * HOUR_IN_SECONDS );
	}
	return $result;
}

/**
 * Should this validation result stop an order? A bad format always; unknown or terminated only in strict mode.
 *
 * @param string $state A state from clear_postcode_validate().
 */
function clear_postcode_blocks( $state ) {
	if ( 'invalid_format' === $state ) {
		return true;
	}
	return in_array( $state, array( 'unknown', 'terminated' ), true ) && '1' === get_option( 'clear_postcode_strict', '0' );
}

/** Countries whose postcodes are UK postcodes in WooCommerce. */
function clear_postcode_countries() {
	return array( 'GB', 'IM', 'JE', 'GG' );
}

/**
 * The message for a postcode that stops an order.
 *
 * @param string $label    "Billing postcode" or "Shipping postcode".
 * @param string $postcode The postcode as typed.
 * @param array  $result   What clear_postcode_validate() returned.
 */
function clear_postcode_message( $label, $postcode, $result ) {
	if ( 'terminated' === $result['state'] && '' !== $result['replaced_by'] ) {
		/* translators: 1: "Billing postcode" or "Shipping postcode", 2: the postcode as typed, 3: the nearest live postcode. */
		return sprintf( __( '%1$s “%2$s” is no longer in use. The nearest live postcode is %3$s: check the address and try again.', 'clear-postcode' ), $label, $postcode, $result['replaced_by'] );
	}
	if ( 'terminated' === $result['state'] ) {
		/* translators: 1: "Billing postcode" or "Shipping postcode", 2: the postcode as typed. */
		return sprintf( __( '%1$s “%2$s” is no longer in use. Check the address and try again.', 'clear-postcode' ), $label, $postcode );
	}
	if ( 'unknown' === $result['state'] ) {
		/* translators: 1: "Billing postcode" or "Shipping postcode", 2: the postcode as typed. */
		return sprintf( __( '%1$s “%2$s” is not in the UK postcode data. Check it and try again.', 'clear-postcode' ), $label, $postcode );
	}
	/* translators: 1: "Billing postcode" or "Shipping postcode", 2: the postcode as typed. */
	return sprintf( __( '%1$s “%2$s” is not a UK postcode. Check it and try again, for example SW1A 1AA.', 'clear-postcode' ), $label, $postcode );
}
