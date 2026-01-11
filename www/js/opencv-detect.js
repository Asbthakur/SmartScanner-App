/**
 * OpenCV Detection Module v2.0
 * Production-grade with strict memory management
 * 
 * ROLE: Secondary detector + Edge validator for Heatmap
 * NOT the primary detector - Heatmap is primary
 * 
 * Features:
 * - Adaptive Canny thresholds for light backgrounds
 * - Strict Mat cleanup (no WASM memory leaks)
 * - Edge density validation for heatmap results
 * - Mobile-safe performance (reusable Mats)
 */

const OpenCVDetector = {
    
    // Reusable Mats (allocated once, reused each frame)
    _mats: {
        gray: null,
        blurred: null,
        edges: null,
        dilated: null
    },
    
    // Detection state
    _frameCount: 0,
    _lastCleanup: 0,
    
    /**
     * Check if OpenCV is ready
     */
    isReady() {
        return window.cvReady && typeof cv !== 'undefined' && typeof cv.Mat !== 'undefined';
    },

    /**
     * Initialize reusable Mats (call once after OpenCV loads)
     */
    init() {
        if (!this.isReady()) return false;
        
        try {
            // Pre-allocate reusable Mats
            this._mats.gray = new cv.Mat();
            this._mats.blurred = new cv.Mat();
            this._mats.edges = new cv.Mat();
            this._mats.dilated = new cv.Mat();
            console.log('✅ OpenCVDetector initialized');
            return true;
        } catch (err) {
            console.error('OpenCVDetector init failed:', err);
            return false;
        }
    },

    /**
     * Cleanup reusable Mats (call on app destroy)
     */
    destroy() {
        try {
            Object.values(this._mats).forEach(mat => mat?.delete());
            this._mats = { gray: null, blurred: null, edges: null, dilated: null };
            console.log('🧹 OpenCVDetector destroyed');
        } catch (err) {
            console.warn('OpenCVDetector destroy error:', err);
        }
    },

    /**
     * Main detection - tries adaptive methods
     * @param {ImageData} imageData 
     * @param {number} w - Width
     * @param {number} h - Height
     * @returns {Object|null} Corners {tl, tr, br, bl} or null
     */
    detect(imageData, w, h) {
        if (!this.isReady()) return null;
        
        this._frameCount++;
        
        let src = null;
        let contours = null;
        let hierarchy = null;
        
        try {
            // Create source Mat from imageData
            src = cv.matFromImageData(imageData);
            
            // Ensure reusable Mats exist
            if (!this._mats.gray) this.init();
            
            // Convert to grayscale (reuse Mat)
            cv.cvtColor(src, this._mats.gray, cv.COLOR_RGBA2GRAY);
            
            // FIX: Compute adaptive Canny thresholds based on image intensity
            const { low, high } = this._computeAdaptiveThresholds(this._mats.gray);
            
            // Gaussian blur (reuse Mat)
            cv.GaussianBlur(this._mats.gray, this._mats.blurred, new cv.Size(5, 5), 0);
            
            // Canny edge detection with adaptive thresholds (reuse Mat)
            cv.Canny(this._mats.blurred, this._mats.edges, low, high);
            
            // Dilate to connect nearby edges (reuse Mat)
            const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
            cv.dilate(this._mats.edges, this._mats.dilated, kernel);
            kernel.delete(); // FIX: Delete kernel
            
            // Find contours
            contours = new cv.MatVector();
            hierarchy = new cv.Mat();
            cv.findContours(this._mats.dilated, contours, hierarchy, 
                cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            
            // Find best quadrilateral
            const result = this._findBestQuad(contours, w, h);
            
            return result;
            
        } catch (err) {
            console.error('OpenCV detect error:', err);
            return null;
        } finally {
            // FIX: Strict cleanup - always delete non-reusable Mats
            src?.delete();
            contours?.delete();
            hierarchy?.delete();
        }
    },

    /**
     * NEW: Compute adaptive Canny thresholds based on median intensity
     * Critical for light backgrounds
     */
    _computeAdaptiveThresholds(grayMat) {
        try {
            // Compute mean intensity (faster than median)
            const mean = cv.mean(grayMat);
            const intensity = mean[0];
            
            // Adaptive thresholds based on intensity
            // Light images (high intensity) need lower thresholds
            // Dark images need higher thresholds
            let low, high;
            
            if (intensity > 180) {
                // Very light background - use very low thresholds
                low = 15;
                high = 45;
            } else if (intensity > 140) {
                // Light background
                low = 25;
                high = 75;
            } else if (intensity > 100) {
                // Medium background
                low = 40;
                high = 120;
            } else {
                // Dark background - standard thresholds
                low = 50;
                high = 150;
            }
            
            return { low, high, intensity };
            
        } catch (err) {
            // Fallback to standard thresholds
            return { low: 50, high: 150, intensity: 128 };
        }
    },

    /**
     * Find the best quadrilateral contour
     */
    _findBestQuad(contours, w, h) {
        const frameArea = w * h;
        const minArea = frameArea * (CONFIG?.DETECTION?.MIN_AREA_RATIO ?? 0.08);
        const maxArea = frameArea * (CONFIG?.DETECTION?.MAX_AREA_RATIO ?? 0.95);
        
        let bestQuad = null;
        let bestScore = 0;
        
        for (let i = 0; i < contours.size(); i++) {
            const contour = contours.get(i);
            const area = cv.contourArea(contour);
            
            // Skip too small or too large
            if (area < minArea || area > maxArea) continue;
            
            // Approximate to polygon
            const epsilon = (CONFIG?.DETECTION?.CONTOUR_APPROX_EPSILON ?? 0.02) * cv.arcLength(contour, true);
            const approx = new cv.Mat();
            
            try {
                cv.approxPolyDP(contour, approx, epsilon, true);
                
                // Must be a quadrilateral
                if (approx.rows === 4) {
                    // Score based on area (larger is better)
                    const score = area;
                    
                    if (score > bestScore) {
                        bestScore = score;
                        
                        // Extract corner points
                        const pts = [];
                        for (let j = 0; j < 4; j++) {
                            pts.push({
                                x: approx.data32S[j * 2],
                                y: approx.data32S[j * 2 + 1]
                            });
                        }
                        
                        bestQuad = this._orderCorners(pts);
                    }
                }
            } finally {
                approx.delete(); // FIX: Always delete approx
            }
        }
        
        return bestQuad;
    },

    /**
     * Order 4 points as {tl, tr, br, bl}
     */
    _orderCorners(pts) {
        // Find centroid
        const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
        const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
        
        // Sort by angle from centroid
        const withAngles = pts.map(p => ({
            ...p,
            angle: Math.atan2(p.y - cy, p.x - cx)
        }));
        withAngles.sort((a, b) => a.angle - b.angle);
        
        // Find top-left (smallest x + y)
        let tlIdx = 0;
        let minSum = Infinity;
        for (let i = 0; i < 4; i++) {
            const sum = withAngles[i].x + withAngles[i].y;
            if (sum < minSum) {
                minSum = sum;
                tlIdx = i;
            }
        }
        
        // Rotate so TL is first
        const ordered = [];
        for (let i = 0; i < 4; i++) {
            ordered.push(withAngles[(tlIdx + i) % 4]);
        }
        
        return {
            tl: { x: ordered[0].x, y: ordered[0].y },
            tr: { x: ordered[1].x, y: ordered[1].y },
            br: { x: ordered[2].x, y: ordered[2].y },
            bl: { x: ordered[3].x, y: ordered[3].y }
        };
    },

    // ════════════════════════════════════════════════════════════════════
    // NEW: EDGE DENSITY VALIDATION (for Heatmap verification)
    // ════════════════════════════════════════════════════════════════════

    /**
     * NEW: Validate heatmap result by checking edge density along quad edges
     * This is FAST - samples only the boundary, not the whole region
     * 
     * @param {Object} corners - Detected corners {tl, tr, br, bl}
     * @param {ImageData} imageData - Source image data
     * @param {number} w - Image width
     * @param {number} h - Image height
     * @returns {number} Edge density 0.0-1.0 (ratio of edge pixels found)
     */
    edgeDensity(corners, imageData, w, h) {
        if (!this.isReady() || !corners) return 1.0;
        
        let src = null;
        
        try {
            src = cv.matFromImageData(imageData);
            
            // Ensure reusable Mats exist
            if (!this._mats.gray) this.init();
            
            // Convert to grayscale
            cv.cvtColor(src, this._mats.gray, cv.COLOR_RGBA2GRAY);
            
            // Compute adaptive thresholds
            const { low, high } = this._computeAdaptiveThresholds(this._mats.gray);
            
            // Blur and detect edges
            cv.GaussianBlur(this._mats.gray, this._mats.blurred, new cv.Size(3, 3), 0);
            cv.Canny(this._mats.blurred, this._mats.edges, low, high);
            
            // Sample edges along the 4 sides of the quadrilateral
            let edgePixels = 0;
            let totalSamples = 0;
            const sampleStep = 4; // Sample every 4 pixels for speed
            
            // Helper to sample along a line
            const sampleLine = (p1, p2) => {
                const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
                const steps = Math.max(1, Math.floor(dist / sampleStep));
                
                for (let i = 0; i <= steps; i++) {
                    const t = steps > 0 ? i / steps : 0;
                    const x = Math.round(p1.x + t * (p2.x - p1.x));
                    const y = Math.round(p1.y + t * (p2.y - p1.y));
                    
                    if (x >= 0 && x < w && y >= 0 && y < h) {
                        // Check 3x3 neighborhood for edge pixel
                        let hasEdge = false;
                        for (let dy = -2; dy <= 2 && !hasEdge; dy++) {
                            for (let dx = -2; dx <= 2 && !hasEdge; dx++) {
                                const nx = x + dx, ny = y + dy;
                                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                                    if (this._mats.edges.ucharAt(ny, nx) > 0) {
                                        hasEdge = true;
                                    }
                                }
                            }
                        }
                        if (hasEdge) edgePixels++;
                        totalSamples++;
                    }
                }
            };
            
            // Sample all 4 edges
            sampleLine(corners.tl, corners.tr); // Top
            sampleLine(corners.tr, corners.br); // Right
            sampleLine(corners.br, corners.bl); // Bottom
            sampleLine(corners.bl, corners.tl); // Left
            
            const density = totalSamples > 0 ? edgePixels / totalSamples : 0;
            
            return density;
            
        } catch (err) {
            console.warn('Edge density check failed:', err);
            return 1.0; // Assume valid on error
        } finally {
            // FIX: Strict cleanup
            src?.delete();
        }
    },

    /**
     * NEW: Quick edge validation - returns true/false
     * @param {Object} corners - Detected corners
     * @param {ImageData} imageData - Source image data
     * @param {number} w - Image width
     * @param {number} h - Image height
     * @param {number} minDensity - Minimum density threshold (default from config)
     * @returns {boolean} True if edges are valid
     */
    validateEdges(corners, imageData, w, h, minDensity) {
        const threshold = minDensity ?? CONFIG?.DETECTION?.MIN_EDGE_DENSITY ?? 0.15;
        const density = this.edgeDensity(corners, imageData, w, h);
        const valid = density >= threshold;
        
        if (!valid) {
            console.log(`⚠️ Edge validation failed: density=${density.toFixed(2)} < ${threshold}`);
        }
        
        return valid;
    }
};
