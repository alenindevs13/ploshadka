package app.ploshchadka.sportmap;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import org.json.JSONArray;
import org.json.JSONObject;

final class Catalog {
    private static final String FILE = "catalog-v1.sqlite";
    private static final String COLUMNS = "id,name,kind,lat,lon,address,description";
    private static final String PREVIOUS_BUILT_IN = "5cb66cdfefd155c42a346a0acb6de38492917c1b8d431e05e4d16387793b1d3e";
    private static final String EXPANDED_BUILT_IN = "62bb243cc5e427aff4fe6116fc79976382bf70f0e0bbf36848ad6f046e6170b6";

    static synchronized WebResourceResponse load(Context context, Uri uri) {
        try {
            double lat = Double.parseDouble(uri.getQueryParameter("lat"));
            double lon = Double.parseDouble(uri.getQueryParameter("lon"));
            int radius = Integer.parseInt(uri.getQueryParameter("radius"));
            String offsetValue = uri.getQueryParameter("offset");
            int offset = offsetValue == null ? 0 : Integer.parseInt(offsetValue);
            if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat) > 90
                || Math.abs(lon) > 180 || radius < 500 || radius > 100000 || offset < 0) {
                return response(400, "Bad Request", "{}");
            }
            File file = new File(context.getFilesDir(), FILE);
            if (!file.isFile() || isPreviousBuiltIn(file)) {
                try (InputStream input = context.getAssets().open("catalog.sqlite")) {
                    install(context, input);
                }
            }
            JSONArray rows = new JSONArray();
            double latitudeSpan = radius / 110574.0;
            double longitudeSpan = Math.min(180, radius / (111320.0 * Math.max(0.001,
                Math.cos(Math.toRadians(Math.min(89.99, Math.abs(lat) + latitudeSpan))))));
            String where = "lat BETWEEN ? AND ? AND min(abs(lon - ?), 360 - abs(lon - ?)) <= CAST(? AS REAL)";
            String[] args = {Double.toString(lat - latitudeSpan), Double.toString(lat + latitudeSpan),
                Double.toString(lon), Double.toString(lon), Double.toString(longitudeSpan)};
            if ("1".equals(uri.getQueryParameter("all"))) {
                where = "1=1";
                args = new String[0];
            }
            String sql = "SELECT " + COLUMNS + " FROM places WHERE " + where
                + " ORDER BY (lat - " + lat + ")*(lat - " + lat + ") + "
                + Math.pow(Math.cos(Math.toRadians(lat)), 2) + "*min(abs(lon - " + lon
                + "),360-abs(lon - " + lon + "))*min(abs(lon - " + lon + "),360-abs(lon - "
                + lon + ")),id LIMIT 101 OFFSET " + offset;
            boolean more = false;
            try (SQLiteDatabase db = SQLiteDatabase.openDatabase(file.getPath(), null, SQLiteDatabase.OPEN_READONLY);
                 Cursor cursor = db.rawQuery(sql, args)) {
                while (cursor.moveToNext()) {
                    if (rows.length() == 100) {
                        more = true;
                        break;
                    }
                    rows.put(new JSONObject()
                        .put("id", cursor.getString(0)).put("name", cursor.getString(1))
                        .put("type", cursor.getString(2))
                        .put("lat", cursor.isNull(3) ? JSONObject.NULL : cursor.getDouble(3))
                        .put("lon", cursor.isNull(4) ? JSONObject.NULL : cursor.getDouble(4))
                        .put("address", cursor.getString(5))
                        .put("description", cursor.getString(6)));
                }
            }
            return response(200, "OK", new JSONObject().put("places", rows).put("more", more).toString());
        } catch (Exception unavailable) {
            return response(500, "Catalog Error", "{}");
        }
    }

    private static boolean isPreviousBuiltIn(File file) throws IOException, NoSuchAlgorithmException {
        if (file.length() != 16384 && file.length() != 36864) return false;
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file.toPath()));
        StringBuilder hex = new StringBuilder(64);
        for (byte value : digest) {
            hex.append(Character.forDigit((value & 255) >>> 4, 16));
            hex.append(Character.forDigit(value & 15, 16));
        }
        String hash = hex.toString();
        return PREVIOUS_BUILT_IN.equals(hash) || EXPANDED_BUILT_IN.equals(hash);
    }

    static synchronized void install(Context context, InputStream input) throws IOException {
        File target = new File(context.getFilesDir(), FILE);
        File pending = File.createTempFile("catalog-", ".sqlite", context.getFilesDir());
        try {
            try (FileOutputStream output = new FileOutputStream(pending)) {
                byte[] buffer = new byte[16384];
                int read;
                long total = 0;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > 512L * 1024 * 1024) throw new IOException("Catalog too large");
                    output.write(buffer, 0, read);
                }
                output.getFD().sync();
            }
            try (SQLiteDatabase db = SQLiteDatabase.openDatabase(pending.getPath(), null, SQLiteDatabase.OPEN_READONLY);
                 Cursor schema = db.rawQuery("PRAGMA user_version", null);
                 Cursor check = db.rawQuery("PRAGMA quick_check(1)", null);
                 Cursor columns = db.rawQuery("SELECT " + COLUMNS + " FROM places LIMIT 0", null)) {
                if (!schema.moveToFirst() || schema.getInt(0) != 1 || !check.moveToFirst()
                    || !"ok".equals(check.getString(0)) || columns.getColumnCount() != 7) {
                    throw new IOException("Unsupported catalog");
                }
            }
            Files.move(pending.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE);
        } finally {
            if (pending.exists()) pending.delete();
        }
    }

    private static WebResourceResponse response(int code, String reason, String body) {
        return new WebResourceResponse("application/json", "UTF-8", code, reason,
            Collections.singletonMap("Cache-Control", "no-store"),
            new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }
}
