<?php
/**
 * WooCommerce checkout: the billing and shipping postcodes are checked when the order is placed.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Classic (shortcode) checkout: billing and, when used, shipping postcode.
 *
 * @param array    $data   The posted checkout fields.
 * @param WP_Error $errors WooCommerce's checkout errors.
 */
function clear_postcode_classic_checkout( $data, $errors ) {
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
			$errors->add( $type . '_postcode_clear_postcode', esc_html( clear_postcode_message( $label, $postcode, $result ) ) );
		}
	}
}
add_action( 'woocommerce_after_checkout_validation', 'clear_postcode_classic_checkout', 10, 2 );

/**
 * Checkout block (Store API): the same checks on the order being placed.
 *
 * @param WC_Order $order The order the Store API is filling.
 * @throws \Automattic\WooCommerce\StoreApi\Exceptions\RouteException A postcode that stops the order.
 */
function clear_postcode_block_checkout( $order ) {
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
			throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException( 'clear_postcode_invalid', esc_html( clear_postcode_message( $label, $postcode, $result ) ), 400 );
		}
	}
}
add_action( 'woocommerce_store_api_checkout_update_order_from_request', 'clear_postcode_block_checkout' );

/** Tell WooCommerce the plugin works with order tables (HPOS) and the Checkout block. */
add_action(
	'before_woocommerce_init',
	function () {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', CLEAR_POSTCODE_FILE, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', CLEAR_POSTCODE_FILE, true );
		}
	}
);
