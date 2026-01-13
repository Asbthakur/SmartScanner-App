/**
 * UI Manager - Handles all UI interactions
 * Modern, responsive, and user-friendly
 */

const UI = {
    // Screen management
    screens: {},
    currentScreen: null,
    
    /**
     * Initialize UI
     */
    init() {
        // Cache screen elements
        this.screens = {
            welcome: document.getElementById('screen-welcome'),
            camera: document.getElementById('screen-camera'),
            crop: document.getElementById('screen-crop'),
            filter: document.getElementById('screen-filter'),
            result: document.getElementById('screen-result')
        };
        
        console.log('✅ UI initialized');
    },
    
    /**
     * Show a specific screen
     */
    showScreen(name) {
        // Hide all screens
        Object.values(this.screens).forEach(screen => {
            if (screen) screen.classList.remove('active');
        });
        
        // Show target screen
        if (this.screens[name]) {
            this.screens[name].classList.add('active');
            this.currentScreen = name;
        }
        
        console.log(`📱 Screen: ${name}`);
    },
    
    /**
     * Set camera status message
     */
    setStatus(text, type = 'info') {
        const status = document.getElementById('status');
        if (!status) return;
        
        status.textContent = text;
        status.className = 'camera-status';
        
        if (type === 'locked' || type === 'success') {
            status.classList.add('locked');
        } else if (type === 'warning' || type === 'error') {
            status.classList.add('warning');
        }
    },
    
    /**
     * Set page count badge
     */
    setPageCount(count) {
        const badge = document.getElementById('page-count');
        const resultCount = document.getElementById('result-count');
        
        const text = count === 1 ? '1 page' : `${count} pages`;
        
        if (badge) badge.textContent = text;
        if (resultCount) resultCount.textContent = text;
        
        // Enable/disable PDF button
        const pdfBtn = document.getElementById('btn-create-pdf');
        if (pdfBtn) {
            pdfBtn.disabled = count === 0;
        }
    },
    
    /**
     * Update result pages grid
     */
    updateResultPages(pages) {
        const container = document.getElementById('result-pages');
        if (!container) return;
        
        // Clear container
        container.innerHTML = '';
        
        if (pages.length === 0) {
            // Show empty state
            container.innerHTML = `
                <div class="result-empty">
                    <div class="result-empty-icon">📄</div>
                    <div class="result-empty-text">No pages yet.<br>Add your first scan!</div>
                </div>
            `;
            return;
        }
        
        // Add page thumbnails
        pages.forEach((page, index) => {
            const item = document.createElement('div');
            item.className = 'result-page-item';
            item.innerHTML = `
                <img src="${page.dataUrl}" alt="Page ${index + 1}">
                <div class="result-page-number">${index + 1}</div>
                <button class="result-page-delete" data-index="${index}">✕</button>
            `;
            container.appendChild(item);
        });
        
        // Bind delete buttons
        container.querySelectorAll('.result-page-delete').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                if (typeof App !== 'undefined' && App.deletePage) {
                    App.deletePage(index);
                }
            };
        });
    },
    
    /**
     * Flash effect on capture
     */
    flash() {
        const flash = document.getElementById('flash');
        if (!flash) return;
        
        flash.classList.remove('active');
        void flash.offsetWidth; // Trigger reflow
        flash.classList.add('active');
        
        setTimeout(() => flash.classList.remove('active'), 200);
    },
    
    /**
     * Show loading overlay
     */
    showLoading(text = 'Processing...') {
        const overlay = document.getElementById('loading-overlay');
        const loadingText = document.getElementById('loading-text');
        
        if (loadingText) loadingText.textContent = text;
        if (overlay) overlay.classList.add('active');
    },
    
    /**
     * Hide loading overlay
     */
    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.remove('active');
    },
    
    /**
     * Show toast notification
     */
    showToast(message, type = 'info', duration = 3000) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        
        toast.textContent = message;
        toast.className = 'toast';
        if (type) toast.classList.add(type);
        
        // Show
        setTimeout(() => toast.classList.add('show'), 10);
        
        // Hide after duration
        setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    },
    
    /**
     * Show alert (fallback to toast)
     */
    alert(message) {
        this.showToast(message, 'error', 4000);
    },
    
    /**
     * Set active filter button
     */
    setActiveFilter(filterName) {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.filter === filterName) {
                btn.classList.add('active');
            }
        });
    },
    
    /**
     * Set adjustment slider value display
     */
    setAdjustmentValue(type, value) {
        const el = document.getElementById(`val-${type}`);
        if (el) {
            el.textContent = value > 0 ? `+${value}` : value;
        }
    },
    
    /**
     * Reset adjustment sliders
     */
    resetAdjustments() {
        const brightness = document.getElementById('adj-brightness');
        const contrast = document.getElementById('adj-contrast');
        
        if (brightness) brightness.value = 0;
        if (contrast) contrast.value = 0;
        
        this.setAdjustmentValue('brightness', 0);
        this.setAdjustmentValue('contrast', 0);
    },
    
    /**
     * Show share modal
     */
    showShareModal(pageCount) {
        const modal = document.getElementById('modal-share');
        const countEl = document.getElementById('modal-page-count');
        
        if (countEl) {
            countEl.textContent = pageCount === 1 ? '1 page' : `${pageCount} pages`;
        }
        
        if (modal) modal.classList.add('active');
    },
    
    /**
     * Hide share modal
     */
    hideShareModal() {
        const modal = document.getElementById('modal-share');
        if (modal) modal.classList.remove('active');
    },
    
    /**
     * Resize overlay canvas to match video
     */
    resizeOverlay(video, overlay) {
        if (!video || !overlay) return;
        
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
    }
};
