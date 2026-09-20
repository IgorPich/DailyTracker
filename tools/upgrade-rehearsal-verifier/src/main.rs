use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    path::Path,
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Expectations {
    synthetic_only: bool,
    source_classification: String,
    #[serde(default)]
    user_added_exercise_ids: Vec<String>,
    #[serde(default)]
    expected_template_codes: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Capture {
    format_version: u32,
    stage: String,
    app_version: String,
    schema_version: i64,
    protocol_version: u32,
    data_version: i64,
    integrity_check: String,
    counts: BTreeMap<String, i64>,
    duplicate_ids: BTreeMap<String, i64>,
    section_hashes: BTreeMap<String, String>,
    template_programs: Value,
    exercise_definitions: Value,
    gyms: Value,
    journal: Value,
    sync_counts: BTreeMap<String, i64>,
    expected_user_added_exercise_ids: Vec<String>,
    expected_template_codes: Vec<String>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("upgrade rehearsal verifier: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("audit-seed") if args.len() == 4 => audit_seed(Path::new(&args[2]), Path::new(&args[3])),
        Some("capture") if args.len() == 8 => {
            let expected_schema = args[6].parse::<i64>()?;
            let capture = capture(Path::new(&args[2]), &args[4], &args[5], expected_schema, Path::new(&args[7]))?;
            write_json(Path::new(&args[3]), &capture)
        }
        Some("compare") if args.len() == 5 => compare_files(Path::new(&args[2]), Path::new(&args[3]), Path::new(&args[4])),
        _ => Err("usage: audit-seed <db> <expectations> | capture <db> <out> <stage> <app-version> <expected-schema> <expectations> | compare <before> <after> <out>".into()),
    }
}

fn expectations(path: &Path) -> Result<Expectations> {
    let value: Expectations = serde_json::from_slice(&fs::read(path)?)?;
    if !value.synthetic_only || value.source_classification != "SANITIZED_REHEARSAL_COPY" {
        return Err("expectations must declare syntheticOnly=true and sourceClassification=SANITIZED_REHEARSAL_COPY".into());
    }
    Ok(value)
}

fn open_read_only(path: &Path) -> Result<Connection> {
    if !path.is_file() {
        return Err(format!("database does not exist: {}", path.display()).into());
    }
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?)
}

fn schema(conn: &Connection) -> Result<i64> {
    Ok(conn.pragma_query_value(None, "user_version", |row| row.get(0))?)
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn scalar(conn: &Connection, sql: &str) -> Result<i64> {
    Ok(conn.query_row(sql, [], |row| row.get(0))?)
}

fn integrity(conn: &Connection) -> Result<String> {
    Ok(conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?)
}

fn payload(conn: &Connection) -> Result<(i64, Value)> {
    let (version, raw): (i64, String) = conn.query_row(
        "SELECT data_version, payload_json FROM app_data WHERE singleton_id=1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let value: Value = serde_json::from_str(&raw)?;
    if value.get("version").and_then(Value::as_i64) != Some(version) {
        return Err("app_data data_version does not match payload version".into());
    }
    Ok((version, value))
}

fn audit_seed(db: &Path, expectation_path: &Path) -> Result<()> {
    let expected = expectations(expectation_path)?;
    let conn = open_read_only(db)?;
    if schema(&conn)? != 7 {
        return Err("sanitized rehearsal seed must be schema 7".into());
    }
    if integrity(&conn)? != "ok" {
        return Err("sanitized rehearsal seed failed SQLite integrity_check".into());
    }
    for table in ["paired_devices", "pairing_windows"] {
        if table_exists(&conn, table)?
            && scalar(&conn, &format!("SELECT COUNT(*) FROM {table}"))? != 0
        {
            return Err(
                format!("sanitized rehearsal seed contains forbidden rows in {table}").into(),
            );
        }
    }
    if table_exists(&conn, "sync_service_identity")?
        && scalar(
            &conn,
            "SELECT COUNT(*) FROM sync_service_identity WHERE identity_state='ready'",
        )? != 0
    {
        return Err("sanitized rehearsal seed contains a ready Sync Service identity".into());
    }
    let (_, data) = payload(&conn)?;
    validate_expectations(&data, &expected)?;
    println!("PASS: sanitized schema-7 rehearsal seed is structurally valid and contains no pairing/service identity material.");
    Ok(())
}

fn array<'a>(root: &'a Value, name: &str) -> Result<&'a Vec<Value>> {
    root.get(name)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("app_data.{name} must be an array").into())
}

