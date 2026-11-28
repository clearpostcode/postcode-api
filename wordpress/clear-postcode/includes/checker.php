<?php
/**
 * The [clear_postcode_lookup] postcode checker: a box on any page. The finder answers in the visitor's browser as
 * they type (keyless, or with the publishable key), so the checker works behind page caches and CDNs and costs the
 * site's server nothing.
 *
 * @package ClearPostcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * [clear_postcode_lookup placeholder="Enter a UK postcode"]
 *
 * @param array|string $atts Shortcode attributes.
 */
function clear_postcode_shortcode( $atts ) {
	$a = shortcode_atts(
		array( 'placeholder' => __( 'Enter a UK postcode', 'clear-postcode' ) ),
		$atts,
		'clear_postcode_lookup'
	);
	clear_postcode_enqueue_finder( true );
	wp_enqueue_style( 'clear-postcode-checker', plugins_url( 'assets/checker.css', CLEAR_POSTCODE_FILE ), array( 'clear-postcode-finder' ), CLEAR_POSTCODE_VERSION );
	static $once = false;
	if ( ! $once ) {
		$once = true;
		// The checker answers as the visitor types: pressing Enter in it never reloads the page.
		wp_add_inline_script( 'clear-postcode-finder', 'document.addEventListener("submit",function(e){if(e.target.matches("form.clear-postcode"))e.preventDefault();});', 'before' );
	}
	$rows = array(
		'council'      => __( 'Council', 'clear-postcode' ),
		'ward'         => __( 'Ward', 'clear-postcode' ),
		'constituency' => __( 'Constituency', 'clear-postcode' ),
		'region'       => __( 'Region', 'clear-postcode' ),
		'country'      => __( 'Country', 'clear-postcode' ),
	);
	ob_start();
	?>
	<form class="clear-postcode" role="search" novalidate>
		<label class="clear-postcode__label">
			<span class="screen-reader-text"><?php echo esc_html( $a['placeholder'] ); ?></span>
			<input class="clear-postcode__input" type="text" name="postcode" maxlength="12" autocomplete="off" spellcheck="false" data-clearpostcode="postcode" placeholder="<?php echo esc_attr( $a['placeholder'] ); ?>">
		</label>
		<dl class="clear-postcode__rows">
			<?php foreach ( $rows as $field => $label ) : ?>
				<div class="clear-postcode__row"><dt><?php echo esc_html( $label ); ?></dt><dd data-clearpostcode="<?php echo esc_attr( $field ); ?>"></dd></div>
			<?php endforeach; ?>
		</dl>
	</form>
	<?php
	return ob_get_clean();
}
add_shortcode( 'clear_postcode_lookup', 'clear_postcode_shortcode' );
