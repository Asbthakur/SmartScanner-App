/**
 * Image Processor Module v2.0
 * Production-grade image processing for document scanning
 * 
 * KEY PRINCIPLES:
 * - Preview and Capture are SEPARATE pipelines
 * - Capture NEVER uses scaled data
 * - White background is forced after warp
 * - No quality loss until final export
 */

const ImageProcessor = {

    /**
     * Apply perspective correction to image
     * This is quality-critical - NO downscaling here
     * 
     * @param {HTMLCanvasElement} srcCanvas - Source image (FULL resolution)
     * @param {Object} corners - Corner coordinates { tl, tr, br, bl }
     * @returns {HTMLCanvasElement} Corrected image with white background
     */
    perspectiveCorrect(srcCanvas, corners) {
        if (!window.cvReady || typeof cv === 'undefined') {
            console.warn('OpenCV not ready for perspective correction');
            return srcCanvas;
        }
        
        // DEBUG: Log corner positions to verify they're correct
        console.log('🔍 Perspective corners (in video coords):', JSON.stringify({
            tl: { x: Math.round(corners.tl.x), y: Math.round(corners.tl.y) },
            tr: { x: Math.round(corners.tr.x), y: Math.round(corners.tr.y) },
            bl: { x: Math.round(corners.bl.x), y: Math.round(corners.bl.y) },
            br: { x: Math.round(corners.br.x), y: Math.round(corners.br.y) }
        }));
        
        // Calculate output dimensions from corner distances
        const widthTop = this.distance(corners.tl, corners.tr);
        const widthBottom = this.distance(corners.bl, corners.br);
        const heightLeft = this.distance(corners.tl, corners.bl);
        const heightRight = this.distance(corners.tr, corners.br);
        
        console.log('🔍 Edge lengths:', {
            top: Math.round(widthTop),
            bottom: Math.round(widthBottom),
            left: Math.round(heightLeft),
            right: Math.round(heightRight)
        });
        
        let outWidth = Math.round(Math.max(widthTop, widthBottom));
        let outHeight = Math.round(Math.max(heightLeft, heightRight));
        
        // ═══════════════════════════════════════════════════════════════
        // IMPORTANT: Only limit to prevent browser memory crash
        // In native app, this can be much higher (6000-8000)
        // ═══════════════════════════════════════════════════════════════
        const maxDim = CONFIG.OUTPUT.MAX_DIMENSION || 4096;
        if (outWidth > maxDim || outHeight > maxDim) {
            const scale = maxDim / Math.max(outWidth, outHeight);
            outWidth = Math.round(outWidth * scale);
            outHeight = Math.round(outHeight * scale);
            console.log(`📐 Scaled output to ${outWidth}x${outHeight} (max: ${maxDim})`);
        }
        
        let srcMat, srcPts, dstPts, M, dst;
        
        try {
            // Get source image data at FULL resolution
            const srcCtx = srcCanvas.getContext('2d');
            const imageData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
            srcMat = cv.matFromImageData(imageData);
            
            console.log(`📷 Perspective input: ${srcCanvas.width}x${srcCanvas.height}`);
            console.log(`📄 Perspective output: ${outWidth}x${outHeight}`);
            
            // Source points (corners from detection)
            srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
                corners.tl.x, corners.tl.y,
                corners.tr.x, corners.tr.y,
                corners.br.x, corners.br.y,
                corners.bl.x, corners.bl.y
            ]);
            
            // Destination points (rectangle)
            dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0,
                outWidth, 0,
                outWidth, outHeight,
                0, outHeight
            ]);
            
            // Get perspective transform matrix
            M = cv.getPerspectiveTransform(srcPts, dstPts);
            
            // ═══════════════════════════════════════════════════════════════
            // WARP with WHITE background (not black!)
            // This is critical for scanner-grade output
            // ═══════════════════════════════════════════════════════════════
            dst = new cv.Mat();
            const white = new cv.Scalar(255, 255, 255, 255);
            cv.warpPerspective(
                srcMat, 
                dst, 
                M, 
                new cv.Size(outWidth, outHeight),
                cv.INTER_LINEAR,      // Good quality interpolation
                cv.BORDER_CONSTANT,   // Fill border with constant color
                white                 // WHITE background
            );
            
            // Create output canvas
            const outCanvas = document.createElement('canvas');
            outCanvas.width = outWidth;
            outCanvas.height = outHeight;
            cv.imshow(outCanvas, dst);
            
            return outCanvas;
            
        } finally {
            // Cleanup OpenCV matrices
            if (srcMat) srcMat.delete();
            if (srcPts) srcPts.delete();
            if (dstPts) dstPts.delete();
            if (M) M.delete();
            if (dst) dst.delete();
        }
    },

    /**
     * Calculate distance between two points
     */
    distance(p1, p2) {
        return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    },

    /**
     * Capture frame from video at FULL RESOLUTION
     * This is the start of the CAPTURE pipeline
     * 
     * CRITICAL: This must use video.videoWidth/Height directly
     * NEVER use scaled preview data
     * 
     * @param {HTMLVideoElement} video 
     * @returns {HTMLCanvasElement} Full resolution frame
     */
    captureFrame(video) {
        const canvas = document.createElement('canvas');
        
        // ═══════════════════════════════════════════════════════════════
        // FULL RESOLUTION - no scaling!
        // ═══════════════════════════════════════════════════════════════
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        
        console.log(`📸 Captured frame: ${canvas.width}x${canvas.height}`);
        
        return canvas;
    },

    /**
     * Load image from file at FULL RESOLUTION
     * @param {File} file 
     * @returns {Promise<HTMLCanvasElement>}
     */
    loadImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                
                // Full resolution, no scaling
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.getContext('2d').drawImage(img, 0, 0);
                
                console.log(`📷 Loaded image: ${canvas.width}x${canvas.height}`);
                
                URL.revokeObjectURL(img.src);
                resolve(canvas);
            };
            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                reject(new Error('Failed to load image'));
            };
            img.src = URL.createObjectURL(file);
        });
    },

    /**
     * Resize canvas (only for final export if needed)
     * @param {HTMLCanvasElement} canvas 
     * @param {number} maxDim 
     * @returns {HTMLCanvasElement}
     */
    resize(canvas, maxDim) {
        if (canvas.width <= maxDim && canvas.height <= maxDim) {
            return canvas;
        }
        
        const scale = maxDim / Math.max(canvas.width, canvas.height);
        const newWidth = Math.round(canvas.width * scale);
        const newHeight = Math.round(canvas.height * scale);
        
        const resized = document.createElement('canvas');
        resized.width = newWidth;
        resized.height = newHeight;
        
        // Use high-quality scaling
        const ctx = resized.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, newWidth, newHeight);
        
        console.log(`📐 Resized: ${canvas.width}x${canvas.height} → ${newWidth}x${newHeight}`);
        
        return resized;
    },

    /**
     * Get SCALED image data for DETECTION ONLY
     * This is the PREVIEW pipeline - separate from capture
     * 
     * IMPORTANT: This data is ONLY for detection algorithms
     * NEVER use this for the final captured image
     * 
     * @param {HTMLVideoElement} video 
     * @param {number} scale - Scale factor (default from config)
     * @returns {{ imageData: ImageData, width: number, height: number }}
     */
    getScaledImageData(video, scale) {
        // Use config scale or default 0.5
        const processScale = scale || CONFIG.CAMERA.PROCESS_SCALE || 0.5;
        
        const w = Math.round(video.videoWidth * processScale);
        const h = Math.round(video.videoHeight * processScale);
        
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        
        // This is for DETECTION only, not capture
        return {
            imageData: ctx.getImageData(0, 0, w, h),
            width: w,
            height: h
        };
    },
    
    /**
     * Force white background on any remaining black/transparent pixels
     * Call this after perspective correction if needed
     * 
     * @param {HTMLCanvasElement} canvas
     * @returns {HTMLCanvasElement}
     */
    forceWhiteBackground(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            // If pixel is very dark or transparent, make it white
            if (data[i + 3] < 128 || (data[i] < 5 && data[i + 1] < 5 && data[i + 2] < 5)) {
                data[i] = 255;     // R
                data[i + 1] = 255; // G
                data[i + 2] = 255; // B
                data[i + 3] = 255; // A
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    },

    /**
     * Clean edges - crop inward and add white border
     * Makes scanned documents look professional
     * Supports per-side crop percentages: TOP, RIGHT, BOTTOM, LEFT
     * 
     * @param {HTMLCanvasElement} canvas - Input image
     * @returns {HTMLCanvasElement} - Cleaned image with white border
     */
    cleanEdges(canvas) {
        const config = CONFIG.EDGE_CROP || { ENABLED: false };
        
        if (!config.ENABLED) {
            return canvas;
        }
        
        // Support per-side percentages or fallback to uniform PERCENT
        const cropTop = config.TOP ?? config.PERCENT ?? 2.5;
        const cropRight = config.RIGHT ?? config.PERCENT ?? 2.5;
        const cropBottom = config.BOTTOM ?? config.PERCENT ?? 0.2;
        const cropLeft = config.LEFT ?? config.PERCENT ?? 2.5;
        const whiteBorder = config.WHITE_BORDER || 10;
        
        // Calculate crop amounts in pixels
        const cropT = Math.round(canvas.height * cropTop / 100);
        const cropR = Math.round(canvas.width * cropRight / 100);
        const cropB = Math.round(canvas.height * cropBottom / 100);
        const cropL = Math.round(canvas.width * cropLeft / 100);
        
        // New dimensions after crop
        const croppedWidth = canvas.width - cropL - cropR;
        const croppedHeight = canvas.height - cropT - cropB;
        
        // Final dimensions with white border
        const finalWidth = croppedWidth + (whiteBorder * 2);
        const finalHeight = croppedHeight + (whiteBorder * 2);
        
        console.log(`✂️ Edge crop: T=${cropTop}% R=${cropRight}% B=${cropBottom}% L=${cropLeft}%`);
        console.log(`📐 Crop pixels: T=${cropT}px R=${cropR}px B=${cropB}px L=${cropL}px`);
        console.log(`📐 Size: ${canvas.width}x${canvas.height} → ${finalWidth}x${finalHeight}`);
        
        // Create output canvas
        const outCanvas = document.createElement('canvas');
        outCanvas.width = finalWidth;
        outCanvas.height = finalHeight;
        const ctx = outCanvas.getContext('2d');
        
        // Fill with white background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, finalWidth, finalHeight);
        
        // Draw cropped image (crop from top-left corner)
        ctx.drawImage(
            canvas,
            cropL, cropT,                    // Source position (crop from left, top)
            croppedWidth, croppedHeight,     // Source size
            whiteBorder, whiteBorder,        // Destination position
            croppedWidth, croppedHeight      // Destination size (no scaling)
        );
        
        return outCanvas;
    }
};
