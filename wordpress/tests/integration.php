<?php
/**
 * The plugin's tests on a real WordPress with WooCommerce: `wp eval-file /tests/integration.php` (run.sh).
 * Keyed runs answer from a fake HTTP layer (pre_http_request) that records every request; the last group calls the
 * live API without a key. Prints one line per check and exits 1 on any failure.
 *
 * @package ClearPostcode
 */

// phpcs:disable WordPress.WP.AlternativeFunctions, WordPress.Security.EscapeOutput

$GLOBALS['cpt'] = array(
	'pass'     => 0,
	'fail'     => 0,
	'requests' => array(),
	'fake'     => null,
);

function cpt_check( $name, $ok, $detail = '' ) {
	$GLOBALS['cpt'][ $ok ? 'pass' : 'fail' ]++;
	echo ( $ok ? 'ok    ' : 'FAIL  ' ) . $name . ( $ok || '' === $detail ? '' : "\n      " . $detail ) . "\n";
}

/** A canned API answer for pre_http_request. */
function cpt_answer( $status, $body, $headers = array() ) {
	return array(
		'headers'  => $headers,
		'body'     => wp_json_encode( $body ),
		'response' => array(
			'code'    => $status,
			'message' => '',
		),
		'cookies'  => array(),
		'filename' => null,
	);
}

function cpt_problem( $status, $code, $extra = array() ) {
	return cpt_answer(
		$status,
		array_merge(
			array(
				'type'       => 'https://clearpostcode.co.uk/developers/docs/errors#' . $code,
				'title'      => $code,
				'status'     => $status,
				'detail'     => 'Detail for ' . $code . '.',
				'instance'   => '/v1/test',
				'request_id' => 'req-' . $code,
			),
			$extra
		),
		429 === $status ? array( 'retry-after' => '40000' ) : array()
	);
}

function cpt_validation( $postcode, $known, $status, $replaced_by = null ) {
	return cpt_answer(
		200,
		array(
			'data' => array(
				'input'        => $postcode,
				'postcode'     => $postcode,
				'format_valid' => true,
				'known'        => $known,
				'status'       => $status,
				'valid'        => $known && 'live' === $status,
				'coverage'     => 'covered',
				'country'      => array(
					'code' => 'E92000001',
					'name' => 'England',
				),
				'replaced_by'  => $replaced_by,
			),
			'meta' => array( 'edition' => '2026-08' ),
		)
	);
}

/** Answer API calls with $fake (url, args) => response; null sends real requests. Every API request is recorded. */
function cpt_fake( $fake ) {
	$GLOBALS['cpt']['fake']     = $fake;
	$GLOBALS['cpt']['requests'] = array();
}

function cpt_last() {
	$r = end( $GLOBALS['cpt']['requests'] );
	return $r ? $r : array(
		'url'  => '',
		'args' => array( 'headers' => array() ),
	);
}

function cpt_reset_cache() {
	global $wpdb;
	$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_%clear\\_postcode\\_%'" );
	wp_cache_flush();
}

add_filter(
	'pre_http_request',
	function ( $pre, $args, $url ) {
		if ( 0 !== strpos( $url, 'https://api.clearpostcode.co.uk/' ) ) {
			return $pre;
		}
		$GLOBALS['cpt']['requests'][] = array(
			'url'  => $url,
			'args' => $args,
		);
		return $GLOBALS['cpt']['fake'] ? call_user_func( $GLOBALS['cpt']['fake'], $url, $args ) : $pre;
	},
	10,
	3
);

$live_key  = 'cp_live_' . str_repeat( 'A', 32 );
$other_key = 'cp_live_' . str_repeat( 'B', 32 );
$pub_key   = 'cp_pub_' . str_repeat( 'C', 32 );

