( function () {
	'use strict';
	var cfg = window.clearPostcodeChecker;
	if ( ! cfg ) {
		return;
	}
	function show( box, build ) {
		while ( box.firstChild ) {
			box.removeChild( box.firstChild );
		}
		build( box );
	}
	function text( box, value ) {
		box.appendChild( document.createTextNode( value ) );
	}
	document.querySelectorAll( 'form.clear-postcode' ).forEach( function ( form ) {
		var result = form.querySelector( '.clear-postcode__result' );
		var button = form.querySelector( '.clear-postcode__button' );
		form.addEventListener( 'submit', function ( event ) {
			event.preventDefault();
			var body = new FormData();
			body.append( 'action', 'clear_postcode_check' );
			body.append( 'nonce', cfg.nonce );
			body.append( 'postcode', form.elements.postcode.value );
			button.disabled = true;
			fetch( cfg.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: body } )
				.then( function ( r ) {
					return r.json();
				} )
				.then( function ( json ) {
					show( result, function ( box ) {
						if ( ! json.success ) {
							text( box, ( json.data && json.data.message ) || cfg.error );
							return;
						}
						var d = json.data;
						var strong = document.createElement( 'strong' );
						strong.textContent = d.postcode;
						box.appendChild( strong );
						if ( d.status === 'terminated' ) {
							text( box, ' ' + ( d.replaced_by ? cfg.terminated.replace( '%s', d.replaced_by ) : cfg.retired ) );
						}
						var list = document.createElement( 'dl' );
						d.rows.forEach( function ( row ) {
							var dt = document.createElement( 'dt' );
							var dd = document.createElement( 'dd' );
							dt.textContent = row.label;
							dd.textContent = row.value;
							list.appendChild( dt );
							list.appendChild( dd );
						} );
						box.appendChild( list );
					} );
				} )
				.catch( function () {
					show( result, function ( box ) {
						text( box, cfg.error );
					} );
				} )
				.then( function () {
					button.disabled = false;
				} );
		} );
	} );
}() );