fn validate_expectations(data: &Value, expected: &Expectations) -> Result<()> {
    let templates = array(data, "templates")?;
    let codes: BTreeSet<&str> = templates
        .iter()
        .filter_map(|v| v.get("code").and_then(Value::as_str))
        .collect();
    for code in &expected.expected_template_codes {
        if !codes.contains(code.as_str()) {
            return Err(format!("expected template code is absent: {code}").into());
        }
    }
    let library = array(data, "exerciseLibrary")?;
    let ids: BTreeSet<&str> = library
        .iter()
        .filter_map(|v| v.get("id").and_then(Value::as_str))
        .collect();
    for id in &expected.user_added_exercise_ids {
        if !ids.contains(id.as_str()) {
            return Err(format!("expected user-added exercise is absent: {id}").into());
        }
    }
    Ok(())
}

fn capture(
    db: &Path,
    stage: &str,
    app_version: &str,
    expected_schema: i64,
    expectation_path: &Path,
) -> Result<Capture> {
    let expected = expectations(expectation_path)?;
    let conn = open_read_only(db)?;
    let actual_schema = schema(&conn)?;
    if actual_schema != expected_schema {
        return Err(format!("expected schema {expected_schema}, found {actual_schema}").into());
    }
    let integrity_check = integrity(&conn)?;
    if integrity_check != "ok" {
        return Err(format!("SQLite integrity_check returned: {integrity_check}").into());
    }
    let (data_version, data) = payload(&conn)?;
    validate_expectations(&data, &expected)?;
    let daily = array(&data, "dailyEntries")?;
    let workouts = array(&data, "workouts")?;
    let templates = array(&data, "templates")?;
    let library = array(&data, "exerciseLibrary")?;
    let template_programs = project_templates(templates);
    let exercise_definitions = project_library(library);
    let gyms = project_gyms(&data, workouts);
    let journal = project_journal(&data, daily)?;
    validate_sync_coherence(&conn)?;
    let mut counts = BTreeMap::new();
    counts.insert("dailyEntries".into(), daily.len() as i64);
    counts.insert("workouts".into(), workouts.len() as i64);
    counts.insert("templates".into(), templates.len() as i64);
    counts.insert("exerciseLibrary".into(), library.len() as i64);
    let duplicate_ids = BTreeMap::from([
        ("dailyEntryIds".into(), duplicates(daily, "id")),
        ("dailyEntryDates".into(), duplicates(daily, "date")),
        ("workoutIds".into(), duplicates(workouts, "id")),
        ("templateIds".into(), duplicates(templates, "id")),
        ("exerciseIds".into(), duplicates(library, "id")),
    ]);
    if duplicate_ids.values().any(|v| *v != 0) {
        return Err("duplicate logical IDs/dates detected".into());
    }
    let waist_steps = Value::Array(daily.iter().map(|v| json!({"id":v.get("id"),"date":v.get("date"),"waist":v.get("waist"),"steps":v.get("steps")})).collect());
    let settings = data.get("settings").cloned().unwrap_or(Value::Null);
    let sections = [
        ("fullPayload", data.clone()),
        ("dailyEntries", Value::Array(daily.clone())),
        ("workoutSnapshots", Value::Array(workouts.clone())),
        ("templates", Value::Array(templates.clone())),
        ("exerciseLibrary", Value::Array(library.clone())),
        ("settings", settings),
        ("waistSteps", waist_steps),
        ("templatePrograms", template_programs.clone()),
        ("exerciseDefinitions", exercise_definitions.clone()),
        ("gyms", gyms.clone()),
        ("journal", journal.clone()),
    ];
    let section_hashes = sections
        .into_iter()
        .map(|(name, value)| Ok((name.into(), hash_value(&value)?)))
        .collect::<Result<_>>()?;
    Ok(Capture {
        format_version: 1,
        stage: stage.into(),
        app_version: app_version.into(),
        schema_version: actual_schema,
        protocol_version: 1,
        data_version,
        integrity_check,
        counts,
        duplicate_ids,
        section_hashes,
        template_programs,
        exercise_definitions,
        gyms,
        journal,
        sync_counts: sync_counts(&conn)?,
        expected_user_added_exercise_ids: expected.user_added_exercise_ids,
        expected_template_codes: expected.expected_template_codes,
    })
}