echo "== Plugin loaded\n";
cpt_check( 'the plugin is active', is_plugin_active( 'clear-postcode/clear-postcode.php' ) );
cpt_check( 'WooCommerce is active', class_exists( 'WooCommerce' ) );
cpt_check( 'classic checkout hook', false !== has_action( 'woocommerce_after_checkout_validation', 'clear_postcode_classic_checkout' ) );
cpt_check( 'admin notice hook', false !== has_action( 'admin_notices', 'clear_postcode_admin_notice' ) );
cpt_check( 'block checkout hook', false !== has_action( 'woocommerce_store_api_checkout_update_order_from_request', 'clear_postcode_block_checkout' ) );

echo "== Saving a key outside wp-admin (WP-CLI) does not fail\n";
cpt_fake(
	function () {
		return cpt_answer( 200, array( 'data' => array( 'plan_name' => 'Free', 'remaining' => 9588, 'allowance' => 10000 ) ) );
	}
);
update_option( 'clear_postcode_secret_key', $other_key );
cpt_check( 'a secret key set without the settings screen is stored', get_option( 'clear_postcode_secret_key' ) === $other_key );
delete_option( 'clear_postcode_secret_key' );

require_once ABSPATH . 'wp-admin/includes/template.php'; // add_settings_error(), as options.php loads it.

