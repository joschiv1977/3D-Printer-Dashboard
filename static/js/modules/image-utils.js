// A stopgap for skIcon (icons.js): pages that load only some of the modules --
// and a bundle that has not been rebuilt after a new module file -- should get
// no symbol, but should not crash either.
window.skIcon = window.skIcon || function () { return ''; };

/**
 * Determine the image type from base64 data.
 *
 * Thumbnails come from two sources: cut-out slicer previews (PNG, with
 * transparency) and camera snapshots (JPEG). The type used to be hard-wired at
 * every place that shows one -- and was therefore wrong at one of them.
 */
(function (global) {
    'use strict';

    // The signatures at the start of the base64 string: PNG begins with
    // \x89PNG, JPEG with \xFF\xD8\xFF, GIF with "GIF8".
    const SIGNATURES = [
        ['iVBORw0KGgo', 'image/png'],
        ['/9j/', 'image/jpeg'],
        ['R0lGOD', 'image/gif'],
    ];

    function imageMimeFromBase64(b64) {
        if (!b64) return 'image/png';
        for (const [prefix, mime] of SIGNATURES) {
            if (b64.startsWith(prefix)) return mime;
        }
        return 'image/png';
    }

    function imageDataUrl(b64) {
        return b64 ? `data:${imageMimeFromBase64(b64)};base64,${b64}` : '';
    }

    global.imageMimeFromBase64 = imageMimeFromBase64;
    global.imageDataUrl = imageDataUrl;
})(window);
