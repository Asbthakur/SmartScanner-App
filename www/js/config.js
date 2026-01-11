/**
 * SmartScanner Configuration v2.0
 * Production-grade settings for document scanning
 */

const CONFIG = {
    // Version
    VERSION: '2.0.0',
    
    // ═══════════════════════════════════════════════════════════════
    // CAMERA
    // ═══════════════════════════════════════════════════════════════
    CAMERA: {
        WIDTH: 3840,          // 4K resolution for high quality prints
        HEIGHT: 2160,         // 4K resolution
        FACING_MODE: 'environment',
        PROCESS_SCALE: 0.25   // Scale down more for detection (4K is big)
    },
    
    // ═══════════════════════════════════════════════════════════════
    // DETECTION
    // ═══════════════════════════════════════════════════════════════
    DETECTION: {
        MIN_AREA_RATIO: 0.08,
        MAX_AREA_RATIO: 0.95,
        EDGE_MARGIN_RATIO: 0.02,
        CONTOUR_APPROX_EPSILON: 0.02,
        MIN_EDGE_DENSITY: 0.15      // NEW: Minimum edge density to trust heatmap
    },
    
    // ═══════════════════════════════════════════════════════════════
    // HEATMAP CNN (corner detection)
    // ═══════════════════════════════════════════════════════════════
    HEATMAP: {
        MODEL_PATH: './models/corner_heatmap.onnx',
        INPUT_SIZE: 128,
        OUTPUT_SIZE: 32,
        SKIP_FRAMES: 4,
        CONFIDENCE_TRUSTED: 0.25,
        CONFIDENCE_RESCUE: 0.30
    },
    
    // ═══════════════════════════════════════════════════════════════
    // DEWARP CNN (curve flattening)
    // ═══════════════════════════════════════════════════════════════
    DEWARP: {
        ENABLED: false,       // Disabled - enable for book scanning
        MODEL_PATH: './models/doc_dewarp.onnx',
        INPUT_SIZE: 256,
        MAX_DISPLACEMENT: 12
    },
    
    // ═══════════════════════════════════════════════════════════════
    // STABILITY (rectangle locking)
    // ═══════════════════════════════════════════════════════════════
    STABILITY: {
        LOCK_THRESHOLD: 8,
        UNLOCK_THRESHOLD: 3,
        STABLE_DISTANCE: 15,
        BIG_MOVEMENT: 50,
        UNLOCK_MOVEMENT: 60,
        MISSED_FRAMES_RESET: 5,
        NO_DOC_WARNING: 30
    },

    // ═══════════════════════════════════════════════════════════════
    // AUTO CAPTURE
    // ═══════════════════════════════════════════════════════════════
    AUTO_CAPTURE: {
        ENABLED: false,         // Disabled - manual capture only
        DELAY: 400,             // ms to wait after lock before capture
        SOUND: true             // Play shutter sound on manual capture
    },
    
    // ═══════════════════════════════════════════════════════════════
    // CORNER
    // ═══════════════════════════════════════════════════════════════
    CORNER: {
        WEAK_RATIO: 0.6,
        AGREEMENT_DISTANCE: 30
    },
    
    // ═══════════════════════════════════════════════════════════════
    // SMOOTHING
    // ═══════════════════════════════════════════════════════════════
    SMOOTH: {
        ALPHA: 0.4,
        LOCKED_ALPHA: 0.1
    },
    
    // ═══════════════════════════════════════════════════════════════
    // EDGE CROP (clean edges) - per-side percentages
    // ═══════════════════════════════════════════════════════════════
    EDGE_CROP: {
        ENABLED: true,
        TOP: 1.0,             // Reduced: Crop 1% from top
        RIGHT: 1.0,           // Reduced: Crop 1% from right
        BOTTOM: 0.5,          // Reduced: Crop 0.5% from bottom
        LEFT: 1.0,            // Reduced: Crop 1% from left
        WHITE_BORDER: 5       // Reduced: 5px white padding
    },

    // ═══════════════════════════════════════════════════════════════
    // DOCUMENT ENHANCEMENT (OkenScan-style processing)
    // ═══════════════════════════════════════════════════════════════
    ENHANCE: {
        WHITE_BALANCE: true,      // Auto white balance
        CLAHE: true,              // Adaptive local contrast
        TEXT_ENHANCE: true,       // Boost text darkness
        SHARPEN: true,            // Edge sharpening
        CLAHE_CLIP_LIMIT: 3.0,    // CLAHE contrast limit (was 2.0)
        CLAHE_TILE_SIZE: 8,       // CLAHE tile size
        TEXT_BOOST: 1.6,          // Text darkness multiplier (was 1.3)
        SHARPEN_AMOUNT: 0.4,      // Sharpening strength (was 0.3)
        WHITE_PAPER_TARGET: 255   // Target white level (was 250)
    },

    // ═══════════════════════════════════════════════════════════════
    // OUTPUT
    // ═══════════════════════════════════════════════════════════════
    OUTPUT: {
        MAX_DIMENSION: 4096,    // High resolution
        JPEG_QUALITY: 0.98      // Maximum quality for print
    },
    
    // ═══════════════════════════════════════════════════════════════
    // PDF
    // ═══════════════════════════════════════════════════════════════
    PDF: {
        PAGE_WIDTH: 210,
        PAGE_HEIGHT: 297,
        MARGIN: 5
    },
    
    // ═══════════════════════════════════════════════════════════════
    // COLORS
    // ═══════════════════════════════════════════════════════════════
    COLORS: {
        PRIMARY: '#6C5CE7',
        SUCCESS: '#00B894',
        WARNING: '#e17055',
        OVERLAY_DETECTING: 'rgba(108, 92, 231, 0.15)',
        OVERLAY_LOCKED: 'rgba(0, 184, 148, 0.25)'
    },
    
    // ═══════════════════════════════════════════════════════════════
    // ENHANCEMENT (Scanner-grade processing)
    // ═══════════════════════════════════════════════════════════════
    ENHANCEMENT: {
        BACKGROUND_WHITENING: true,
        SHADOW_REMOVAL: true,
        SHARPEN: true,
        DENOISE: true
    }
};

// Freeze config
Object.freeze(CONFIG);
Object.keys(CONFIG).forEach(key => {
    if (typeof CONFIG[key] === 'object') {
        Object.freeze(CONFIG[key]);
    }
});
