<?php
/**
 * The ClearPostcode API, called from this site's server with the secret key saved in Settings.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** A secret key as the API issues it. */
const CLEAR_POSTCODE_SECRET_RE = '/^cp_live_[A-Za-z0-9_-]{24,64}$/';

/** The secret key from Settings, or '' (the API's free keyless allowance then applies). */
function clear_postcode_secret_key() {
	$key = get_option( 'clear_postcode_secret_key', '' );
	return is_string( $key ) ? $key : '';
}

/**
 * The problem code of an RFC 9457 answer: "postcode_not_found" from ".../errors#postcode_not_found", or ''.
 *
 * @param array $json The decoded answer.
 */
function clear_postcode_problem_code( $json ) {
	if ( empty( $json['type'] ) || ! is_string( $json['type'] ) ) {
		return '';
	}
	$hash = strrpos( $json['type'], '#' );
	return false === $hash ? '' : substr( $json['type'], $hash + 1 );
}

/**
 * One GET to the API. The secret key goes in the X-Api-Key header; no Origin header is sent, as for any server call.
 *
 * @param string      $path  Path under /v1, e.g. "/postcodes/SW1A%201AA/validate".
 * @param array       $query Query parameters.
 * @param string|null $key   A key to use instead of the saved one (the settings check of a key being saved).
 * @return array{status: int, json: array, retry_after: int} status 0 when the API could not be reached.
 */
function clear_postcode_api_get( $path, $query = array(), $key = null ) {
	$key = null === $key ? clear_postcode_secret_key() : $key;
	$url = CLEAR_POSTCODE_API . $path;
	if ( $query ) {
		$url .= '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
	}
	$headers = array(
		'Accept'     => 'application/json',
		'User-Agent' => 'clear-postcode-wordpress/' . CLEAR_POSTCODE_VERSION,
	);
	if ( '' !== $key ) {
		$headers['X-Api-Key'] = $key;
	}
	$response = wp_remote_get(
		$url,
		array(
			'timeout'     => 5,
			'redirection' => 0,
			'headers'     => $headers,
		)
	);
	if ( is_wp_error( $response ) ) {
		return array(
			'status'      => 0,
			'json'        => array(),
			'retry_after' => 0,
		);
	}
	$json   = json_decode( wp_remote_retrieve_body( $response ), true );
	$answer = array(
		'status'      => (int) wp_remote_retrieve_response_code( $response ),
		'json'        => is_array( $json ) ? $json : array(),
		'retry_after' => (int) wp_remote_retrieve_header( $response, 'retry-after' ),
	);
	clear_postcode_note_answer( $answer );
	return $answer;
}

/**
 * Keep the answers the site owner must act on for an admin notice: a key the API refuses (401, 403), a month's lookups
 * used up (402), a key's daily cap or the day's keyless allowance reached (429 for more than a few minutes). Any answer
 * that shows the key working clears it. Written only when the state changes.
 *
 * @param array $answer What clear_postcode_api_get() returns.
 */
function clear_postcode_note_answer( $answer ) {
	$status = $answer['status'];
	$code   = clear_postcode_problem_code( $answer['json'] );
	$alert  = get_option( 'clear_postcode_alert', false );
	$owner  = in_array( $status, array( 401, 402, 403 ), true )
		|| ( 429 === $status && ( 'daily_cap_reached' === $code || $answer['retry_after'] > 600 ) );
	if ( $owner ) {
		if ( is_array( $alert ) && isset( $alert['code'] ) && $alert['code'] === $code ) {
			return;
		}
		update_option(
			'clear_postcode_alert',
			array(
				'status'     => $status,
				'code'       => $code,
				'detail'     => isset( $answer['json']['detail'] ) ? sanitize_text_field( (string) $answer['json']['detail'] ) : '',
				'resets'     => isset( $answer['json']['resets'] ) ? sanitize_text_field( (string) $answer['json']['resets'] ) : '',
				'request_id' => isset( $answer['json']['request_id'] ) ? sanitize_text_field( (string) $answer['json']['request_id'] ) : '',
			)
		);
		return;
	}
	$works = ( $status >= 200 && $status < 300 ) || 400 === $status || 404 === $status;
	if ( $works && false !== $alert ) {
		delete_option( 'clear_postcode_alert' );
	}
}
