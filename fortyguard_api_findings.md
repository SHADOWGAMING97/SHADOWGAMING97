# FortyGuard API findings

The official FortyGuard quickstart and Create Heatmap documentation confirm that requests use the `api-key` header and `Content-Type: application/json` against `https://api.fortyguard.com/v1/heatmap`. The POST is asynchronous: a successful submission returns an `activity_id`, not the final heatmap payload. The app must poll `GET https://api.fortyguard.com/v1/status/{activity_id}` with the same `api-key` header.

The status response contains `data.status`. Processing states must be polled with a bounded timeout. A terminal completed/succeeded state includes the final endpoint result; failed/error states must surface an actionable error. The Create Heatmap result contains `map_data` (GeoJSON FeatureCollection) and `stats_data`, where temperature statistics include a mean value. The submitted heatmap payload must include `polygon_aoi`, `date_time.start_date` in YYYY-MM-DD, `date_time.start_time` in HH:MM, `date_time.filter_type: 1`, and `granularity` 60, 80, or 100.

Source URLs: https://docs-api.fortyguard.com/docs/quickstart, https://docs-api.fortyguard.com/docs/create-heatmap, https://docs-api.fortyguard.com/docs/check-status
