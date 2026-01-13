/**
 * Filter Module v4.0 - PROPER FIX
 * Advanced document enhancement with LOCAL CONTRAST ANALYSIS
 * 
 * Key Innovation: Don't decide pixel-by-pixel using global thresholds.
 * Instead, use LOCAL CONTEXT to differentiate text from shadows.
 * 
 * Features:
 * - Local brightness analysis (adapts to uneven lighting)
 * - Edge sharpness detection (Sobel operator)
 * - Local variance calculation (text vs shadow differentiation)
 * - Shadow-aware processing (removes shadows, preserves text)
 * - Blue/red ink enhancement
 * - Auto sharpening
 */

const FilterManager = {
    // State
    originalImage: null,
    currentFilter: 'auto',
    adjustments: { brightness: 0, contrast: 0, sharpness: 0 },
    canvas: null,
    ctx: null,
    
    // Processing buffers (reused for performance)
    brightnessMap: null,
    edgeMap: null,
    varianceMap: null,

    // ═══════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════
    DOC_CONFIG: {
        // Local analysis settings
        LOCAL: {
            BLOCK_SIZE: 16,              // Block size for local brightness (16x16)
            VARIANCE_RADIUS: 2,          // Radius for variance calculation (5x5)
            EDGE_THRESHOLD: 25,          // Gradient magnitude for "sharp" edge
            VARIANCE_THRESHOLD: 300,     // Variance threshold for text vs shadow
        },
        
        // Text detection (relative to local paper)
        TEXT: {
            MIN_CONTRAST: 0.06,          // 6% darker than local = might be text
            STRONG_CONTRAST: 0.12,       // 12% darker = definitely text
            DARKEN_FACTOR: 0.35,         // How much to darken detected text
            LIGHT_TEXT_FACTOR: 0.55,     // How much to darken light text
        },
        
        // Shadow detection
        SHADOW: {
            MAX_EDGE: 20,                // Low edge = soft gradient = shadow
            MAX_VARIANCE: 400,           // Low variance = uniform area = shadow
            WHITENESS: 250,              // Make shadows this bright (near white)
        },
        
        // Paper detection
        PAPER: {
            MIN_BRIGHTNESS: 0.50,        // Minimum brightness to consider as paper region
            TOLERANCE: 0.04,             // Within 4% of local avg = paper
        },
        
        // Blue ink detection (pen blue range)
        BLUE_INK: {
            HUE_MIN: 185,
            HUE_MAX: 260,
            MIN_SATURATION: 0.18,
            MIN_VALUE: 0.15,
            MAX_VALUE: 0.82,
            OUTPUT: { r: 0, g: 30, b: 200 }
        },
        
        // Red ink detection
        RED_INK: {
            HUE_MIN1: 335,
            HUE_MAX1: 360,
            HUE_MIN2: 0,
            HUE_MAX2: 30,
            MIN_SATURATION: 0.22,
            MIN_VALUE: 0.18,
            MAX_VALUE: 0.85,
            OUTPUT: { r: 200, g: 10, b: 30 }
        },
        
        // Black text (absolute detection for very dark pixels)
        BLACK: {
            MAX_VALUE: 0.30,
            MAX_SATURATION: 0.30,
            DARKEN_FACTOR: 0.70
        },
        
        // Auto sharpness
        AUTO_SHARPNESS: 30
    },

    /**
     * Initialize with captured image
     */
    init(image) {
        this.originalImage = image;
        this.currentFilter = 'auto';
        this.adjustments = { brightness: 0, contrast: 0, sharpness: 0 };
        
        this.canvas = document.getElementById('filter-canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Clear analysis buffers
        this.brightnessMap = null;
        this.edgeMap = null;
        this.varianceMap = null;
    },

    /**
     * Set active filter
     */
    setFilter(filter) {
        this.currentFilter = filter;
        this.apply();
    },

    setBrightness(value) {
        this.adjustments.brightness = parseInt(value);
        this.apply();
    },

    setContrast(value) {
        this.adjustments.contrast = parseInt(value);
        this.apply();
    },

    setSharpness(value) {
        this.adjustments.sharpness = parseInt(value);
        this.apply();
    },

    reset() {
        this.adjustments = { brightness: 0, contrast: 0, sharpness: 0 };
        this.apply();
    },

    /**
     * Main apply function
     */
    apply() {
        if (!this.originalImage) return;
        
        const src = this.originalImage;
        
        // Set canvas size
        this.canvas.width = src.width;
        this.canvas.height = src.height;
        
        // Draw original
        this.ctx.drawImage(src, 0, 0);
        
        // Get image data
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        
        // Apply filter based on type
        if (this.currentFilter === 'auto' || this.currentFilter === 'magic') {
            // Use advanced local contrast analysis
            this.applyAdvancedEnhancement(imageData);
        } else if (this.currentFilter === 'bw') {
            this.applyGrayscale(imageData);
        }
        // 'original' = no processing
        
        // Apply brightness/contrast adjustments
        if (this.adjustments.brightness !== 0 || this.adjustments.contrast !== 0) {
            this.applyBrightnessContrast(imageData);
        }
        
        this.ctx.putImageData(imageData, 0, 0);
        
        // Apply sharpening
        let sharpnessAmount = this.adjustments.sharpness;
        if (this.currentFilter === 'auto' || this.currentFilter === 'magic') {
            sharpnessAmount = Math.max(sharpnessAmount, this.DOC_CONFIG.AUTO_SHARPNESS);
        }
        if (sharpnessAmount > 0) {
            this.applySharpen(sharpnessAmount);
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // ADVANCED ENHANCEMENT (LOCAL CONTRAST ANALYSIS)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Apply advanced document enhancement with local analysis
     * This is the PROPER FIX algorithm
     */
    applyAdvancedEnhancement(imageData) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const cfg = this.DOC_CONFIG;
        
        console.log('🔍 Starting advanced enhancement...');
        const startTime = performance.now();
        
        // PASS 1: Build analysis maps
        const grayscale = this.buildGrayscaleArray(data, width, height);
        const localBrightness = this.buildLocalBrightnessMap(grayscale, width, height);
        const edgeMap = this.buildEdgeMap(grayscale, width, height);
        const varianceMap = this.buildVarianceMap(grayscale, width, height);
        
        console.log(`📊 Analysis maps built in ${(performance.now() - startTime).toFixed(0)}ms`);
        
        // PASS 2: Process each pixel with context
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                
                let r = data[idx];
                let g = data[idx + 1];
                let b = data[idx + 2];
                
                // Get local context
                const pixelBrightness = grayscale[y * width + x] / 255;
                const localPaper = this.getLocalBrightness(localBrightness, x, y, width, height);
                const edgeStrength = edgeMap[y * width + x];
                const localVariance = varianceMap[y * width + x];
                
                // Process pixel with context
                [r, g, b] = this.processPixelWithContext(
                    r, g, b,
                    pixelBrightness,
                    localPaper,
                    edgeStrength,
                    localVariance
                );
                
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
            }
        }
        
        // Extra contrast boost for 'magic' filter
        if (this.currentFilter === 'magic') {
            this.applyContrastBoost(data, 1.2);
        }
        
        console.log(`✅ Enhancement complete in ${(performance.now() - startTime).toFixed(0)}ms`);
    },

    /**
     * Process single pixel using local context
     * This is the core decision logic
     */
    processPixelWithContext(r, g, b, pixelBrightness, localPaper, edgeStrength, localVariance) {
        const cfg = this.DOC_CONFIG;
        const hsv = this.rgbToHsv(r, g, b);
        
        // ─────────────────────────────────────────────────────────
        // 1. ABSOLUTE BLACK - Always preserve (darkest pixels)
        // ─────────────────────────────────────────────────────────
        if (hsv.v <= cfg.BLACK.MAX_VALUE && hsv.s <= cfg.BLACK.MAX_SATURATION) {
            const f = cfg.BLACK.DARKEN_FACTOR;
            return [
                Math.max(0, Math.round(r * f)),
                Math.max(0, Math.round(g * f)),
                Math.max(0, Math.round(b * f))
            ];
        }
        
        // ─────────────────────────────────────────────────────────
        // 2. BLUE INK - Pen writing, stamps
        // ─────────────────────────────────────────────────────────
        if (hsv.h >= cfg.BLUE_INK.HUE_MIN && hsv.h <= cfg.BLUE_INK.HUE_MAX &&
            hsv.s >= cfg.BLUE_INK.MIN_SATURATION &&
            hsv.v >= cfg.BLUE_INK.MIN_VALUE && hsv.v <= cfg.BLUE_INK.MAX_VALUE) {
            return this.enhanceBlueInk(r, g, b, hsv);
        }
        
        // ─────────────────────────────────────────────────────────
        // 3. RED INK - Stamps, signatures
        // ─────────────────────────────────────────────────────────
        const isRedHue = (hsv.h >= cfg.RED_INK.HUE_MIN1 && hsv.h <= cfg.RED_INK.HUE_MAX1) ||
                         (hsv.h >= cfg.RED_INK.HUE_MIN2 && hsv.h <= cfg.RED_INK.HUE_MAX2);
        if (isRedHue && hsv.s >= cfg.RED_INK.MIN_SATURATION &&
            hsv.v >= cfg.RED_INK.MIN_VALUE && hsv.v <= cfg.RED_INK.MAX_VALUE) {
            return this.enhanceRedInk(r, g, b, hsv);
        }
        
        // ─────────────────────────────────────────────────────────
        // 4. LOCAL CONTRAST ANALYSIS - The key innovation
        // ─────────────────────────────────────────────────────────
        
        // How much darker is this pixel than local paper?
        const contrastDiff = localPaper - pixelBrightness;
        
        // Is this pixel noticeably darker than surroundings?
        if (contrastDiff > cfg.TEXT.MIN_CONTRAST) {
            
            // Check: Is it TEXT or SHADOW?
            const isSharpEdge = edgeStrength > cfg.LOCAL.EDGE_THRESHOLD;
            const isHighVariance = localVariance > cfg.LOCAL.VARIANCE_THRESHOLD;
            
            // TEXT indicators: sharp edges OR high local variance
            const likelyText = isSharpEdge || isHighVariance;
            
            // SHADOW indicators: soft edges AND low variance AND large contrast area
            const likelyShadow = !isSharpEdge && !isHighVariance && contrastDiff < cfg.TEXT.STRONG_CONTRAST;
            
            if (likelyText) {
                // ═══ IT'S TEXT ═══
                // Darken it for better readability
                let darkenFactor;
                if (contrastDiff > cfg.TEXT.STRONG_CONTRAST) {
                    // Strong text - darken more
                    darkenFactor = cfg.TEXT.DARKEN_FACTOR;
                } else {
                    // Light text - darken less aggressively
                    darkenFactor = cfg.TEXT.LIGHT_TEXT_FACTOR;
                }
                
                return [
                    Math.max(0, Math.round(r * darkenFactor)),
                    Math.max(0, Math.round(g * darkenFactor)),
                    Math.max(0, Math.round(b * darkenFactor))
                ];
            } else if (likelyShadow) {
                // ═══ IT'S SHADOW ═══
                // Push towards white
                const whiteness = cfg.SHADOW.WHITENESS;
                return [whiteness, whiteness, whiteness];
            } else {
                // ═══ UNCERTAIN - Moderate darkening ═══
                // Could be either, play it safe
                const safeFactor = 0.7;
                return [
                    Math.max(0, Math.round(r * safeFactor)),
                    Math.max(0, Math.round(g * safeFactor)),
                    Math.max(0, Math.round(b * safeFactor))
                ];
            }
        }
        
        // ─────────────────────────────────────────────────────────
        // 5. PAPER - Matches local brightness = make white
        // ─────────────────────────────────────────────────────────
        if (contrastDiff <= cfg.PAPER.TOLERANCE && pixelBrightness > cfg.PAPER.MIN_BRIGHTNESS) {
            return [255, 255, 255];
        }
        
        // ─────────────────────────────────────────────────────────
        // 6. SLIGHTLY DARKER - Light gray, push to white
        // ─────────────────────────────────────────────────────────
        if (contrastDiff > 0 && contrastDiff <= cfg.TEXT.MIN_CONTRAST) {
            // Very slight darkness - likely light paper variation
            const lightness = Math.round(240 + (15 * (1 - contrastDiff / cfg.TEXT.MIN_CONTRAST)));
            return [lightness, lightness, lightness];
        }
        
        // ─────────────────────────────────────────────────────────
        // 7. COLORED CONTENT - Preserve with saturation boost
        // ─────────────────────────────────────────────────────────
        if (hsv.s > 0.25) {
            return this.boostSaturation(r, g, b, 1.15);
        }
        
        // Default: return as-is
        return [r, g, b];
    },

    // ═══════════════════════════════════════════════════════════════
    // ANALYSIS MAP BUILDERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Build grayscale array from RGBA data
     */
    buildGrayscaleArray(data, width, height) {
        const gray = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        }
        return gray;
    },

    /**
     * Build local brightness map (average brightness per block)
     */
    buildLocalBrightnessMap(grayscale, width, height) {
        const blockSize = this.DOC_CONFIG.LOCAL.BLOCK_SIZE;
        const mapWidth = Math.ceil(width / blockSize);
        const mapHeight = Math.ceil(height / blockSize);
        const map = new Float32Array(mapWidth * mapHeight);
        
        for (let by = 0; by < mapHeight; by++) {
            for (let bx = 0; bx < mapWidth; bx++) {
                let sum = 0;
                let count = 0;
                
                const startX = bx * blockSize;
                const startY = by * blockSize;
                const endX = Math.min(startX + blockSize, width);
                const endY = Math.min(startY + blockSize, height);
                
                // Calculate average, but bias towards BRIGHTER pixels (paper detection)
                const values = [];
                for (let y = startY; y < endY; y++) {
                    for (let x = startX; x < endX; x++) {
                        values.push(grayscale[y * width + x]);
                    }
                }
                
                // Use 75th percentile as "local paper" brightness
                // This helps ignore text when estimating paper color
                values.sort((a, b) => a - b);
                const percentileIdx = Math.floor(values.length * 0.75);
                map[by * mapWidth + bx] = values[percentileIdx] / 255;
            }
        }
        
        return { data: map, width: mapWidth, height: mapHeight, blockSize };
    },

    /**
     * Get interpolated local brightness for a pixel
     */
    getLocalBrightness(map, x, y, imgWidth, imgHeight) {
        const bx = Math.floor(x / map.blockSize);
        const by = Math.floor(y / map.blockSize);
        
        // Clamp to map bounds
        const cx = Math.min(bx, map.width - 1);
        const cy = Math.min(by, map.height - 1);
        
        return map.data[cy * map.width + cx];
    },

    /**
     * Build edge strength map using Sobel operator
     */
    buildEdgeMap(grayscale, width, height) {
        const edgeMap = new Float32Array(width * height);
        
        // Sobel kernels
        const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
        const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let gx = 0, gy = 0;
                let ki = 0;
                
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const pixel = grayscale[(y + ky) * width + (x + kx)];
                        gx += pixel * sobelX[ki];
                        gy += pixel * sobelY[ki];
                        ki++;
                    }
                }
                
                // Gradient magnitude
                edgeMap[y * width + x] = Math.sqrt(gx * gx + gy * gy);
            }
        }
        
        return edgeMap;
    },

    /**
     * Build local variance map
     */
    buildVarianceMap(grayscale, width, height) {
        const varianceMap = new Float32Array(width * height);
        const radius = this.DOC_CONFIG.LOCAL.VARIANCE_RADIUS;
        
        for (let y = radius; y < height - radius; y++) {
            for (let x = radius; x < width - radius; x++) {
                let sum = 0;
                let sumSq = 0;
                let count = 0;
                
                for (let ky = -radius; ky <= radius; ky++) {
                    for (let kx = -radius; kx <= radius; kx++) {
                        const val = grayscale[(y + ky) * width + (x + kx)];
                        sum += val;
                        sumSq += val * val;
                        count++;
                    }
                }
                
                const mean = sum / count;
                const variance = (sumSq / count) - (mean * mean);
                varianceMap[y * width + x] = variance;
            }
        }
        
        return varianceMap;
    },

    // ═══════════════════════════════════════════════════════════════
    // INK ENHANCEMENT
    // ═══════════════════════════════════════════════════════════════

    enhanceBlueInk(r, g, b, hsv) {
        const cfg = this.DOC_CONFIG.BLUE_INK;
        const intensity = 1 - hsv.v;
        const blendFactor = 0.35 + (intensity * 0.45);
        
        return [
            Math.round(r * (1 - blendFactor) + cfg.OUTPUT.r * blendFactor),
            Math.round(g * (1 - blendFactor) + cfg.OUTPUT.g * blendFactor),
            Math.round(b * (1 - blendFactor) + cfg.OUTPUT.b * blendFactor)
        ];
    },

    enhanceRedInk(r, g, b, hsv) {
        const cfg = this.DOC_CONFIG.RED_INK;
        const intensity = 1 - hsv.v;
        const blendFactor = 0.35 + (intensity * 0.45);
        
        return [
            Math.round(r * (1 - blendFactor) + cfg.OUTPUT.r * blendFactor),
            Math.round(g * (1 - blendFactor) + cfg.OUTPUT.g * blendFactor),
            Math.round(b * (1 - blendFactor) + cfg.OUTPUT.b * blendFactor)
        ];
    },

    // ═══════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    rgbToHsv(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        
        let h = 0;
        let s = max === 0 ? 0 : delta / max;
        let v = max;
        
        if (delta !== 0) {
            if (max === r) {
                h = 60 * (((g - b) / delta) % 6);
            } else if (max === g) {
                h = 60 * ((b - r) / delta + 2);
            } else {
                h = 60 * ((r - g) / delta + 4);
            }
        }
        
        if (h < 0) h += 360;
        
        return { h, s, v };
    },

    boostSaturation(r, g, b, factor) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        return [
            Math.min(255, Math.max(0, Math.round(gray + (r - gray) * factor))),
            Math.min(255, Math.max(0, Math.round(gray + (g - gray) * factor))),
            Math.min(255, Math.max(0, Math.round(gray + (b - gray) * factor)))
        ];
    },

    applyGrayscale(imageData) {
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
        }
    },

    applyBrightnessContrast(imageData) {
        const data = imageData.data;
        const brightness = this.adjustments.brightness * 2;
        const contrast = this.adjustments.contrast / 50;
        
        for (let i = 0; i < data.length; i += 4) {
            for (let c = 0; c < 3; c++) {
                let value = data[i + c];
                value = (value - 128) * (1 + contrast) + 128;
                value = value + brightness;
                data[i + c] = Math.max(0, Math.min(255, Math.round(value)));
            }
        }
    },

    applyContrastBoost(data, factor) {
        for (let i = 0; i < data.length; i += 4) {
            for (let c = 0; c < 3; c++) {
                let value = data[i + c];
                value = (value - 128) * factor + 128;
                data[i + c] = Math.max(0, Math.min(255, Math.round(value)));
            }
        }
    },

    applySharpen(amount) {
        if (amount <= 0) return;
        
        const strength = amount / 100;
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imageData.data;
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        const original = new Uint8ClampedArray(data);
        
        const centerWeight = 1 + (4 * strength);
        const edgeWeight = -strength;
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                const idxTop = ((y - 1) * width + x) * 4;
                const idxBottom = ((y + 1) * width + x) * 4;
                const idxLeft = (y * width + (x - 1)) * 4;
                const idxRight = (y * width + (x + 1)) * 4;
                
                for (let c = 0; c < 3; c++) {
                    let value = original[idx + c] * centerWeight +
                               original[idxTop + c] * edgeWeight +
                               original[idxBottom + c] * edgeWeight +
                               original[idxLeft + c] * edgeWeight +
                               original[idxRight + c] * edgeWeight;
                    
                    data[idx + c] = Math.max(0, Math.min(255, Math.round(value)));
                }
            }
        }
        
        this.ctx.putImageData(imageData, 0, 0);
    },

    // ═══════════════════════════════════════════════════════════════
    // ANIMATION & OUTPUT
    // ═══════════════════════════════════════════════════════════════

    runScanAnimation(callback) {
        const scanLine = document.getElementById('scan-line');
        if (!scanLine) {
            if (callback) callback();
            return;
        }
        
        scanLine.classList.remove('active');
        this.setFilter('original');
        
        setTimeout(() => {
            scanLine.classList.add('active');
        }, 100);
        
        setTimeout(() => {
            scanLine.classList.remove('active');
            this.setFilter('auto');
            if (callback) callback();
        }, 1700);
    },

    getDataURL(quality = CONFIG.OUTPUT.JPEG_QUALITY) {
        return this.canvas.toDataURL('image/jpeg', quality);
    },

    getDimensions() {
        return {
            width: this.canvas.width,
            height: this.canvas.height
        };
    },

    getState() {
        return {
            filter: this.currentFilter,
            brightness: this.adjustments.brightness,
            contrast: this.adjustments.contrast,
            sharpness: this.adjustments.sharpness
        };
    },

    cleanup() {
        this.originalImage = null;
        this.brightnessMap = null;
        this.edgeMap = null;
        this.varianceMap = null;
    }
};
