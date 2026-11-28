<?php
/**
 * Browser tests only (run.sh BROWSER=1): the site's server calls to the API answer from here, and the finder in the
 * browser is pointed at tests/fake/api.mjs on the host, so a browser run makes no live API calls.
 *
 * @package ClearPostcode
 */

add_filter(
	'pre_http_request',
	function ( $pre, $args, $url ) {
		if ( 0 !== strpos( $url, 'https://api.clearpostcode.co.uk/' ) ) {
			return $pre;
		}
		$path = (string) wp_parse_url( $url, PHP_URL_PATH );
		$pc   = strtoupper( rawurldecode( (string) preg_replace( '#^/v1/postcodes/([^/]+).*$#', '$1', $path ) ) );
		$ok   = (bool) preg_match( '/^[A-PR-UWYZ][A-HK-Y]?[0-9][0-9A-Z]? ?[0-9][ABD-HJLNP-UW-Z]{2}$/', $pc );
		$body = array(
			'data' => array(
				'input'        => $pc,
				'postcode'     => $ok ? $pc : null,
				'format_valid' => $ok,
				'known'        => $ok,
				'status'       => $ok ? 'live' : null,
				'valid'        => $ok,
				'coverage'     => 'covered',
				'replaced_by'  => null,
			),
		);
		return array(
			'headers'  => array(),
			'body'     => wp_json_encode( $body ),
			'response' => array(
				'code'    => 200,
				'message' => 'OK',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	},
	10,
	3
);

add_filter(
	'script_loader_tag',
	function ( $tag, $handle ) {
		return 'clear-postcode-finder' === $handle ? str_replace( '<script', '<script data-base-url="http://127.0.0.1:8766/v1"', $tag ) : $tag;
	},
	20,
	2
);
