package com.manabrew.app

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private val safeArea = SafeAreaInsets()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(safeArea, "__ANDROID_SAFE_AREA__")

    val density = resources.displayMetrics.density
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val bars =
        insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
        )
      safeArea.set(
        bars.top / density,
        bars.right / density,
        bars.bottom / density,
        bars.left / density,
      )
      webView.evaluateJavascript(
        "window.dispatchEvent(new Event('android-safe-area-changed'))",
        null,
      )
      insets
    }
    ViewCompat.requestApplyInsets(webView)
  }
}

class SafeAreaInsets {
  @Volatile private var top = 0f
  @Volatile private var right = 0f
  @Volatile private var bottom = 0f
  @Volatile private var left = 0f

  fun set(t: Float, r: Float, b: Float, l: Float) {
    top = t
    right = r
    bottom = b
    left = l
  }

  @JavascriptInterface
  fun getInsets(): String = "{\"top\":$top,\"right\":$right,\"bottom\":$bottom,\"left\":$left}"
}
