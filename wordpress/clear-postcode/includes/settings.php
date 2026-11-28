<?php
/**
 * Settings → ClearPostcode: the secret key (checked against the API when saved), two switches, and the notice that
 * tells the site owner when the API refuses the key or the allowance runs out.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** The settings screen's address. */
function clear_postcode_settings_url() {
	return admin_url( 'options-general.php?page=clear-postcode' );
}

/**
 * A message on the settings screen. Outside wp-admin (a key set with WP-CLI) there is no screen, so nothing is shown.
 *
 * @param string $code    The message's id.
 * @param string $message The message.
 * @param string $type    error | success | warning.
 */
function clear_postcode_settings_message( $code, $message, $type = 'error' ) {
	if ( function_exists( 'add_settings_error' ) ) {
		add_settings_error( 'clear_postcode_secret_key', $code, $message, $type );
	}
}

/**
 * Check a secret key being saved: its format, then one free call to /v1/usage with it. A key the API refuses is not
 * saved (the previous one stays); a key the API can't confirm just now is saved.
 *
 * @param mixed $value What was typed.
 * @return string The key to store.
 */
function clear_postcode_sanitize_secret_key( $value ) {
	static $checked = array(); // WordPress sanitises twice when the option is first added: check once.

	$value = trim( sanitize_text_field( (string) $value ) );
	if ( ! isset( $checked[ $value ] ) ) {
		$checked[ $value ] = clear_postcode_check_secret_key( $value, clear_postcode_secret_key() );
	}
	return $checked[ $value ];
}

/**
 * The key to store, with a settings message saying what the API made of it.
 *
 * @param string $value    The key typed, trimmed.
 * @param string $previous The key saved before.
 */
function clear_postcode_check_secret_key( $value, $previous ) {
	if ( '' === $value ) {
		return '';
	}
	if ( 0 === strpos( $value, 'cp_pub_' ) ) {
		clear_postcode_settings_message( 'clear_postcode_publishable', __( 'That is a publishable key (cp_pub_), made for browsers. Checkout checks run on your server, so paste your secret key: it starts cp_live_.', 'clear-postcode' ) );
		return $previous;
	}
	if ( ! preg_match( CLEAR_POSTCODE_SECRET_RE, $value ) ) {
		clear_postcode_settings_message( 'clear_postcode_format', __( 'That is not a ClearPostcode secret key. Copy it from your dashboard: it starts cp_live_.', 'clear-postcode' ) );
		return $previous;
	}
	$res = clear_postcode_api_get( '/usage', array(), $value );
	if ( 200 === $res['status'] && isset( $res['json']['data']['remaining'], $res['json']['data']['allowance'] ) ) {
		$u = $res['json']['data'];
		clear_postcode_settings_message(
			'clear_postcode_key_ok',
			sprintf(
				/* translators: 1: plan name, 2: postcode lookups left, 3: the month's allowance. */
				__( 'Settings saved. Your key is live on the %1$s plan, with %2$s of %3$s postcode lookups left this period.', 'clear-postcode' ),
				sanitize_text_field( (string) ( isset( $u['plan_name'] ) ? $u['plan_name'] : '' ) ),
				number_format_i18n( (int) $u['remaining'] ),
				number_format_i18n( (int) $u['allowance'] )
			),
			'success'
		);
		return $value;
	}
	if ( 401 === $res['status'] ) {
		clear_postcode_settings_message( 'clear_postcode_inactive', __( 'The API doesn’t recognise that key: it may have been revoked. Copy your secret key again from your dashboard.', 'clear-postcode' ) );
		return $previous;
	}
	clear_postcode_settings_message( 'clear_postcode_unconfirmed', __( 'Settings saved. The API didn’t confirm the key just now; checkout uses it from the next order.', 'clear-postcode' ), 'warning' );
	return $value;
}

