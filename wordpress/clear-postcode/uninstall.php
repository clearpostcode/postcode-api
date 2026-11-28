<?php
/**
 * Removes the plugin's settings and cached answers when the plugin is deleted.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}
foreach ( array( 'clear_postcode_secret_key', 'clear_postcode_publishable_key', 'clear_postcode_finder', 'clear_postcode_checkout', 'clear_postcode_strict', 'clear_postcode_alert' ) as $clear_postcode_option ) {
	delete_option( $clear_postcode_option );
}

global $wpdb;
$clear_postcode_like = $wpdb->esc_like( '_transient_clear_postcode_' ) . '%';
$clear_postcode_old  = $wpdb->esc_like( '_transient_timeout_clear_postcode_' ) . '%';
$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s", $clear_postcode_like, $clear_postcode_old ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
