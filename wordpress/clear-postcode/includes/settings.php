<?php
/**
 * Settings → ClearPostcode: the secret key (checked against the API when saved, never shown again), the publishable
 * key for the postcode finder, the switches, and the notice that tells the site owner when the API refuses the key or
 * the allowance runs out.
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
 * A saved secret key as the settings screen shows it: the prefix and the last four characters, never the key.
 *
 * @param string $key A secret key.
 */
function clear_postcode_mask( $key ) {
	return 'cp_live_' . str_repeat( '•', 12 ) . substr( $key, -4 );
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

	$value    = trim( sanitize_text_field( (string) $value ) );
	$previous = clear_postcode_secret_key();
	if ( '' !== $previous && clear_postcode_mask( $previous ) === $value ) {
		return $previous; // The masked key came back unchanged: keep it.
	}
	if ( ! isset( $checked[ $value ] ) ) {
		$checked[ $value ] = clear_postcode_check_secret_key( $value, $previous );
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
		register_setting(
			'clear_postcode',
			'clear_postcode_publishable_key',
			array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'clear_postcode_sanitize_publishable_key',
			)
		);
		foreach ( array(
			'clear_postcode_finder'   => '1',
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
	$secret = clear_postcode_secret_key();
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'ClearPostcode', 'clear-postcode' ); ?></h1>
		<p>
			<?php esc_html_e( 'Every UK postcode checked as it is typed and again as the order is placed. Get your free keys at', 'clear-postcode' ); ?>
			<a href="<?php echo esc_url( 'https://clearpostcode.co.uk/developers#key' ); ?>" target="_blank" rel="noopener">clearpostcode.co.uk/developers</a>.
		</p>
		<form method="post" action="options.php">
			<?php settings_fields( 'clear_postcode' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="clear_postcode_secret_key"><?php esc_html_e( 'Secret key', 'clear-postcode' ); ?></label></th>
					<td>
						<input type="text" class="regular-text code" id="clear_postcode_secret_key" name="clear_postcode_secret_key" value="<?php echo esc_attr( '' === $secret ? '' : clear_postcode_mask( $secret ) ); ?>" placeholder="cp_live_..." autocomplete="off" spellcheck="false">
						<p class="description"><?php esc_html_e( 'Starts cp_live_. It stays on your server, where checkout checks run, and is never shown again once saved. Clear the field to run on the free keyless allowance.', 'clear-postcode' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="clear_postcode_publishable_key"><?php esc_html_e( 'Publishable key', 'clear-postcode' ); ?></label></th>
					<td>
						<input type="text" class="regular-text code" id="clear_postcode_publishable_key" name="clear_postcode_publishable_key" value="<?php echo esc_attr( clear_postcode_publishable_key() ); ?>" placeholder="cp_pub_..." autocomplete="off" spellcheck="false">
						<p class="description">
							<?php
							/* translators: %s: this site's domain. */
							echo esc_html( sprintf( __( 'Starts cp_pub_, locked to %s. Optional: the postcode finder runs in your visitors\' browsers and works without one. With Address lookup on your account, it turns the finder into a full address finder.', 'clear-postcode' ), clear_postcode_site_host() ) );
							?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Postcode finder', 'clear-postcode' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="clear_postcode_finder" value="1" <?php checked( get_option( 'clear_postcode_finder', '1' ), '1' ); ?>>
							<?php esc_html_e( 'Format and check postcodes as they are typed, with suggestions, at checkout, on My account addresses and on postcode fields in Contact Form 7 and WPForms', 'clear-postcode' ); ?>
						</label>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'WooCommerce checkout', 'clear-postcode' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="clear_postcode_checkout" value="1" <?php checked( get_option( 'clear_postcode_checkout', '1' ), '1' ); ?>>
							<?php esc_html_e( 'Check billing and shipping postcodes as the order is placed', 'clear-postcode' ); ?>
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
		<h2><?php esc_html_e( 'Forms', 'clear-postcode' ); ?></h2>
		<p><?php esc_html_e( 'Contact Form 7: add a postcode field with the tag below. It formats and checks the postcode as it is typed, and the form will not send a postcode that is not a UK postcode.', 'clear-postcode' ); ?></p>
		<p><code>[postcode* your-postcode]</code></p>
		<p><?php esc_html_e( 'WPForms: add a Single Line Text field and give it the CSS class clear-postcode (Advanced, CSS Classes). The same checks apply.', 'clear-postcode' ); ?></p>
		<h2><?php esc_html_e( 'Postcode checker', 'clear-postcode' ); ?></h2>
		<p><code>[clear_postcode_lookup]</code> <?php esc_html_e( 'adds a postcode checker to any page, post or widget area: visitors type a postcode and see its council, ward, constituency, region and country as they type.', 'clear-postcode' ); ?></p>
		<p><code>[clear_postcode_lookup placeholder="Your postcode"]</code></p>
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
