<?php
/**
 * Plugin Name:       ClearPostcode
 * Plugin URI:        https://clearpostcode.co.uk/integrations
 * Description:       Check UK postcodes at WooCommerce checkout (billing and shipping) and add a postcode checker to any page with [clear_postcode_lookup].
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            ClearPostcode
 * Author URI:        https://clearpostcode.co.uk
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       clear-postcode
 *
 * Every call goes from the site's server to api.clearpostcode.co.uk (docs: https://clearpostcode.co.uk/developers/docs).
 * The visitor's browser never sees the key. Checkout fails open: if the API cannot be reached, the order goes through.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const CLEAR_POSTCODE_VERSION = '1.0.0';
const CLEAR_POSTCODE_API     = 'https://api.clearpostcode.co.uk/v1';

/** A UK postcode as people type it: trimmed, single spaces, upper case. */
function clear_postcode_normalise( $postcode ) {
	return strtoupper( trim( preg_replace( '/\s+/', ' ', (string) $postcode ) ) );
}

/** The publishable key from Settings, or '' (the API's keyless allowance then applies). */
function clear_postcode_key() {
	$key = get_option( 'clear_postcode_key', '' );
	return is_string( $key ) ? $key : '';
}

/**
 * One GET to the API. Returns array( 'status' => int, 'json' => array ), or array( 'status' => 0, 'json' => array() ) when
 * the API could not be reached.
 */
function clear_postcode_api_get( $path, $query = array() ) {
	$url     = add_query_arg( array_map( 'rawurlencode', $query ), CLEAR_POSTCODE_API . $path );
	$headers = array(
		'Accept'     => 'application/json',
		'User-Agent' => 'clear-postcode-wordpress/' . CLEAR_POSTCODE_VERSION,
	);
	$key     = clear_postcode_key();
	if ( '' !== $key ) {
		$headers['x-api-key'] = $key;
	}
	$response = wp_remote_get(
		$url,
		array(
			'timeout' => 5,
			'headers' => $headers,
		)
	);
	if ( is_wp_error( $response ) ) {
		return array(
			'status' => 0,
			'json'   => array(),
		);
	}
	$json = json_decode( wp_remote_retrieve_body( $response ), true );
	return array(
		'status' => (int) wp_remote_retrieve_response_code( $response ),
		'json'   => is_array( $json ) ? $json : array(),
	);
}

/**
 * Validate one postcode. Returns array( 'state' => ..., 'postcode' => canonical form ).
 * state: valid | invalid_format | unknown | terminated | not_covered | error. Definite answers are cached for 12 hours.
 */
