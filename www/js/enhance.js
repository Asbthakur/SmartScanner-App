/**
 * Document Enhancement Module
 * Professional-grade document processing like OkenScan/CamScanner
 * 
 * Pipeline:
 * 1. White Balance - Paper → Pure white
 * 2. CLAHE - Adaptive local contrast
 * 3. Text Enhancement - Black text boost
 * 4. Sharpening - Crisp edges
 */

const DocumentEnhancer = {

    // ═══════════════════════════════════════════════════════════════
    // MAIN ENHANCEMENT PIPELINE
    // ═══════════════════════════════════════════════════════════════

    /**
     * Full document enhancement pipeline
     * @param {HTMLCanvasElement} sourceCanvas - Input image
     * @param {Object} options - Enhancement options
     * @returns {HTMLCanvasElement} Enhanced image
     */
    enhance(sourceCanvas, options = {}) {
        const config = {
            whiteBalance: options.whiteBalance ?? true,
            clahe: options.clahe ?? true,
            textEnhance: options.textEnhance ?? true,
            sharpen: options.sharpen ?? true,
            // Tuning parameters
            claheClipLimit: options.claheClipLimit ?? 2.0,
            claheTileSize: options.claheTileSize ?? 8,
            textBoost: options.textBoost ?? 1.3,
            sharpenAmount: options.sharpenAmount ?? 0.3,
            whitePaperTarget: options.whitePaperTarget ?? 250,
            ...options
        };

        console.log('📄 Starting document enhancement pipeline...');
        const startTime = performance.now();

        // Create working canvas
        let canvas = this.cloneCanvas(sourceCanvas);

        // Step 1: White Balance
        if (config.whiteBalance) {
            console.log('  1️⃣ White balance...');
            canvas = this.applyWhiteBalance(canvas, config);
        }

        // Step 2: CLAHE (Adaptive Local Contrast)
        if (config.clahe) {
            console.log('  2️⃣ CLAHE adaptive contrast...');
            canvas = this.applyCLAHE(canvas, config);
        }

        // Step 3: Text Enhancement
        if (config.textEnhance) {
            console.log('  3️⃣ Text enhancement...');
            canvas = this.applyTextEnhancement(canvas, config);
        }

        // Step 4: Sharpening
        if (config.sharpen) {
            console.log('  4️⃣ Sharpening...');
            canvas = this.applySharpen(canvas, config);
        }

        const elapsed = (performance.now() - startTime).toFixed(0);
        console.log(`✅ Enhancement complete in ${elapsed}ms`);

        return canvas;
    },

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: WHITE BALANCE
    // ═══════════════════════════════════════════════════════════════

    /**
     * White balance correction
     * Samples paper color and shifts to pure white
     */
    applyWhiteBalance(canvas, config) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Sample paper color from multiple regions (corners + center edges)
        const paperColor = this.samplePaperColor(data, canvas.width, canvas.height);
        console.log(`    Paper color detected: RGB(${paperColor.r}, ${paperColor.g}, ${paperColor.b})`);

        // Calculate correction factors to shift paper → white
        const targetWhite = config.whitePaperTarget; // 250 instead of 255 to avoid pure white clipping
        const corrR = targetWhite / Math.max(paperColor.r, 1);
        const corrG = targetWhite / Math.max(paperColor.g, 1);
        const corrB = targetWhite / Math.max(paperColor.b, 1);

        // Apply correction to all pixels
        for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, Math.round(data[i] * corrR));
            data[i + 1] = Math.min(255, Math.round(data[i + 1] * corrG));
            data[i + 2] = Math.min(255, Math.round(data[i + 2] * corrB));
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    },

    /**
     * Sample paper color from bright regions
     * Uses percentile-based sampling to find the paper (brightest areas)
     */
    samplePaperColor(data, width, height) {
        const samples = [];
        
        // Sample from multiple regions
        const regions = [
            { x: 0.1, y: 0.1, w: 0.15, h: 0.15 },   // Top-left
            { x: 0.75, y: 0.1, w: 0.15, h: 0.15 },  // Top-right
            { x: 0.1, y: 0.75, w: 0.15, h: 0.15 },  // Bottom-left
            { x: 0.75, y: 0.75, w: 0.15, h: 0.15 }, // Bottom-right
            { x: 0.4, y: 0.05, w: 0.2, h: 0.1 },    // Top-center
            { x: 0.4, y: 0.85, w: 0.2, h: 0.1 },    // Bottom-center
        ];

        for (const region of regions) {
            const startX = Math.floor(region.x * width);
            const startY = Math.floor(region.y * height);
            const endX = Math.floor((region.x + region.w) * width);
            const endY = Math.floor((region.y + region.h) * height);

            for (let y = startY; y < endY; y += 3) {
                for (let x = startX; x < endX; x += 3) {
                    const idx = (y * width + x) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    const brightness = (r + g + b) / 3;
                    
                    // Only sample bright pixels (likely paper)
                    if (brightness > 150) {
                        samples.push({ r, g, b, brightness });
                    }
                }
            }
        }

        if (samples.length === 0) {
            return { r: 240, g: 240, b: 240 }; // Fallback
        }

        // Sort by brightness and take top 20% (brightest = paper)
        samples.sort((a, b) => b.brightness - a.brightness);
        const topSamples = samples.slice(0, Math.max(10, Math.floor(samples.length * 0.2)));

        // Average the top samples
        let sumR = 0, sumG = 0, sumB = 0;
        for (const s of topSamples) {
            sumR += s.r;
            sumG += s.g;
            sumB += s.b;
        }

        return {
            r: Math.round(sumR / topSamples.length),
            g: Math.round(sumG / topSamples.length),
            b: Math.round(sumB / topSamples.length)
        };
    },

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: CLAHE (Contrast Limited Adaptive Histogram Equalization)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Apply CLAHE using OpenCV
     * This is the KEY to OkenScan-quality output
     */
    applyCLAHE(canvas, config) {
        // Check if OpenCV is available
        if (typeof cv === 'undefined' || !window.cvReady) {
            console.warn('    OpenCV not available, using fallback contrast');
            return this.applyFallbackContrast(canvas, config);
        }

        let src, lab, labPlanes, clahe, dst;
        
        try {
            // Read image
            src = cv.imread(canvas);
            
            // Convert to LAB color space (CLAHE works best on L channel)
            lab = new cv.Mat();
            cv.cvtColor(src, lab, cv.COLOR_RGBA2RGB);
            const labColor = new cv.Mat();
            cv.cvtColor(lab, labColor, cv.COLOR_RGB2Lab);
            lab.delete();
            lab = labColor;
            
            // Split into channels
            labPlanes = new cv.MatVector();
            cv.split(lab, labPlanes);
            
            // Apply CLAHE to L channel (lightness)
            clahe = new cv.CLAHE(config.claheClipLimit, new cv.Size(config.claheTileSize, config.claheTileSize));
            const lChannel = labPlanes.get(0);
            const lEnhanced = new cv.Mat();
            clahe.apply(lChannel, lEnhanced);
            
            // Replace L channel
            labPlanes.set(0, lEnhanced);
            
            // Merge back
            dst = new cv.Mat();
            cv.merge(labPlanes, dst);
            
            // Convert back to RGB
            const rgb = new cv.Mat();
            cv.cvtColor(dst, rgb, cv.COLOR_Lab2RGB);
            
            // Convert to RGBA for canvas
            const rgba = new cv.Mat();
            cv.cvtColor(rgb, rgba, cv.COLOR_RGB2RGBA);
            
            // Write to canvas
            cv.imshow(canvas, rgba);
            
            // Cleanup
            lEnhanced.delete();
            rgb.delete();
            rgba.delete();
            
        } catch (err) {
            console.error('    CLAHE error:', err);
            return this.applyFallbackContrast(canvas, config);
        } finally {
            // Cleanup OpenCV mats
            src?.delete();
            lab?.delete();
            labPlanes?.delete();
            clahe?.delete();
            dst?.delete();
        }

        return canvas;
    },

    /**
     * Fallback contrast enhancement when OpenCV not available
     */
    applyFallbackContrast(canvas, config) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Find min/max for contrast stretch
        let min = 255, max = 0;
        for (let i = 0; i < data.length; i += 4) {
            const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (gray < min) min = gray;
            if (gray > max) max = gray;
        }

        // Stretch contrast
        const range = max - min || 1;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = ((data[i] - min) / range) * 255;
            data[i + 1] = ((data[i + 1] - min) / range) * 255;
            data[i + 2] = ((data[i + 2] - min) / range) * 255;
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    },

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: TEXT ENHANCEMENT
    // ═══════════════════════════════════════════════════════════════

    /**
     * Enhance text by boosting dark pixels toward black
     * and light pixels toward white (without full binarization)
     * PRESERVES COLORED ELEMENTS (stamps, signatures, logos)
     */
    applyTextEnhancement(canvas, config) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        const boost = config.textBoost;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            const gray = (r + g + b) / 3;
            const maxRGB = Math.max(r, g, b);
            const minRGB = Math.min(r, g, b);
            
            // Calculate saturation (0 = grayscale, 1 = fully saturated)
            const saturation = maxRGB > 0 ? (maxRGB - minRGB) / maxRGB : 0;
            
            // Calculate color difference from gray
            const colorDiff = Math.abs(r - gray) + Math.abs(g - gray) + Math.abs(b - gray);
            
            // Detect if pixel is colored (stamp, signature, logo)
            const isColored = saturation > 0.12 || colorDiff > 30;
            
            if (isColored) {
                // ═══════════════════════════════════════════════════════════
                // COLORED PIXEL - Preserve and enhance color (stamps, signs)
                // ═══════════════════════════════════════════════════════════
                
                // Boost saturation while preserving hue
                const satBoost = 1.3; // Increase color vibrancy
                const lumBoost = 0.95; // Slightly darken for better visibility
                
                // Convert to HSL-like adjustment
                const avgColor = (r + g + b) / 3;
                
                // Enhance each channel relative to average (boosts saturation)
                let newR = avgColor + (r - avgColor) * satBoost;
                let newG = avgColor + (g - avgColor) * satBoost;
                let newB = avgColor + (b - avgColor) * satBoost;
                
                // Apply slight darkening for better print visibility
                newR *= lumBoost;
                newG *= lumBoost;
                newB *= lumBoost;
                
                // For blue stamps (common) - extra boost
                if (b > r && b > g && b > 100) {
                    newB = Math.min(255, newB * 1.1);
                    newR *= 0.9;
                    newG *= 0.9;
                }
                
                // For red signatures (common) - extra boost
                if (r > g && r > b && r > 100) {
                    newR = Math.min(255, newR * 1.1);
                    newG *= 0.85;
                    newB *= 0.85;
                }
                
                // For green elements
                if (g > r && g > b && g > 100) {
                    newG = Math.min(255, newG * 1.1);
                    newR *= 0.9;
                    newB *= 0.9;
                }
                
                data[i] = Math.min(255, Math.max(0, Math.round(newR)));
                data[i + 1] = Math.min(255, Math.max(0, Math.round(newG)));
                data[i + 2] = Math.min(255, Math.max(0, Math.round(newB)));
                
            } else if (gray > 180) {
                // ═══════════════════════════════════════════════════════════
                // LIGHT GRAYSCALE - Paper → Push to PURE WHITE
                // ═══════════════════════════════════════════════════════════
                // More aggressive: anything light becomes white
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
                
            } else if (gray < 150) {
                // ═══════════════════════════════════════════════════════════
                // DARK GRAYSCALE - Text/Lines → Push to PURE BLACK
                // ═══════════════════════════════════════════════════════════
                // More aggressive threshold and darker output
                const normalizedGray = gray / 150;
                const factor = Math.pow(normalizedGray, boost * 1.5) * 0.4;
                
                data[i] = Math.max(0, Math.round(r * factor));
                data[i + 1] = Math.max(0, Math.round(g * factor));
                data[i + 2] = Math.max(0, Math.round(b * factor));
                
            } else {
                // ═══════════════════════════════════════════════════════════
                // MID-TONE GRAYSCALE (150-180) - Push toward black or white
                // ═══════════════════════════════════════════════════════════
                const midFactor = (gray - 150) / 30; // 0 to 1
                
                // More aggressive: push mid-tones to extremes
                if (midFactor < 0.5) {
                    // Closer to dark - push to black
                    const darkFactor = 0.3 + (midFactor * 0.4);
                    data[i] = Math.round(r * darkFactor);
                    data[i + 1] = Math.round(g * darkFactor);
                    data[i + 2] = Math.round(b * darkFactor);
                } else {
                    // Closer to light - push to white
                    const lightAmount = (midFactor - 0.5) * 2; // 0 to 1
                    data[i] = Math.min(255, Math.round(r + (255 - r) * lightAmount));
                    data[i + 1] = Math.min(255, Math.round(g + (255 - g) * lightAmount));
                    data[i + 2] = Math.min(255, Math.round(b + (255 - b) * lightAmount));
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    },

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: SHARPENING (Unsharp Mask)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Apply unsharp mask sharpening
     */
    applySharpen(canvas, config) {
        // Check if OpenCV is available
        if (typeof cv === 'undefined' || !window.cvReady) {
            console.warn('    OpenCV not available, skipping sharpen');
            return canvas;
        }

        const amount = config.sharpenAmount; // 0.3 = 30% sharpening
        
        let src, blurred, sharpened;
        
        try {
            src = cv.imread(canvas);
            blurred = new cv.Mat();
            sharpened = new cv.Mat();

            // Gaussian blur
            cv.GaussianBlur(src, blurred, new cv.Size(0, 0), 3);

            // Unsharp mask: sharpened = original + amount * (original - blurred)
            cv.addWeighted(src, 1 + amount, blurred, -amount, 0, sharpened);

            // Write to canvas
            cv.imshow(canvas, sharpened);

        } catch (err) {
            console.error('    Sharpen error:', err);
        } finally {
            src?.delete();
            blurred?.delete();
            sharpened?.delete();
        }

        return canvas;
    },

    // ═══════════════════════════════════════════════════════════════
    // PRESET MODES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Document mode - Full enhancement (like CamScanner/OkenScan)
     * AGGRESSIVE settings for clean, professional output
     */
    documentMode(canvas) {
        return this.enhance(canvas, {
            whiteBalance: true,
            clahe: true,
            textEnhance: true,
            sharpen: true,
            claheClipLimit: 3.5,        // Strong local contrast
            claheTileSize: 8,
            textBoost: 1.8,             // Aggressive text darkening
            sharpenAmount: 0.5,         // Strong sharpening
            whitePaperTarget: 255       // Pure white paper
        });
    },

    /**
     * Photo mode - Light enhancement (preserve colors)
     */
    photoMode(canvas) {
        return this.enhance(canvas, {
            whiteBalance: false,
            clahe: true,
            textEnhance: false,
            sharpen: true,
            claheClipLimit: 1.5,
            sharpenAmount: 0.2
        });
    },

    /**
     * Whiteboard mode - Strong contrast for whiteboards
     */
    whiteboardMode(canvas) {
        return this.enhance(canvas, {
            whiteBalance: true,
            clahe: true,
            textEnhance: true,
            sharpen: false,
            claheClipLimit: 3.0,
            textBoost: 1.5,
            whitePaperTarget: 255
        });
    },

    /**
     * Book mode - Optimized for book pages
     */
    bookMode(canvas) {
        return this.enhance(canvas, {
            whiteBalance: true,
            clahe: true,
            textEnhance: true,
            sharpen: true,
            claheClipLimit: 2.5,
            textBoost: 1.4,
            sharpenAmount: 0.25
        });
    },

    // ═══════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Clone a canvas with willReadFrequently for better performance
     */
    cloneCanvas(source) {
        const clone = document.createElement('canvas');
        clone.width = source.width;
        clone.height = source.height;
        clone.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0);
        return clone;
    },

    /**
     * Get context with willReadFrequently optimization
     */
    getOptimizedContext(canvas) {
        return canvas.getContext('2d', { willReadFrequently: true });
    }
};