fn duplicates(values: &[Value], field: &str) -> i64 {
    let mut seen = BTreeSet::new();
    values
        .iter()
        .filter_map(|v| v.get(field).and_then(Value::as_str))
        .filter(|v| !seen.insert((*v).to_string()))
        .count() as i64
}

fn select(value: &Value, fields: &[&str]) -> Value {
    let mut result = Map::new();
    for field in fields {
        if let Some(v) = value.get(*field) {
            result.insert((*field).into(), v.clone());
        }
    }
    Value::Object(result)
}

fn project_templates(templates: &[Value]) -> Value {
    Value::Array(
        templates
            .iter()
            .map(|template| {
                let mut item = select(template, &["id", "code", "name"]);
                let exercises = template
                    .get("exercises")
                    .and_then(Value::as_array)
                    .map(|xs| {
                        xs.iter()
                            .map(|x| {
                                select(
                                    x,
                                    &[
                                        "id",
                                        "exerciseId",
                                        "prescription",
                                        "defaultSets",
                                        "equipmentSensitive",
                                    ],
                                )
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                item.as_object_mut()
                    .unwrap()
                    .insert("exercises".into(), Value::Array(exercises));
                item
            })
            .collect(),
    )
}

fn project_library(library: &[Value]) -> Value {
    Value::Array(
        library
            .iter()
            .map(|v| select(v, &["id", "aliases", "equipmentSensitive"]))
            .collect(),
    )
}

fn project_gyms(data: &Value, workouts: &[Value]) -> Value {
    let settings = data.get("settings").unwrap_or(&Value::Null);
    let used: Vec<Value> = workouts
        .iter()
        .filter_map(|v| v.get("gymLocation").cloned())
        .collect();
    json!({"configured":settings.get("gymLocations"),"last":settings.get("lastGymLocation"),"workoutHistory":used})
}

fn project_journal(data: &Value, daily: &[Value]) -> Result<Value> {
    if let Some(config) = data.pointer("/settings/journalConfiguration") {
        validate_journal_configuration(config)?;
        return Ok(json!({"source":"explicit","configuration":config}));
    }
    let metrics = [
        ("WEIGHT", Some("weight"), true),
        ("WAIST", Some("waist"), true),
        ("CALORIES", Some("calories"), true),
        ("PROTEIN", Some("protein"), true),
        ("CARBS", Some("carbs"), true),
        ("FAT", Some("fat"), true),
        ("STEPS", Some("steps"), true),
        ("SLEEP", Some("sleep"), false),
        ("RECOVERY", Some("recovery"), false),
        ("CHEST", None, false),
        ("BICEPS", None, false),
    ];
    let derived: Vec<Value> = metrics
        .iter()
        .map(|(id, field, default)| {
            let historical = field
                .map(|f| daily.iter().any(|v| v.get(f).is_some()))
                .unwrap_or(false);
            json!({"metricId":id,"initiallyTracked":*default || historical,"transitions":[]})
        })
        .collect();
    Ok(json!({"source":"legacy-derived","configuration":{"version":1,"metrics":derived}}))
}

fn validate_journal_configuration(config: &Value) -> Result<()> {
    if config.get("version").and_then(Value::as_i64) != Some(1) {
        return Err("journal configuration version must be 1".into());
    }
    let metrics = config
        .get("metrics")
        .and_then(Value::as_array)
        .ok_or("journal configuration metrics must be an array")?;
    let expected: BTreeSet<&str> = [
        "WEIGHT", "WAIST", "CALORIES", "PROTEIN", "CARBS", "FAT", "STEPS", "SLEEP", "RECOVERY",
        "CHEST", "BICEPS",
    ]
    .into_iter()
    .collect();
    let mut seen = BTreeSet::new();
    for metric in metrics {
        let id = metric
            .get("metricId")
            .and_then(Value::as_str)
            .ok_or("journal metricId must be a string")?;
        if !expected.contains(id) || !seen.insert(id) {
            return Err(format!("unknown or duplicate journal metricId: {id}").into());
        }
        if metric
            .get("initiallyTracked")
            .and_then(Value::as_bool)
            .is_none()
        {
            return Err(format!("journal metric {id} has invalid initiallyTracked").into());
        }
        let transitions = metric
            .get("transitions")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("journal metric {id} transitions must be an array"))?;
        let mut previous = "";
        for transition in transitions {
            let from = transition
                .get("from")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("journal metric {id} transition date is invalid"))?;
            let bytes = from.as_bytes();
            let date_shape = bytes.len() == 10
                && bytes[4] == b'-'
                && bytes[7] == b'-'
                && bytes
                    .iter()
                    .enumerate()
                    .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());
            if !date_shape
                || from <= previous
                || transition.get("tracked").and_then(Value::as_bool).is_none()
            {
                return Err(
                    format!("journal metric {id} has an invalid tracking transition").into(),
                );
            }
            previous = from;
        }
    }
    if seen != expected {
        return Err("journal configuration must contain every schema-8 metric exactly once".into());
    }
    Ok(())
}

fn sync_counts(conn: &Connection) -> Result<BTreeMap<String, i64>> {
    let mut result = BTreeMap::new();
    for table in [
        "sync_entities",
        "sync_outbox",
        "applied_operations",
        "sync_remote_entities",
        "daily_delivery",
        "daily_conflict_rejections",
    ] {
        if table_exists(conn, table)? {
            result.insert(
                table.into(),
                scalar(conn, &format!("SELECT COUNT(*) FROM {table}"))?,
            );
        }
    }
    if table_exists(conn, "sync_entities")? {
        result.insert(
            "sync_entities_tombstones".into(),
            scalar(
                conn,
                "SELECT COUNT(*) FROM sync_entities WHERE deleted_at IS NOT NULL",
            )?,
        );
    }
    if table_exists(conn, "sync_outbox")? {
        result.insert(
            "sync_outbox_pending".into(),
            scalar(
                conn,
                "SELECT COUNT(*) FROM sync_outbox WHERE acknowledged_at IS NULL",
            )?,
        );
    }
    Ok(result)
}

fn validate_sync_coherence(conn: &Connection) -> Result<()> {
    let checks = [
        ("sync_outbox", "SELECT COUNT(*) FROM sync_outbox o LEFT JOIN sync_entities e ON e.entity_type=o.entity_type AND e.entity_id=o.entity_id WHERE e.entity_id IS NULL"),
        ("sync_entity_order", "SELECT COUNT(*) FROM sync_entity_order o LEFT JOIN sync_entities e ON e.entity_type=o.entity_type AND e.entity_id=o.entity_id WHERE e.entity_id IS NULL"),
        ("sync_remote_entities", "SELECT COUNT(*) FROM sync_remote_entities e LEFT JOIN sync_remotes r ON r.service_id=e.service_id WHERE r.service_id IS NULL"),
        ("daily_delivery", "SELECT COUNT(*) FROM daily_delivery d LEFT JOIN sync_remotes r ON r.service_id=d.service_id LEFT JOIN sync_outbox o ON o.operation_id=d.operation_id WHERE r.service_id IS NULL OR o.operation_id IS NULL"),
    ];
    for (table, sql) in checks {
        if table_exists(conn, table)? {
            let violations = scalar(conn, sql)?;
            if violations != 0 {
                return Err(format!(
                    "sync coherence failed for {table}: {violations} orphan row(s)"
                )
                .into());
            }
        }
    }
    if table_exists(conn, "sync_meta")? && table_exists(conn, "sync_entities")? {
        let behind = scalar(conn, "SELECT COUNT(*) FROM sync_meta WHERE global_revision < COALESCE((SELECT MAX(revision) FROM sync_entities),0)")?;
        if behind != 0 {
            return Err("sync_meta.global_revision is behind sync_entities".into());
        }
    }
    Ok(())
}

fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), canonical(v)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

