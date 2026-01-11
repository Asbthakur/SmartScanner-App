/**
 * Filter Manager Module
 * Applies image filters and adjustments
 * Integrated with DocumentEnhancer for professional output
 */

const FilterManager = {
    
    canvas: null,
    ctx: null,
    originalImage: null,
    enhancedCache: {},  // Cache enhanced versions
    currentFilter: 'document',  // Default to document mode
    adjustments: { brightness: 0, contrast: 0 },
    
    /**
     * Initialize with image
     */
    init(image) {
        this.originalImage = image;
        this.currentFilter = 'document';  // Default to best quality
        this.adjustments = { brightness: 0, contrast: 0 };
        this.enhancedCache = {};
        
        this.canvas = document.getElementById('filter-canvas');
        if (!this.canvas) {
            console.error('filter-preview canvas not found');
            return;
        }
        
        this.ctx = this.canvas.getContext('2d');
        
        // Set canvas size
        this.canvas.width = image.width;
        this.canvas.height = image.height;
        
        // Apply default filter (document mode)
        this.applyFilter('document');
    },
    
    /**
     * Apply a filter
     */
    applyFilter(filterName) {
        if (!this.originalImage) return;
        
        this.currentFilter = filterName;
        console.log(`🎨 Applying filter: ${filterName}`);
        
        // Check cache first
        if (this.enhancedCache[filterName]) {
            this.ctx.drawImage(this.enhancedCache[filterName], 0, 0);
            this.applyAdjustmentsToCanvas();
            return;
        }
        
        // Create temp canvas with original
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.originalImage.width;
        tempCanvas.height = this.originalImage.height;
        tempCanvas.getContext('2d').drawImage(this.originalImage, 0, 0);
        
        let resultCanvas;
        
        switch (filterName) {
            case 'document':
                // Professional document enhancement (OkenScan quality)
                if (typeof DocumentEnhancer !== 'undefined') {
                    resultCanvas = DocumentEnhancer.documentMode(tempCanvas);
                } else {
                    resultCanvas = this.legacyAutoEnhance(tempCanvas);
                }
                break;
                
            case 'photo':
                // Light enhancement preserving colors
                if (typeof DocumentEnhancer !== 'undefined') {
                    resultCanvas = DocumentEnhancer.photoMode(tempCanvas);
                } else {
                    resultCanvas = tempCanvas;
                }
                break;
                
            case 'whiteboard':
                // Strong contrast for whiteboards
                if (typeof DocumentEnhancer !== 'undefined') {
                    resultCanvas = DocumentEnhancer.whiteboardMode(tempCanvas);
                } else {
                    resultCanvas = this.legacyAutoEnhance(tempCanvas);
                }
                break;
                
            case 'book':
                // Optimized for book pages
                if (typeof DocumentEnhancer !== 'undefined') {
                    resultCanvas = DocumentEnhancer.bookMode(tempCanvas);
                } else {
                    resultCanvas = this.legacyAutoEnhance(tempCanvas);
                }
                break;
                
            case 'bw':
                // Black and white (high contrast)
                resultCanvas = this.applyBW(tempCanvas);
                break;
                
            case 'gray':
                // Grayscale
                resultCanvas = this.applyGrayscale(tempCanvas);
                break;
                
            case 'original':
            default:
                // No filter - raw capture
                resultCanvas = tempCanvas;
                break;
        }
        
        // Cache the result
        this.enhancedCache[filterName] = resultCanvas;
        
        // Draw to main canvas
        this.ctx.drawImage(resultCanvas, 0, 0);
        
        // Apply brightness/contrast adjustments
        this.applyAdjustmentsToCanvas();
    },
    
    /**
     * Legacy auto-enhance (fallback when DocumentEnhancer not available)
     */
    legacyAutoEnhance(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Find min/max for contrast stretch
        let min = 255, max = 0;
        for (let i = 0; i < data.length; i += 4) {
            const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (gray < min) min = gray;
            if (gray > max) max = gray;
        }
        
        // Contrast stretch
        const range = max - min || 1;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = ((data[i] - min) / range) * 255;
            data[i + 1] = ((data[i + 1] - min) / range) * 255;
            data[i + 2] = ((data[i + 2] - min) / range) * 255;
        }
        
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    },
    
    /**
     * Black and white (high contrast binarization)
     */
    applyBW(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // First apply document enhancement for better results
        if (typeof DocumentEnhancer !== 'undefined') {
            const enhanced = DocumentEnhancer.enhance(canvas, {
                whiteBalance: true,
                clahe: true,
                textEnhance: false,
                sharpen: false
            });
            const enhCtx = enhanced.getContext('2d');
            const enhData = enhCtx.getImageData(0, 0, enhanced.width, enhanced.height);
            
            // Adaptive threshold
            for (let i = 0; i < enhData.data.length; i += 4) {
                const gray = (enhData.data[i] + enhData.data[i + 1] + enhData.data[i + 2]) / 3;
                const bw = gray > 140 ? 255 : 0;  // Threshold
                enhData.data[i] = bw;
                enhData.data[i + 1] = bw;
                enhData.data[i + 2] = bw;
            }
            
            enhCtx.putImageData(enhData, 0, 0);
            return enhanced;
        }
        
        // Fallback simple B&W
        for (let i = 0; i < data.length; i += 4) {
            const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const bw = gray > 128 ? 255 : 0;
            data[i] = bw;
            data[i + 1] = bw;
            data[i + 2] = bw;
        }
        
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    },
    
    /**
     * Grayscale filter
     */
    applyGrayscale(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
        }
        
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    },
    
    /**
     * Apply brightness/contrast adjustments to current canvas
     */
    applyAdjustmentsToCanvas() {
        const brightness = this.adjustments.brightness;
        const contrast = this.adjustments.contrast;
        
        if (brightness === 0 && contrast === 0) return;
        
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imageData.data;
        
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
        
        for (let i = 0; i < data.length; i += 4) {
            // Brightness
            let r = data[i] + brightness;
            let g = data[i + 1] + brightness;
            let b = data[i + 2] + brightness;
            
            // Contrast
            r = factor * (r - 128) + 128;
            g = factor * (g - 128) + 128;
            b = factor * (b - 128) + 128;
            
            data[i] = Math.min(255, Math.max(0, r));
            data[i + 1] = Math.min(255, Math.max(0, g));
            data[i + 2] = Math.min(255, Math.max(0, b));
        }
        
        this.ctx.putImageData(imageData, 0, 0);
    },
    
    /**
     * Set brightness
     */
    setBrightness(value) {
        this.adjustments.brightness = value * 2.55; // Convert -50..50 to -127..127
        // Re-apply current filter with new adjustments
        if (this.enhancedCache[this.currentFilter]) {
            this.ctx.drawImage(this.enhancedCache[this.currentFilter], 0, 0);
            this.applyAdjustmentsToCanvas();
        }
    },
    
    /**
     * Set contrast
     */
    setContrast(value) {
        this.adjustments.contrast = value * 2.55;
        // Re-apply current filter with new adjustments
        if (this.enhancedCache[this.currentFilter]) {
            this.ctx.drawImage(this.enhancedCache[this.currentFilter], 0, 0);
            this.applyAdjustmentsToCanvas();
        }
    },
    
    /**
     * Reset adjustments
     */
    reset() {
        this.adjustments = { brightness: 0, contrast: 0 };
        this.applyFilter(this.currentFilter);
    },
    
    /**
     * Get current filter name
     */
    getCurrentFilter() {
        return this.currentFilter;
    },
    
    /**
     * Get canvas as data URL
     */
    getDataURL(quality = 0.92) {
        return this.canvas.toDataURL('image/jpeg', quality);
    },
    
    /**
     * Get canvas
     */
    getCanvas() {
        return this.canvas;
    },
    
    /**
     * Get dimensions
     */
    getDimensions() {
        return {
            width: this.canvas.width,
            height: this.canvas.height
        };
    },
    
    /**
     * Cleanup
     */
    cleanup() {
        this.originalImage = null;
        this.currentFilter = 'document';
        this.adjustments = { brightness: 0, contrast: 0 };
        this.enhancedCache = {};
    }
};
