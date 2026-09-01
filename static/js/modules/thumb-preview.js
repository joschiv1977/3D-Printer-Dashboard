/**
 * Thumbnail-Vorschau: Maus ueber ein Thumbnail -> grosse Ansicht daneben.
 *
 * Arbeitet mit Ereignis-Delegation am document, damit auch Thumbnails
 * abgedeckt sind, die erst spaeter nachgeladen werden (Verlaufsliste,
 * SD-Karte, Plattenauswahl). Kein Aufruf pro Anzeigestelle noetig.
 */
(function () {
    'use strict';

    // Alle Thumbnail-Bilder der Oberflaeche.
    // Die Live-Kachel auf dem Dashboard bleibt bewusst aussen vor: dort wird
    // das Bild ohnehin schon gross angezeigt, die Vorschau waere kaum
    // groesser als das Original.
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

    // Geraete ohne echten Zeiger (Touch) haben kein Hover — dort wuerde die
    // Vorschau beim Tippen aufblitzen und stehen bleiben.
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

        // Bevorzugt rechts neben das Thumbnail, sonst links, sonst angelegt.
        let left = r.right + GAP;
        if (left + w > window.innerWidth - MARGIN) left = r.left - GAP - w;
        if (left < MARGIN) left = Math.min(
            Math.max(MARGIN, r.left), window.innerWidth - w - MARGIN);

        // Mittig zur Bildhoehe, aber vollstaendig im Fenster.
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

        // Erst positionieren, wenn die Groesse feststeht — sonst springt die
        // Vorschau beim ersten Anzeigen.
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

    // Beim Scrollen oder Groessenaendern wandert das Thumbnail weg.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
})();