fn hash_value(value: &Value) -> Result<String> {
    let bytes = serde_json::to_vec(&canonical(value))?;
    Ok(format!("{:X}", Sha256::digest(bytes)))
}

fn compare_files(before_path: &Path, after_path: &Path, out: &Path) -> Result<()> {
    let before: Capture = serde_json::from_slice(&fs::read(before_path)?)?;
    let after: Capture = serde_json::from_slice(&fs::read(after_path)?)?;
    let mut checks = Vec::new();
    let is_upgrade = before.schema_version == 7;
    check(
        &mut checks,
        "target schema",
        after.schema_version == 8,
        format!("{}", after.schema_version),
    );
    check(
        &mut checks,
        "protocol remains 1",
        after.protocol_version == 1,
        format!("{}", after.protocol_version),
    );
    check(
        &mut checks,
        "SQLite integrity",
        after.integrity_check == "ok",
        after.integrity_check.clone(),
    );
    if is_upgrade {
        check(
            &mut checks,
            "target app version",
            after.app_version == "4.0.0-rc.1",
            after.app_version.clone(),
        );
    }
    check(
        &mut checks,
        "data version",
        before.data_version == after.data_version,
        format!("{} -> {}", before.data_version, after.data_version),
    );
    check(
        &mut checks,
        "logical counts",
        before.counts == after.counts,
        "counts compared".into(),
    );
    check(
        &mut checks,
        "no duplicate logical IDs",
        after.duplicate_ids.values().all(|v| *v == 0),
        format!("{:?}", after.duplicate_ids),
    );
    for (name, hash) in &before.section_hashes {
        check(
            &mut checks,
            &format!("unchanged {name}"),
            after.section_hashes.get(name) == Some(hash),
            "canonical SHA-256 compared".into(),
        );
    }
    for (name, count) in &before.sync_counts {
        if let Some(after_count) = after.sync_counts.get(name) {
            check(
                &mut checks,
                &format!("sync count {name}"),
                count == after_count,
                format!("{count} -> {after_count}"),
            );
        }
    }
    check(
        &mut checks,
        "expected user exercises",
        before.expected_user_added_exercise_ids.iter().all(|id| {
            after
                .exercise_definitions
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .any(|v| v.get("id").and_then(Value::as_str) == Some(id))
        }),
        "manifest expectations checked".into(),
    );
    check(
        &mut checks,
        "expected template codes",
        before.expected_template_codes.iter().all(|code| {
            after
                .template_programs
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .any(|v| v.get("code").and_then(Value::as_str) == Some(code))
        }),
        "manifest expectations checked".into(),
    );
    let passed = checks
        .iter()
        .all(|v: &Value| v.get("passed") == Some(&Value::Bool(true)));
    write_json(
        out,
        &json!({"formatVersion":1,"verdict":if passed {"PASS"} else {"FAIL"},"before":before.stage,"after":after.stage,"checks":checks}),
    )?;
    if !passed {
        return Err(format!("comparison failed; see {}", out.display()).into());
    }
    println!("PASS: {} -> {}", before.stage, after.stage);
    Ok(())
}

