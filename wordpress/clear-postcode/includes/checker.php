<?php
/**
 * The [clear_postcode_lookup] postcode checker: a box on any page, answered by this site's server.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * [clear_postcode_lookup placeholder="Enter a postcode" button="Check postcode"]
 *
 * @param array|string $atts Shortcode attributes.
 */
function clear_postcode_shortcode( $atts ) {
	$a = shortcode_atts(
		array(
			'placeholder' => __( 'Enter a UK postcode', 'clear-postcode' ),
			'button'      => __( 'Check postcode', 'clear-postcode' ),
		),
		$atts,
		'clear_postcode_lookup'
	);
	if ( ! wp_script_is( 'clear-postcode-checker' ) ) {
		wp_enqueue_style( 'clear-postcode-checker', plugins_url( 'assets/checker.css', CLEAR_POSTCODE_FILE ), array(), CLEAR_POSTCODE_VERSION );
		wp_enqueue_script( 'clear-postcode-checker', plugins_url( 'assets/checker.js', CLEAR_POSTCODE_FILE ), array(), CLEAR_POSTCODE_VERSION, true );
		wp_localize_script(
			'clear-postcode-checker',
			'clearPostcodeChecker',
			array(
				'ajaxUrl'    => admin_url( 'admin-ajax.php' ),
				'nonce'      => wp_create_nonce( 'clear_postcode_check' ),
				'error'      => __( 'The checker didn’t answer. Try again in a moment.', 'clear-postcode' ),
				/* translators: %s: the nearest live postcode. */
				'terminated' => __( 'No longer in use. The nearest live postcode is %s.', 'clear-postcode' ),
				'retired'    => __( 'No longer in use.', 'clear-postcode' ),
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
add_shortcode( 'clear_postcode_lookup', 'clear_postcode_shortcode' );

/**
 * What the checker shows for a postcode: its areas, or the reason there are none. Answers are cached for 12 hours.
 *
 * @param string $postcode A normalised postcode.
 * @return array{ok: bool, status: int, data: array}
 */
function clear_postcode_check( $postcode ) {
	$cache_id = 'clear_postcode_l_' . md5( $postcode );
	$cached   = get_transient( $cache_id );
	if ( is_array( $cached ) && isset( $cached['rows'] ) ) {
		return array(
			'ok'     => true,
			'status' => 200,
			'data'   => $cached,
		);
	}
	$res  = clear_postcode_api_get( '/postcodes/' . rawurlencode( $postcode ), array( 'fields' => 'country,region,local_authority,ward,constituency,replaced_by' ) );
	$code = clear_postcode_problem_code( $res['json'] );
	if ( in_array( $code, array( 'invalid_postcode', 'postcode_not_found' ), true ) ) {
		return array(
			'ok'     => false,
			'status' => 404,
			'data'   => array( 'message' => __( 'That postcode isn’t in the UK postcode data. Check it and try again.', 'clear-postcode' ) ),
		);
	}
	if ( 'not_covered' === $code ) {
		return array(
			'ok'     => false,
			'status' => 404,
			'data'   => array( 'message' => __( 'Northern Ireland postcodes are checked by format only.', 'clear-postcode' ) ),
		);
	}
	if ( 200 !== $res['status'] || empty( $res['json']['data']['postcode'] ) ) {
		return array(
			'ok'     => false,
			'status' => 502,
			'data'   => array( 'message' => __( 'The checker didn’t answer. Try again in a moment.', 'clear-postcode' ) ),
		);
	}
	$d      = $res['json']['data'];
	$rows   = array();
	$labels = array(
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
	return array(
		'ok'     => true,
		'status' => 200,
		'data'   => $out,
	);
}

/** Checker request: the nonce, a small per-visitor allowance, then one postcode lookup. */
function clear_postcode_ajax_check() {
	if ( ! check_ajax_referer( 'clear_postcode_check', 'nonce', false ) ) {
		wp_send_json_error( array( 'message' => __( 'Reload the page and try again.', 'clear-postcode' ) ), 403 );
	}
	$visitor = md5( isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '' );
	$budget  = 'clear_postcode_rl_' . $visitor;
	$used    = (int) get_transient( $budget );
	if ( $used >= 30 ) {
		wp_send_json_error( array( 'message' => __( 'That’s a lot of checks in a row. Try again in a few minutes.', 'clear-postcode' ) ), 429 );
	}
	set_transient( $budget, $used + 1, 10 * MINUTE_IN_SECONDS );

	$postcode = isset( $_POST['postcode'] ) ? clear_postcode_normalise( sanitize_text_field( wp_unslash( $_POST['postcode'] ) ) ) : '';
	if ( '' === $postcode || strlen( $postcode ) > 12 ) {
		wp_send_json_error( array( 'message' => __( 'Enter a UK postcode, for example SW1A 1AA.', 'clear-postcode' ) ), 400 );
	}
	$answer = clear_postcode_check( $postcode );
	if ( $answer['ok'] ) {
		wp_send_json_success( $answer['data'] );
	}
	wp_send_json_error( $answer['data'], $answer['status'] );
}
add_action( 'wp_ajax_clear_postcode_check', 'clear_postcode_ajax_check' );
add_action( 'wp_ajax_nopriv_clear_postcode_check', 'clear_postcode_ajax_check' );
