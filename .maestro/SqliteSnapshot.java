import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;

/** Test-only, read-only, single-statement snapshot. Coordinates never leave the device. */
public final class SqliteSnapshot {
  public static void main(String[] args) throws Exception {
    String query = "SELECT r.id,r.status,r.active_duration_ms,r.distance_meters,r.last_saved_at_ms,"
      + "r.ended_at_ms,r.completion_reason,r.segment_index,r.state_revision,l.segment_index AS location_segment,"
      + "COUNT(l.id) AS point_count,MIN(l.recorded_at_ms) AS first_timestamp,MAX(l.recorded_at_ms) AS last_timestamp,"
      + "(SELECT distance_delta_meters FROM run_locations f WHERE f.run_id=r.id AND f.segment_index=l.segment_index ORDER BY recorded_at_ms LIMIT 1) AS first_delta,"
      + "(SELECT COUNT(*) FROM runs) AS total_runs,(SELECT COUNT(*) FROM run_locations) AS total_points,"
      + "(SELECT COUNT(*) FROM run_locations WHERE run_id NOT IN (SELECT id FROM runs)) AS orphan_points,"
      + "(SELECT background_tracking_enabled FROM app_settings WHERE id=1) AS background_enabled,"
      + "(SELECT user_version FROM pragma_user_version) AS schema_version "
      + "FROM (SELECT 1) seed LEFT JOIN runs r ON 1=1 LEFT JOIN run_locations l ON l.run_id=r.id "
      + "GROUP BY r.id,l.segment_index ORDER BY r.started_at_ms DESC,l.segment_index";
    JSONArray rows = new JSONArray();
    try (SQLiteDatabase db = SQLiteDatabase.openDatabase(args[0], null,
        SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS);
        Cursor cursor = db.rawQuery(query, null)) {
      while (cursor.moveToNext()) {
        JSONObject row = new JSONObject();
        for (int i=0;i<cursor.getColumnCount();i++) {
          Object value;
          switch (cursor.getType(i)) {
            case Cursor.FIELD_TYPE_NULL: value=JSONObject.NULL; break;
            case Cursor.FIELD_TYPE_INTEGER: value=cursor.getLong(i); break;
            case Cursor.FIELD_TYPE_FLOAT: value=cursor.getDouble(i); break;
            default: value=cursor.getString(i);
          }
          row.put(cursor.getColumnName(i),value);
        }
        rows.put(row);
      }
    }
    System.out.println(rows.toString());
  }
}
