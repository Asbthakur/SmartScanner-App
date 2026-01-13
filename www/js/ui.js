/**
 * UI Module
 * Handles screen transitions and UI updates
 */

const UI = {
    
    currentScreen: 'welcome',
    
    /**
     * Initialize UI
     */
    init() {
        console.log('📱 UI initialized');
        // Show welcome screen by default
        this.showScreen('welcome');
    },
    
    /**
     * Show a screen
     */
    showScreen(name) {
        console.log(`📱 Screen: ${name}`);
        
        // Hide all screens
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        
        // Show target screen
        const screen = document.getElementById(`screen-${name}`);
        if (screen) {
            screen.classList.add('active');
            this.currentScreen = name;
        }
    },
    
    /**
     * Set status text
     */
    setStatus(text, type = 'info') {
        const el = document.getElementById('status-text');
        if (el) {
            el.textContent = text;
            el.className = `status-text status-${type}`;
        }
    },
    
    /**
     * Flash effect for capture
     */
    flash() {
        const el = document.getElementById('flash');
        if (el) {
            el.classList.add('active');
            setTimeout(() => el.classList.remove('active'), 150);
        }
    },
    
    /**
     * Show loading overlay
     */
    showLoading(text = 'Processing...') {
        const overlay = document.getElementById('loading-overlay');
        const textEl = document.getElementById('loading-text');
        
        if (overlay) overlay.classList.add('active');
        if (textEl) textEl.textContent = text;
    },
    
    /**
     * Hide loading overlay
     */
    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.remove('active');
    },
    
    /**
     * Set page count display
     */
    setPageCount(count) {
        const el = document.getElementById('page-count');
        if (el) {
            el.textContent = count > 0 ? count : '';
            el.style.display = count > 0 ? 'flex' : 'none';
        }
        
        const resultCount = document.getElementById('result-count');
        if (resultCount) {
            resultCount.textContent = `${count} page${count !== 1 ? 's' : ''}`;
        }
    },
    
    /**
     * Show toast message
     */
    toast(message, duration = 2000) {
        const el = document.getElementById('toast');
        if (el) {
            el.textContent = message;
            el.classList.add('active');
            setTimeout(() => el.classList.remove('active'), duration);
        }
    },
    
    /**
     * Show alert
     */
    alert(message) {
        alert(message);
    },
    
    /**
     * Render pages in result screen
     */
    renderPages(pages, onDelete) {
        const container = document.getElementById('result-pages');
        if (!container) return;
        
        if (pages.length === 0) {
            container.innerHTML = `
                <div class="result-empty">
                    <div class="result-empty-icon">📄</div>
                    <div class="result-empty-text">No pages yet.<br>Add your first scan!</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = pages.map((page, i) => `
            <div class="result-page" data-index="${i}">
                <img src="${page.dataUrl}" alt="Page ${i + 1}">
                <button class="delete-page-btn" onclick="App.deletePage(${i})">×</button>
                <span class="page-number">${i + 1}</span>
            </div>
        `).join('');
    },
    
    /**
     * Set active filter button
     */
    setActiveFilter(filterName) {
        // Remove active from all filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Add active to selected filter
        const activeBtn = document.querySelector(`.filter-btn[data-filter="${filterName}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    },
    
    /**
     * Reset adjustments sliders
     */
    resetAdjustments() {
        const brightness = document.getElementById('brightness-slider');
        const contrast = document.getElementById('contrast-slider');
        
        if (brightness) brightness.value = 0;
        if (contrast) contrast.value = 0;
    }
};
