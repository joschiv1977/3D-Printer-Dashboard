/**
 * Zoom Controls Manager
 * Fullscreen and desktop camera zoom with mouse position tracking
 */
class ZoomControlsManager {
    constructor() {
        this.fullscreenScale = 1;
        this.desktopScale = 1;
        this.transformOriginX = 50;
        this.transformOriginY = 50;

        // Listen for fullscreen changes
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                const container = document.getElementById('fullscreen-container');
                if (container) {
                    container.remove();
                }
                this.fullscreenScale = 1;
            }
        });
    }

    // --- PRESERVE the camera rotation and flip while zooming ---
    // The zoom used to set transform='scale(X)' and overwrote the base transform
    // (rotate(180deg), say) -> the image ended up upside down, on a reset too.
    // Now the base and the scale are combined, and the origin is mirrored along
    // at 180° or on a flip, so zoom-to-cursor is right.
    _baseTransform(img) { return (img && img.dataset.baseTransform) || ''; }
    _mapOrigin(base, x, y) {
        let ox = x, oy = y;
        if (/rotate\(180deg\)/.test(base)) { ox = 100 - ox; oy = 100 - oy; }
        if (/scaleX\(-1\)/.test(base)) { ox = 100 - ox; }
        if (/scaleY\(-1\)/.test(base)) { oy = 100 - oy; }
        return ox + '% ' + oy + '%';
    }
    _applyZoom(img, scale, x, y) {
        const base = this._baseTransform(img);
        img.style.transformOrigin = this._mapOrigin(base, x, y);
        img.style.transform = (base ? base + ' ' : '') + 'scale(' + scale + ')';
    }
    _resetZoom(img) {
        img.style.transformOrigin = 'center';
        img.style.transform = this._baseTransform(img);
    }

    // === Fullscreen Zoom ===

    fullscreenZoomAtPosition(deltaScale, mouseX, mouseY) {
        const img = document.getElementById('fullscreen-camera-stream');
        if (!img) return;

        const rect = img.getBoundingClientRect();

        // The mouse position relative to the image (as a percentage)
        const x = ((mouseX - rect.left) / rect.width) * 100;
        const y = ((mouseY - rect.top) / rect.height) * 100;

        // The new scale value
        const newScale = Math.min(Math.max(1, this.fullscreenScale + deltaScale), 5);

        if (newScale !== this.fullscreenScale) {
            this.fullscreenScale = newScale;
            this._applyZoom(img, this.fullscreenScale, x, y);
        }
    }

    fullscreenZoomIn(e) {
        if (!e || !e.clientX) {
            const img = document.getElementById('fullscreen-camera-stream');
            const rect = img.getBoundingClientRect();
            this.fullscreenZoomAtPosition(0.1, rect.left + rect.width/2, rect.top + rect.height/2);
        } else {
            this.fullscreenZoomAtPosition(0.1, e.clientX, e.clientY);
        }
    }

    fullscreenZoomOut(e) {
        if (!e || !e.clientX) {
            const img = document.getElementById('fullscreen-camera-stream');
            const rect = img.getBoundingClientRect();
            this.fullscreenZoomAtPosition(-0.1, rect.left + rect.width/2, rect.top + rect.height/2);
        } else {
            this.fullscreenZoomAtPosition(-0.1, e.clientX, e.clientY);
        }
    }

    fullscreenZoomReset() {
        const img = document.getElementById('fullscreen-camera-stream');
        if (img) {
            this.fullscreenScale = 1;
            this._resetZoom(img);
        }
    }

    exitFullscreen() {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }

        // Remove the container
        const container = document.getElementById('fullscreen-container');
        if (container) {
            container.remove();
        }

        // Reset the zoom
        this.fullscreenScale = 1;
    }

    // === Desktop Zoom ===

    desktopZoomAtPosition(deltaScale, mouseX, mouseY) {
        const img = document.getElementById('camera-stream');
        if (!img) return;

        const rect = img.getBoundingClientRect();

        // The mouse position relative to the image (as a percentage)
        const x = ((mouseX - rect.left) / rect.width) * 100;
        const y = ((mouseY - rect.top) / rect.height) * 100;

        // The new scale value
        const newScale = Math.min(Math.max(1, this.desktopScale + deltaScale), 5);

        if (newScale !== this.desktopScale) {
            // Set the transform origin to the mouse position
            this.transformOriginX = x;
            this.transformOriginY = y;
            this.desktopScale = newScale;
            this._applyZoom(img, this.desktopScale, x, y);
        }
    }

    desktopZoomIn(e) {
        // With an event (from a button), use the centre of the image
        if (!e || !e.clientX) {
            const img = document.getElementById('camera-stream');
            const rect = img.getBoundingClientRect();
            this.desktopZoomAtPosition(0.1, rect.left + rect.width/2, rect.top + rect.height/2);
        } else {
            this.desktopZoomAtPosition(0.1, e.clientX, e.clientY);
        }
    }

    desktopZoomOut(e) {
        if (!e || !e.clientX) {
            const img = document.getElementById('camera-stream');
            const rect = img.getBoundingClientRect();
            this.desktopZoomAtPosition(-0.1, rect.left + rect.width/2, rect.top + rect.height/2);
        } else {
            this.desktopZoomAtPosition(-0.1, e.clientX, e.clientY);
        }
    }

    desktopZoomReset() {
        const img = document.getElementById('camera-stream');
        if (img) {
            this.desktopScale = 1;
            this._resetZoom(img);
        }
    }
}

// Global singleton
window.zoomControls = new ZoomControlsManager();

// Backwards compatibility - global functions for onclick handlers
window.fullscreenZoomAtPosition = (d, x, y) => window.zoomControls.fullscreenZoomAtPosition(d, x, y);
window.fullscreenZoomIn = (e) => window.zoomControls.fullscreenZoomIn(e);
window.fullscreenZoomOut = (e) => window.zoomControls.fullscreenZoomOut(e);
window.fullscreenZoomReset = () => window.zoomControls.fullscreenZoomReset();
window.exitFullscreen = () => window.zoomControls.exitFullscreen();
window.desktopZoomAtPosition = (d, x, y) => window.zoomControls.desktopZoomAtPosition(d, x, y);
window.desktopZoomIn = (e) => window.zoomControls.desktopZoomIn(e);
window.desktopZoomOut = (e) => window.zoomControls.desktopZoomOut(e);
window.desktopZoomReset = () => window.zoomControls.desktopZoomReset();