/** Sanitise $value as the settings screen does; returns [stored, messages]. */
function cpt_save( $value ) {
	global $wp_settings_errors;
	$wp_settings_errors         = array(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride
	$GLOBALS['cpt']['requests'] = array();
	update_option( 'clear_postcode_secret_key', $value );
	return array( get_option( 'clear_postcode_secret_key' ), get_settings_errors( 'clear_postcode_secret_key' ) );
}

echo "== Settings: the secret key\n";
list( $stored, $messages ) = cpt_save( $live_key );
$req                       = cpt_last();
cpt_check( 'a cp_live_ key the API confirms is saved', $stored === $live_key, var_export( $stored, true ) );
cpt_check( 'it is checked with one call to /v1/usage', 1 === count( $GLOBALS['cpt']['requests'] ) && 'https://api.clearpostcode.co.uk/v1/usage' === $req['url'], $req['url'] );
cpt_check( 'the check sends the key in X-Api-Key', isset( $req['args']['headers']['X-Api-Key'] ) && $req['args']['headers']['X-Api-Key'] === $live_key );
cpt_check( 'the confirmation names the plan and lookups left', isset( $messages[0]['type'] ) && 'success' === $messages[0]['type'] && false !== strpos( $messages[0]['message'], '9,588' ) && false !== strpos( $messages[0]['message'], 'Free' ), wp_json_encode( $messages ) );

list( $stored, $messages ) = cpt_save( $pub_key );
cpt_check( 'a publishable key is refused and the saved key stays', $stored === $live_key && 'error' === $messages[0]['type'] && false !== strpos( $messages[0]['message'], 'cp_live_' ), wp_json_encode( $messages ) );
list( $stored, $messages ) = cpt_save( 'cp_live_short' );
cpt_check( 'a malformed key is refused', $stored === $live_key && 'error' === $messages[0]['type'] );

cpt_fake(
	function () {
		return cpt_problem( 401, 'invalid_key' );
	}
);
list( $stored, $messages ) = cpt_save( 'cp_live_' . str_repeat( 'E', 32 ) );
cpt_check( 'a key the API refuses is not saved', $stored === $live_key && 'error' === $messages[0]['type'], wp_json_encode( $messages ) );

cpt_fake(
	function () {
		return new WP_Error( 'http_request_failed', 'timeout' );
	}
);
$third                     = 'cp_live_' . str_repeat( 'D', 32 );
list( $stored, $messages ) = cpt_save( $third );
cpt_check( 'a key the API cannot confirm just now is saved, with a warning', $stored === $third && 'warning' === $messages[0]['type'] );
list( $stored ) = cpt_save( '' );
cpt_check( 'an empty field clears the key (keyless)', '' === $stored );
update_option( 'clear_postcode_secret_key', $live_key );

echo "== Keyed validation (fake API)\n";
cpt_reset_cache();
cpt_fake(
	function ( $url ) {
		if ( false !== strpos( $url, '/SW1A%201AA/validate' ) ) {
			return cpt_validation( 'SW1A 1AA', true, 'live' );
		}
		if ( false !== strpos( $url, '/AB1%200AA/validate' ) ) {
			return cpt_validation( 'AB1 0AA', true, 'terminated', 'AB10 1AA' );
		}
		if ( false !== strpos( $url, '/SW1A%209ZZ/validate' ) ) {
			return cpt_validation( 'SW1A 9ZZ', false, null );
		}
		if ( false !== strpos( $url, '/BT1%201AA/validate' ) ) {
			$a    = cpt_validation( 'BT1 1AA', null, null );
			$body = json_decode( $a['body'], true );
			$body['data']['coverage'] = 'not_covered';
			$a['body'] = wp_json_encode( $body );
			return $a;
		}
		return cpt_answer( 200, array( 'data' => array( 'input' => 'x', 'postcode' => null, 'format_valid' => false, 'known' => false, 'status' => null, 'valid' => false, 'coverage' => 'covered' ) ) );
	}
);
$r   = clear_postcode_validate( ' sw1a  1aa ' );
$req = cpt_last();
cpt_check( 'a live postcode is valid', 'valid' === $r['state'] && 'SW1A 1AA' === $r['postcode'], wp_json_encode( $r ) );
cpt_check( 'the server call carries the secret key', isset( $req['args']['headers']['X-Api-Key'] ) && $req['args']['headers']['X-Api-Key'] === $live_key );
cpt_check( 'the server call sends no Origin or Referer', ! isset( $req['args']['headers']['Origin'] ) && ! isset( $req['args']['headers']['Referer'] ) );
cpt_check( 'the server call names the plugin in User-Agent', 0 === strpos( $req['args']['headers']['User-Agent'], 'clear-postcode-wordpress/' . CLEAR_POSTCODE_VERSION ) );
cpt_check( 'it calls /validate with the postcode in the path', 'https://api.clearpostcode.co.uk/v1/postcodes/SW1A%201AA/validate' === $req['url'], $req['url'] );
$n = count( $GLOBALS['cpt']['requests'] );
clear_postcode_validate( 'SW1A 1AA' );
cpt_check( 'a repeat postcode is answered from the cache', count( $GLOBALS['cpt']['requests'] ) === $n );
$r = clear_postcode_validate( 'AB1 0AA' );
cpt_check( 'a terminated postcode carries its replacement', 'terminated' === $r['state'] && 'AB10 1AA' === $r['replaced_by'], wp_json_encode( $r ) );
cpt_check( 'an unknown postcode', 'unknown' === clear_postcode_validate( 'SW1A 9ZZ' )['state'] );
cpt_check( 'a Northern Ireland postcode is checked by format', 'not_covered' === clear_postcode_validate( 'BT1 1AA' )['state'] );
cpt_check( 'a postcode in no UK format', 'invalid_format' === clear_postcode_validate( 'ZZ1 1ZZ' )['state'] );
cpt_check( 'default mode stops only a bad format', clear_postcode_blocks( 'invalid_format' ) && ! clear_postcode_blocks( 'unknown' ) && ! clear_postcode_blocks( 'terminated' ) && ! clear_postcode_blocks( 'error' ) );
update_option( 'clear_postcode_strict', '1' );
cpt_check( 'strict mode also stops unknown and terminated', clear_postcode_blocks( 'unknown' ) && clear_postcode_blocks( 'terminated' ) && ! clear_postcode_blocks( 'not_covered' ) && ! clear_postcode_blocks( 'error' ) );
$msg = clear_postcode_message( 'Shipping postcode', 'AB1 0AA', clear_postcode_validate( 'AB1 0AA' ) );
cpt_check( 'the terminated message names the live postcode', false !== strpos( $msg, 'AB10 1AA' ), $msg );
update_option( 'clear_postcode_strict', '0' );

echo "== Notices when the API refuses the key\n";
wp_set_current_user( 1 );
function cpt_notice() {
	ob_start();
	clear_postcode_admin_notice();
	return (string) ob_get_clean();
}
foreach ( array(
	array( 401, 'invalid_key', 'recognise' ),
	array( 402, 'quota_exceeded', 'used up' ),
	array( 403, 'publishable_key_not_allowed', 'cp_live_' ),
	array( 429, 'daily_cap_reached', 'cap' ),
) as $case ) {
	list( $status, $code, $words ) = $case;
	cpt_reset_cache();
	cpt_fake(
		function () use ( $status, $code ) {
			return cpt_problem( $status, $code, 402 === $status ? array( 'resets' => '2026-12-01T00:00:00.000Z' ) : array() );
		}
	);
	$r      = clear_postcode_validate( 'M1 1AE' );
	$notice = cpt_notice();
	cpt_check( "$status $code: the order goes through (fail open)", 'error' === $r['state'] && ! clear_postcode_blocks( $r['state'] ) );
	cpt_check( "$status $code: an admin notice says what to do", false !== strpos( $notice, 'notice-error' ) && false !== strpos( $notice, $words ) && false !== strpos( $notice, 'req-' . $code ), $notice );
}
cpt_reset_cache();
cpt_fake(
	function () {
		return cpt_validation( 'M1 1AE', true, 'live' );
	}
);
clear_postcode_validate( 'M1 1AE' );
cpt_check( 'the next good answer clears the notice', '' === trim( cpt_notice() ) && false === get_option( 'clear_postcode_alert' ) );
cpt_reset_cache();
cpt_fake(
	function () {
		$a                           = cpt_problem( 429, 'rate_limited' );
		$a['headers']['retry-after'] = '10';
		return $a;
	}
);
clear_postcode_validate( 'M1 1AE' );
cpt_check( 'a short burst limit raises no notice', false === get_option( 'clear_postcode_alert' ) );
wp_set_current_user( 0 );
cpt_check( 'people who cannot change settings never see it', '' === trim( cpt_notice() ) );

echo "== WooCommerce checkout (fake API)\n";
cpt_reset_cache();
cpt_fake(
	function ( $url ) {
		if ( false !== strpos( $url, '/SW1A%201AA/validate' ) ) {
			return cpt_validation( 'SW1A 1AA', true, 'live' );
		}
		return cpt_answer( 200, array( 'data' => array( 'input' => 'x', 'postcode' => null, 'format_valid' => false, 'known' => false, 'status' => null, 'valid' => false, 'coverage' => 'covered' ) ) );
	}
);
$errors = new WP_Error();
clear_postcode_classic_checkout(
	array(
		'billing_country'           => 'GB',
		'billing_postcode'          => 'ZZ1 1ZZ',
		'ship_to_different_address' => 1,
		'shipping_country'          => 'GB',
		'shipping_postcode'         => 'SW1A 1AA',
	),
	$errors
);
cpt_check( 'classic: a bad billing postcode is stopped with a clear message', array( 'billing_postcode_clear_postcode' ) === $errors->get_error_codes() && false !== strpos( $errors->get_error_message(), 'ZZ1 1ZZ' ), wp_json_encode( $errors->errors ) );
$errors = new WP_Error();
$before = count( $GLOBALS['cpt']['requests'] );
clear_postcode_classic_checkout(
	array(
		'billing_country'  => 'FR',
		'billing_postcode' => '75001',
	),
	$errors
);
cpt_check( 'classic: other countries are left alone, with no call', ! $errors->has_errors() && count( $GLOBALS['cpt']['requests'] ) === $before );
$order = new WC_Order();
$order->set_billing_country( 'GB' );
$order->set_billing_postcode( 'ZZ1 1ZZ' );
$thrown = '';
try {
	clear_postcode_block_checkout( $order );
} catch ( \Automattic\WooCommerce\StoreApi\Exceptions\RouteException $e ) {
	$thrown = $e->getMessage();
}
cpt_check( 'block: a bad billing postcode stops the order', false !== strpos( $thrown, 'ZZ1 1ZZ' ), $thrown );
$order->set_billing_postcode( 'SW1A 1AA' );
$thrown = '';
try {
	clear_postcode_block_checkout( $order );
} catch ( \Automattic\WooCommerce\StoreApi\Exceptions\RouteException $e ) {
	$thrown = $e->getMessage();
}
cpt_check( 'block: a live postcode goes through', '' === $thrown, $thrown );
update_option( 'clear_postcode_checkout', '0' );
$errors = new WP_Error();
clear_postcode_classic_checkout(
	array(
		'billing_country'  => 'GB',
		'billing_postcode' => 'ZZ1 1ZZ',
	),
	$errors
);
cpt_check( 'checkout checks switch off in Settings', ! $errors->has_errors() );
update_option( 'clear_postcode_checkout', '1' );

echo "== Postcode checker (fake API)\n";
cpt_reset_cache();
cpt_fake(
	function () {
		return cpt_answer(
			200,
			array(
				'data' => array(
					'postcode'        => 'AB1 0AA',
					'status'          => 'terminated',
					'replaced_by'     => 'AB10 1AA',
					'local_authority' => array(
						'code' => 'S12000033',
						'name' => 'Aberdeen City',
					),
				),
			)
		);
	}
);
$a   = clear_postcode_check( 'AB1 0AA' );
$req = cpt_last();
parse_str( (string) wp_parse_url( $req['url'], PHP_URL_QUERY ), $q );
cpt_check( 'the checker asks for replaced_by with the area fields', isset( $q['fields'] ) && in_array( 'replaced_by', explode( ',', $q['fields'] ), true ), $req['url'] );
cpt_check( 'a terminated postcode shows its replacement', $a['ok'] && 'terminated' === $a['data']['status'] && 'AB10 1AA' === $a['data']['replaced_by'] && 'Aberdeen City' === $a['data']['rows'][0]['value'], wp_json_encode( $a ) );
$html = do_shortcode( '[clear_postcode_lookup button="Find my council"]' );
cpt_check( 'the shortcode renders the box', false !== strpos( $html, 'Find my council' ) && false !== strpos( $html, 'autocomplete="postal-code"' ) );

echo "== Keyless, against the live API\n";
delete_option( 'clear_postcode_secret_key' );
cpt_reset_cache();
cpt_fake( null );
$r   = clear_postcode_validate( 'SW1A 1AA' );
$req = cpt_last();
cpt_check( 'live: SW1A 1AA is valid', 'valid' === $r['state'], wp_json_encode( $r ) );
cpt_check( 'live: a keyless call sends no key', ! isset( $req['args']['headers']['X-Api-Key'] ) );
cpt_check( 'live: ZZ1 1ZZ is not a postcode', 'invalid_format' === clear_postcode_validate( 'ZZ1 1ZZ' )['state'] );
$a = clear_postcode_check( 'M1 1AE' );
cpt_check( 'live: the checker answers M1 1AE with its council', $a['ok'] && in_array( 'Manchester', wp_list_pluck( $a['data']['rows'], 'value' ), true ), wp_json_encode( $a ) );
cpt_check( 'live: no notice after keyless answers', false === get_option( 'clear_postcode_alert' ) );

printf( "\n%d passed, %d failed\n", $GLOBALS['cpt']['pass'], $GLOBALS['cpt']['fail'] );
if ( $GLOBALS['cpt']['fail'] ) {
	exit( 1 );
}