fn check(checks: &mut Vec<Value>, name: &str, passed: bool, detail: String) {
    checks.push(json!({"name":name,"passed":passed,"detail":detail}));
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    #[test]
    fn canonical_object_key_order_does_not_change_hash() {
        assert_eq!(
            hash_value(&json!({"b":2,"a":1})).unwrap(),
            hash_value(&json!({"a":1,"b":2})).unwrap()
        );
    }
    #[test]
    fn array_order_changes_hash() {
        assert_ne!(
            hash_value(&json!([1, 2])).unwrap(),
            hash_value(&json!([2, 1])).unwrap()
        );
    }
    #[test]
    fn duplicate_detection_is_exact() {
        assert_eq!(
            duplicates(
                &[json!({"id":"a"}), json!({"id":"a"}), json!({"id":"A"})],
                "id"
            ),
            1
        );
    }

    #[test]
    fn schema7_to_schema8_capture_and_comparison_passes_without_domain_changes() {
        let temp = tempfile::tempdir().unwrap();
        let db = temp.path().join("seed.sqlite");
        let expectations_path = temp.path().join("expectations.json");
        let baseline = temp.path().join("baseline.json");
        let post = temp.path().join("post.json");
        let comparison = temp.path().join("comparison.json");
        fs::write(
            &expectations_path,
            serde_json::to_vec(&json!({
                "syntheticOnly":true,
                "sourceClassification":"SANITIZED_REHEARSAL_COPY",
                "userAddedExerciseIds":["custom"],
                "expectedTemplateCodes":["A"]
            }))
            .unwrap(),
        )
        .unwrap();
        let payload = json!({
            "version":4,
            "dailyEntries":[{"id":"day","date":"2026-01-01","waist":80,"steps":9000}],
            "workouts":[{"id":"workout","date":"2026-01-01","templateId":"template-a","templateCode":"A","templateName":"A","exercises":[]}],
            "templates":[{"id":"template-a","code":"A","name":"A","exercises":[{"id":"row","exerciseId":"custom","prescription":"3 x 8","defaultSets":3}]}],
            "exerciseLibrary":[{"id":"custom","name":"Synthetic","equipmentSensitive":true,"aliases":["Old synthetic"]}],
            "settings":{"gymLocations":["Synthetic Gym"],"lastGymLocation":"Synthetic Gym"},
            "coachNotes":{}
        });
        {
            let conn = Connection::open(&db).unwrap();
            conn.execute_batch(
                "CREATE TABLE app_data(singleton_id INTEGER PRIMARY KEY,data_version INTEGER NOT NULL,payload_json TEXT NOT NULL);
                 CREATE TABLE paired_devices(device_id TEXT);
                 CREATE TABLE pairing_windows(nonce_hash TEXT);
                 CREATE TABLE sync_service_identity(singleton_id INTEGER PRIMARY KEY,identity_state TEXT NOT NULL);
                 INSERT INTO sync_service_identity VALUES(1,'uninitialized');
                 PRAGMA user_version=7;",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO app_data VALUES(1,4,?1)",
                [serde_json::to_string(&payload).unwrap()],
            )
            .unwrap();
        }
        audit_seed(&db, &expectations_path).unwrap();
        write_json(
            &baseline,
            &capture(&db, "baseline", "3.0.3", 7, &expectations_path).unwrap(),
        )
        .unwrap();
        Connection::open(&db)
            .unwrap()
            .execute_batch("PRAGMA user_version=8;")
            .unwrap();
        write_json(
            &post,
            &capture(&db, "post", "4.0.0-rc.1", 8, &expectations_path).unwrap(),
        )
        .unwrap();
        compare_files(&baseline, &post, &comparison).unwrap();
        let result: Value = serde_json::from_slice(&fs::read(comparison).unwrap()).unwrap();
        assert_eq!(result["verdict"], "PASS");
    }
}
