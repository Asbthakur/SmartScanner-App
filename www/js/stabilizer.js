/**
 * Stabilizer Module
 * Smooths corner detection over time to reduce jitter
 */

const Stabilizer = {
    
    state: {
        corners: null,
        lockedCorners: null,
        stableCount: 0,
        missedCount: 0,
        locked: false
    },
    
    /**
     * Update with new detection
     */
    update(corners) {
        if (!corners) {
            this.state.missedCount++;
            
            if (this.state.missedCount > (CONFIG?.STABILITY?.MISSED_FRAMES_RESET ?? 5)) {
                this.reset();
            }
            
            return {
                corners: this.state.corners,
                locked: this.state.locked,
                status: this.state.corners ? 'detecting' : 'no_document'
            };
        }
        
        this.state.missedCount = 0;
        
        // Smooth corners
        if (this.state.corners) {
            const alpha = this.state.locked ? 
                (CONFIG?.SMOOTH?.LOCKED_ALPHA ?? 0.1) : 
                (CONFIG?.SMOOTH?.ALPHA ?? 0.4);
            
            this.state.corners = this.smooth(this.state.corners, corners, alpha);
        } else {
            this.state.corners = corners;
        }
        
        // Check stability
        if (this.isStable(corners)) {
            this.state.stableCount++;
            
            if (this.state.stableCount >= (CONFIG?.STABILITY?.LOCK_THRESHOLD ?? 8)) {
                this.state.locked = true;
                this.state.lockedCorners = { ...this.state.corners };
            }
        } else {
            this.state.stableCount = Math.max(0, this.state.stableCount - 1);
        }
        
        return {
            corners: this.state.corners,
            locked: this.state.locked,
            status: this.state.locked ? 'locked' : 'detecting',
            stableCount: this.state.stableCount
        };
    },
    
    /**
     * Smooth corners using exponential moving average
     */
    smooth(prev, curr, alpha) {
        return {
            tl: {
                x: prev.tl.x + alpha * (curr.tl.x - prev.tl.x),
                y: prev.tl.y + alpha * (curr.tl.y - prev.tl.y)
            },
            tr: {
                x: prev.tr.x + alpha * (curr.tr.x - prev.tr.x),
                y: prev.tr.y + alpha * (curr.tr.y - prev.tr.y)
            },
            br: {
                x: prev.br.x + alpha * (curr.br.x - prev.br.x),
                y: prev.br.y + alpha * (curr.br.y - prev.br.y)
            },
            bl: {
                x: prev.bl.x + alpha * (curr.bl.x - prev.bl.x),
                y: prev.bl.y + alpha * (curr.bl.y - prev.bl.y)
            },
            _confidence: curr._confidence
        };
    },
    
    /**
     * Check if corners are stable (not moving much)
     */
    isStable(corners) {
        if (!this.state.corners || !corners) return false;
        
        const threshold = CONFIG?.STABILITY?.STABLE_DISTANCE ?? 15;
        const dist = Geometry.cornerDistance(this.state.corners, corners);
        
        return dist < threshold;
    },
    
    /**
     * Unlock detection
     */
    unlock() {
        this.state.locked = false;
        this.state.lockedCorners = null;
        this.state.stableCount = 0;
    },
    
    /**
     * Reset all state
     */
    reset() {
        this.state = {
            corners: null,
            lockedCorners: null,
            stableCount: 0,
            missedCount: 0,
            locked: false
        };
    },
    
    /**
     * Get current state
     */
    isLocked() {
        return this.state.locked;
    },
    
    getLockedCorners() {
        return this.state.lockedCorners;
    },
    
    getLastCorners() {
        return this.state.corners;
    },
    
    shouldShowNoDocWarning() {
        return this.state.missedCount > (CONFIG?.STABILITY?.NO_DOC_WARNING ?? 30);
    }
};