/** Registered on init, so a key set from WP-CLI or REST is checked as the settings screen checks it. */
add_action(
	'init',
	function () {
		register_setting(
			'clear_postcode',
			'clear_postcode_secret_key',
			array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'clear_postcode_sanitize_secret_key',
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

/** A saved key starts a fresh notice: the next call shows whether it works. */
add_action(
	'update_option_clear_postcode_secret_key',
	function () {
		delete_option( 'clear_postcode_alert' );
	}
);

add_action(
	'admin_menu',
	function () {
		add_options_page( 'ClearPostcode', 'ClearPostcode', 'manage_options', 'clear-postcode', 'clear_postcode_settings_page' );
	}
);

/** The settings screen. Settings messages show through WordPress's own options header. */
function clear_postcode_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'ClearPostcode', 'clear-postcode' ); ?></h1>
		<p>
			<?php esc_html_e( 'Every UK billing and shipping postcode checked as the order is placed. Get your free secret key at', 'clear-postcode' ); ?>
			<a href="<?php echo esc_url( 'https://clearpostcode.co.uk/developers#key' ); ?>" target="_blank" rel="noopener">clearpostcode.co.uk/developers</a>.
		</p>
		<form method="post" action="options.php">
			<?php settings_fields( 'clear_postcode' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="clear_postcode_secret_key"><?php esc_html_e( 'Secret key', 'clear-postcode' ); ?></label></th>
					<td>
						<input type="password" class="regular-text code" id="clear_postcode_secret_key" name="clear_postcode_secret_key" value="<?php echo esc_attr( clear_postcode_secret_key() ); ?>" placeholder="cp_live_..." autocomplete="off" spellcheck="false">
						<p class="description"><?php esc_html_e( 'Starts cp_live_. It stays on your server: checkout checks and the postcode checker call the API from here, never from the visitor’s browser. Leave it empty to run on the free keyless allowance.', 'clear-postcode' ); ?></p>
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

/**
 * What the site owner needs to know about the last refused call.
 *
 * @param array $alert The stored alert (clear_postcode_note_answer()).
 */
function clear_postcode_alert_message( $alert ) {
	$keyed = '' !== clear_postcode_secret_key();
	switch ( $alert['status'] ) {
		case 401:
			return $keyed
				? __( 'The API doesn’t recognise the secret key in Settings, so checkout postcodes go through unchecked. Paste a live key, or clear the field to run on the free keyless allowance.', 'clear-postcode' )
				: __( 'The API asked for a key. Paste your free secret key in Settings.', 'clear-postcode' );
		case 402:
			return '' !== $alert['resets']
				/* translators: %s: the date the allowance resets. */
				? sprintf( __( 'This period’s postcode lookups are used up, so checkout postcodes go through unchecked until %s. Move up a plan or add a pack to keep every order checked.', 'clear-postcode' ), date_i18n( get_option( 'date_format' ), strtotime( $alert['resets'] ) ) )
				: __( 'This period’s postcode lookups are used up, so checkout postcodes go through unchecked. Move up a plan or add a pack to keep every order checked.', 'clear-postcode' );
		case 403:
			return __( 'The API refused the key in Settings. Paste your secret key: it starts cp_live_.', 'clear-postcode' );
		default:
			return 'daily_cap_reached' === $alert['code']
				? __( 'Today’s cap on your key is reached, so checkout postcodes go through unchecked until midnight UTC. Raise the cap in your dashboard.', 'clear-postcode' )
				: __( 'Your server has used today’s free keyless allowance, so checkout postcodes go through unchecked until midnight UTC. Paste your free secret key in Settings to keep every order checked.', 'clear-postcode' );
	}
}

/** The notice, for people who can change the settings, on every admin screen until a call shows the key working. */
function clear_postcode_admin_notice() {
	$alert = get_option( 'clear_postcode_alert', false );
	if ( ! is_array( $alert ) || ! isset( $alert['status'], $alert['code'], $alert['resets'] ) || ! current_user_can( 'manage_options' ) ) {
		return;
	}
	printf(
		'<div class="notice notice-error"><p><strong>ClearPostcode:</strong> %1$s <a href="%2$s">%3$s</a>%4$s</p></div>',
		esc_html( clear_postcode_alert_message( $alert ) ),
		esc_url( clear_postcode_settings_url() ),
		esc_html__( 'Open the settings', 'clear-postcode' ),
		! empty( $alert['request_id'] ) ? ' <code>' . esc_html( $alert['request_id'] ) . '</code>' : ''
	);
}
add_action( 'admin_notices', 'clear_postcode_admin_notice' );

add_filter(
	'plugin_action_links_' . plugin_basename( CLEAR_POSTCODE_FILE ),
	function ( $links ) {
		array_unshift( $links, '<a href="' . esc_url( clear_postcode_settings_url() ) . '">' . esc_html__( 'Settings', 'clear-postcode' ) . '</a>' );
		return $links;
	}
);
