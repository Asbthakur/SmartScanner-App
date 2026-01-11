/**
 * Heatmap CNN Detector
 * Uses ONNX Runtime to run corner detection model
 */

const HeatmapDetector = {
    
    session: null,
    modelReady: false,
    lastCorners: null,
    lastConfidence: 0,
    frameCount: 0,
    
    /**
     * Initialize the ONNX model
     */
    async init() {
        try {
            const modelPath = CONFIG?.HEATMAP?.MODEL_PATH ?? './models/corner_heatmap.onnx';
            
            console.log('🔥 Loading heatmap model...');
            this.session = await ort.InferenceSession.create(modelPath, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            
            this.modelReady = true;
            console.log('✅ Heatmap model loaded');
            return true;
        } catch (err) {
            console.error('❌ Heatmap model failed to load:', err);
            this.modelReady = false;
            return false;
        }
    },
    
    /**
     * Run detection on image
     * @param {ImageData} imageData 
     * @param {number} w - Width
     * @param {number} h - Height
     * @returns {Object|null} Corners with confidence
     */
    async detect(imageData, w, h) {
        if (!this.modelReady || !this.session) return null;
        
        // Skip frames for performance
        this.frameCount++;
        const skipFrames = CONFIG?.HEATMAP?.SKIP_FRAMES ?? 4;
        if (this.frameCount % skipFrames !== 0) {
            return this.lastCorners;
        }
        
        try {
            const inputSize = CONFIG?.HEATMAP?.INPUT_SIZE ?? 128;
            const outputSize = CONFIG?.HEATMAP?.OUTPUT_SIZE ?? 32;
            
            // Resize image to model input size
            const resized = this.resizeImageData(imageData, w, h, inputSize, inputSize);
            
            // Normalize to [0, 1]
            const input = new Float32Array(inputSize * inputSize * 3);
            for (let i = 0; i < inputSize * inputSize; i++) {
                input[i] = resized[i * 4] / 255;                    // R
                input[i + inputSize * inputSize] = resized[i * 4 + 1] / 255;     // G
                input[i + inputSize * inputSize * 2] = resized[i * 4 + 2] / 255; // B
            }
            
            // Create tensor
            const tensor = new ort.Tensor('float32', input, [1, 3, inputSize, inputSize]);
            
            // Run inference
            const feeds = { [this.session.inputNames[0]]: tensor };
            const results = await this.session.run(feeds);
            const output = results[this.session.outputNames[0]].data;
            
            // Parse heatmap output (4 corners x outputSize x outputSize)
            const corners = this.parseHeatmaps(output, outputSize, w, h);
            
            if (corners) {
                this.lastCorners = corners;
                this.lastConfidence = corners._confidence;
            }
            
            return corners;
            
        } catch (err) {
            console.error('Heatmap detection error:', err);
            return null;
        }
    },
    
    /**
     * Resize ImageData to target size
     */
    resizeImageData(imageData, srcW, srcH, dstW, dstH) {
        const canvas = document.createElement('canvas');
        canvas.width = dstW;
        canvas.height = dstH;
        const ctx = canvas.getContext('2d');
        
        // Create temp canvas with source
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = srcW;
        srcCanvas.height = srcH;
        srcCanvas.getContext('2d').putImageData(imageData, 0, 0);
        
        // Draw resized
        ctx.drawImage(srcCanvas, 0, 0, dstW, dstH);
        
        return ctx.getImageData(0, 0, dstW, dstH).data;
    },
    
    /**
     * Parse heatmap output to corner coordinates
     */
    parseHeatmaps(output, outputSize, frameW, frameH) {
        const corners = ['tl', 'tr', 'br', 'bl'];
        const result = {};
        let totalConf = 0;
        
        for (let c = 0; c < 4; c++) {
            const offset = c * outputSize * outputSize;
            let maxVal = -Infinity;
            let maxX = 0, maxY = 0;
            
            // Find max in heatmap
            for (let y = 0; y < outputSize; y++) {
                for (let x = 0; x < outputSize; x++) {
                    const val = output[offset + y * outputSize + x];
                    if (val > maxVal) {
                        maxVal = val;
                        maxX = x;
                        maxY = y;
                    }
                }
            }
            
            // Scale to frame coordinates
            result[corners[c]] = {
                x: (maxX / outputSize) * frameW,
                y: (maxY / outputSize) * frameH
            };
            
            totalConf += Math.max(0, Math.min(1, maxVal));
        }
        
        result._confidence = totalConf / 4;
        
        return result;
    },
    
    /**
     * Check if model is ready
     */
    isReady() {
        return this.modelReady;
    },
    
    /**
     * Get last detection confidence
     */
    getConfidence() {
        return this.lastConfidence;
    }
};
