/**
 * Rectangle Math Stabilization Layer v2.0
 * ========================================
 * 
 * SCANNER-GRADE detection stabilization
 * 
 * Key improvements:
 * - 3-corner rectangle completion
 * - Stricter geometry validation
 * - Smoother overlay movement (lerp)
 * - Auto-capture support with stability check
 * - User feedback messages
 * 
 * Pipeline:
 *   Raw Detection → Validate → Complete → Smooth → Gate → Lock → Output
 */

const RectangleMath = {
    
    // ============================================
    // CONFIGURATION
    // ============================================
    
    CONFIG: {
        // ─────────────────────────────────────────────────
        // GEOMETRY VALIDATION (stricter)
        // ─────────────────────────────────────────────────
        
        // Angle constraints
        ANGLE_MIN: 70,              // Adjacent angles must be 70-110° (near perpendicular)
        ANGLE_MAX: 110,
        
        // Parallel edge constraints (KEY!)
        // Ratio = longer / shorter of parallel edges
        PARALLEL_ANGLE_DIFF: 15,    // Max angle difference between parallel edges (degrees)
        PARALLEL_LENGTH_RATIO: 2.2, // Max length ratio between parallel edges (tuned for perspective)
        
        // Diagonal consistency (CRITICAL - catches impossible shapes)
        DIAGONAL_RATIO_MAX: 1.15,   // Diagonals must be nearly equal
        
        // Aspect ratio
        ASPECT_RATIO_MIN: 0.3,
        ASPECT_RATIO_MAX: 3.0,
        
        // Minimum area (% of frame) - lowered for distant documents
        MIN_AREA_RATIO: 0.03,
        
        // ─────────────────────────────────────────────────
        // 3-CORNER COMPLETION
        // ─────────────────────────────────────────────────
        
        // Max deviation to accept computed 4th corner (pixels)
        CORNER_COMPLETION_TOLERANCE: 50,
        
        // Min confidence for corner to be "reliable"
        CORNER_CONFIDENCE_MIN: 0.4,
        
        // ─────────────────────────────────────────────────
        // SMOOTHING (lerp for smooth movement)
        // ─────────────────────────────────────────────────
        
        // Higher = more responsive, Lower = smoother
        // Values closer to 1.0 = nearly instant response
        SMOOTH_ALPHA_PREVIEW: 0.4,      // Very responsive - follows camera movement
        SMOOTH_ALPHA_LOCKED: 0.15,      // Slightly smoother when locked
        SMOOTH_ALPHA_FAST: 0.7,         // Very fast catch-up after big movement
        
        // ─────────────────────────────────────────────────
        // STABILITY & LOCKING
        // ─────────────────────────────────────────────────
        
        // Jitter threshold (ignore movement below this)
        JITTER_THRESHOLD: 3,            // Reduced - allow small movements through
        
        // Frames required to lock
        STABLE_FRAMES_REQUIRED: 10,     // Increased - harder to lock
        
        // Movement threshold for "stable" (pixels)
        STABLE_MOVEMENT_MAX: 8,         // Reduced - must be very still to lock
        
        // Area change threshold for "stable" (%)
        STABLE_AREA_CHANGE_MAX: 5,
        
        // Unlock thresholds
        UNLOCK_MOVEMENT: 25,            // pixels to trigger unlock
        UNLOCK_FRAMES: 2,               // consecutive frames to unlock
        
        // ─────────────────────────────────────────────────
        // AUTO-CAPTURE
        // ─────────────────────────────────────────────────
        
        AUTO_CAPTURE_ENABLED: false,     // Disabled - manual capture only
        AUTO_CAPTURE_DELAY: 400,        // ms after lock before capture
        AUTO_CAPTURE_SOUND: true,
    },
    
    // ============================================
    // STATE
    // ============================================
    
    state: {
        // Smoothed corners (for display)
        smoothedCorners: null,
        
        // Previous frame corners (for movement calculation)
        previousCorners: null,
        
        // Gated corners (anti-jitter)
        gatedCorners: null,
        
        // Stability tracking
        stableFrameCount: 0,
        unlockFrameCount: 0,
        
        // Lock state
        isLocked: false,
        lockedCorners: null,
        lockTime: null,
        
        // Auto-capture state
        autoCaptureScheduled: false,
        autoCaptureTimer: null,
        
        // Frame history for analysis
        frameHistory: [],
        maxHistoryLength: 10,
        
        // Feedback message
        feedbackMessage: 'Searching for document...',
        feedbackType: 'info', // 'info', 'warning', 'success', 'error'
        
        // Debug
        lastRejectReason: null,
        consecutiveRejects: 0,
    },
    
    // ============================================
    // MAIN ENTRY POINT
    // ============================================
    
    /**
     * Process detected corners through stabilization pipeline
     * 
     * @param {Object|null} rawCorners - Raw detected corners {tl, tr, br, bl}
     * @param {number} frameWidth
     * @param {number} frameHeight
     * @param {Object} options - { mode: 'preview'|'capture', cornerConfidences: {} }
     * @returns {Object|null} Stabilized corners or null
     */
    process(rawCorners, frameWidth, frameHeight, options = {}) {
        const mode = options.mode || 'preview';
        const confidences = options.cornerConfidences || null;
        
        // Clear previous reject reason
        this.state.lastRejectReason = null;
        
        // Step 1: Handle no detection
        if (!rawCorners) {
            return this.handleNoDetection();
        }
        
        // Step 2: Ensure corners are ordered (TL, TR, BR, BL)
        let corners = this.ensureOrdered(rawCorners);
        if (!corners) {
            this.state.lastRejectReason = 'invalid_corner_structure';
            return this.handleInvalidDetection();
        }
        
        // Step 3: Validate basic structure
        if (!this.hasValidCorners(corners)) {
            this.state.lastRejectReason = 'missing_corners';
            return this.handleInvalidDetection();
        }
        
        // Step 4: Try 3-corner completion if one corner is weak
        if (confidences) {
            corners = this.tryThreeCornerCompletion(corners, confidences);
        }
        
        // Step 5: Validate geometry (strict)
        const validation = this.validateGeometry(corners, frameWidth, frameHeight);
        if (!validation.valid) {
            this.state.lastRejectReason = validation.reason;
            this.state.consecutiveRejects++;
            return this.handleInvalidDetection();
        }
        
        // Reset reject count on success
        this.state.consecutiveRejects = 0;
        
        // Step 6: Apply temporal smoothing (lerp)
        corners = this.applySmoothing(corners);
        
        // Step 7: Apply movement gating (anti-jitter)
        corners = this.applyMovementGating(corners);
        
        // Step 8: Update stability and lock
        corners = this.updateStability(corners);
        
        // Step 9: Update feedback message
        this.updateFeedback();
        
        return corners;
    },
    
    // ============================================
    // GEOMETRY VALIDATION
    // ============================================
    
    /**
     * Strict geometry validation
     * Returns { valid: boolean, reason: string }
     */
    validateGeometry(corners, frameW, frameH) {
        // Check 1: Must be convex
        if (!this.isConvex(corners)) {
            return { valid: false, reason: 'not_convex' };
        }
        
        // Check 2: Minimum area
        const area = this.quadArea(corners);
        const frameArea = frameW * frameH;
        const areaRatio = area / frameArea;
        if (areaRatio < this.CONFIG.MIN_AREA_RATIO) {
            return { valid: false, reason: `area_too_small_${(areaRatio*100).toFixed(1)}%` };
        }
        
        // Check 3: Diagonal consistency (CRITICAL - catches impossible shapes)
        // For any rectangle, both diagonals must be approximately equal
        const diag1 = this.distance(corners.tl, corners.br);
        const diag2 = this.distance(corners.tr, corners.bl);
        const diagRatio = Math.max(diag1, diag2) / Math.min(diag1, diag2);
        if (diagRatio > this.CONFIG.DIAGONAL_RATIO_MAX) {
            return { valid: false, reason: `diagonal_mismatch_${diagRatio.toFixed(2)}` };
        }
        
        // Check 4: Parallel edges must be approximately parallel
        const parallelCheck = this.checkParallelEdges(corners);
        if (!parallelCheck.valid) {
            return { valid: false, reason: parallelCheck.reason };
        }
        
        // Check 5: Adjacent angles must be near 90°
        const angleCheck = this.checkAdjacentAngles(corners);
        if (!angleCheck.valid) {
            return { valid: false, reason: angleCheck.reason };
        }
        
        // Check 6: All corners must be inside frame
        const pts = [corners.tl, corners.tr, corners.br, corners.bl];
        for (const p of pts) {
            if (p.x < -10 || p.x > frameW + 10 || p.y < -10 || p.y > frameH + 10) {
                return { valid: false, reason: 'corner_outside_frame' };
            }
        }
        
        return { valid: true, reason: null };
    },
    
    /**
     * Check that opposite edges are approximately parallel
     */
    checkParallelEdges(c) {
        // Top and bottom edges
        const topAngle = Math.atan2(c.tr.y - c.tl.y, c.tr.x - c.tl.x) * 180 / Math.PI;
        const botAngle = Math.atan2(c.br.y - c.bl.y, c.br.x - c.bl.x) * 180 / Math.PI;
        const horizAngleDiff = Math.abs(this.normalizeAngle(topAngle - botAngle));
        
        // Left and right edges
        const leftAngle = Math.atan2(c.bl.y - c.tl.y, c.bl.x - c.tl.x) * 180 / Math.PI;
        const rightAngle = Math.atan2(c.br.y - c.tr.y, c.br.x - c.tr.x) * 180 / Math.PI;
        const vertAngleDiff = Math.abs(this.normalizeAngle(leftAngle - rightAngle));
        
        // Check angle difference
        if (horizAngleDiff > this.CONFIG.PARALLEL_ANGLE_DIFF) {
            return { valid: false, reason: `horiz_not_parallel_${horizAngleDiff.toFixed(0)}°` };
        }
        if (vertAngleDiff > this.CONFIG.PARALLEL_ANGLE_DIFF) {
            return { valid: false, reason: `vert_not_parallel_${vertAngleDiff.toFixed(0)}°` };
        }
        
        // Check length ratio
        const topLen = this.distance(c.tl, c.tr);
        const botLen = this.distance(c.bl, c.br);
        const leftLen = this.distance(c.tl, c.bl);
        const rightLen = this.distance(c.tr, c.br);
        
        const horizRatio = Math.max(topLen, botLen) / Math.min(topLen, botLen);
        const vertRatio = Math.max(leftLen, rightLen) / Math.min(leftLen, rightLen);
        
        if (horizRatio > this.CONFIG.PARALLEL_LENGTH_RATIO) {
            return { valid: false, reason: `horiz_ratio_${horizRatio.toFixed(2)}` };
        }
        if (vertRatio > this.CONFIG.PARALLEL_LENGTH_RATIO) {
            return { valid: false, reason: `vert_ratio_${vertRatio.toFixed(2)}` };
        }
        
        return { valid: true };
    },
    
    /**
     * Check that adjacent angles are approximately 90°
     */
    checkAdjacentAngles(corners) {
        const angles = this.calculateInternalAngles(corners);
        
        for (let i = 0; i < 4; i++) {
            const angle = angles[i];
            if (angle < this.CONFIG.ANGLE_MIN || angle > this.CONFIG.ANGLE_MAX) {
                return { valid: false, reason: `angle_${i}_${angle.toFixed(0)}°` };
            }
        }
        
        return { valid: true };
    },
    
    /**
     * Normalize angle to -180 to 180 range
     */
    normalizeAngle(angle) {
        while (angle > 180) angle -= 360;
        while (angle < -180) angle += 360;
        return angle;
    },
    
    /**
     * Calculate internal angles of quadrilateral
     */
    calculateInternalAngles(c) {
        const pts = [c.tl, c.tr, c.br, c.bl];
        const angles = [];
        
        for (let i = 0; i < 4; i++) {
            const p1 = pts[(i + 3) % 4];
            const p2 = pts[i];
            const p3 = pts[(i + 1) % 4];
            
            const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
            const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
            
            const dot = v1.x * v2.x + v1.y * v2.y;
            const cross = v1.x * v2.y - v1.y * v2.x;
            
            let angle = Math.atan2(Math.abs(cross), dot) * 180 / Math.PI;
            angles.push(angle);
        }
        
        return angles;
    },
    
    // ============================================
    // 3-CORNER COMPLETION
    // ============================================
    
    /**
     * If one corner is weak, compute it from the other 3
     * Formula: D = B + C - A (parallelogram property)
     */
    tryThreeCornerCompletion(corners, confidences) {
        const keys = ['tl', 'tr', 'br', 'bl'];
        const minConf = this.CONFIG.CORNER_CONFIDENCE_MIN;
        
        // Find weak corners
        const weakCorners = keys.filter(k => 
            confidences[k] !== undefined && confidences[k] < minConf
        );
        
        // Only complete if exactly one corner is weak
        if (weakCorners.length !== 1) {
            return corners;
        }
        
        const weakKey = weakCorners[0];
        const completed = { ...corners };
        
        // Compute 4th corner using parallelogram property
        // For parallelogram ABCD: D = B + C - A
        switch (weakKey) {
            case 'tl':
                // TL = TR + BL - BR
                completed.tl = this.computeFourthCorner(corners.tr, corners.bl, corners.br);
                break;
            case 'tr':
                // TR = TL + BR - BL
                completed.tr = this.computeFourthCorner(corners.tl, corners.br, corners.bl);
                break;
            case 'br':
                // BR = BL + TR - TL
                completed.br = this.computeFourthCorner(corners.bl, corners.tr, corners.tl);
                break;
            case 'bl':
                // BL = TL + BR - TR
                completed.bl = this.computeFourthCorner(corners.tl, corners.br, corners.tr);
                break;
        }
        
        // Check if computed corner is close to detected corner
        const detected = corners[weakKey];
        const computed = completed[weakKey];
        const deviation = this.distance(detected, computed);
        
        if (deviation > this.CONFIG.CORNER_COMPLETION_TOLERANCE) {
            // Detected corner is way off - use computed
            console.log(`🔧 Completed ${weakKey}: deviation ${deviation.toFixed(0)}px`);
            return completed;
        }
        
        // Detected corner is reasonable - blend
        completed[weakKey] = {
            x: (detected.x + computed.x) / 2,
            y: (detected.y + computed.y) / 2
        };
        
        return completed;
    },
    
    /**
     * Compute 4th corner of parallelogram
     * D = B + C - A
     */
    computeFourthCorner(b, c, a) {
        return {
            x: b.x + c.x - a.x,
            y: b.y + c.y - a.y
        };
    },
    
    // ============================================
    // SMOOTHING (Lerp-based)
    // ============================================
    
    /**
     * Apply temporal smoothing using linear interpolation
     * newPoint = lerp(previousPoint, detectedPoint, alpha)
     */
    applySmoothing(corners) {
        // Initialize if first frame
        if (!this.state.smoothedCorners) {
            this.state.smoothedCorners = this.cloneCorners(corners);
            return corners;
        }
        
        // Choose alpha based on state
        let alpha = this.CONFIG.SMOOTH_ALPHA_PREVIEW;
        
        if (this.state.isLocked) {
            alpha = this.CONFIG.SMOOTH_ALPHA_LOCKED;
        } else {
            // Check for big movement - use faster alpha to catch up
            const movement = this.averageCornerMovement(this.state.smoothedCorners, corners);
            if (movement > 50) {
                alpha = this.CONFIG.SMOOTH_ALPHA_FAST;
            }
        }
        
        // Apply lerp to each corner
        const smoothed = {
            tl: this.lerpPoint(this.state.smoothedCorners.tl, corners.tl, alpha),
            tr: this.lerpPoint(this.state.smoothedCorners.tr, corners.tr, alpha),
            br: this.lerpPoint(this.state.smoothedCorners.br, corners.br, alpha),
            bl: this.lerpPoint(this.state.smoothedCorners.bl, corners.bl, alpha)
        };
        
        this.state.smoothedCorners = smoothed;
        return smoothed;
    },
    
    /**
     * Linear interpolation between two points
     * result = previous + alpha * (target - previous)
     */
    lerpPoint(prev, target, alpha) {
        return {
            x: prev.x + alpha * (target.x - prev.x),
            y: prev.y + alpha * (target.y - prev.y)
        };
    },
    
    // ============================================
    // MOVEMENT GATING (Anti-Jitter)
    // ============================================
    
    /**
     * Ignore tiny movements to prevent micro-jitter
     * But allow updates to flow through for responsiveness
     */
    applyMovementGating(corners) {
        if (!this.state.gatedCorners) {
            this.state.gatedCorners = this.cloneCorners(corners);
            return corners;
        }
        
        const movement = this.averageCornerMovement(this.state.gatedCorners, corners);
        
        // ALWAYS update gated corners to track position
        // Only return old corners if movement is truly tiny (micro-jitter)
        if (movement < this.CONFIG.JITTER_THRESHOLD) {
            // Micro-jitter - but still slowly update towards new position
            // This prevents freezing while reducing jitter
            const blendAlpha = 0.3;
            this.state.gatedCorners = {
                tl: this.lerpPoint(this.state.gatedCorners.tl, corners.tl, blendAlpha),
                tr: this.lerpPoint(this.state.gatedCorners.tr, corners.tr, blendAlpha),
                br: this.lerpPoint(this.state.gatedCorners.br, corners.br, blendAlpha),
                bl: this.lerpPoint(this.state.gatedCorners.bl, corners.bl, blendAlpha)
            };
            return this.state.gatedCorners;
        }
        
        // Significant movement - update immediately
        this.state.gatedCorners = this.cloneCorners(corners);
        return corners;
    },
    
    // ============================================
    // STABILITY & LOCKING
    // ============================================
    
    /**
     * Track stability and manage lock state
     */
    updateStability(corners) {
        // Calculate movement from previous frame
        let movement = 0;
        let areaChange = 0;
        
        if (this.state.previousCorners) {
            movement = this.averageCornerMovement(this.state.previousCorners, corners);
            
            const prevArea = this.quadArea(this.state.previousCorners);
            const currArea = this.quadArea(corners);
            areaChange = Math.abs(currArea - prevArea) / prevArea * 100;
        }
        
        // Store current as previous
        this.state.previousCorners = this.cloneCorners(corners);
        
        // Add to history
        this.state.frameHistory.push({ corners: this.cloneCorners(corners), movement, areaChange });
        if (this.state.frameHistory.length > this.state.maxHistoryLength) {
            this.state.frameHistory.shift();
        }
        
        // Handle locked state
        if (this.state.isLocked) {
            return this.handleLockedState(corners, movement);
        }
        
        // Not locked - check for stability
        const isStable = movement < this.CONFIG.STABLE_MOVEMENT_MAX && 
                         areaChange < this.CONFIG.STABLE_AREA_CHANGE_MAX;
        
        if (isStable) {
            this.state.stableFrameCount++;
        } else {
            // Decay stable count on movement
            this.state.stableFrameCount = Math.max(0, this.state.stableFrameCount - 2);
        }
        
        // Check if should lock
        if (this.state.stableFrameCount >= this.CONFIG.STABLE_FRAMES_REQUIRED) {
            this.lock(corners);
        }
        
        return corners;
    },
    
    /**
     * Handle behavior when locked
     * KEY: Even when locked, overlay should follow camera movement!
     */
    handleLockedState(corners, movement) {
        // Check for unlock condition (big movement)
        if (movement > this.CONFIG.UNLOCK_MOVEMENT) {
            this.state.unlockFrameCount++;
            
            if (this.state.unlockFrameCount >= this.CONFIG.UNLOCK_FRAMES) {
                this.unlock();
                return corners;
            }
        } else {
            this.state.unlockFrameCount = 0;
        }
        
        // IMPORTANT: Even when locked, update the locked corners to follow camera
        // This makes the overlay responsive while maintaining "locked" status
        // Use slower lerp for stability
        const alpha = this.CONFIG.SMOOTH_ALPHA_LOCKED;
        this.state.lockedCorners = {
            tl: this.lerpPoint(this.state.lockedCorners.tl, corners.tl, alpha),
            tr: this.lerpPoint(this.state.lockedCorners.tr, corners.tr, alpha),
            br: this.lerpPoint(this.state.lockedCorners.br, corners.br, alpha),
            bl: this.lerpPoint(this.state.lockedCorners.bl, corners.bl, alpha)
        };
        
        return this.state.lockedCorners;
    },
    
    /**
     * Lock the rectangle
     */
    lock(corners) {
        this.state.isLocked = true;
        this.state.lockedCorners = this.cloneCorners(corners);
        this.state.lockTime = Date.now();
        this.state.unlockFrameCount = 0;
        
        console.log('🔒 LOCKED');
        
        // Schedule auto-capture if enabled
        if (this.CONFIG.AUTO_CAPTURE_ENABLED && !this.state.autoCaptureScheduled) {
            this.scheduleAutoCapture();
        }
    },
    
    /**
     * Unlock the rectangle
     */
    unlock() {
        this.state.isLocked = false;
        this.state.lockedCorners = null;
        this.state.lockTime = null;
        this.state.stableFrameCount = 0;
        this.state.unlockFrameCount = 0;
        
        // Cancel auto-capture
        this.cancelAutoCapture();
        
        console.log('🔓 UNLOCKED');
    },
    
    // ============================================
    // AUTO-CAPTURE
    // ============================================
    
    /**
     * Schedule auto-capture after delay
     */
    scheduleAutoCapture() {
        if (this.state.autoCaptureTimer) {
            clearTimeout(this.state.autoCaptureTimer);
        }
        
        this.state.autoCaptureScheduled = true;
        this.state.autoCaptureTimer = setTimeout(() => {
            if (this.state.isLocked) {
                this.triggerAutoCapture();
            }
            this.state.autoCaptureScheduled = false;
            this.state.autoCaptureTimer = null;
        }, this.CONFIG.AUTO_CAPTURE_DELAY);
    },
    
    /**
     * Cancel scheduled auto-capture
     */
    cancelAutoCapture() {
        if (this.state.autoCaptureTimer) {
            clearTimeout(this.state.autoCaptureTimer);
            this.state.autoCaptureTimer = null;
        }
        this.state.autoCaptureScheduled = false;
    },
    
    /**
     * Trigger auto-capture (calls App)
     */
    triggerAutoCapture() {
        console.log('📸 AUTO-CAPTURE');
        
        // Play sound if enabled
        if (this.CONFIG.AUTO_CAPTURE_SOUND) {
            this.playShutterSound();
        }
        
        // Trigger capture in App
        if (typeof App !== 'undefined' && App.handleAutoCapture) {
            App.handleAutoCapture();
        }
    },
    
    /**
     * Play camera shutter sound
     */
    playShutterSound() {
        try {
            // Create simple beep sound using Web Audio API
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
            
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.1);
        } catch (e) {
            console.log('Could not play shutter sound:', e);
        }
    },
    
    // ============================================
    // USER FEEDBACK
    // ============================================
    
    /**
     * Update feedback message based on state
     */
    updateFeedback() {
        if (this.state.isLocked) {
            this.state.feedbackMessage = '✓ Document detected';
            this.state.feedbackType = 'success';
        } else if (this.state.stableFrameCount > 0) {
            const progress = Math.min(100, Math.round(
                this.state.stableFrameCount / this.CONFIG.STABLE_FRAMES_REQUIRED * 100
            ));
            this.state.feedbackMessage = `Hold steady... ${progress}%`;
            this.state.feedbackType = 'info';
        } else {
            this.state.feedbackMessage = 'Searching for document...';
            this.state.feedbackType = 'info';
        }
    },
    
    // ============================================
    // HANDLE NO/INVALID DETECTION
    // ============================================
    
    /**
     * Handle frame with no detection
     */
    handleNoDetection() {
        this.state.consecutiveRejects++;
        
        // Update feedback
        if (this.state.consecutiveRejects > 30) {
            this.state.feedbackMessage = 'No document detected. Adjust position or capture manually.';
            this.state.feedbackType = 'warning';
        }
        
        // Decay stability
        this.state.stableFrameCount = Math.max(0, this.state.stableFrameCount - 1);
        
        // If locked, check if should unlock
        if (this.state.isLocked && this.state.consecutiveRejects > 5) {
            this.unlock();
        }
        
        // Return last known corners (fading)
        return null;
    },
    
    /**
     * Handle invalid detection
     */
    handleInvalidDetection() {
        // Update feedback based on reject reason
        if (this.state.lastRejectReason) {
            if (this.state.lastRejectReason.includes('not_convex')) {
                this.state.feedbackMessage = 'Adjust camera angle...';
            } else if (this.state.lastRejectReason.includes('parallel')) {
                this.state.feedbackMessage = 'Move camera back slightly...';
            } else {
                this.state.feedbackMessage = 'Searching for document...';
            }
            this.state.feedbackType = 'info';
        }
        
        // Decay stability
        this.state.stableFrameCount = Math.max(0, this.state.stableFrameCount - 1);
        
        return null;
    },
    
    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    
    /**
     * Ensure corners are in TL, TR, BR, BL order
     */
    ensureOrdered(corners) {
        if (!corners) return null;
        
        // If already has named properties, validate them
        if (corners.tl && corners.tr && corners.br && corners.bl) {
            return corners;
        }
        
        // If array, convert to object
        if (Array.isArray(corners) && corners.length === 4) {
            return this.sortCorners(corners);
        }
        
        return null;
    },
    
    /**
     * Sort 4 points into TL, TR, BR, BL order
     */
    sortCorners(pts) {
        if (!pts || pts.length !== 4) return null;
        
        // Find centroid
        const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
        const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
        
        // Sort by angle from centroid
        const sorted = [...pts].sort((a, b) => {
            const angleA = Math.atan2(a.y - cy, a.x - cx);
            const angleB = Math.atan2(b.y - cy, b.x - cx);
            return angleA - angleB;
        });
        
        // Find top-left (smallest x+y sum)
        let tlIndex = 0;
        let minSum = Infinity;
        for (let i = 0; i < 4; i++) {
            const sum = sorted[i].x + sorted[i].y;
            if (sum < minSum) {
                minSum = sum;
                tlIndex = i;
            }
        }
        
        // Rotate to start with TL
        const rotated = [
            sorted[tlIndex],
            sorted[(tlIndex + 1) % 4],
            sorted[(tlIndex + 2) % 4],
            sorted[(tlIndex + 3) % 4]
        ];
        
        return {
            tl: { x: rotated[0].x, y: rotated[0].y },
            tr: { x: rotated[1].x, y: rotated[1].y },
            br: { x: rotated[2].x, y: rotated[2].y },
            bl: { x: rotated[3].x, y: rotated[3].y }
        };
    },
    
    /**
     * Check if corners object has all required properties
     */
    hasValidCorners(c) {
        return c && c.tl && c.tr && c.br && c.bl &&
               typeof c.tl.x === 'number' && typeof c.tl.y === 'number' &&
               typeof c.tr.x === 'number' && typeof c.tr.y === 'number' &&
               typeof c.br.x === 'number' && typeof c.br.y === 'number' &&
               typeof c.bl.x === 'number' && typeof c.bl.y === 'number';
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
            
            if (Math.abs(cross) > 1) {
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
     * Calculate quadrilateral area (shoelace formula)
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
     * Distance between two points
     */
    distance(p1, p2) {
        return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    },
    
    /**
     * Average corner movement between two corner sets
     */
    averageCornerMovement(c1, c2) {
        let total = 0;
        for (const key of ['tl', 'tr', 'br', 'bl']) {
            total += this.distance(c1[key], c2[key]);
        }
        return total / 4;
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
    
    // ============================================
    // PUBLIC API
    // ============================================
    
    /**
     * Get current status
     */
    getStatus() {
        return {
            isLocked: this.state.isLocked,
            stableFrameCount: this.state.stableFrameCount,
            feedbackMessage: this.state.feedbackMessage,
            feedbackType: this.state.feedbackType,
            lastRejectReason: this.state.lastRejectReason,
            autoCaptureScheduled: this.state.autoCaptureScheduled
        };
    },
    
    /**
     * Get locked corners (for capture)
     */
    getLockedCorners() {
        return this.state.lockedCorners;
    },
    
    /**
     * Get current corners (locked or smoothed)
     * Use this for manual capture
     */
    getCurrentCorners() {
        if (this.state.isLocked && this.state.lockedCorners) {
            return this.state.lockedCorners;
        }
        return this.state.smoothedCorners || this.state.gatedCorners || null;
    },
    
    /**
     * Force unlock
     */
    forceUnlock() {
        this.unlock();
    },
    
    /**
     * Reset all state
     */
    reset() {
        this.cancelAutoCapture();
        
        this.state = {
            smoothedCorners: null,
            previousCorners: null,
            gatedCorners: null,
            stableFrameCount: 0,
            unlockFrameCount: 0,
            isLocked: false,
            lockedCorners: null,
            lockTime: null,
            autoCaptureScheduled: false,
            autoCaptureTimer: null,
            frameHistory: [],
            maxHistoryLength: 10,
            feedbackMessage: 'Searching for document...',
            feedbackType: 'info',
            lastRejectReason: null,
            consecutiveRejects: 0,
        };
    },
    
    /**
     * Set auto-capture enabled/disabled
     */
    setAutoCapture(enabled) {
        this.CONFIG.AUTO_CAPTURE_ENABLED = enabled;
        if (!enabled) {
            this.cancelAutoCapture();
        }
    },
    
    /**
     * Check if auto-capture is enabled
     */
    isAutoCaptureEnabled() {
        return this.CONFIG.AUTO_CAPTURE_ENABLED;
    }
};
