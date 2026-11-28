<?php
/**
 * Plugin Name:       ClearPostcode
 * Plugin URI:        https://clearpostcode.co.uk/integrations/woocommerce
 * Description:       UK postcodes formatted, checked and suggested as they are typed, at WooCommerce checkout, in Contact Form 7 and WPForms, and in a postcode checker for any page. Address lookup with a key that has it.
 * Version:           1.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            ClearPostcode
 * Author URI:        https://clearpostcode.co.uk
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       clear-postcode
 *
 * Checks on placing an order or sending a form run on this site's server with the secret key from Settings, which never
 * reaches a browser. The finder (assets/finder.js) runs in visitors' browsers, keyless or with the publishable key.
 * Docs: https://clearpostcode.co.uk/developers/docs. Checks fail open: if the API cannot be reached, the order goes
 * through.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const CLEAR_POSTCODE_VERSION = '1.1.0';
const CLEAR_POSTCODE_API     = 'https://api.clearpostcode.co.uk/v1';
const CLEAR_POSTCODE_FILE    = __FILE__;

require_once __DIR__ . '/includes/api.php';
require_once __DIR__ . '/includes/validate.php';
require_once __DIR__ . '/includes/checkout.php';
require_once __DIR__ . '/includes/finder.php';
require_once __DIR__ . '/includes/checker.php';
require_once __DIR__ . '/includes/settings.php';

/** Form plugins: each integration loads only with its plugin. */
add_action(
	'plugins_loaded',
	function () {
		if ( defined( 'WPCF7_VERSION' ) ) {
			require_once __DIR__ . '/includes/forms/contact-form-7.php';
		}
		if ( function_exists( 'wpforms' ) ) {
			require_once __DIR__ . '/includes/forms/wpforms.php';
		}
	}
);
