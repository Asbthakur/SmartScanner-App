package com.smartscanner.app;

import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Enable WebView camera permissions
        enableWebViewCamera();
    }
    
    private void enableWebViewCamera() {
        WebView webView = getBridge().getWebView();
        
        if (webView != null) {
            // Enable JavaScript (should already be enabled by Capacitor)
            webView.getSettings().setJavaScriptEnabled(true);
            
            // Enable media playback without gesture
            webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
            
            // Set WebChromeClient to handle permission requests
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    // Grant all requested permissions (camera, microphone, etc.)
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            request.grant(request.getResources());
                        }
                    });
                }
                
                @Override
                public void onPermissionRequestCanceled(PermissionRequest request) {
                    super.onPermissionRequestCanceled(request);
                }
            });
        }
    }
}