function clear_postcode_validate( $postcode ) {
	$postcode = clear_postcode_normalise( $postcode );
	$cache_id = 'clear_postcode_v_' . md5( $postcode );
	$cached   = get_transient( $cache_id );
	if ( is_array( $cached ) ) {
		return $cached;
	}
	$res    = clear_postcode_api_get( '/postcodes/' . rawurlencode( $postcode ) . '/validate' );
	$result = array(
		'state'    => 'error',
		'postcode' => $postcode,
	);
	if ( 400 === $res['status'] ) {
		$result['state'] = 'invalid_format';
	} elseif ( 200 === $res['status'] && isset( $res['json']['data'] ) && is_array( $res['json']['data'] ) ) {
		$d = $res['json']['data'];
		if ( ! empty( $d['postcode'] ) ) {
			$result['postcode'] = (string) $d['postcode'];
		}
		if ( isset( $d['coverage'] ) && 'not_covered' === $d['coverage'] ) {
			$result['state'] = 'not_covered'; // Northern Ireland: format checked only.
		} elseif ( isset( $d['format_valid'] ) && false === $d['format_valid'] ) {
			$result['state'] = 'invalid_format';
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

/** Should this validation result stop an order? Bad format always; unknown or terminated only in strict mode. */
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

function clear_postcode_message( $label, $postcode ) {
	/* translators: 1: "Billing postcode" or "Shipping postcode", 2: the postcode as typed. */
	return sprintf( __( '%1$s “%2$s” is not a UK postcode we can find. Please check it and try again.', 'clear-postcode' ), $label, $postcode );
}

/** WooCommerce checkout (classic shortcode checkout): billing and, when used, shipping postcode. */
add_action(
	'woocommerce_after_checkout_validation',
	function ( $data, $errors ) {
		if ( '1' !== get_option( 'clear_postcode_checkout', '1' ) ) {
			return;
		}
		$parts = array(
			'billing'  => __( 'Billing postcode', 'clear-postcode' ),
			'shipping' => __( 'Shipping postcode', 'clear-postcode' ),
		);
		foreach ( $parts as $type => $label ) {
			if ( 'shipping' === $type && empty( $data['ship_to_different_address'] ) ) {
				continue;
			}
			$country  = isset( $data[ $type . '_country' ] ) ? (string) $data[ $type . '_country' ] : '';
			$postcode = isset( $data[ $type . '_postcode' ] ) ? (string) $data[ $type . '_postcode' ] : '';
			if ( ! in_array( $country, clear_postcode_countries(), true ) || '' === trim( $postcode ) ) {
				continue; // Empty required fields are WooCommerce's own error.
			}
			$result = clear_postcode_validate( $postcode );
			if ( clear_postcode_blocks( $result['state'] ) ) {
				$errors->add( $type . '_postcode_clear_postcode', esc_html( clear_postcode_message( $label, $postcode ) ) );
			}
		}
	},
	10,
	2
);

/** WooCommerce Checkout block (Store API): the same two checks on the order being placed. */
add_action(
	'woocommerce_store_api_checkout_update_order_from_request',
	function ( $order ) {
		if ( '1' !== get_option( 'clear_postcode_checkout', '1' ) || ! class_exists( '\Automattic\WooCommerce\StoreApi\Exceptions\RouteException' ) ) {
			return;
		}
		$addresses = array(
			array( __( 'Billing postcode', 'clear-postcode' ), $order->get_billing_country(), $order->get_billing_postcode() ),
		);
		if ( $order->has_shipping_address() ) {
			$addresses[] = array( __( 'Shipping postcode', 'clear-postcode' ), $order->get_shipping_country(), $order->get_shipping_postcode() );
		}
		foreach ( $addresses as $address ) {
			list( $label, $country, $postcode ) = $address;
			if ( ! in_array( (string) $country, clear_postcode_countries(), true ) || '' === trim( (string) $postcode ) ) {
				continue;
			}
			$result = clear_postcode_validate( $postcode );
			if ( clear_postcode_blocks( $result['state'] ) ) {
				throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException( 'clear_postcode_invalid', esc_html( clear_postcode_message( $label, $postcode ) ), 400 );
			}
		}
	}
);

/** Tell WooCommerce the plugin works with order tables (HPOS) and the Checkout block. */
add_action(
	'before_woocommerce_init',
	function () {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', __FILE__, true );
		}
	}
);

/** [clear_postcode_lookup placeholder="Enter a postcode" button="Check postcode"] */
add_shortcode(
	'clear_postcode_lookup',
	function ( $atts ) {
		$a = shortcode_atts(
			array(
				'placeholder' => __( 'Enter a UK postcode', 'clear-postcode' ),
				'button'      => __( 'Check postcode', 'clear-postcode' ),
			),
			$atts,
			'clear_postcode_lookup'
		);
		static $enqueued = false;
		if ( ! $enqueued ) {
			$enqueued = true;
			wp_enqueue_style( 'clear-postcode', plugins_url( 'assets/checker.css', __FILE__ ), array(), CLEAR_POSTCODE_VERSION );
			wp_enqueue_script( 'clear-postcode', plugins_url( 'assets/checker.js', __FILE__ ), array(), CLEAR_POSTCODE_VERSION, true );
			wp_localize_script(
				'clear-postcode',
				'clearPostcode',
				array(
					'ajaxUrl' => admin_url( 'admin-ajax.php' ),
					'nonce'   => wp_create_nonce( 'clear_postcode_check' ),
					'error'   => __( 'Something went wrong. Please try again.', 'clear-postcode' ),
				)
			);
		}
		ob_start();
		?>
		<form class="clear-postcode" novalidate>
			<label class="clear-postcode__label">
				<span class="screen-reader-text"><?php echo esc_html( $a['placeholder'] ); ?></span>
				<input class="clear-postcode__input" type="text" name="postcode" maxlength="12" autocomplete="postal-code" placeholder="<?php echo esc_attr( $a['placeholder'] ); ?>">
			</label>
			<button class="clear-postcode__button" type="submit"><?php echo esc_html( $a['button'] ); ?></button>
			<p class="clear-postcode__result" role="status" aria-live="polite"></p>
		</form>
		<?php
		return ob_get_clean();
	}
);

/** Checker request: nonce, a small per-visitor allowance, then one postcode lookup (cached for 12 hours). */
function clear_postcode_ajax_check() {
	if ( ! check_ajax_referer( 'clear_postcode_check', 'nonce', false ) ) {
		wp_send_json_error( array( 'message' => __( 'Please reload the page and try again.', 'clear-postcode' ) ), 403 );
	}
	$visitor = md5( isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '' );
	$budget  = 'clear_postcode_rl_' . $visitor;
	$used    = (int) get_transient( $budget );
	if ( $used >= 30 ) {
		wp_send_json_error( array( 'message' => __( 'Too many checks for now. Please try again in a few minutes.', 'clear-postcode' ) ), 429 );
	}
	set_transient( $budget, $used + 1, 10 * MINUTE_IN_SECONDS );

	$postcode = isset( $_POST['postcode'] ) ? clear_postcode_normalise( sanitize_text_field( wp_unslash( $_POST['postcode'] ) ) ) : '';
	if ( '' === $postcode || strlen( $postcode ) > 12 ) {
		wp_send_json_error( array( 'message' => __( 'Enter a UK postcode, for example SW1A 1AA.', 'clear-postcode' ) ), 400 );
	}

	$cache_id = 'clear_postcode_l_' . md5( $postcode );
	$cached   = get_transient( $cache_id );
	if ( is_array( $cached ) ) {
		wp_send_json_success( $cached );
	}
	$res = clear_postcode_api_get( '/postcodes/' . rawurlencode( $postcode ), array( 'fields' => 'country,region,local_authority,ward,constituency' ) );
	if ( 400 === $res['status'] || 404 === $res['status'] ) {
		wp_send_json_error( array( 'message' => __( 'We could not find that postcode. Please check it and try again.', 'clear-postcode' ) ), 404 );
	}
	if ( 200 !== $res['status'] || empty( $res['json']['data']['postcode'] ) ) {
		wp_send_json_error( array( 'message' => __( 'The postcode service is busy. Please try again shortly.', 'clear-postcode' ) ), 502 );
	}
	$d       = $res['json']['data'];
	$rows    = array();
	$labels  = array(
		'local_authority' => __( 'Council', 'clear-postcode' ),
		'ward'            => __( 'Ward', 'clear-postcode' ),
		'constituency'    => __( 'Constituency', 'clear-postcode' ),
		'region'          => __( 'Region', 'clear-postcode' ),
		'country'         => __( 'Country', 'clear-postcode' ),
	);
	foreach ( $labels as $field => $label ) {
		if ( ! empty( $d[ $field ]['name'] ) ) {
			$rows[] = array(
				'label' => $label,
				'value' => sanitize_text_field( (string) $d[ $field ]['name'] ),
			);
		}
	}
	$out = array(
		'postcode'    => sanitize_text_field( (string) $d['postcode'] ),
		'status'      => ( isset( $d['status'] ) && 'terminated' === $d['status'] ) ? 'terminated' : 'live',
		'replaced_by' => ! empty( $d['replaced_by'] ) ? sanitize_text_field( (string) $d['replaced_by'] ) : '',
		'rows'        => $rows,
	);
	set_transient( $cache_id, $out, 12 * HOUR_IN_SECONDS );
	wp_send_json_success( $out );
}
add_action( 'wp_ajax_clear_postcode_check', 'clear_postcode_ajax_check' );
add_action( 'wp_ajax_nopriv_clear_postcode_check', 'clear_postcode_ajax_check' );

/** Settings → ClearPostcode: the publishable key and two switches. */
add_action(
	'admin_init',
	function () {
		register_setting(
			'clear_postcode',
			'clear_postcode_key',
			array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => function ( $v ) {
					$v = trim( sanitize_text_field( (string) $v ) );
					if ( '' === $v ) {
						return '';
					}
					if ( 0 === strpos( $v, 'cp_live_' ) ) {
						add_settings_error( 'clear_postcode_key', 'clear_postcode_secret', __( 'That is a secret key (cp_live_). Paste your publishable key, which starts cp_pub_.', 'clear-postcode' ) );
						return '';
					}
					if ( ! preg_match( '/^cp_pub_[A-Za-z0-9_-]{8,128}$/', $v ) ) {
						add_settings_error( 'clear_postcode_key', 'clear_postcode_format', __( 'That does not look like a publishable key. It starts cp_pub_.', 'clear-postcode' ) );
						return '';
					}
					return $v;
				},
			)
		);
		foreach ( array(
			'clear_postcode_checkout' => '1',
			'clear_postcode_strict'   => '0',
		) as $option => $default ) {
			register_setting(
				'clear_postcode',
				$option,
				array(
					'type'              => 'string',
					'default'           => $default,
					'sanitize_callback' => function ( $v ) {
						return '1' === $v ? '1' : '0';
					},
				)
			);
		}
	}
);
add_action(
	'admin_menu',
	function () {
		add_options_page( 'ClearPostcode', 'ClearPostcode', 'manage_options', 'clear-postcode', 'clear_postcode_settings_page' );
	}
);
function clear_postcode_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'ClearPostcode', 'clear-postcode' ); ?></h1>
		<p>
			<?php esc_html_e( 'Get a free publishable key (10,000 postcode lookups a month, no card) at', 'clear-postcode' ); ?>
			<a href="<?php echo esc_url( 'https://clearpostcode.co.uk/developers#key' ); ?>" target="_blank" rel="noopener">clearpostcode.co.uk/developers</a>.
		</p>
		<?php settings_errors( 'clear_postcode_key' ); ?>
		<form method="post" action="options.php">
			<?php settings_fields( 'clear_postcode' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="clear_postcode_key"><?php esc_html_e( 'Publishable key', 'clear-postcode' ); ?></label></th>
					<td>
						<input type="text" class="regular-text code" id="clear_postcode_key" name="clear_postcode_key" value="<?php echo esc_attr( clear_postcode_key() ); ?>" placeholder="cp_pub_..." autocomplete="off">
						<p class="description"><?php esc_html_e( 'Optional: without a key the free keyless allowance applies.', 'clear-postcode' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'WooCommerce checkout', 'clear-postcode' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="clear_postcode_checkout" value="1" <?php checked( get_option( 'clear_postcode_checkout', '1' ), '1' ); ?>>
							<?php esc_html_e( 'Check billing and shipping postcodes at checkout', 'clear-postcode' ); ?>
						</label>
						<br>
						<label>
							<input type="checkbox" name="clear_postcode_strict" value="1" <?php checked( get_option( 'clear_postcode_strict', '0' ), '1' ); ?>>
							<?php esc_html_e( 'Also stop postcodes that are not in the current edition or have been terminated (very new postcodes can take up to a quarter to appear)', 'clear-postcode' ); ?>
						</label>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
		<h2><?php esc_html_e( 'Postcode checker', 'clear-postcode' ); ?></h2>
		<p><code>[clear_postcode_lookup]</code> <?php esc_html_e( 'adds a postcode checker to any page, post or widget area. Optional: placeholder and button text.', 'clear-postcode' ); ?></p>
		<p><code>[clear_postcode_lookup placeholder="Your postcode" button="Find my council"]</code></p>
	</div>
	<?php
}
add_filter(
	'plugin_action_links_' . plugin_basename( __FILE__ ),
	function ( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=clear-postcode' ) ) . '">' . esc_html__( 'Settings', 'clear-postcode' ) . '</a>' );
		return $links;
	}
);
