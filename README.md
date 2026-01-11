# SmartScanner App

Professional document scanner with AI-powered edge detection.

## Features

- 📷 Real-time document detection
- 🎯 AI-powered corner detection (CNN + OpenCV)
- ✂️ Automatic perspective correction
- 🎨 Document enhancement (CamScanner-quality)
- 📄 PDF export
- 📤 Share via WhatsApp

## Setup

### Prerequisites

- Node.js 18+
- Android Studio (for local builds)

### Install

```bash
npm install
npx cap add android
npx cap sync
```

### Build APK

```bash
cd android
./gradlew assembleDebug
```

APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`

## Required Files

Add these files manually (too large for git):

- `www/lib/opencv.js` - OpenCV.js library (~8MB)
- `www/models/corner_heatmap.onnx` - Corner detection model (~2MB)

## License

MIT
