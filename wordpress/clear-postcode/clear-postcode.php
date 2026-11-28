<?php
/**
 * Plugin Name:       ClearPostcode
 * Plugin URI:        https://clearpostcode.co.uk/integrations/woocommerce
 * Description:       Check UK postcodes at WooCommerce checkout (billing and shipping) and add a postcode checker to any page with [clear_postcode_lookup].
 * Version:           1.0.1
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            ClearPostcode
 * Author URI:        https://clearpostcode.co.uk
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       clear-postcode
 *
 * Checkout checks and the checker run on this site's server, which calls api.clearpostcode.co.uk with the secret key
 * from Settings (docs: https://clearpostcode.co.uk/developers/docs). The key never reaches a visitor's browser.
 * Checkout fails open: if the API cannot be reached, the order goes through.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const CLEAR_POSTCODE_VERSION = '1.0.1';
const CLEAR_POSTCODE_API     = 'https://api.clearpostcode.co.uk/v1';
const CLEAR_POSTCODE_FILE    = __FILE__;

require_once __DIR__ . '/includes/api.php';
require_once __DIR__ . '/includes/validate.php';
require_once __DIR__ . '/includes/checkout.php';
require_once __DIR__ . '/includes/checker.php';
require_once __DIR__ . '/includes/settings.php';
