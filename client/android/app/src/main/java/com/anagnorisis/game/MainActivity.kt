package com.anagnorisis.game

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.preference.PreferenceManager

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var lastLoadedUrl: String = ""

    // Deferred geolocation permission — held until Android grants/denies the OS prompt
    private var geolocationCallback: GeolocationPermissions.Callback? = null
    private var geolocationOrigin: String? = null

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                      permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        geolocationCallback?.invoke(geolocationOrigin, granted, false)
        geolocationCallback = null
        geolocationOrigin = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webview)
        setupWebView()
        loadGameUrl()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true          // localStorage for game state cache
        settings.databaseEnabled = true
        settings.geolocationEnabled = true        // GPS → WebView JS geolocation API
        settings.mediaPlaybackRequiresUserGesture = false
        // Allow HTTP content from local server (usesCleartextTraffic also set in manifest)
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    showConnectionError()
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback
            ) {
                val fineOk = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                val coarseOk = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.ACCESS_COARSE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED

                if (fineOk || coarseOk) {
                    // Already have permission — pass straight through
                    callback.invoke(origin, true, false)
                } else {
                    // Ask Android; answer forwarded in locationPermissionLauncher callback
                    geolocationCallback = callback
                    geolocationOrigin = origin
                    locationPermissionLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        )
                    )
                }
            }
        }
    }

    private fun serverUrl(): String {
        val prefs = PreferenceManager.getDefaultSharedPreferences(this)
        return prefs.getString("server_url", getString(R.string.pref_server_url_default))
            ?: getString(R.string.pref_server_url_default)
    }

    private fun loadGameUrl() {
        lastLoadedUrl = serverUrl()
        webView.loadUrl(lastLoadedUrl)
    }

    private fun showConnectionError() {
        AlertDialog.Builder(this)
            .setTitle(R.string.error_title)
            .setMessage(R.string.error_msg)
            .setPositiveButton(R.string.btn_settings) { _, _ -> openSettings() }
            .setNegativeButton(R.string.btn_retry) { _, _ -> loadGameUrl() }
            .show()
    }

    private fun openSettings() {
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, MENU_SETTINGS, 0, "Settings")
            .setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER)
        menu.add(0, MENU_REFRESH, 1, "Refresh")
            .setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        MENU_SETTINGS -> { openSettings(); true }
        MENU_REFRESH  -> { loadGameUrl(); true }
        else          -> super.onOptionsItemSelected(item)
    }

    override fun onResume() {
        super.onResume()
        // Reload only if the server URL was changed in Settings
        val current = serverUrl()
        if (current != lastLoadedUrl) loadGameUrl()
    }

    @Deprecated("Deprecated in API 33 — use OnBackPressedDispatcher in future")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    companion object {
        private const val MENU_SETTINGS = 1
        private const val MENU_REFRESH  = 2
    }
}
