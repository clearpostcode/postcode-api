<?php
/**
 * The postcode finder in visitors' browsers (assets/finder.js, the ClearPostcode finder from the clearpostcode npm
 * package): it formats and checks postcodes as they are typed at checkout, on My account addresses, in forms and in
 * the postcode checker. It calls the API from the browser, keyless or with the publishable key from Settings.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** A publishable key as the API issues it. */
const CLEAR_POSTCODE_PUBLISHABLE_RE = '/^cp_pub_[A-Za-z0-9_-]{24,64}$/';

/** The inputs the finder takes: marked ones, every postcode field, and WPForms fields with the clear-postcode class. */
const CLEAR_POSTCODE_FINDER_SELECTOR = '[data-clearpostcode="postcode"], input[autocomplete~="postal-code"], .clear-postcode input';

/** The publishable key from Settings, or ''. */
function clear_postcode_publishable_key() {
	$key = get_option( 'clear_postcode_publishable_key', '' );
	return is_string( $key ) ? $key : '';
}

/** This site's host name, the domain a publishable key must be locked to. */
function clear_postcode_site_host() {
	return (string) wp_parse_url( home_url(), PHP_URL_HOST );
}

/**
 * Check a publishable key being saved: its format, then one free autocomplete call from this site's origin, as the
 * finder will make it. A key the API refuses is not saved; a key not yet locked to this domain is saved with a note.
 *
 * @param mixed $value What was typed.
 * @return string The key to store.
 */
function clear_postcode_sanitize_publishable_key( $value ) {
	static $checked = array();

	$value = trim( sanitize_text_field( (string) $value ) );
	if ( ! isset( $checked[ $value ] ) ) {
		$checked[ $value ] = clear_postcode_check_publishable_key( $value, clear_postcode_publishable_key() );
	}
	return $checked[ $value ];
}

/**
 * The publishable key to store, with a settings message.
 *
 * @param string $value    The key typed, trimmed.
 * @param string $previous The key saved before.
 */
function clear_postcode_check_publishable_key( $value, $previous ) {
	if ( '' === $value ) {
		return '';
	}
	if ( 0 === strpos( $value, 'cp_live_' ) ) {
		clear_postcode_settings_message( 'clear_postcode_secret_in_browser', __( 'That is your secret key: it belongs in the Secret key field, never in a browser. The publishable key starts cp_pub_.', 'clear-postcode' ) );
		return $previous;
	}
	if ( ! preg_match( CLEAR_POSTCODE_PUBLISHABLE_RE, $value ) ) {
		clear_postcode_settings_message( 'clear_postcode_pub_format', __( 'That is not a ClearPostcode publishable key. Copy it from your dashboard: it starts cp_pub_.', 'clear-postcode' ) );
		return $previous;
	}
	$response = wp_remote_get(
		CLEAR_POSTCODE_API . '/autocomplete?q=SW1A&key=' . rawurlencode( $value ),
		array(
			'timeout'     => 5,
			'redirection' => 0,
			'headers'     => array(
				'Accept'     => 'application/json',
				'Origin'     => untrailingslashit( home_url() ),
				'User-Agent' => 'clear-postcode-wordpress/' . CLEAR_POSTCODE_VERSION,
			),
		)
	);
	$status   = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
	$code     = is_wp_error( $response ) ? '' : clear_postcode_problem_code( (array) json_decode( wp_remote_retrieve_body( $response ), true ) );
	if ( 401 === $status ) {
		clear_postcode_settings_message( 'clear_postcode_pub_inactive', __( 'The API doesn’t recognise that publishable key. Copy it again from your dashboard.', 'clear-postcode' ) );
		return $previous;
	}
	if ( 'origin_not_allowed' === $code ) {
		/* translators: %s: this site's domain. */
		clear_postcode_settings_message( 'clear_postcode_pub_domain', sprintf( __( 'Publishable key saved. Add %s to its domains in your dashboard and the finder uses it; until then the finder runs keyless.', 'clear-postcode' ), clear_postcode_site_host() ), 'warning' );
		return $value;
	}
	if ( 200 === $status ) {
		/* translators: %s: this site's domain. */
		clear_postcode_settings_message( 'clear_postcode_pub_ok', sprintf( __( 'Settings saved. Your publishable key works on %s.', 'clear-postcode' ), clear_postcode_site_host() ), 'success' );
	}
	return $value;
}

/**
 * Load the finder on this page. The checker loads it whatever the setting; checkout and forms follow the setting.
 *
 * @param bool $always Load it even when the finder is switched off in Settings.
 * @return bool Whether it loads.
 */
function clear_postcode_enqueue_finder( $always = false ) {
	if ( ! $always && '1' !== get_option( 'clear_postcode_finder', '1' ) ) {
		return false;
	}
	wp_enqueue_style( 'clear-postcode-finder', plugins_url( 'assets/finder.css', CLEAR_POSTCODE_FILE ), array(), CLEAR_POSTCODE_VERSION );
	wp_enqueue_script(
		'clear-postcode-finder',
		plugins_url( 'assets/finder.js', CLEAR_POSTCODE_FILE ),
		array(),
		CLEAR_POSTCODE_VERSION,
		array(
			'in_footer' => true,
			'strategy'  => 'defer',
		)
	);
	return true;
}

/**
 * The finder's settings ride on its script tag: the publishable key (public by design, locked to this domain) and
 * which inputs to take.
 *
 * @param string $tag    The script tag.
 * @param string $handle The script's handle.
 */
function clear_postcode_finder_tag( $tag, $handle ) {
	if ( 'clear-postcode-finder' !== $handle ) {
		return $tag;
	}
	$attributes = ' data-selector="' . esc_attr( CLEAR_POSTCODE_FINDER_SELECTOR ) . '"';
	$key        = clear_postcode_publishable_key();
	if ( '' !== $key ) {
		$attributes .= ' data-key="' . esc_attr( $key ) . '"';
	}
	return preg_replace( '/<script /', '<script' . $attributes . ' ', $tag, 1 );
}
add_filter( 'script_loader_tag', 'clear_postcode_finder_tag', 10, 2 );

/** WooCommerce: the checkout (classic and block) and the My account address forms. */
function clear_postcode_finder_on_woocommerce() {
	if ( ! function_exists( 'is_checkout' ) ) {
		return;
	}
	$checkout = is_checkout() && ! is_wc_endpoint_url( 'order-received' ) && ! is_wc_endpoint_url( 'order-pay' );
	if ( $checkout || ( is_account_page() && is_wc_endpoint_url( 'edit-address' ) ) ) {
		clear_postcode_enqueue_finder();
	}
}
add_action( 'wp_enqueue_scripts', 'clear_postcode_finder_on_woocommerce' );
