/**
 * The thumbnail preview: mouse over a thumbnail -> a large view beside it.
 *
 * It works through event delegation on the document, so thumbnails that are
 * only loaded later are covered too (the history list, the SD card, the plate
 * picker). No call is needed per place that shows one.
 */
(function () {
    'use strict';

    // Every thumbnail image in the interface.
    // The live tile on the dashboard is deliberately left out: the image is
    // already shown large there, and the preview would be barely bigger than
    // the original.
    const SELECTOR = [
        '.hist-thumb',                // Verlaufsliste
        '.hist-detail-thumb',         // Verlaufs-Detail
        '.sd-thumb',                  // SD-Karte
        '.plate-thumb',               // Plattenauswahl (Drucken/Planen)
    ].join(',');

    const MAX_SIDE = 420;   // Kantenlaenge der Vorschau
    const GAP = 14;         // Abstand zum Thumbnail
    const MARGIN = 12;      // Mindestabstand zum Fensterrand

    let box = null;
    let boxImg = null;
    let activeSource = null;

    // Devices without a real pointer (touch) have no hover -- there the preview
    // would flash up on a tap and stay.
    function hasHover() {
        return window.matchMedia && window.matchMedia('(hover: hover)').matches;
    }

    function ensureBox() {
        if (box) return;
        box = document.createElement('div');
        box.className = 'thumb-preview';
        boxImg = document.createElement('img');
        box.appendChild(boxImg);
        document.body.appendChild(box);
    }

    function position(source) {
        const r = source.getBoundingClientRect();
        const w = box.offsetWidth;
        const h = box.offsetHeight;

        // Preferably to the right of the thumbnail, otherwise to the left,
        // otherwise flush against it.
        let left = r.right + GAP;
        if (left + w > window.innerWidth - MARGIN) left = r.left - GAP - w;
        if (left < MARGIN) left = Math.min(
            Math.max(MARGIN, r.left), window.innerWidth - w - MARGIN);

        // Centred on the image height, but fully inside the window.
        let top = r.top + r.height / 2 - h / 2;
        top = Math.min(Math.max(MARGIN, top), window.innerHeight - h - MARGIN);

        box.style.left = Math.round(left) + 'px';
        box.style.top = Math.round(top) + 'px';
    }

    function show(source) {
        const src = source.currentSrc || source.src;
        if (!src) return;

        ensureBox();
        activeSource = source;
        source.classList.add('thumb-preview-source');

        boxImg.src = src;
        box.style.maxWidth = MAX_SIDE + 'px';
        box.style.maxHeight = MAX_SIDE + 'px';
        boxImg.style.maxWidth = (MAX_SIDE - 16) + 'px';
        boxImg.style.maxHeight = (MAX_SIDE - 16) + 'px';

        // Position it only once the size is known -- otherwise the preview
        // jumps the first time it is shown.
        const place = () => {
            if (activeSource !== source) return;
            position(source);
            box.classList.add('is-visible');
        };
        if (boxImg.complete) place();
        else boxImg.onload = place;
    }

    function hide() {
        if (!box) return;
        box.classList.remove('is-visible');
        activeSource = null;
    }

    if (!hasHover()) return;

    document.addEventListener('mouseover', (e) => {
        const target = e.target instanceof Element ? e.target.closest(SELECTOR) : null;
        if (!target || target === activeSource) return;
        // Ein leeres oder ausgeblendetes Bild hat nichts zu zeigen.
        if (target.tagName !== 'IMG' || !target.offsetParent) return;
        show(target);
    });

    document.addEventListener('mouseout', (e) => {
        if (!activeSource) return;
        const target = e.target instanceof Element ? e.target.closest(SELECTOR) : null;
        if (target !== activeSource) return;
        // Wechsel innerhalb desselben Bildes ignorieren.
        if (e.relatedTarget instanceof Element &&
            e.relatedTarget.closest(SELECTOR) === activeSource) return;
        hide();
    });

    // On scrolling or resizing the thumbnail moves away.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
})();
