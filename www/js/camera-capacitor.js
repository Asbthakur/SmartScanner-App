/**
 * Camera Module for Capacitor
 * Handles camera access in both browser and native app (Android/iOS)
 * 
 * In Browser: Uses getUserMedia (for testing)
 * In Native App: Uses Capacitor Camera plugin
 */

const CameraModule = {
    // State
    isNative: false,
    stream: null,
    videoElement: null,
    
    /**
     * Initialize camera module
     */
    init(videoElement) {
        this.videoElement = videoElement;
        
        // Check if running in Capacitor native app
        this.isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
        
        console.log(`📷 Camera Module initialized`);
        console.log(`   Platform: ${this.isNative ? 'Native (Capacitor)' : 'Browser'}`);
        
        if (this.isNative) {
            console.log(`   Using: Capacitor Camera Plugin`);
        } else {
            console.log(`   Using: getUserMedia API`);
        }
    },

    /**
     * Check camera permissions
     */
    async checkPermissions() {
        if (this.isNative && typeof Capacitor !== 'undefined') {
            try {
                const { Camera } = Capacitor.Plugins;
                const permissions = await Camera.checkPermissions();
                console.log('📷 Camera permissions:', permissions);
                return permissions.camera === 'granted';
            } catch (e) {
                console.error('Permission check failed:', e);
                return false;
            }
        }
        return true; // Browser handles permissions in getUserMedia
    },

    /**
     * Request camera permissions
     */
    async requestPermissions() {
        if (this.isNative && typeof Capacitor !== 'undefined') {
            try {
                const { Camera } = Capacitor.Plugins;
                const permissions = await Camera.requestPermissions();
                return permissions.camera === 'granted';
            } catch (e) {
                console.error('Permission request failed:', e);
                return false;
            }
        }
        return true;
    },

    /**
     * Start camera preview
     * For native: We'll use getUserMedia with higher constraints
     * The native camera will be used only for HD capture
     */
    async startPreview(config = {}) {
        const defaultConfig = {
            facingMode: 'environment',
            width: 1920,
            height: 1080
        };
        
        const settings = { ...defaultConfig, ...config };
        
        try {
            // For both native and browser, use getUserMedia for PREVIEW
            // Native capture will use Capacitor Camera plugin for HD
            
            // Stop existing stream
            this.stopPreview();
            
            // Try to get camera with best possible settings
            let stream = null;
            
            // Try ideal settings first
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: settings.facingMode,
                        width: { ideal: settings.width, min: 640 },
                        height: { ideal: settings.height, min: 480 }
                    },
                    audio: false
                });
            } catch (e) {
                console.warn('Ideal camera settings failed, trying basic...', e);
                
                // Fallback for Android WebView - simpler constraints
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            facingMode: { exact: 'environment' }
                        },
                        audio: false
                    });
                } catch (e2) {
                    console.warn('Exact facingMode failed, trying any camera...', e2);
                    
                    // Last resort - any camera
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                        audio: false
                    });
                }
            }
            
            this.stream = stream;
            
            if (this.videoElement) {
                this.videoElement.srcObject = stream;
                
                // Wait for video to be ready
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        console.warn('Video loadedmetadata timeout, continuing...');
                        resolve();
                    }, 5000);
                    
                    this.videoElement.onloadedmetadata = () => {
                        clearTimeout(timeout);
                        resolve();
                    };
                    
                    this.videoElement.onerror = (e) => {
                        clearTimeout(timeout);
                        reject(new Error('Video element error'));
                    };
                });
                
                await this.videoElement.play();
            }
            
            const track = stream.getVideoTracks()[0];
            const actualSettings = track.getSettings();
            
            console.log(`📷 Camera preview started: ${actualSettings.width}x${actualSettings.height}`);
            
            return {
                success: true,
                width: actualSettings.width || settings.width,
                height: actualSettings.height || settings.height
            };
            
        } catch (err) {
            console.error('❌ Camera preview failed:', err);
            return {
                success: false,
                error: this.getErrorMessage(err)
            };
        }
    },

    /**
     * Stop camera preview
     */
    stopPreview() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => {
                track.stop();
                console.log(`   Stopped track: ${track.kind}`);
            });
            this.stream = null;
        }
        
        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }
    },

    /**
     * Capture HD image
     * In Browser: Capture from video stream
     * In Native: Use Capacitor Camera for full resolution
     */
    async captureHD() {
        if (this.isNative) {
            return await this.captureNative();
        } else {
            return await this.captureFromVideo();
        }
    },

    /**
     * Capture from video stream (browser/fallback)
     */
    async captureFromVideo() {
        if (!this.videoElement || !this.stream) {
            return { success: false, error: 'Camera not active' };
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = this.videoElement.videoWidth;
        canvas.height = this.videoElement.videoHeight;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.videoElement, 0, 0);
        
        console.log(`📸 Captured from video: ${canvas.width}x${canvas.height}`);
        
        return {
            success: true,
            canvas: canvas,
            width: canvas.width,
            height: canvas.height,
            source: 'video'
        };
    },

    /**
     * Capture using Capacitor Camera (native HD)
     */
    async captureNative() {
        if (typeof Capacitor === 'undefined' || !Capacitor.Plugins.Camera) {
            console.warn('Capacitor Camera not available, falling back to video capture');
            return await this.captureFromVideo();
        }
        
        try {
            const { Camera } = Capacitor.Plugins;
            
            console.log('📸 Requesting native HD capture...');
            
            // Capture photo using native camera
            const photo = await Camera.getPhoto({
                quality: 100,
                allowEditing: false,
                resultType: 'dataUrl', // Get as base64 data URL
                source: 'CAMERA',
                direction: 'REAR',
                correctOrientation: true,
                saveToGallery: false,
                width: 4096,  // Request high resolution
                height: 3072
            });
            
            // Convert data URL to canvas
            const canvas = await this.dataUrlToCanvas(photo.dataUrl);
            
            console.log(`📸 Native HD capture: ${canvas.width}x${canvas.height}`);
            
            return {
                success: true,
                canvas: canvas,
                width: canvas.width,
                height: canvas.height,
                source: 'native'
            };
            
        } catch (err) {
            console.error('Native capture failed:', err);
            
            // If user cancelled, return specific error
            if (err.message && err.message.includes('cancelled')) {
                return { success: false, error: 'Capture cancelled', cancelled: true };
            }
            
            // Fallback to video capture
            console.log('Falling back to video capture...');
            return await this.captureFromVideo();
        }
    },

    /**
     * Convert data URL to canvas
     */
    dataUrlToCanvas(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.getContext('2d').drawImage(img, 0, 0);
                resolve(canvas);
            };
            img.onerror = reject;
            img.src = dataUrl;
        });
    },

    /**
     * Get user-friendly error message
     */
    getErrorMessage(err) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            return 'Camera permission denied. Please allow camera access in app settings.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            return 'No camera found on this device.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            return 'Camera is in use by another app. Close other apps and try again.';
        } else if (err.name === 'OverconstrainedError') {
            return 'Camera does not support requested settings.';
        } else {
            return 'Camera error: ' + (err.message || 'Unknown error');
        }
    },

    /**
     * Check if native capture is available
     */
    hasNativeCapture() {
        return this.isNative && typeof Capacitor !== 'undefined' && Capacitor.Plugins.Camera;
    }
};

// Export for use in app
window.CameraModule = CameraModule;
