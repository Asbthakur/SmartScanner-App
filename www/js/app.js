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
        
        // Show loading overlay
        const loadingOverlay = document.getElementById('camera-loading');
        if (loadingOverlay) loadingOverlay.classList.remove('hidden');
        
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
            
            console.log('📷 Requesting camera access...');
            
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
                console.log('📷 Got camera stream with ideal settings');
            } catch (e) {
                console.warn('Ideal camera settings failed, trying basic...', e);
                // Fallback to basic camera request
                stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false
                });
                console.log('📷 Got camera stream with basic settings');
            }
            
            this.stream = stream;
            this.video.srcObject = stream;
            
            console.log('📷 Waiting for video metadata...');
            
            // Wait for video to be ready with timeout
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.warn('Video loadeddata timeout, continuing anyway...');
                    resolve();
                }, 5000);
                
                this.video.onloadedmetadata = () => {
                    console.log('📷 Video metadata loaded');
                    clearTimeout(timeout);
                    resolve();
                };
                
                this.video.onerror = (e) => {
                    clearTimeout(timeout);
                    reject(new Error('Video element error'));
                };
            });
            
            await this.video.play();
            console.log('📷 Video playing');
            
            // Set overlay dimensions
            this.overlay.width = this.video.videoWidth || CONFIG.CAMERA.WIDTH;
            this.overlay.height = this.video.videoHeight || CONFIG.CAMERA.HEIGHT;
            
            console.log(`📷 Camera ready: ${this.overlay.width}x${this.overlay.height}`);
            UI.setStatus('Point at document');
            
            // Hide loading overlay
            if (loadingOverlay) loadingOverlay.classList.add('hidden');
            
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
            stableCount: (typeof RectangleMath !== 'undefined' && RectangleMath.state) ? RectangleMath.state.stableFrameCount : 0
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
        
        // NEW: Pass imageData for edge validation
        return this.arbitrateDetection(opencvResult, heatmapResult, imageData, w, h);
    },

    // NEW: Use OpenCVDetector.edgeDensity for validation (moved from inline)
    arbitrateDetection(opencvResult, heatmapResult, imageData, w, h) {
        // Check heatmap confidence levels
        const heatmapTrusted = heatmapResult && 
            heatmapResult._confidence >= CONFIG.HEATMAP.CONFIDENCE_TRUSTED;
        const heatmapHighConfidence = heatmapResult && 
            heatmapResult._confidence >= 0.5;
        
        // NEW: Edge density threshold from config
        const minEdgeDensity = CONFIG.DETECTION?.MIN_EDGE_DENSITY ?? 0.15;
        
        let inAgreement = false;
        if (heatmapTrusted && opencvResult) {
            const distance = Geometry.cornerDistance(heatmapResult, opencvResult);
            inAgreement = distance < CONFIG.CORNER.AGREEMENT_DISTANCE;
        }
        
        // NEW: Check edge density using OpenCVDetector
        let edgeDensity = 1.0;
        let edgeCheckPassed = true;
        
        if (heatmapHighConfidence && !inAgreement) {
            // Only check edges when heatmap is confident but OpenCV disagrees/missing
            edgeDensity = OpenCVDetector.edgeDensity(heatmapResult, imageData, w, h);
            edgeCheckPassed = edgeDensity >= minEdgeDensity;
        }
        
        // PRIORITY A: High-confidence heatmap + edge check passes
        if (heatmapHighConfidence && edgeCheckPassed) {
            console.log(`🔥 Heatmap accepted (conf: ${heatmapResult._confidence.toFixed(2)}, edges: ${edgeDensity.toFixed(2)})`);
            return heatmapResult;
        }
        
        // NEW: Reject high-confidence heatmap if edges are weak
        if (heatmapHighConfidence && !edgeCheckPassed) {
            console.log(`⚠️ Heatmap rejected (low edge density: ${edgeDensity.toFixed(2)})`);
            // Fall through to other options
        }
        
        // PRIORITY B: Both agree - use heatmap (more accurate corners)
        if (opencvResult && heatmapTrusted && inAgreement) {
            console.log(`✅ OpenCV + Heatmap agree, using heatmap`);
            return heatmapResult;
        }
        
        // PRIORITY C: Trusted heatmap alone - verify edges
        if (heatmapTrusted && !inAgreement) {
            const density = OpenCVDetector.edgeDensity(heatmapResult, imageData, w, h);
            if (density >= minEdgeDensity) {
                console.log(`🔶 Heatmap alone accepted (conf: ${heatmapResult._confidence.toFixed(2)}, edges: ${density.toFixed(2)})`);
                return heatmapResult;
            } else {
                console.log(`⚠️ Heatmap alone rejected (edges: ${density.toFixed(2)})`);
            }
        }
        
        // PRIORITY D: Fall back to OpenCV
        if (opencvResult) {
            console.log(`📐 Falling back to OpenCV`);
            return opencvResult;
        }
        
        // PRIORITY E: Nothing valid
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

    async handleCapture() {
        // Use RectangleMath as the source of truth (same as preview)
        if (typeof RectangleMath !== 'undefined') {
            const corners = RectangleMath.getCurrentCorners();
            
            if (corners) {
                // Use corners from RectangleMath
                console.log('📸 Capturing with RectangleMath corners', corners);
                await this.captureWithCorners(corners);
            } else {
                // No corners detected - manual crop
                console.log('📸 No corners - manual crop');
                await this.captureForManualCrop();
            }
        } else {
            // Fallback to old Stabilizer method
            if (Stabilizer.isLocked()) {
                await this.captureWithCorners(Stabilizer.getLockedCorners());
            } else if (Stabilizer.shouldShowNoDocWarning()) {
                await this.captureForManualCrop();
            } else if (Stabilizer.getLastCorners()) {
                await this.captureWithCorners(Stabilizer.getLastCorners());
            } else {
                await this.captureForManualCrop();
            }
        }
    },

    /**
     * Try to capture high-resolution image using Capacitor Camera
     * Falls back to browser video frame if not available
     */
    async captureHighResFrame() {
        // Check if Capacitor Camera is available
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera) {
            try {
                console.log('📷 Attempting high-res capture via Capacitor...');
                const { Camera, CameraResultType, CameraSource } = window.Capacitor.Plugins;
                
                const photo = await Camera.getPhoto({
                    quality: 100,
                    allowEditing: false,
                    resultType: CameraResultType.DataUrl,
                    source: CameraSource.Camera,
                    saveToGallery: false,
                    correctOrientation: true,
                    width: 4096,
                    height: 4096
                });
                
                // Convert data URL to canvas
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = photo.dataUrl;
                });
                
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.getContext('2d').drawImage(img, 0, 0);
                
                console.log(`📷 High-res capture: ${canvas.width}x${canvas.height}`);
                return { canvas, isHighRes: true };
                
            } catch (err) {
                console.warn('Capacitor Camera failed, using video frame:', err);
            }
        }
        
        // Fallback: Use browser video frame
        const canvas = ImageProcessor.captureFrame(this.video);
        console.log(`📷 Browser capture: ${canvas.width}x${canvas.height}`);
        return { canvas, isHighRes: false };
    },

    async captureWithCorners(corners) {
        UI.flash();
        
        // Try high-res capture first
        const { canvas: frame, isHighRes } = await this.captureHighResFrame();
        
        // Scale corners if we got high-res image
        let scaledCorners = corners;
        if (isHighRes && frame.width !== this.video.videoWidth) {
            const scaleX = frame.width / this.video.videoWidth;
            const scaleY = frame.height / this.video.videoHeight;
            scaledCorners = {
                tl: { x: corners.tl.x * scaleX, y: corners.tl.y * scaleY },
                tr: { x: corners.tr.x * scaleX, y: corners.tr.y * scaleY },
                br: { x: corners.br.x * scaleX, y: corners.br.y * scaleY },
                bl: { x: corners.bl.x * scaleX, y: corners.bl.y * scaleY }
            };
            console.log(`📐 Scaled corners for high-res: ${scaleX.toFixed(2)}x`);
        }
        
        let processed;
        try {
            // Step 1: Perspective correction
            processed = ImageProcessor.perspectiveCorrect(frame, scaledCorners);
            
            // Step 2: Clean edges (crop + white border)
            if (typeof ImageProcessor.cleanEdges === 'function') {
                processed = ImageProcessor.cleanEdges(processed);
                console.log('✂️ Edge cleanup applied');
            }
        } catch (err) {
            console.error('Perspective correction failed:', err);
            processed = frame;
        }
        
        // Reset detection state for next scan
        Stabilizer.unlock();
        if (typeof RectangleMath !== 'undefined') {
            RectangleMath.unlock();
        }
        
        this.currentCapture = processed;
        this.showFilterScreen();
    },

    captureForManualCrop() {
        // Safety check for ImageProcessor
        if (typeof ImageProcessor === 'undefined') {
            console.error('❌ ImageProcessor not loaded!');
            UI.alert('Scanner not ready. Please refresh.');
            return;
        }
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
        UI.setActiveFilter('document');  // Default to document filter
        UI.resetAdjustments();
        
        FilterManager.init(this.currentCapture);
    },

    selectFilter(filter) {
        FilterManager.applyFilter(filter);
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
