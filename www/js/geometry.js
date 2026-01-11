/**
 * Geometry Module
 * Helper functions for corner/point calculations
 */

const Geometry = {
    
    /**
     * Scale corners from detection resolution to full resolution
     */
    scaleCorners(corners, fromWidth, fromHeight, toWidth, toHeight) {
        if (!corners) return null;
        
        const scaleX = toWidth / fromWidth;
        const scaleY = toHeight / fromHeight;
        
        return {
            tl: { x: corners.tl.x * scaleX, y: corners.tl.y * scaleY },
            tr: { x: corners.tr.x * scaleX, y: corners.tr.y * scaleY },
            br: { x: corners.br.x * scaleX, y: corners.br.y * scaleY },
            bl: { x: corners.bl.x * scaleX, y: corners.bl.y * scaleY },
            _confidence: corners._confidence
        };
    },
    
    /**
     * Validate corners are within frame bounds
     */
    validate(corners, w, h) {
        if (!corners) return null;
        
        const margin = 5;
        const inBounds = (p) => 
            p.x >= -margin && p.x <= w + margin &&
            p.y >= -margin && p.y <= h + margin;
        
        if (!inBounds(corners.tl) || !inBounds(corners.tr) ||
            !inBounds(corners.br) || !inBounds(corners.bl)) {
            return null;
        }
        
        return corners;
    },
    
    /**
     * Calculate distance between two corner sets
     */
    cornerDistance(c1, c2) {
        if (!c1 || !c2) return Infinity;
        
        const dist = (p1, p2) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
        
        return (
            dist(c1.tl, c2.tl) +
            dist(c1.tr, c2.tr) +
            dist(c1.br, c2.br) +
            dist(c1.bl, c2.bl)
        ) / 4;
    },
    
    /**
     * Fix weak corner by calculating 4th from other 3
     */
    fixWeakCorner(corners) {
        if (!corners) return null;
        // For now, just return corners as-is
        // Can implement parallelogram completion if needed
        return corners;
    },
    
    /**
     * Calculate area of quadrilateral
     */
    quadArea(corners) {
        if (!corners) return 0;
        
        // Shoelace formula
        const pts = [corners.tl, corners.tr, corners.br, corners.bl];
        let area = 0;
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            area += pts[i].x * pts[j].y;
            area -= pts[j].x * pts[i].y;
        }
        return Math.abs(area) / 2;
    },
    
    /**
     * Get center point of corners
     */
    center(corners) {
        if (!corners) return null;
        return {
            x: (corners.tl.x + corners.tr.x + corners.br.x + corners.bl.x) / 4,
            y: (corners.tl.y + corners.tr.y + corners.br.y + corners.bl.y) / 4
        };
    }
};
