/**
 * Crop Manager Module
 * Handles manual corner adjustment UI
 */

const CropManager = {
    
    canvas: null,
    ctx: null,
    image: null,
    corners: null,
    activeCorner: null,
    displayScale: 1,
    offsetX: 0,
    offsetY: 0,
    onComplete: null,
    onCancel: null,
    
    CONFIG: {
        CORNER_RADIUS: 20,
        LINE_WIDTH: 3,
        MARGIN: 0.15
    },
    
    /**
     * Initialize crop manager
     */
    init(sourceImage, onComplete, onCancel) {
        this.image = sourceImage;
        this.onComplete = onComplete;
        this.onCancel = onCancel;
        
        this.canvas = document.getElementById('crop-canvas');
        if (!this.canvas) {
            console.error('crop-canvas not found');
            return;
        }
        
        this.ctx = this.canvas.getContext('2d');
        
        // Setup dimensions
        this.setupDimensions();
        
        // Initialize corners
        this.initCorners();
        
        // Setup touch/mouse handlers
        this.setupHandlers();
        
        // Initial draw
        this.draw();
    },
    
    /**
     * Setup canvas dimensions
     */
    setupDimensions() {
        const container = this.canvas.parentElement;
        const containerW = container.clientWidth;
        const containerH = container.clientHeight;
        
        // Calculate scale to fit image in container
        const scaleX = containerW / this.image.width;
        const scaleY = containerH / this.image.height;
        this.displayScale = Math.min(scaleX, scaleY, 1);
        
        // Canvas size
        const displayW = this.image.width * this.displayScale;
        const displayH = this.image.height * this.displayScale;
        
        this.canvas.width = displayW;
        this.canvas.height = displayH;
        
        // Center offset
        this.offsetX = (containerW - displayW) / 2;
        this.offsetY = (containerH - displayH) / 2;
        
        this.canvas.style.marginLeft = this.offsetX + 'px';
        this.canvas.style.marginTop = this.offsetY + 'px';
    },
    
    /**
     * Initialize corners with margin
     */
    initCorners() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const m = this.CONFIG.MARGIN;
        
        this.corners = {
            tl: { x: w * m, y: h * m },
            tr: { x: w * (1 - m), y: h * m },
            br: { x: w * (1 - m), y: h * (1 - m) },
            bl: { x: w * m, y: h * (1 - m) }
        };
    },
    
    /**
     * Setup touch/mouse handlers
     */
    setupHandlers() {
        // Touch events
        this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e));
        this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e));
        this.canvas.addEventListener('touchend', () => this.onTouchEnd());
        
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this.onMouseUp());
    },
    
    /**
     * Get touch position relative to canvas
     */
    getTouchPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        return {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
    },
    
    /**
     * Get mouse position relative to canvas
     */
    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    },
    
    /**
     * Find corner near point
     */
    findCorner(pos) {
        const threshold = this.CONFIG.CORNER_RADIUS * 2;
        
        for (const key of ['tl', 'tr', 'br', 'bl']) {
            const c = this.corners[key];
            const dist = Math.sqrt((pos.x - c.x) ** 2 + (pos.y - c.y) ** 2);
            if (dist < threshold) {
                return key;
            }
        }
        return null;
    },
    
    onTouchStart(e) {
        e.preventDefault();
        const pos = this.getTouchPos(e);
        this.activeCorner = this.findCorner(pos);
    },
    
    onTouchMove(e) {
        e.preventDefault();
        if (!this.activeCorner) return;
        
        const pos = this.getTouchPos(e);
        this.corners[this.activeCorner] = pos;
        this.draw();
    },
    
    onTouchEnd() {
        this.activeCorner = null;
    },
    
    onMouseDown(e) {
        const pos = this.getMousePos(e);
        this.activeCorner = this.findCorner(pos);
    },
    
    onMouseMove(e) {
        if (!this.activeCorner) return;
        
        const pos = this.getMousePos(e);
        this.corners[this.activeCorner] = pos;
        this.draw();
    },
    
    onMouseUp() {
        this.activeCorner = null;
    },
    
    /**
     * Draw crop overlay
     */
    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // Clear and draw image
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(this.image, 0, 0, w, h);
        
        // Draw darkened area outside crop
        this.drawOverlay();
        
        // Draw crop lines
        ctx.beginPath();
        ctx.moveTo(this.corners.tl.x, this.corners.tl.y);
        ctx.lineTo(this.corners.tr.x, this.corners.tr.y);
        ctx.lineTo(this.corners.br.x, this.corners.br.y);
        ctx.lineTo(this.corners.bl.x, this.corners.bl.y);
        ctx.closePath();
        
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = this.CONFIG.LINE_WIDTH;
        ctx.stroke();
        
        // Draw corner handles
        for (const key of ['tl', 'tr', 'br', 'bl']) {
            const c = this.corners[key];
            ctx.beginPath();
            ctx.arc(c.x, c.y, this.CONFIG.CORNER_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.strokeStyle = '#10B981';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    },
    
    /**
     * Draw darkened overlay outside crop area
     */
    drawOverlay() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        
        // Cut out crop area
        ctx.moveTo(this.corners.tl.x, this.corners.tl.y);
        ctx.lineTo(this.corners.bl.x, this.corners.bl.y);
        ctx.lineTo(this.corners.br.x, this.corners.br.y);
        ctx.lineTo(this.corners.tr.x, this.corners.tr.y);
        ctx.closePath();
        
        ctx.fill('evenodd');
    },
    
    /**
     * Complete cropping
     */
    complete() {
        console.log('✂️ CropManager.complete() called');
        
        if (!this.corners || !this.image) {
            console.error('No crop data');
            return;
        }
        
        // Scale corners back to original image coordinates
        const scale = 1 / this.displayScale;
        const scaledCorners = {
            tl: { x: this.corners.tl.x * scale, y: this.corners.tl.y * scale },
            tr: { x: this.corners.tr.x * scale, y: this.corners.tr.y * scale },
            br: { x: this.corners.br.x * scale, y: this.corners.br.y * scale },
            bl: { x: this.corners.bl.x * scale, y: this.corners.bl.y * scale }
        };
        
        // Apply perspective correction
        let result;
        try {
            if (typeof ImageProcessor !== 'undefined') {
                result = ImageProcessor.perspectiveCorrect(this.image, scaledCorners);
                console.log('✂️ Perspective correction done');
                
                // Apply edge cleanup
                if (typeof ImageProcessor.cleanEdges === 'function') {
                    result = ImageProcessor.cleanEdges(result);
                    console.log('✂️ Edge cleanup done');
                }
            } else {
                result = this.image;
            }
        } catch (err) {
            console.error('Crop perspective failed:', err);
            result = this.image;
        }
        
        const callback = this.onComplete;
        this.cleanup();
        
        if (callback) {
            console.log('✂️ Calling onComplete callback');
            callback(result);
        }
    },
    
    /**
     * Cancel cropping
     */
    cancel() {
        const callback = this.onCancel;
        this.cleanup();
        if (callback) callback();
    },
    
    /**
     * Cleanup
     */
    cleanup() {
        this.image = null;
        this.corners = null;
        this.activeCorner = null;
        this.onComplete = null;
        this.onCancel = null;
    }
};
