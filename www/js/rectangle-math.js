/**
 * Rectangle Math Stabilization Layer
 * Sits ABOVE OpenCV + Heatmap detection
 * Enforces clean rectangles with temporal smoothing
 * 
 * Pipeline position:
 *   OpenCV/Heatmap detect → RectangleMath.process() → Stabilizer → UI
 */

const RectangleMath = {
    
    // ============================================
    // CONFIGURATION
    // ============================================
    
    CONFIG: {
        // Perspective-aware quadrilateral constraints
        // (NOT strict rectangle - allows camera angle distortion)
        ANGLE_MIN: 30,              // Minimum internal angle (allows steep perspective)
        ANGLE_MAX: 150,             // Maximum internal angle (allows steep perspective)
        ANGLE_SUM_MIN: 355,         // Minimum sum of all angles (should be ~360)
        ANGLE_SUM_MAX: 365,         // Maximum sum of all angles
        ASPECT_RATIO_MIN: 0.3,      // Minimum width/height ratio (after perspective)
        ASPECT_RATIO_MAX: 3.0,      // Maximum width/height ratio (after perspective)
        VANISHING_POINT_TOLERANCE: 0.5,  // Tolerance for perspective convergence
        
        // Parallel edge ratio limits (KEY FOR REJECTING FALSE DETECTIONS)
        // Ratio = longer_side / shorter_side of parallel edges
        // TUNED: Was 1.5, now 1.8 for better white background tolerance
        PARALLEL_RATIO_PREVIEW: 1.8,    // Looser for live preview
        PARALLEL_RATIO_CAPTURE: 2.0,    // Looser for final capture
        PARALLEL_RATIO_BOOK: 2.5,       // Books have more curve/perspective
        
        // Temporal smoothing (EMA) - DUAL ALPHA SYSTEM
        // TUNED: Was 0.90, now 0.75 for faster response when locked
        SMOOTHING_ALPHA_LOCKED: 0.75,   // Faster smoothing when locked
        SMOOTHING_ALPHA_UNLOCKED: 0.50, // Fast smoothing when unlocked (responsive)
        
        // Movement gating
        JITTER_THRESHOLD: 6,        // Pixels - ignore movement below this
        
        // Stability lock - FASTER UNLOCK
        // TUNED: Was 25/3, now 15/2 for easier unlock
        STABLE_FRAMES_REQUIRED: 8,  // Frames to lock (keep strict)
        UNLOCK_MOVEMENT: 15,        // Pixels to trigger unlock (easier unlock)
        UNLOCK_FRAMES: 2,           // Frames of movement to unlock (faster response)
        
        // Rectangle fitting
        MIN_CONFIDENCE: 0.3,        // Minimum corner confidence for fitting
    },
    
    // Current mode: 'preview' or 'capture'
    mode: 'preview',
    
    // ============================================
    // STATE
    // ============================================
    
    state: {
        smoothedCorners: null,      // EMA-smoothed corners
        previousGatedCorners: null, // Last gated corners (for movement gating)
        stableFrameCount: 0,        // Consecutive stable frames
        unlockFrameCount: 0,        // Consecutive frames with significant movement
        lockedRectangle: null,      // Locked rectangle (when stable)
        isLocked: false,
        frameHistory: [],           // Last N frames for analysis
        lastRejectReason: null,     // DEBUG: Why was last detection rejected?
        rejectCount: 0,             // DEBUG: Count of consecutive rejections
    },
    
    // ============================================
    // MAIN ENTRY POINT
    // ============================================
    
    /**
     * Process detected corners through stabilization pipeline
     * Call this AFTER OpenCV/Heatmap detection, BEFORE Stabilizer
     * 
     * IMPORTANT: Returns FINAL_CORNERS - the single source of truth
     * ALL rendering (lines + dots) must use ONLY these corners
     * 
     * Pipeline (SIMPLIFIED):
     *   ensureOrdered → validate → smooth → gate → lock → ensureOrdered (final)
     * 
     * @param {Object|null} rawCorners - Raw detected corners {tl, tr, br, bl}
     * @param {number} frameWidth - Frame width for validation
     * @param {number} frameHeight - Frame height for validation
     * @param {string} mode - 'preview' (strict) or 'capture' (looser)
     * @returns {Object|null} FINAL ordered corners or null
     */
    process(rawCorners, frameWidth, frameHeight, mode = 'preview') {
        // Set current mode
        this.mode = mode;
        
        // Clear reject reason at start of each frame
        this.state.lastRejectReason = null;
        
        // Step 1: If no detection, handle gracefully
        if (!rawCorners) {
            this.state.lastRejectReason = 'no_detection';
            return this.handleNoDetection();
        }
        
        // Step 2: Ensure input corners are properly ordered ONCE at start
        // IMPORTANT: This is the ONLY place we order corners
        // Once smoothing begins, corner identity must remain fixed
        let corners = this.ensureOrdered(rawCorners);
        if (!corners) {
            this.state.lastRejectReason = 'invalid_corners_structure';
            this.state.rejectCount++;
            return this.handleInvalidDetection();
        }
        
        // Step 3: Validate rectangle geometry
        corners = this.validateAndCorrect(corners, frameWidth, frameHeight);
        if (!corners) {
            // lastRejectReason is set inside validateAndCorrect
            this.state.rejectCount++;
            return this.handleInvalidDetection();
        }
        
        // Reset reject count on success
        this.state.rejectCount = 0;
        
        // Step 4: Apply temporal smoothing (EMA)
        // After this point, DO NOT reorder corners - identity is fixed
        corners = this.applyTemporalSmoothing(corners);
        
        // Step 5: Apply movement gating (anti-jitter)
        corners = this.applyMovementGating(corners);
        
        // Step 6: Update stability lock
        corners = this.updateStabilityLock(corners);
        
        // NO final ensureOrdered() here - corner identity must stay fixed after smoothing
        // Re-ordering after smoothing causes floating dots and corner identity swaps
        
        return corners;
    },
    
    // ============================================
    // 1. RECTANGLE VALIDITY CONSTRAINTS
    // ============================================
    
    /**
     * Validate quadrilateral geometry (perspective-aware)
     * Accepts trapezoids/parallelograms from angled camera
     * 
     * HARD REJECT only for:
     * - Non-convex shapes
     * - Extreme side ratios
     * - Degenerate/tiny shapes
     * - Triangle-like shapes (one side much smaller than others)
     * 
     * Sets this.state.lastRejectReason for debugging
     */
    validateAndCorrect(corners, frameW, frameH) {
        // First, check basic validity
        if (!this.hasValidCorners(corners)) {
            this.state.lastRejectReason = 'invalid_corners';
            return null;
        }
        
        // HARD RULE 1: Must be convex quadrilateral
        if (!this.isConvex(corners)) {
            this.state.lastRejectReason = 'not_convex';
            console.log('❌ Rejected: not convex');
            return null;
        }
        
        // HARD RULE 2: Check parallel edge ratios (KEY CHECK!)
        const parallelCheck = this.checkParallelEdgeRatioWithDetails(corners);
        if (!parallelCheck.valid) {
            this.state.lastRejectReason = `parallel_ratio (h:${parallelCheck.horizRatio.toFixed(2)}, v:${parallelCheck.vertRatio.toFixed(2)}, max:${parallelCheck.maxAllowed})`;
            console.log('❌ Rejected: parallel ratio bad', parallelCheck);
            return null;
        }
        
        // HARD RULE 3: Check minimum area (not degenerate)
        const area = this.quadArea(corners);
        const frameArea = frameW * frameH;
        const areaRatio = area / frameArea;
        if (areaRatio < 0.01) {  // Less than 1% of frame
            this.state.lastRejectReason = `area_too_small (${(areaRatio * 100).toFixed(1)}%)`;
            console.log('❌ Rejected: area too small', (areaRatio * 100).toFixed(1) + '%');
            return null;
        }
        
        // HARD RULE 4: No triangle-like shapes (all sides must be reasonable)
        const sides = this.getSideLengths(corners);
        const maxSide = Math.max(...sides);
        const minSide = Math.min(...sides);
        const sideRatio = minSide / maxSide;
        if (sideRatio < 0.15) {  // One side is less than 15% of longest
            this.state.lastRejectReason = `triangle_shape (ratio:${sideRatio.toFixed(2)})`;
            console.log('❌ Rejected: triangle-like shape (min/max ratio:', sideRatio.toFixed(2), ')');
            return null;
        }
        
        // HARD RULE 5: All corners must be inside frame (with margin)
        const margin = Math.min(frameW, frameH) * 0.05; // 5% margin
        const pts = [corners.tl, corners.tr, corners.br, corners.bl];
        for (const p of pts) {
            if (p.x < -margin || p.x > frameW + margin || 
                p.y < -margin || p.y > frameH + margin) {
                this.state.lastRejectReason = `corner_outside_frame (${p.x.toFixed(0)},${p.y.toFixed(0)})`;
                console.log('❌ Rejected: corner outside frame', p);
                return null;
            }
        }
        
        // SOFT CHECK: Angles (use for info, NOT rejection unless extreme)
        const angles = this.calculateInternalAngles(corners);
        
        // Only reject for EXTREME angle violations (triangle-like)
        // Loosened to 6/174 to allow steep perspective on long documents
        const hasExtremeAngle = angles.some(a => a < 6 || a > 174);
        if (hasExtremeAngle) {
            this.state.lastRejectReason = `extreme_angle (${angles.map(a => a.toFixed(0)).join(',')})`;
            console.log('❌ Rejected: extreme angle detected', angles.map(a => a.toFixed(0)));
            return null;
        }
        
        // Return corners as-is (passed hard rules)
        return corners;
    },
    
    /**
     * Check parallel edge ratio with detailed info for debugging
     */
    checkParallelEdgeRatioWithDetails(c) {
        const topWidth = this.distance(c.tl, c.tr);
        const bottomWidth = this.distance(c.bl, c.br);
        const leftHeight = this.distance(c.tl, c.bl);
        const rightHeight = this.distance(c.tr, c.br);
        
        const horizRatio = Math.max(topWidth, bottomWidth) / Math.min(topWidth, bottomWidth);
        const vertRatio = Math.max(leftHeight, rightHeight) / Math.min(leftHeight, rightHeight);
        
        const maxAllowed = this.getMaxParallelRatio();
        const valid = horizRatio <= maxAllowed && vertRatio <= maxAllowed;
        
        return { valid, horizRatio, vertRatio, maxAllowed, topWidth, bottomWidth, leftHeight, rightHeight };
    },
    
    /**
     * Get all 4 side lengths
     */
    getSideLengths(c) {
        return [
            this.distance(c.tl, c.tr),  // top
            this.distance(c.tr, c.br),  // right
            this.distance(c.br, c.bl),  // bottom
            this.distance(c.bl, c.tl)   // left
        ];
    },
    
    /**
     * Calculate all 4 internal angles of quadrilateral
     */
    calculateInternalAngles(c) {
        const pts = [c.tl, c.tr, c.br, c.bl];
        const angles = [];
        
        for (let i = 0; i < 4; i++) {
            const p1 = pts[(i + 3) % 4];  // Previous point
            const p2 = pts[i];             // Current point (vertex)
            const p3 = pts[(i + 1) % 4];  // Next point
            
            // Vectors from vertex to neighbors
            const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
            const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
            
            // Angle using dot product
            const dot = v1.x * v2.x + v1.y * v2.y;
            const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
            const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
            
            let angle = Math.acos(dot / (mag1 * mag2)) * (180 / Math.PI);
            angles.push(angle);
        }
        
        return angles;
    },
    
    /**
     * Full quadrilateral validation (perspective-aware)
     * Renamed but keeping old name for compatibility
     */
    isValidRectangle(corners, frameW, frameH) {
        return this.isValidQuadrilateral(corners, frameW, frameH);
    },
    
    /**
     * Check aspect ratio is within valid range
     */
    checkAspectRatio(c) {
        const topWidth = this.distance(c.tl, c.tr);
        const botWidth = this.distance(c.bl, c.br);
        const leftHeight = this.distance(c.tl, c.bl);
        const rightHeight = this.distance(c.tr, c.br);
        
        const avgWidth = (topWidth + botWidth) / 2;
        const avgHeight = (leftHeight + rightHeight) / 2;
        
        const ratio = avgWidth / avgHeight;
        
        return ratio >= this.CONFIG.ASPECT_RATIO_MIN && 
               ratio <= this.CONFIG.ASPECT_RATIO_MAX;
    },
    
    /**
     * Check parallel edge ratio (KEY VALIDATION!)
     * 
     * For a real rectangle viewed at ANY camera angle:
     * - Parallel sides stay parallel
     * - Parallel sides have SIMILAR lengths (ratio close to 1.0)
     * 
     * Corner convention:
     *   TL ●────────────● TR
     *      │            │
     *      │            │
     *   BL ●────────────● BR
     * 
     * @param {Object} c - Corners {tl, tr, br, bl}
     * @returns {boolean} True if parallel edge ratios are valid
     */
    checkParallelEdgeRatio(c) {
        // Horizontal edges (top and bottom - should be parallel)
        const topWidth    = this.distance(c.tl, c.tr);
        const bottomWidth = this.distance(c.bl, c.br);
        
        // Vertical edges (left and right - should be parallel)
        const leftHeight  = this.distance(c.tl, c.bl);
        const rightHeight = this.distance(c.tr, c.br);
        
        // Calculate ratios (always >= 1.0)
        const horizRatio = Math.max(topWidth, bottomWidth) / 
                           Math.min(topWidth, bottomWidth);
        const vertRatio  = Math.max(leftHeight, rightHeight) / 
                           Math.min(leftHeight, rightHeight);
        
        // Get max allowed ratio based on current mode
        const maxRatio = this.getMaxParallelRatio();
        
        // Both ratios must be within limit
        const isValid = horizRatio <= maxRatio && vertRatio <= maxRatio;
        
        // Debug logging (remove in production)
        if (!isValid) {
            console.log(`⚠️ Parallel ratio check FAILED:`, {
                topWidth: topWidth.toFixed(1),
                bottomWidth: bottomWidth.toFixed(1),
                horizRatio: horizRatio.toFixed(2),
                leftHeight: leftHeight.toFixed(1),
                rightHeight: rightHeight.toFixed(1),
                vertRatio: vertRatio.toFixed(2),
                maxAllowed: maxRatio,
                mode: this.mode
            });
        }
        
        return isValid;
    },
    
    /**
     * Get maximum allowed parallel edge ratio based on current mode
     */
    getMaxParallelRatio() {
        switch (this.mode) {
            case 'capture':
                return this.CONFIG.PARALLEL_RATIO_CAPTURE;
            case 'book':
                return this.CONFIG.PARALLEL_RATIO_BOOK;
            case 'preview':
            default:
                return this.CONFIG.PARALLEL_RATIO_PREVIEW;
        }
    },
    
    /**
     * Set detection mode
     * @param {string} mode - 'preview', 'capture', or 'book'
     */
    setMode(mode) {
        if (['preview', 'capture', 'book'].includes(mode)) {
            this.mode = mode;
        }
    },
    
    /**
     * Check if quadrilateral is convex
     */
    isConvex(c) {
        const pts = [c.tl, c.tr, c.br, c.bl];
        let sign = 0;
        
        for (let i = 0; i < 4; i++) {
            const p1 = pts[i];
            const p2 = pts[(i + 1) % 4];
            const p3 = pts[(i + 2) % 4];
            
            const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
            
            if (cross !== 0) {
                const newSign = cross > 0 ? 1 : -1;
                if (sign === 0) {
                    sign = newSign;
                } else if (newSign !== sign) {
                    return false;
                }
            }
        }
        return true;
    },
    
    /**
     * Check perspective validity using vanishing point analysis
     * For a rectangle viewed at an angle:
     * - Top/bottom edges should converge to same vanishing point (or be parallel)
     * - Left/right edges should converge to same vanishing point (or be parallel)
     */
    checkPerspectiveValidity(c) {
        // Get edge directions
        const topDir = { x: c.tr.x - c.tl.x, y: c.tr.y - c.tl.y };
        const botDir = { x: c.br.x - c.bl.x, y: c.br.y - c.bl.y };
        const leftDir = { x: c.bl.x - c.tl.x, y: c.bl.y - c.tl.y };
        const rightDir = { x: c.br.x - c.tr.x, y: c.br.y - c.tr.y };
        
        // Check horizontal edges (top/bottom)
        // They should either be parallel OR converge consistently
        const horizValid = this.edgesConvergeConsistently(
            c.tl, topDir, c.bl, botDir
        );
        
        // Check vertical edges (left/right)
        const vertValid = this.edgesConvergeConsistently(
            c.tl, leftDir, c.tr, rightDir
        );
        
        return horizValid && vertValid;
    },
    
    /**
     * Check if two edges converge consistently (perspective) or are parallel
     */
    edgesConvergeConsistently(p1, dir1, p2, dir2) {
        // Normalize directions
        const len1 = Math.sqrt(dir1.x * dir1.x + dir1.y * dir1.y);
        const len2 = Math.sqrt(dir2.x * dir2.x + dir2.y * dir2.y);
        
        if (len1 < 1 || len2 < 1) return false;
        
        const n1 = { x: dir1.x / len1, y: dir1.y / len1 };
        const n2 = { x: dir2.x / len2, y: dir2.y / len2 };
        
        // Calculate angle between directions
        const dot = n1.x * n2.x + n1.y * n2.y;
        const angle = Math.acos(Math.min(1, Math.abs(dot))) * (180 / Math.PI);
        
        // Parallel (angle < 15°) is always valid
        if (angle < 15) return true;
        
        // For converging lines, check they converge on same side
        // Cross product tells us rotation direction
        const cross = n1.x * n2.y - n1.y * n2.x;
        
        // Allow convergence up to tolerance
        return angle < 45; // Allow up to 45° convergence for steep camera angles
    },
    
    /**
     * Check aspect ratio considering perspective distortion
     * Estimates what the rectangle would look like if viewed straight-on
     */
    checkPerspectiveAspectRatio(c) {
        // For perspective-distorted rectangle:
        // Use the average of parallel sides to estimate true dimensions
        const topWidth = this.distance(c.tl, c.tr);
        const botWidth = this.distance(c.bl, c.br);
        const leftHeight = this.distance(c.tl, c.bl);
        const rightHeight = this.distance(c.tr, c.br);
        
        // The "closer" side appears larger due to perspective
        // Use geometric mean for better estimate
        const estWidth = Math.sqrt(topWidth * botWidth);
        const estHeight = Math.sqrt(leftHeight * rightHeight);
        
        const ratio = estWidth / estHeight;
        
        return ratio >= this.CONFIG.ASPECT_RATIO_MIN && 
               ratio <= this.CONFIG.ASPECT_RATIO_MAX;
    },
    
    /**
     * Check if quadrilateral is valid (perspective-aware)
     */
    isValidQuadrilateral(corners, frameW, frameH) {
        if (!this.hasValidCorners(corners)) return false;
        
        // Check bounds
        const pts = [corners.tl, corners.tr, corners.br, corners.bl];
        for (const p of pts) {
            if (p.x < 0 || p.x > frameW || p.y < 0 || p.y > frameH) {
                return false;
            }
        }
        
        // Check convexity
        if (!this.isConvex(corners)) return false;
        
        // Check angles (perspective-aware: 30°-150°)
        const angles = this.calculateInternalAngles(corners);
        if (!angles.every(a => a >= this.CONFIG.ANGLE_MIN && a <= this.CONFIG.ANGLE_MAX)) {
            return false;
        }
        
        // Check angle sum (~360°)
        const angleSum = angles.reduce((a, b) => a + b, 0);
        if (angleSum < this.CONFIG.ANGLE_SUM_MIN || angleSum > this.CONFIG.ANGLE_SUM_MAX) {
            return false;
        }
        
        // Check parallel edge ratio (KEY CHECK!)
        if (!this.checkParallelEdgeRatio(corners)) {
            return false;
        }
        
        // Check perspective aspect ratio
        if (!this.checkPerspectiveAspectRatio(corners)) {
            return false;
        }
        
        return true;
    },
    
    /**
     * Check if angles are close enough to attempt gentle correction
     */
    canGentleCorrect(angles) {
        // Allow correction if all angles are within 20-160 degrees
        // and sum is close to 360
        const angleSum = angles.reduce((a, b) => a + b, 0);
        return angles.every(a => a >= 20 && a <= 160) &&
               angleSum >= 340 && angleSum <= 380;
    },
    
    /**
     * Apply gentle perspective-preserving correction
     * Smooths out noise while preserving the perspective shape
     */
    gentlePerspectiveCorrection(corners) {
        // Find centroid
        const cx = (corners.tl.x + corners.tr.x + corners.br.x + corners.bl.x) / 4;
        const cy = (corners.tl.y + corners.tr.y + corners.br.y + corners.bl.y) / 4;
        
        // Calculate vectors from centroid to each corner
        const vectors = {
            tl: { x: corners.tl.x - cx, y: corners.tl.y - cy },
            tr: { x: corners.tr.x - cx, y: corners.tr.y - cy },
            br: { x: corners.br.x - cx, y: corners.br.y - cy },
            bl: { x: corners.bl.x - cx, y: corners.bl.y - cy }
        };
        
        // For a proper quadrilateral, opposite corners should be roughly opposite
        // TL-BR and TR-BL should point in opposite directions
        
        // Average the opposite pairs to reduce noise
        const avgTLBR = {
            x: (vectors.tl.x - vectors.br.x) / 2,
            y: (vectors.tl.y - vectors.br.y) / 2
        };
        const avgTRBL = {
            x: (vectors.tr.x - vectors.bl.x) / 2,
            y: (vectors.tr.y - vectors.bl.y) / 2
        };
        
        // Reconstruct corners
        return {
            tl: { x: cx + avgTLBR.x, y: cy + avgTLBR.y },
            tr: { x: cx + avgTRBL.x, y: cy + avgTRBL.y },
            br: { x: cx - avgTLBR.x, y: cy - avgTLBR.y },
            bl: { x: cx - avgTRBL.x, y: cy - avgTRBL.y }
        };
    },
    
    // ============================================
    // 2. RECTANGLE FITTING (minAreaRect equivalent)
    // ============================================
    
    /**
     * Fit minimum area rectangle to 4 points
     * Pure JS implementation of OpenCV's minAreaRect
     */
    fitMinAreaRect(corners) {
        const pts = [corners.tl, corners.tr, corners.br, corners.bl];
        
        // Find centroid
        const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
        const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
        
        // Try rotations from -45 to 45 degrees to find minimum area
        let bestAngle = 0;
        let bestArea = Infinity;
        let bestRect = null;
        
        for (let angle = -45; angle <= 45; angle += 1) {
            const rad = angle * Math.PI / 180;
            
            // Rotate points around centroid
            const rotated = pts.map(p => ({
                x: Math.cos(rad) * (p.x - cx) - Math.sin(rad) * (p.y - cy) + cx,
                y: Math.sin(rad) * (p.x - cx) + Math.cos(rad) * (p.y - cy) + cy
            }));
            
            // Find bounding box
            const minX = Math.min(...rotated.map(p => p.x));
            const maxX = Math.max(...rotated.map(p => p.x));
            const minY = Math.min(...rotated.map(p => p.y));
            const maxY = Math.max(...rotated.map(p => p.y));
            
            const area = (maxX - minX) * (maxY - minY);
            
            if (area < bestArea) {
                bestArea = area;
                bestAngle = angle;
                bestRect = { minX, maxX, minY, maxY, angle };
            }
        }
        
        if (!bestRect) return null;
        
        // Convert best bounding box back to corners
        const rad = -bestRect.angle * Math.PI / 180;
        const rectCorners = [
            { x: bestRect.minX, y: bestRect.minY },
            { x: bestRect.maxX, y: bestRect.minY },
            { x: bestRect.maxX, y: bestRect.maxY },
            { x: bestRect.minX, y: bestRect.maxY }
        ];
        
        // Rotate back
        const finalCorners = rectCorners.map(p => ({
            x: Math.cos(rad) * (p.x - cx) - Math.sin(rad) * (p.y - cy) + cx,
            y: Math.sin(rad) * (p.x - cx) + Math.cos(rad) * (p.y - cy) + cy
        }));
        
        // Sort to TL, TR, BR, BL
        return this.sortCorners(finalCorners);
    },
    
    // ============================================
    // 3. PARTIAL RECTANGLE COMPLETION
    // ============================================
    
    /**
     * Complete rectangle when only 2-3 corners are reliable
     * Uses perpendicular vector math
     */
    completePartialRectangle(corners, angles) {
        // Find which corners have bad angles (likely wrong position)
        const badIndices = [];
        const keys = ['tl', 'tr', 'br', 'bl'];
        
        angles.forEach((angle, i) => {
            if (angle < this.CONFIG.ANGLE_MIN - 10 || angle > this.CONFIG.ANGLE_MAX + 10) {
                badIndices.push(i);
            }
        });
        
        // If more than 1 bad corner, can't reliably complete
        if (badIndices.length !== 1) {
            return null;
        }
        
        // Complete single bad corner using parallelogram property
        // For a rectangle: TL + BR = TR + BL (diagonals bisect each other)
        const badKey = keys[badIndices[0]];
        const completed = { ...corners };
        
        switch (badKey) {
            case 'tl':
                // TL = TR + BL - BR
                completed.tl = {
                    x: corners.tr.x + corners.bl.x - corners.br.x,
                    y: corners.tr.y + corners.bl.y - corners.br.y
                };
                break;
            case 'tr':
                // TR = TL + BR - BL
                completed.tr = {
                    x: corners.tl.x + corners.br.x - corners.bl.x,
                    y: corners.tl.y + corners.br.y - corners.bl.y
                };
                break;
            case 'br':
                // BR = TR + BL - TL
                completed.br = {
                    x: corners.tr.x + corners.bl.x - corners.tl.x,
                    y: corners.tr.y + corners.bl.y - corners.tl.y
                };
                break;
            case 'bl':
                // BL = TL + BR - TR
                completed.bl = {
                    x: corners.tl.x + corners.br.x - corners.tr.x,
                    y: corners.tl.y + corners.br.y - corners.tr.y
                };
                break;
        }
        
        return completed;
    },
    
    /**
     * Check if angles are close enough to attempt force correction
     * Now uses gentlePerspectiveCorrection instead
     */
    canForceCorrect(angles) {
        return this.canGentleCorrect(angles);
    },
    
    /**
     * Force rectangle correction - now uses gentle perspective correction
     */
    forceRectangleCorrection(corners) {
        return this.gentlePerspectiveCorrection(corners);
    },
    
    // ============================================
    // 4. TEMPORAL SMOOTHING (EMA)
    // ============================================
    
    /**
     * Apply exponential moving average to corners
     * Uses different alpha based on lock state:
     * - LOCKED: slow smoothing (stable overlay)
     * - UNLOCKED: fast smoothing (responsive to movement)
     */
    applyTemporalSmoothing(newCorners) {
        if (!this.state.smoothedCorners) {
            // First frame - no smoothing
            this.state.smoothedCorners = this.cloneCorners(newCorners);
            return newCorners;
        }
        
        // Use different alpha based on lock state
        const alpha = this.state.isLocked 
            ? this.CONFIG.SMOOTHING_ALPHA_LOCKED 
            : this.CONFIG.SMOOTHING_ALPHA_UNLOCKED;
        
        const prev = this.state.smoothedCorners;
        
        const smoothed = {
            tl: this.smoothPoint(prev.tl, newCorners.tl, alpha),
            tr: this.smoothPoint(prev.tr, newCorners.tr, alpha),
            br: this.smoothPoint(prev.br, newCorners.br, alpha),
            bl: this.smoothPoint(prev.bl, newCorners.bl, alpha)
        };
        
        this.state.smoothedCorners = smoothed;
        return smoothed;
    },
    
    /**
     * Smooth single point using EMA
     */
    smoothPoint(prev, next, alpha) {
        return {
            x: alpha * prev.x + (1 - alpha) * next.x,
            y: alpha * prev.y + (1 - alpha) * next.y
        };
    },
    
    // ============================================
    // 5. MOVEMENT GATING (Anti-Jitter)
    // ============================================
    
    /**
     * Ignore small movements to prevent micro-jitter
     * IMPORTANT: This operates on already-smoothed corners
     * Compares current smoothed position to previous smoothed position
     */
    applyMovementGating(corners) {
        // corners here are already smoothed (from applyTemporalSmoothing)
        
        if (!this.state.previousGatedCorners) {
            // First frame - initialize with smoothed corners
            this.state.previousGatedCorners = this.cloneCorners(corners);
            return corners;
        }
        
        // Calculate average movement between previous gated and current smoothed
        const movement = this.averageCornerMovement(
            this.state.previousGatedCorners, 
            corners
        );
        
        // If movement is below threshold, keep previous gated corners
        // This prevents micro-jitter
        if (movement < this.CONFIG.JITTER_THRESHOLD) {
            return this.state.previousGatedCorners;
        }
        
        // Movement is significant, update previous gated corners
        this.state.previousGatedCorners = this.cloneCorners(corners);
        return corners;
    },
    
    /**
     * Calculate average movement between two corner sets
     */
    averageCornerMovement(c1, c2) {
        let total = 0;
        for (const key of ['tl', 'tr', 'br', 'bl']) {
            total += this.distance(c1[key], c2[key]);
        }
        return total / 4;
    },
    
    // ============================================
    // 6. STABILITY LOCK
    // ============================================
    
    /**
     * Lock rectangle when stable for N consecutive frames
     * FAST UNLOCK when camera moves
     */
    updateStabilityLock(corners) {
        // If currently locked
        if (this.state.isLocked && this.state.lockedRectangle) {
            // Check if significant movement to unlock
            const movement = this.averageCornerMovement(
                this.state.lockedRectangle, 
                corners
            );
            
            if (movement > this.CONFIG.UNLOCK_MOVEMENT) {
                // Count frames with significant movement
                this.state.unlockFrameCount++;
                
                // FAST UNLOCK: Only need UNLOCK_FRAMES consecutive movement frames
                if (this.state.unlockFrameCount >= this.CONFIG.UNLOCK_FRAMES) {
                    // Unlock immediately!
                    this.state.isLocked = false;
                    this.state.lockedRectangle = null;
                    this.state.stableFrameCount = 0;
                    this.state.unlockFrameCount = 0;
                    
                    // Reset smoothed corners to current for fast response
                    this.state.smoothedCorners = this.cloneCorners(corners);
                    
                    console.log('🔓 UNLOCKED - camera moved');
                    return corners;
                }
            } else {
                // No significant movement - reset unlock counter
                this.state.unlockFrameCount = 0;
            }
            
            // Still locked - return locked rectangle
            return this.state.lockedRectangle;
        }
        
        // Not locked - count stable frames
        if (this.state.previousCorners) {
            const movement = this.averageCornerMovement(
                this.state.previousCorners, 
                corners
            );
            
            if (movement < this.CONFIG.JITTER_THRESHOLD * 2) {
                this.state.stableFrameCount++;
            } else {
                this.state.stableFrameCount = Math.max(0, this.state.stableFrameCount - 2);
            }
        } else {
            this.state.stableFrameCount = 1;
        }
        
        // Update previous corners
        this.state.previousCorners = this.cloneCorners(corners);
        
        // Check if should lock
        if (this.state.stableFrameCount >= this.CONFIG.STABLE_FRAMES_REQUIRED) {
            this.state.isLocked = true;
            this.state.lockedRectangle = this.cloneCorners(corners);
            this.state.unlockFrameCount = 0;
            console.log('🔒 LOCKED - stable for', this.CONFIG.STABLE_FRAMES_REQUIRED, 'frames');
            return this.state.lockedRectangle;
        }
        
        return corners;
    },
    
    // ============================================
    // HANDLE MISSING/INVALID DETECTION
    // ============================================
    
    /**
     * Handle frame with no detection
     */
    handleNoDetection() {
        // If locked, keep showing locked rectangle briefly
        if (this.state.isLocked && this.state.lockedRectangle) {
            // Could add timeout here to eventually unlock
            return this.state.lockedRectangle;
        }
        
        // Decay stable count
        this.state.stableFrameCount = Math.max(0, this.state.stableFrameCount - 1);
        
        return null;
    },
    
    /**
     * Handle invalid detection (failed validation)
     */
    handleInvalidDetection() {
        // If we have smoothed corners, use them with decay
        if (this.state.smoothedCorners && this.state.stableFrameCount > 2) {
            this.state.stableFrameCount--;
            return this.state.smoothedCorners;
        }
        
        return this.handleNoDetection();
    },
    
    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    
    /**
     * Check if corners object has valid structure
     */
    hasValidCorners(c) {
        if (!c) return false;
        const keys = ['tl', 'tr', 'br', 'bl'];
        return keys.every(k => 
            c[k] && 
            typeof c[k].x === 'number' && 
            typeof c[k].y === 'number' &&
            !isNaN(c[k].x) && 
            !isNaN(c[k].y)
        );
    },
    
    /**
     * Full rectangle validation
     */
    isValidRectangle(corners, frameW, frameH) {
        if (!this.hasValidCorners(corners)) return false;
        
        // Check bounds
        const pts = [corners.tl, corners.tr, corners.br, corners.bl];
        for (const p of pts) {
            if (p.x < 0 || p.x > frameW || p.y < 0 || p.y > frameH) {
                return false;
            }
        }
        
        // Check angles
        const angles = this.calculateInternalAngles(corners);
        if (!angles.every(a => a >= this.CONFIG.ANGLE_MIN && a <= this.CONFIG.ANGLE_MAX)) {
            return false;
        }
        
        // Check aspect ratio
        if (!this.checkAspectRatio(corners)) {
            return false;
        }
        
        return true;
    },
    
    /**
     * Distance between two points
     */
    distance(p1, p2) {
        return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    },
    
    /**
     * Calculate quadrilateral area using shoelace formula
     * @param {Object} c - Corners {tl, tr, br, bl}
     * @returns {number} Area in square pixels
     */
    quadArea(c) {
        const pts = [c.tl, c.tr, c.br, c.bl];
        let area = 0;
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            area += pts[i].x * pts[j].y;
            area -= pts[j].x * pts[i].y;
        }
        return Math.abs(area) / 2;
    },
    
    /**
     * Clone corners object
     */
    cloneCorners(c) {
        return {
            tl: { x: c.tl.x, y: c.tl.y },
            tr: { x: c.tr.x, y: c.tr.y },
            br: { x: c.br.x, y: c.br.y },
            bl: { x: c.bl.x, y: c.bl.y }
        };
    },
    
    /**
     * Sort 4 points to TL, TR, BR, BL order
     * Works for rotated documents by using angle-based sorting
     * 
     * Method:
     * 1. Find centroid
     * 2. Sort points by angle from centroid (clockwise from top)
     * 3. Find the "top-left-most" point and rotate array
     * 
     * @param {Array} pts - Array of 4 points [{x,y}, ...]
     * @returns {Object} Ordered corners {tl, tr, br, bl}
     */
    sortCorners(pts) {
        if (!pts || pts.length !== 4) {
            return null;
        }
        
        // Validate all points exist
        for (let i = 0; i < 4; i++) {
            if (!pts[i] || typeof pts[i].x !== 'number' || typeof pts[i].y !== 'number') {
                return null;
            }
        }
        
        // Step 1: Compute centroid
        const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
        const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
        
        // Step 2: Sort by angle from centroid (clockwise, starting from top)
        // atan2 gives angle from -PI to PI, with 0 at right (east)
        // We want to start from top (north), so adjust
        const withAngles = pts.map((p, i) => {
            // Angle from centroid, adjusted so 0 = top (north)
            let angle = Math.atan2(p.x - cx, -(p.y - cy)); // Note: swapped and negated for clockwise from top
            return { x: p.x, y: p.y, angle: angle, idx: i };
        });
        
        // Sort clockwise from top
        withAngles.sort((a, b) => a.angle - b.angle);
        
        // Step 3: Now points are in clockwise order starting from ~top
        // withAngles[0] is closest to "top" direction
        // For a document: top-left, top-right, bottom-right, bottom-left (clockwise)
        
        // Find which point is most "top-left" (smallest x + y from centroid perspective)
        // Or: find the point that's in the top-left quadrant
        let tlIdx = 0;
        let minScore = Infinity;
        
        for (let i = 0; i < 4; i++) {
            // Score: prefer points that are both above and left of centroid
            const p = withAngles[i];
            const score = (p.x - cx) + (p.y - cy); // smaller = more top-left
            if (score < minScore) {
                minScore = score;
                tlIdx = i;
            }
        }
        
        // Rotate so TL is first
        const ordered = [];
        for (let i = 0; i < 4; i++) {
            ordered.push(withAngles[(tlIdx + i) % 4]);
        }
        
        // ordered[0]=TL, ordered[1]=TR, ordered[2]=BR, ordered[3]=BL (clockwise)
        return {
            tl: { x: ordered[0].x, y: ordered[0].y },
            tr: { x: ordered[1].x, y: ordered[1].y },
            br: { x: ordered[2].x, y: ordered[2].y },
            bl: { x: ordered[3].x, y: ordered[3].y }
        };
    },
    
    /**
     * Ensure corners are properly ordered - call this on ANY corners before use
     * @param {Object} corners - Corners object {tl, tr, br, bl}
     * @returns {Object} Properly ordered corners
     */
    ensureOrdered(corners) {
        if (!corners) return null;
        if (!corners.tl || !corners.tr || !corners.br || !corners.bl) return null;
        
        const pts = [corners.tl, corners.tr, corners.br, corners.bl];
        return this.sortCorners(pts);
    },
    
    // ============================================
    // RESET / STATUS
    // ============================================
    
    /**
     * Reset all state (call when switching documents/modes)
     */
    reset() {
        this.state = {
            smoothedCorners: null,
            previousGatedCorners: null,
            stableFrameCount: 0,
            unlockFrameCount: 0,
            lockedRectangle: null,
            isLocked: false,
            frameHistory: [],
            lastRejectReason: null,
            rejectCount: 0
        };
    },
    
    /**
     * Force unlock
     */
    unlock() {
        this.state.isLocked = false;
        this.state.lockedRectangle = null;
        this.state.stableFrameCount = 0;
    },
    
    /**
     * Get current status (includes debug info)
     */
    getStatus() {
        return {
            isLocked: this.state.isLocked,
            stableFrameCount: this.state.stableFrameCount,
            hasSmoothedCorners: !!this.state.smoothedCorners,
            lastRejectReason: this.state.lastRejectReason,
            rejectCount: this.state.rejectCount
        };
    },
    
    /**
     * Get debug string for UI display
     */
    getDebugString() {
        if (this.state.lastRejectReason) {
            return `❌ ${this.state.lastRejectReason} (${this.state.rejectCount})`;
        }
        if (this.state.isLocked) {
            return `🔒 LOCKED`;
        }
        if (this.state.smoothedCorners) {
            return `📐 Stable: ${this.state.stableFrameCount}/${this.CONFIG.STABLE_FRAMES_REQUIRED}`;
        }
        return `👀 Searching...`;
    },
    
    /**
     * Get locked corners (for capture)
     * Returns null if not locked
     */
    getLockedCorners() {
        if (this.state.isLocked && this.state.lockedRectangle) {
            return this.cloneCorners(this.state.lockedRectangle);
        }
        return null;
    },
    
    /**
     * Get current best corners (locked or smoothed)
     * Use this for capture when you want any available corners
     */
    getCurrentCorners() {
        if (this.state.isLocked && this.state.lockedRectangle) {
            return this.cloneCorners(this.state.lockedRectangle);
        }
        if (this.state.smoothedCorners) {
            return this.cloneCorners(this.state.smoothedCorners);
        }
        return null;
    },
    
    /**
     * Update config at runtime
     */
    setConfig(key, value) {
        if (key in this.CONFIG) {
            this.CONFIG[key] = value;
        }
    }
};
