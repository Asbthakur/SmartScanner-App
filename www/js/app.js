/**
 * SmartScanner App Controller
 * Main application logic - orchestrates all modules
 */

const App = {
    // Video elements
    video: null,
    overlay: null,
    overlayCtx: null,
    stream: null,
    
    // State
    pages: [],
    detecting: false,
    currentCapture: null,

    /**
     * Initialize application
     */
    async init() {
        console.log(`SmartScanner v${CONFIG.VERSION} initializing...`);
        
        // Get DOM elements
        this.video = document.getElementById('video');
        this.overlay = document.getElementById('overlay');
        this.overlayCtx = this.overlay.getContext('2d');
        
        // Initialize UI
        UI.init();
        
        // Bind events
        this.bindEvents();
        
        // Initialize heatmap detector
        await HeatmapDetector.init();
        
        console.log('✅ App initialized');
    },

    /**
     * Bind all event handlers
     */
    bindEvents() {
        // Welcome screen
        document.getElementById('btn-start').onclick = () => this.startCamera();
        
        // Camera screen
        document.getElementById('btn-back').onclick = () => this.stopCamera();
        document.getElementById('btn-capture').onclick = () => this.handleCapture();
        document.getElementById('btn-gallery').onclick = () => this.openGallery();
        document.getElementById('gallery-input').onchange = (e) => this.handleGallerySelect(e);
        document.getElementById('btn-done').onclick = () => this.showResults();
        
        // Crop screen
        document.getElementById('btn-crop-back').onclick = () => this.cancelCrop();
        document.getElementById('btn-crop-cancel').onclick = () => this.cancelCrop();
        document.getElementById('btn-crop-done').onclick = () => this.applyCrop();
        
        // Filter screen
        document.getElementById('btn-filter-back').onclick = () => this.cancelFilter();
        document.getElementById('btn-filter-save').onclick = () => this.saveFilteredPage();
        document.getElementById('btn-filter-reset').onclick = () => this.resetFilter();
        
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.onclick = () => this.selectFilter(btn.dataset.filter);
        });
        
        document.getElementById('adj-brightness').oninput = (e) => {
            FilterManager.setBrightness(e.target.value);
            UI.setAdjustmentValue('brightness', e.target.value);
        };
        
        document.getElementById('adj-contrast').oninput = (e) => {
            FilterManager.setContrast(e.target.value);
            UI.setAdjustmentValue('contrast', e.target.value);
        };
        
        // Result screen
        document.getElementById('btn-result-back').onclick = () => UI.showScreen('camera');
        document.getElementById('btn-add-scan').onclick = () => UI.showScreen('camera');
        document.getElementById('btn-add-gallery').onclick = () => document.getElementById('add-image-input').click();
        document.getElementById('add-image-input').onchange = (e) => this.handleAddImages(e);
        document.getElementById('btn-create-pdf').onclick = () => this.createPDF();
        
        // Share modal
        document.getElementById('modal-backdrop').onclick = () => UI.hideShareModal();
        document.getElementById('btn-close-modal').onclick = () => UI.hideShareModal();
        document.getElementById('btn-download').onclick = () => this.downloadPDF();
        document.getElementById('btn-whatsapp').onclick = () => this.sharePDF();
        document.getElementById('btn-new-scan').onclick = () => this.startNewScan();
    },

    // ═══════════════════════════════════════════════════════════════
    // CAMERA
    // ═══════════════════════════════════════════════════════════════

    async startCamera() {
        UI.showScreen('camera');
        UI.setStatus('Requesting camera...');
        
        try {
            // IMPORTANT: Stop any existing stream first to prevent camera lock
            if (this.stream) {
                console.log('🔄 Stopping existing camera stream...');
                this.stream.getTracks().forEach(track => {
                    track.stop();
                    console.log(`  Stopped track: ${track.kind}`);
                });
                this.stream = null;
                this.video.srcObject = null;
                
                // Small delay to allow camera to fully release
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            // Request camera with fallback options
            let stream = null;
            
            // Try ideal settings first
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: CONFIG.CAMERA.FACING_MODE,
                        width: { ideal: CONFIG.CAMERA.WIDTH },
                        height: { ideal: CONFIG.CAMERA.HEIGHT }
                    },
                    audio: false
                });
            } catch (e) {
                console.warn('Ideal camera settings failed, trying basic...', e);
                // Fallback to basic camera request
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' },
                    audio: false
                });
            }
            
            this.stream = stream;
            this.video.srcObject = stream;
            
            // Wait for video to be ready with timeout
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.warn('Video loadeddata timeout, continuing anyway...');
                    resolve();
                }, 5000);
                
                this.video.onloadedmetadata = () => {
                    clearTimeout(timeout);
                    resolve();
                };
                
                this.video.onerror = (e) => {
                    clearTimeout(timeout);
                    reject(new Error('Video element error'));
                };
            });
            
            await this.video.play();
            
            // Set overlay dimensions
            this.overlay.width = this.video.videoWidth || CONFIG.CAMERA.WIDTH;
            this.overlay.height = this.video.videoHeight || CONFIG.CAMERA.HEIGHT;
            
            console.log(`📷 Camera ready: ${this.overlay.width}x${this.overlay.height}`);
            UI.setStatus('Point at document');
            
            // Reset detection state
            Stabilizer.reset();
            if (typeof RectangleMath !== 'undefined') {
                RectangleMath.reset();
            }
            
            this.startDetection();
            
        } catch (err) {
            console.error('Camera error:', err);
            
            // User-friendly error messages
            let message = 'Camera error';
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                message = 'Camera permission denied. Please allow camera access and refresh.';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                message = 'No camera found on this device.';
            } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                message = 'Camera is in use by another app. Close other apps and try again.';
            } else {
                message = 'Camera error: ' + err.message;
            }
            
            UI.setStatus(message, 'warning');
            UI.alert(message + '\n\nTry refreshing the page.');
        }
    },

    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        this.video.srcObject = null;
        
        // Reset all detection state
        Stabilizer.reset();
        if (typeof RectangleMath !== 'undefined') {
            RectangleMath.reset();
        }
        
        UI.showScreen('welcome');
    },

    startDetection() {
        const detect = async () => {
            if (!this.stream) return;
            
            if (!this.detecting) {
                this.detecting = true;
                await this.processFrame();
                this.detecting = false;
            }
            
            requestAnimationFrame(detect);
        };
        
        detect();
    },

    async processFrame() {
        if (!this.video || this.video.videoWidth === 0) return;
        
        const { imageData, width, height } = ImageProcessor.getScaledImageData(this.video);
        
        // Step 1: Detect document (OpenCV + Heatmap) - probability detection
        let corners = await this.detectDocument(imageData, width, height);
        
        // Step 2: Scale corners to full video resolution
        if (corners) {
            corners = Geometry.scaleCorners(
                corners,
                width, height,
                this.video.videoWidth, this.video.videoHeight
            );
            corners = Geometry.fixWeakCorner(corners);
        }
        
        // Step 3: Apply RectangleMath stabilization layer
        // This is THE SINGLE SOURCE OF TRUTH for final corners
        // It handles: validation, ordering, smoothing, locking
        let finalCorners = null;
        let isLocked = false;
        let status = 'searching';
        
        if (typeof RectangleMath !== 'undefined') {
            finalCorners = RectangleMath.process(
                corners, 
                this.video.videoWidth, 
                this.video.videoHeight,
                'preview'
            );
            
            // Get lock status from RectangleMath
            const rmStatus = RectangleMath.getStatus();
            isLocked = rmStatus.isLocked;
            
            if (finalCorners) {
                status = isLocked ? 'locked' : 'detecting';
            } else {
                status = 'searching';
            }
        } else {
            // Fallback to old Stabilizer if RectangleMath not available
            const state = Stabilizer.update(corners);
            finalCorners = state.corners;
            isLocked = state.locked;
            status = state.status;
        }
        
        // Step 4: Draw overlay with FINAL corners only
        // Both lines AND dots come from the same source
        this.drawOverlay({
            corners: finalCorners,
            locked: isLocked,
            status: status,
            stableCount: RectangleMath ? RectangleMath.state.stableFrameCount : 0
        });
    },

    async detectDocument(imageData, w, h) {
        let opencvResult = OpenCVDetector.detect(imageData, w, h);
        
        let heatmapResult = null;
        if (HeatmapDetector.isReady()) {
            heatmapResult = await HeatmapDetector.detect(imageData, w, h);
            if (heatmapResult) {
                heatmapResult = Geometry.validate(heatmapResult, w, h);
            }
        }
        
        return this.arbitrateDetection(opencvResult, heatmapResult);
    },

    arbitrateDetection(opencvResult, heatmapResult) {
        const heatmapTrusted = heatmapResult && 
            heatmapResult._confidence >= CONFIG.HEATMAP.CONFIDENCE_TRUSTED;
        
        let inAgreement = false;
        if (heatmapTrusted && opencvResult) {
            const distance = Geometry.cornerDistance(heatmapResult, opencvResult);
            inAgreement = distance < CONFIG.CORNER.AGREEMENT_DISTANCE;
        }
        
        if (opencvResult && heatmapTrusted && inAgreement) {
            return opencvResult;
        } else if (opencvResult) {
            return opencvResult;
        } else if (heatmapTrusted && heatmapResult._confidence >= CONFIG.HEATMAP.CONFIDENCE_RESCUE) {
            return heatmapResult;
        }
        
        return null;
    },

    drawOverlay(state) {
        const ctx = this.overlayCtx;
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        
        if (state.status === 'locked') {
            UI.setStatus('✓ LOCKED - Hold steady', 'locked');
        } else if (state.status === 'no_document') {
            UI.setStatus('No document - tap 📷 for manual', 'warning');
        } else if (state.status === 'detecting') {
            UI.setStatus(`Stabilizing... ${state.stableCount || 0}/${CONFIG.STABILITY.LOCK_THRESHOLD}`);
        } else {
            UI.setStatus('Searching for document...');
        }
        
        if (state.corners) {
            const c = state.corners;
            
            ctx.beginPath();
            ctx.moveTo(c.tl.x, c.tl.y);
            ctx.lineTo(c.tr.x, c.tr.y);
            ctx.lineTo(c.br.x, c.br.y);
            ctx.lineTo(c.bl.x, c.bl.y);
            ctx.closePath();
            
            ctx.fillStyle = state.locked ? CONFIG.COLORS.OVERLAY_LOCKED : CONFIG.COLORS.OVERLAY_DETECTING;
            ctx.fill();
            
            ctx.strokeStyle = state.locked ? CONFIG.COLORS.SUCCESS : CONFIG.COLORS.PRIMARY;
            ctx.lineWidth = 3;
            ctx.stroke();
            
            for (const key of ['tl', 'tr', 'br', 'bl']) {
                ctx.beginPath();
                ctx.arc(c[key].x, c[key].y, 10, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();
                ctx.strokeStyle = state.locked ? CONFIG.COLORS.SUCCESS : CONFIG.COLORS.PRIMARY;
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // CAPTURE
    // ═══════════════════════════════════════════════════════════════

    handleCapture() {
        // Use RectangleMath as the source of truth (same as preview)
        if (typeof RectangleMath !== 'undefined') {
            const corners = RectangleMath.getCurrentCorners();
            
            if (corners) {
                // Use corners from RectangleMath
                console.log('📸 Capturing with RectangleMath corners', corners);
                this.captureWithCorners(corners);
            } else {
                // No corners detected - manual crop
                console.log('📸 No corners - manual crop');
                this.captureForManualCrop();
            }
        } else {
            // Fallback to old Stabilizer method
            if (Stabilizer.isLocked()) {
                this.captureWithCorners(Stabilizer.getLockedCorners());
            } else if (Stabilizer.shouldShowNoDocWarning()) {
                this.captureForManualCrop();
            } else if (Stabilizer.getLastCorners()) {
                this.captureWithCorners(Stabilizer.getLastCorners());
            } else {
                this.captureForManualCrop();
            }
        }
    },

    captureWithCorners(corners) {
        const frame = ImageProcessor.captureFrame(this.video);
        
        let processed;
        try {
            // Step 1: Perspective correction
            processed = ImageProcessor.perspectiveCorrect(frame, corners);
            
            // Step 2: Clean edges (crop + white border)
            if (typeof ImageProcessor.cleanEdges === 'function') {
                processed = ImageProcessor.cleanEdges(processed);
                console.log('✂️ Edge cleanup applied');
            }
        } catch (err) {
            console.error('Perspective correction failed:', err);
            processed = frame;
        }
        
        UI.flash();
        
        // Reset detection state for next scan
        Stabilizer.unlock();
        if (typeof RectangleMath !== 'undefined') {
            RectangleMath.unlock();
        }
        
        this.currentCapture = processed;
        this.showFilterScreen();
    },

    captureForManualCrop() {
        const frame = ImageProcessor.captureFrame(this.video);
        UI.flash();
        this.showCropScreen(frame);
    },

    // ═══════════════════════════════════════════════════════════════
    // CROP
    // ═══════════════════════════════════════════════════════════════

    showCropScreen(image) {
        UI.showScreen('crop');
        
        setTimeout(() => {
            CropManager.init(
                image,
                (result) => {
                    this.currentCapture = result;
                    this.showFilterScreen();
                },
                () => {
                    UI.showScreen('camera');
                }
            );
        }, 100);
    },

    cancelCrop() {
        CropManager.cancel();
        UI.showScreen('camera');
    },

    applyCrop() {
        CropManager.complete();
    },

    // ═══════════════════════════════════════════════════════════════
    // GALLERY
    // ═══════════════════════════════════════════════════════════════

    openGallery() {
        document.getElementById('gallery-input').click();
    },

    async handleGallerySelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        UI.showLoading('Loading image...');
        
        try {
            const canvas = await ImageProcessor.loadImage(file);
            UI.hideLoading();
            this.showCropScreen(canvas);
        } catch (err) {
            UI.hideLoading();
            UI.alert('Failed to load image: ' + err.message);
        }
        
        e.target.value = '';
    },

    // ═══════════════════════════════════════════════════════════════
    // FILTER
    // ═══════════════════════════════════════════════════════════════

    showFilterScreen() {
        UI.showScreen('filter');
        UI.setActiveFilter('auto');
        UI.resetAdjustments();
        
        FilterManager.init(this.currentCapture);
        FilterManager.runScanAnimation();
    },

    selectFilter(filter) {
        FilterManager.setFilter(filter);
        UI.setActiveFilter(filter);
    },

    resetFilter() {
        FilterManager.reset();
        UI.resetAdjustments();
    },

    cancelFilter() {
        FilterManager.cleanup();
        this.currentCapture = null;
        UI.showScreen('camera');
    },

    saveFilteredPage() {
        const dims = FilterManager.getDimensions();
        
        this.pages.push({
            dataUrl: FilterManager.getDataURL(),
            width: dims.width,
            height: dims.height
        });
        
        UI.setPageCount(this.pages.length);
        FilterManager.cleanup();
        this.currentCapture = null;
        UI.showScreen('camera');
    },

    // ═══════════════════════════════════════════════════════════════
    // RESULTS
    // ═══════════════════════════════════════════════════════════════

    showResults() {
        if (this.pages.length === 0) {
            UI.alert('No pages scanned yet!');
            return;
        }
        
        UI.showScreen('result');
        UI.renderPages(this.pages, (index) => this.deletePage(index));
    },

    deletePage(index) {
        this.pages.splice(index, 1);
        UI.setPageCount(this.pages.length);
        
        if (this.pages.length === 0) {
            UI.showScreen('camera');
        } else {
            UI.renderPages(this.pages, (i) => this.deletePage(i));
        }
    },

    async handleAddImages(e) {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        
        UI.showLoading('Adding images...');
        
        for (const file of files) {
            try {
                const canvas = await ImageProcessor.loadImage(file);
                this.pages.push({
                    dataUrl: canvas.toDataURL('image/jpeg', CONFIG.OUTPUT.JPEG_QUALITY),
                    width: canvas.width,
                    height: canvas.height
                });
            } catch (err) {
                console.error('Failed to load image:', err);
            }
        }
        
        UI.hideLoading();
        UI.setPageCount(this.pages.length);
        UI.renderPages(this.pages, (i) => this.deletePage(i));
        
        e.target.value = '';
    },

    // ═══════════════════════════════════════════════════════════════
    // PDF
    // ═══════════════════════════════════════════════════════════════

    async createPDF() {
        if (this.pages.length === 0) {
            UI.alert('No pages to create PDF!');
            return;
        }
        
        UI.showLoading('Creating PDF...');
        
        try {
            await PDFGenerator.create(this.pages);
            UI.hideLoading();
            UI.showShareModal(this.pages.length);
        } catch (err) {
            UI.hideLoading();
            console.error('PDF creation error:', err);
            UI.alert('Error creating PDF: ' + err.message);
        }
    },

    downloadPDF() {
        PDFGenerator.download('scanned_document.pdf');
    },

    async sharePDF() {
        const shared = await PDFGenerator.share('scanned_document.pdf');
        if (!shared) {
            UI.alert('PDF downloaded! Share via WhatsApp manually.');
        }
    },

    startNewScan() {
        this.pages = [];
        PDFGenerator.clear();
        UI.setPageCount(0);
        UI.hideShareModal();
        UI.showScreen('welcome');
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
