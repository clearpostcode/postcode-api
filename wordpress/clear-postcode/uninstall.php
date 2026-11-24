<?php
/**
 * Removes the plugin's settings and cached answers when the plugin is deleted.
 */
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}
delete_option( 'clear_postcode_key' );
delete_option( 'clear_postcode_checkout' );
delete_option( 'clear_postcode_strict' );

global $wpdb;
$clear_postcode_like = $wpdb->esc_like( '_transient_clear_postcode_' ) . '%';
$clear_postcode_old  = $wpdb->esc_like( '_transient_timeout_clear_postcode_' ) . '%';
$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s", $clear_postcode_like, $clear_postcode_old ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
