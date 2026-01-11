/**
 * PDF Generator Module
 * Creates PDF from scanned pages using jsPDF
 * With proper Android/Capacitor support
 */

const PDFGenerator = {
    
    pdfBlob: null,
    pdfUrl: null,
    
    /**
     * Create PDF from pages
     * @param {Array} pages - Array of { dataUrl, width, height }
     * @returns {Promise<Blob>} PDF blob
     */
    async create(pages) {
        if (!pages || pages.length === 0) {
            throw new Error('No pages to create PDF');
        }
        
        // Check if jsPDF is available
        if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
            throw new Error('jsPDF library not loaded');
        }
        
        const { jsPDF } = window.jspdf || jspdf;
        
        // Get page dimensions from config
        const pageWidth = CONFIG?.PDF?.PAGE_WIDTH ?? 210;  // A4 width in mm
        const pageHeight = CONFIG?.PDF?.PAGE_HEIGHT ?? 297; // A4 height in mm
        const margin = CONFIG?.PDF?.MARGIN ?? 5;
        
        // Create PDF
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: [pageWidth, pageHeight]
        });
        
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            
            if (i > 0) {
                pdf.addPage();
            }
            
            // Calculate image dimensions to fit page
            const availW = pageWidth - (margin * 2);
            const availH = pageHeight - (margin * 2);
            
            const imgAspect = page.width / page.height;
            const pageAspect = availW / availH;
            
            let imgW, imgH, imgX, imgY;
            
            if (imgAspect > pageAspect) {
                // Image is wider - fit to width
                imgW = availW;
                imgH = availW / imgAspect;
            } else {
                // Image is taller - fit to height
                imgH = availH;
                imgW = availH * imgAspect;
            }
            
            // Center on page
            imgX = margin + (availW - imgW) / 2;
            imgY = margin + (availH - imgH) / 2;
            
            // Add image to PDF
            pdf.addImage(page.dataUrl, 'JPEG', imgX, imgY, imgW, imgH);
        }
        
        // Store blob for later use
        this.pdfBlob = pdf.output('blob');
        
        // Revoke old URL if exists
        if (this.pdfUrl) {
            URL.revokeObjectURL(this.pdfUrl);
        }
        this.pdfUrl = URL.createObjectURL(this.pdfBlob);
        
        return this.pdfBlob;
    },
    
    /**
     * Download PDF - Works on Android via Capacitor
     */
    async download(filename = 'scan.pdf') {
        if (!this.pdfBlob) {
            console.error('No PDF created yet');
            return false;
        }
        
        try {
            // Check if Capacitor Filesystem is available (Android app)
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
                return await this.downloadCapacitor(filename);
            }
            
            // Fallback: Browser download
            return this.downloadBrowser(filename);
            
        } catch (err) {
            console.error('Download failed:', err);
            // Ultimate fallback
            this.downloadBrowser(filename);
            return false;
        }
    },
    
    /**
     * Download via Capacitor (Android)
     */
    async downloadCapacitor(filename) {
        const { Filesystem, Directory } = window.Capacitor.Plugins;
        
        // Convert blob to base64
        const base64 = await this.blobToBase64(this.pdfBlob);
        
        // Save to Downloads folder
        const result = await Filesystem.writeFile({
            path: filename,
            data: base64,
            directory: Directory.Documents,
            recursive: true
        });
        
        console.log('✅ PDF saved to:', result.uri);
        
        // Show toast
        if (window.Capacitor.Plugins.Toast) {
            window.Capacitor.Plugins.Toast.show({
                text: `PDF saved to Documents/${filename}`,
                duration: 'long'
            });
        }
        
        return true;
    },
    
    /**
     * Download via browser (fallback)
     */
    downloadBrowser(filename) {
        const a = document.createElement('a');
        a.href = this.pdfUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return true;
    },
    
    /**
     * Share PDF via WhatsApp or system share
     */
    async share(filename = 'scan.pdf') {
        if (!this.pdfBlob) {
            console.error('No PDF created yet');
            return false;
        }
        
        try {
            // Check if Capacitor Share is available (Android app)
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
                return await this.shareCapacitor(filename);
            }
            
            // Fallback: Web Share API
            return await this.shareWebAPI(filename);
            
        } catch (err) {
            console.error('Share failed:', err);
            // Fallback to download
            await this.download(filename);
            return false;
        }
    },
    
    /**
     * Share via Capacitor (Android)
     */
    async shareCapacitor(filename) {
        const { Filesystem, Directory, Share } = window.Capacitor.Plugins;
        
        // First save the file
        const base64 = await this.blobToBase64(this.pdfBlob);
        
        const fileResult = await Filesystem.writeFile({
            path: filename,
            data: base64,
            directory: Directory.Cache,
            recursive: true
        });
        
        // Now share it
        await Share.share({
            title: 'Scanned Document',
            text: 'Scanned with SmartScanner',
            url: fileResult.uri,
            dialogTitle: 'Share PDF'
        });
        
        return true;
    },
    
    /**
     * Share via Web Share API
     */
    async shareWebAPI(filename) {
        if (!navigator.share || !navigator.canShare) {
            throw new Error('Web Share API not available');
        }
        
        const file = new File([this.pdfBlob], filename, { type: 'application/pdf' });
        
        if (!navigator.canShare({ files: [file] })) {
            throw new Error('Cannot share PDF files');
        }
        
        await navigator.share({
            files: [file],
            title: 'Scanned Document',
            text: 'Scanned with SmartScanner'
        });
        
        return true;
    },
    
    /**
     * Convert Blob to Base64
     */
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                // Remove data URL prefix
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },
    
    /**
     * Clear stored PDF
     */
    clear() {
        if (this.pdfUrl) {
            URL.revokeObjectURL(this.pdfUrl);
        }
        this.pdfBlob = null;
        this.pdfUrl = null;
    }
};
