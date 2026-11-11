package app.ploshchadka.sportmap;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String HOST = "appassets.androidplatform.net";
    private static final int LOCATION_REQUEST = 1;
    private static final int CATALOG_REQUEST = 2;
    private static final int BACKGROUND = Color.rgb(16, 21, 18);
    private static final Map<String, String> ASSETS = new java.util.HashMap<>();
    static {
        ASSETS.put("index.html", "text/html");
        ASSETS.put("style.css", "text/css");
        ASSETS.put("app.js", "application/javascript");
        ASSETS.put("photos.json", "application/json");
        ASSETS.put("icon.svg", "image/svg+xml");
        ASSETS.put("manifest.webmanifest", "application/manifest+json");
    }
    private WebView web;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
        web = new WebView(this);
        web.setBackgroundColor(BACKGROUND);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost()) && "https".equals(url.getScheme())
                    && "/catalog".equals(url.getPath()) && "GET".equals(request.getMethod())) {
                    return Catalog.load(MainActivity.this, url);
                }
                if (ORIGIN.equals(url.getScheme() + "://" + url.getAuthority())
                    && "/recent-location".equals(url.getPath()) && "GET".equals(request.getMethod())) {
                    return recentLocation();
                }
                return appAsset(url);
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost()) && "/import-catalog".equals(url.getPath())
                    && request.isForMainFrame() && request.hasGesture()) {
                    Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*")
                        .addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(picker, CATALOG_REQUEST);
                    return true;
                }
                if (HOST.equals(url.getHost()) && "https".equals(url.getScheme())) return false;
                if (!request.isForMainFrame() && "https".equals(url.getScheme())) return false;
                if (request.isForMainFrame() && request.hasGesture() && "https".equals(url.getScheme())) openExternal(url);
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                Uri uri = Uri.parse(origin);
                if (!HOST.equals(uri.getHost()) || !"https".equals(uri.getScheme())
                    || (uri.getPort() != -1 && uri.getPort() != 443)) {
                    callback.invoke(origin, false, false);
                } else if (hasLocation()) {
                    callback.invoke(origin, true, false);
                } else if (locationCallback == null) {
                    locationCallback = callback;
                    locationOrigin = origin;
                    requestPermissions(new String[] {
                        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION
                    }, LOCATION_REQUEST);
                } else {
                    callback.invoke(origin, false, false);
                }
            }
        });
        setContentView(web);
        web.loadUrl(ORIGIN + "/index.html");
    }

    private WebResourceResponse appAsset(Uri url) {
        if (!HOST.equals(url.getHost()) || !"https".equals(url.getScheme())) return null;
        String path = url.getPath();
        String name = "/".equals(path) ? "index.html" : path == null ? "" : path.substring(1);
        String type = ASSETS.get(name);
        if (type != null) {
            try {
                return new WebResourceResponse(type, "UTF-8", getAssets().open(name));
            } catch (IOException ignored) {}
        }
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private WebResourceResponse recentLocation() {
        Location best = null;
        double bestScore = Double.POSITIVE_INFINITY;
        if (hasLocation()) {
            LocationManager manager = getSystemService(LocationManager.class);
            if (manager != null) {
                for (String provider : manager.getProviders(true)) {
                    try {
                        Location fix = manager.getLastKnownLocation(provider);
                        if (fix == null || !fix.hasAccuracy() || fix.getAccuracy() > 1000) continue;
                        long age = SystemClock.elapsedRealtimeNanos() - fix.getElapsedRealtimeNanos();
                        if (age < 0 || age > 120_000_000_000L) continue;
                        double score = fix.getAccuracy() + age / 1_000_000_000.0;
                        if (score < bestScore) {
                            best = fix;
                            bestScore = score;
                        }
                    } catch (IllegalArgumentException | SecurityException ignored) {}
                }
            }
        }
        String json = best == null ? "null"
            : "[" + best.getLatitude() + "," + best.getLongitude() + "]";
        Map<String,String> headers = new java.util.HashMap<>();
        headers.put("Cache-Control","no-store");
        headers.put("Cross-Origin-Resource-Policy","same-origin");
        return new WebResourceResponse("application/json","UTF-8",200,"OK",headers,
            new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == LOCATION_REQUEST && locationCallback != null) {
            GeolocationPermissions.Callback callback = locationCallback;
            String origin = locationOrigin;
            locationCallback = null;
            locationOrigin = null;
            boolean granted = hasLocation();
            callback.invoke(origin, granted, false);
            if (granted) web.evaluateJavascript("window.dispatchEvent(new Event('location-granted'))",null);
        }
    }

    private void openExternal(Uri url) {
        String host = url.getHost();
        if ("2gis.ru".equals(host) && url.getPath() != null && url.getPath().startsWith("/routeSearch/")) {
            if (launch(url.buildUpon().scheme("dgis").build(), "ru.dublgis.dgismobile")) return;
        }
        if ("yandex.ru".equals(host) && launch(url, "ru.yandex.yandexmaps")) return;
        if ("www.google.com".equals(host) && launch(url, "com.google.android.apps.maps")) return;
        if (!launch(url, null)) Toast.makeText(this, "Нет приложения для открытия ссылки", Toast.LENGTH_SHORT).show();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != CATALOG_REQUEST || result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        new Thread(() -> {
            try (java.io.InputStream input = getContentResolver().openInputStream(uri)) {
                if (input == null) throw new IOException("No catalog file");
                Catalog.install(this, input);
                runOnUiThread(() -> {
                    if (isDestroyed()) return;
                    Toast.makeText(this, "База площадок обновлена", Toast.LENGTH_SHORT).show();
                    web.reload();
                });
            } catch (Exception invalid) {
                runOnUiThread(() -> Toast.makeText(this, "Не удалось открыть базу площадок", Toast.LENGTH_LONG).show());
            }
        }, "catalog-import").start();
    }

    private boolean launch(Uri url, String appPackage) {
        Intent intent = new Intent(Intent.ACTION_VIEW, url);
        if (appPackage != null) intent.setPackage(appPackage);
        try {
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException exception) {
            return false;
        }
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("document.querySelector('#details')?.open ? (document.querySelector('#details').close(), true) : false",
            closed -> { if (!"true".equals(closed)) super.onBackPressed(); });
    }

    @Override protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
