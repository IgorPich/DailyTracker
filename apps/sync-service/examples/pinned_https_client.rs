use reqwest::{Client, StatusCode};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error as RustlsError, SignatureScheme};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::env;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug)]
struct FingerprintVerifier {
    expected: [u8; 32],
    algorithms: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for FingerprintVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, RustlsError> {
        let actual: [u8; 32] = Sha256::digest(end_entity.as_ref()).into();
        if actual != self.expected {
            return Err(RustlsError::General(
                "GreekGod certificate fingerprint mismatch; re-pairing is required".into(),
            ));
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        verify_tls12_signature(message, certificate, signature, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        verify_tls13_signature(message, certificate, signature, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

fn pinned_client(fingerprint: &str) -> Result<Client, String> {
    let fingerprint = decode_fingerprint(fingerprint)?;
    let provider = rustls::crypto::ring::default_provider();
    let verifier = FingerprintVerifier {
        expected: fingerprint,
        algorithms: provider.signature_verification_algorithms,
    };
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(provider))
        .with_safe_default_protocol_versions()
        .map_err(|error| format!("TLS protocol configuration failed: {error}"))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    reqwest::Client::builder()
        .https_only(true)
        .tls_backend_preconfigured(config)
        .build()
        .map_err(|error| format!("pinned HTTPS client configuration failed: {error}"))
}

fn decode_fingerprint(value: &str) -> Result<[u8; 32], String> {
    if value.len() != 64 {
        return Err("fingerprint must contain exactly 64 hexadecimal characters".into());
    }
    let mut decoded = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let pair = std::str::from_utf8(pair).map_err(|_| "fingerprint is not UTF-8")?;
        decoded[index] = u8::from_str_radix(pair, 16)
            .map_err(|_| "fingerprint contains non-hexadecimal characters")?;
    }
    Ok(decoded)
}

fn compatibility() -> Value {
    json!({
        "appVersion": "3.0.0-tls-smoke",
        "protocolMin": 1,
        "protocolMax": 1,
        "schemaMin": 7,
        "schemaMax": 7,
        "deviceId": "mobile-tls-smoke",
        "lastServerRevision": 0
    })
}

fn with_auth(request: reqwest::RequestBuilder, token: &str) -> reqwest::RequestBuilder {
    request
        .bearer_auth(token)
        .header("x-greekgod-device-id", "mobile-tls-smoke")
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("Pinned HTTPS smoke client failed: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    if arguments.len() < 4 {
        return Err(
            "expected: <expired|full|shared-authority> <base-url> <fingerprint> <nonce> [desktop-edit-ack] [desktop-closed-ack]"
                .into(),
        );
    }
    let mode = &arguments[0];
    let base_url = arguments[1].trim_end_matches('/');
    let fingerprint = &arguments[2];
    let nonce = &arguments[3];
    let client = pinned_client(fingerprint)?;

    match mode.as_str() {
        "expired" => run_expired(&client, base_url, nonce).await,
        "full" => run_full(&client, base_url, fingerprint, nonce).await,
        "shared-authority" if arguments.len() == 6 => {
            run_shared_authority(
                &client,
                base_url,
                nonce,
                Path::new(&arguments[4]),
                Path::new(&arguments[5]),
            )
            .await
        }
        _ => Err("unknown smoke mode".into()),
    }
}

async fn run_shared_authority(
    client: &Client,
    base_url: &str,
    nonce: &str,
    desktop_edit_ack: &Path,
    desktop_closed_ack: &Path,
) -> Result<(), String> {
    let pair_body = json!({
        "nonce": nonce,
        "deviceId": "mobile-tls-smoke",
        "displayName": "Shared authority smoke phone"
    });
    let paired = client
        .post(format!("{base_url}/v1/pair"))
        .json(&pair_body)
        .send()
        .await
        .map_err(|error| format!("shared authority pair failed: {error}"))?;
    require_status(&paired, StatusCode::OK, "shared authority pair")?;
    let paired: Value = paired
        .json()
        .await
        .map_err(|error| format!("shared authority pair JSON failed: {error}"))?;
    let token = paired["credentials"]["deviceToken"]
        .as_str()
        .ok_or_else(|| "shared authority pairing token is missing".to_string())?
        .to_owned();
    let compatibility = compatibility();
    let handshake =
        authenticated_json(client, base_url, "/v1/handshake", &compatibility, &token).await?;
    let initial_revision = handshake["serverRevision"]
        .as_i64()
        .ok_or_else(|| "shared authority handshake revision is missing".to_string())?;

    let create = json!({
        "operationId": "42000000-0000-4000-8000-000000000001",
        "changeSetId": "43000000-0000-4000-8000-000000000001",
        "deviceId": "mobile-tls-smoke",
        "entityType": "workout",
        "entityId": "live-service-workout",
        "baseRevision": 0,
        "orderPosition": 1,
        "operationType": "upsert",
        "payload": {
            "id": "live-service-workout",
            "date": "2026-08-27",
            "templateId": "push",
            "templateCode": "A",
            "templateName": "PUSH",
            "note": "Service live mutation",
            "exercises": []
        }
    });
    let create_body = json!({ "compatibility": compatibility, "operations": [create] });
    let created =
        authenticated_json(client, base_url, "/v1/sync/push", &create_body, &token).await?;
    let create_revision = created["outcomes"][0]["result"]["revision"]
        .as_i64()
        .ok_or_else(|| "shared authority create was not accepted".to_string())?;
    if create_revision <= initial_revision {
        return Err("shared authority create revision is not monotonic".into());
    }
    let replay =
        authenticated_json(client, base_url, "/v1/sync/push", &create_body, &token).await?;
    if replay["serverRevision"] != create_revision
        || replay["outcomes"][0]["result"]["idempotentReplay"] != true
    {
        return Err("shared authority create retry was not idempotent".into());
    }

    wait_for_path(desktop_edit_ack, Duration::from_secs(30)).await?;
    let delete = json!({
        "operationId": "42000000-0000-4000-8000-000000000002",
        "changeSetId": "43000000-0000-4000-8000-000000000002",
        "deviceId": "mobile-tls-smoke",
        "entityType": "workout",
        "entityId": "live-service-workout",
        "baseRevision": create_revision,
        "orderPosition": null,
        "operationType": "delete",
        "payload": null
    });
    let deleted = authenticated_json(
        client,
        base_url,
        "/v1/sync/push",
        &json!({ "compatibility": compatibility, "operations": [delete] }),
        &token,
    )
    .await?;
    let delete_revision = deleted["outcomes"][0]["result"]["revision"]
        .as_i64()
        .ok_or_else(|| "shared authority tombstone was not accepted".to_string())?;
    if delete_revision <= create_revision {
        return Err("shared authority tombstone revision is not monotonic".into());
    }

    wait_for_path(desktop_closed_ack, Duration::from_secs(30)).await?;
    let closed_create = json!({
        "operationId": "42000000-0000-4000-8000-000000000003",
        "changeSetId": "43000000-0000-4000-8000-000000000003",
        "deviceId": "mobile-tls-smoke",
        "entityType": "workout",
        "entityId": "live-closed-workout",
        "baseRevision": 0,
        "orderPosition": 1,
        "operationType": "upsert",
        "payload": {
            "id": "live-closed-workout",
            "date": "2026-08-28",
            "templateId": "push",
            "templateCode": "A",
            "templateName": "PUSH",
            "note": "Committed while Desktop was closed",
            "exercises": []
        }
    });
    let closed = authenticated_json(
        client,
        base_url,
        "/v1/sync/push",
        &json!({ "compatibility": compatibility, "operations": [closed_create] }),
        &token,
    )
    .await?;
    if closed["outcomes"][0]["status"] != "accepted" {
        return Err("closed-Desktop service mutation was not accepted".into());
    }
    println!("PASS shared Desktop + Sync Service authority client gate");
    Ok(())
}

async fn wait_for_path(path: &Path, timeout: Duration) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if path.exists() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(format!("timed out waiting for {}", path.display()))
}

async fn run_expired(client: &Client, base_url: &str, nonce: &str) -> Result<(), String> {
    let response = client
        .post(format!("{base_url}/v1/pair"))
        .json(&json!({
            "nonce": nonce,
            "deviceId": "expired-device",
            "displayName": "Expired pairing test"
        }))
        .send()
        .await
        .map_err(|error| format!("expired pairing request failed: {error}"))?;
    if response.status() != StatusCode::FORBIDDEN {
        return Err(format!(
            "expired pairing returned HTTP {}, expected 403",
            response.status()
        ));
    }
    println!("PASS expired pairing nonce rejected over pinned HTTPS");
    Ok(())
}

async fn run_full(
    client: &Client,
    base_url: &str,
    fingerprint: &str,
    nonce: &str,
) -> Result<(), String> {
    let health = client
        .get(format!("{base_url}/v1/health"))
        .send()
        .await
        .map_err(|error| format!("pinned health failed: {error}"))?;
    require_status(&health, StatusCode::OK, "health")?;
    let health: Value = health
        .json()
        .await
        .map_err(|error| format!("health JSON failed: {error}"))?;
    if health["schemaVersion"] != 7
        || health["protocolVersion"] != 1
        || health["certificateFingerprintSha256"] != fingerprint
    {
        return Err("health identity/version payload is inconsistent".into());
    }

    let wrong_pin = pinned_client(&"00".repeat(32))?;
    if wrong_pin
        .get(format!("{base_url}/v1/health"))
        .send()
        .await
        .is_ok()
    {
        return Err("wrong certificate fingerprint was accepted".into());
    }

    let compatibility = compatibility();
    let anonymous = client
        .post(format!("{base_url}/v1/handshake"))
        .json(&compatibility)
        .send()
        .await
        .map_err(|error| format!("anonymous handshake request failed: {error}"))?;
    require_status(&anonymous, StatusCode::UNAUTHORIZED, "anonymous handshake")?;

    let pair_body = json!({
        "nonce": nonce,
        "deviceId": "mobile-tls-smoke",
        "displayName": "TLS smoke phone"
    });
    let paired = client
        .post(format!("{base_url}/v1/pair"))
        .json(&pair_body)
        .send()
        .await
        .map_err(|error| format!("pair request failed: {error}"))?;
    require_status(&paired, StatusCode::OK, "pair")?;
    let paired: Value = paired
        .json()
        .await
        .map_err(|error| format!("pair JSON failed: {error}"))?;
    if paired["serviceId"] != health["serviceId"]
        || paired["certificateFingerprintSha256"] != fingerprint
    {
        return Err("pairing did not bind serviceId and certificate fingerprint".into());
    }
    let token = paired["credentials"]["deviceToken"]
        .as_str()
        .filter(|token| token.len() == 64)
        .ok_or_else(|| "pairing did not return a 256-bit device token".to_string())?
        .to_owned();
    let replay = client
        .post(format!("{base_url}/v1/pair"))
        .json(&pair_body)
        .send()
        .await
        .map_err(|error| format!("pair replay request failed: {error}"))?;
    require_status(&replay, StatusCode::FORBIDDEN, "pair replay")?;

    let wrong_token = with_auth(
        client
            .post(format!("{base_url}/v1/handshake"))
            .json(&compatibility),
        "wrong-token",
    )
    .send()
    .await
    .map_err(|error| format!("wrong-token request failed: {error}"))?;
    require_status(&wrong_token, StatusCode::UNAUTHORIZED, "wrong token")?;

    let handshake = with_auth(
        client
            .post(format!("{base_url}/v1/handshake"))
            .json(&compatibility),
        &token,
    )
    .send()
    .await
    .map_err(|error| format!("authenticated handshake failed: {error}"))?;
    require_status(&handshake, StatusCode::OK, "authenticated handshake")?;
    let handshake: Value = handshake
        .json()
        .await
        .map_err(|error| format!("handshake JSON failed: {error}"))?;
    let initial_revision = handshake["serverRevision"]
        .as_i64()
        .ok_or_else(|| "handshake server revision is missing".to_string())?;

    let mut incompatible = compatibility.clone();
    incompatible["protocolMin"] = json!(2);
    incompatible["protocolMax"] = json!(2);
    let rejected_handshake = with_auth(
        client
            .post(format!("{base_url}/v1/handshake"))
            .json(&incompatible),
        &token,
    )
    .send()
    .await
    .map_err(|error| format!("incompatible handshake failed: {error}"))?;
    require_status(
        &rejected_handshake,
        StatusCode::UPGRADE_REQUIRED,
        "incompatible handshake",
    )?;
    let revision_after_rejection =
        authenticated_json(client, base_url, "/v1/handshake", &compatibility, &token).await?
            ["serverRevision"]
            .as_i64()
            .ok_or_else(|| "post-mismatch server revision is missing".to_string())?;
    if revision_after_rejection != initial_revision {
        return Err("incompatible handshake mutated the server revision".into());
    }

    let workout_operation = json!({
        "operationId": "40000000-0000-4000-8000-000000000001",
        "changeSetId": "41000000-0000-4000-8000-000000000001",
        "deviceId": "mobile-tls-smoke",
        "entityType": "workout",
        "entityId": "tls-smoke-workout",
        "baseRevision": 0,
        "orderPosition": 0,
        "operationType": "upsert",
        "payload": {
            "id": "tls-smoke-workout",
            "date": "2026-08-27",
            "templateId": "template-a",
            "templateCode": "A",
            "templateName": "PUSH",
            "exercises": []
        }
    });
    let workout_push = json!({
        "compatibility": compatibility,
        "operations": [workout_operation]
    });
    let lost_workout_response = with_auth(
        client
            .post(format!("{base_url}/v1/sync/push"))
            .json(&workout_push),
        &token,
    )
    .send()
    .await
    .map_err(|error| format!("lost-response workout push failed: {error}"))?;
    drop(lost_workout_response);
    let replayed_workout =
        authenticated_json(client, base_url, "/v1/sync/push", &workout_push, &token).await?;
    let workout_revision = replayed_workout["outcomes"][0]["result"]["revision"]
        .as_i64()
        .ok_or_else(|| "workout replay revision is missing".to_string())?;
    if workout_revision != initial_revision + 1
        || replayed_workout["serverRevision"] != workout_revision
        || replayed_workout["outcomes"][0]["result"]["idempotentReplay"] != true
    {
        return Err("lost-response workout retry was not exactly-once".into());
    }

    let daily_operation = json!({
        "operationId": "40000000-0000-4000-8000-000000000002",
        "changeSetId": "41000000-0000-4000-8000-000000000002",
        "deviceId": "mobile-tls-smoke",
        "entityType": "daily_entry",
        "entityId": "2026-08-27",
        "baseRevision": 0,
        "orderPosition": 0,
        "operationType": "upsert",
        "payload": {
            "id": "tls-smoke-daily",
            "date": "2026-08-27",
            "protein": 177
        }
    });
    let daily_push = json!({
        "compatibility": compatibility,
        "operations": [daily_operation]
    });
    let lost_daily_response = with_auth(
        client
            .post(format!("{base_url}/v1/sync/push"))
            .json(&daily_push),
        &token,
    )
    .send()
    .await
    .map_err(|error| format!("lost-response DailyEntry push failed: {error}"))?;
    drop(lost_daily_response);
    let replayed_daily =
        authenticated_json(client, base_url, "/v1/sync/push", &daily_push, &token).await?;
    let daily_revision = replayed_daily["outcomes"][0]["result"]["revision"]
        .as_i64()
        .ok_or_else(|| "DailyEntry replay revision is missing".to_string())?;
    if daily_revision != workout_revision + 1
        || replayed_daily["serverRevision"] != daily_revision
        || replayed_daily["outcomes"][0]["result"]["idempotentReplay"] != true
    {
        return Err("lost-response DailyEntry retry was not exactly-once".into());
    }

    let delete_operation = json!({
        "operationId": "40000000-0000-4000-8000-000000000003",
        "changeSetId": "41000000-0000-4000-8000-000000000003",
        "deviceId": "mobile-tls-smoke",
        "entityType": "workout",
        "entityId": "tls-smoke-workout",
        "baseRevision": workout_revision,
        "orderPosition": null,
        "operationType": "delete",
        "payload": null
    });
    let delete_push = json!({
        "compatibility": compatibility,
        "operations": [delete_operation]
    });
    let lost_delete_response = with_auth(
        client
            .post(format!("{base_url}/v1/sync/push"))
            .json(&delete_push),
        &token,
    )
    .send()
    .await
    .map_err(|error| format!("lost-response tombstone push failed: {error}"))?;
    drop(lost_delete_response);
    let replayed_delete =
        authenticated_json(client, base_url, "/v1/sync/push", &delete_push, &token).await?;
    let delete_revision = replayed_delete["outcomes"][0]["result"]["revision"]
        .as_i64()
        .ok_or_else(|| "tombstone replay revision is missing".to_string())?;
    if delete_revision != daily_revision + 1
        || replayed_delete["serverRevision"] != delete_revision
        || replayed_delete["outcomes"][0]["result"]["idempotentReplay"] != true
        || replayed_delete["outcomes"][0]["result"]["deleted"] != true
    {
        return Err("lost-response tombstone retry was not exactly-once".into());
    }

    let stale_resurrection = json!({
        "operationId": "40000000-0000-4000-8000-000000000004",
        "changeSetId": "41000000-0000-4000-8000-000000000004",
        "deviceId": "mobile-tls-smoke",
        "entityType": "workout",
        "entityId": "tls-smoke-workout",
        "baseRevision": workout_revision,
        "orderPosition": 0,
        "operationType": "upsert",
        "payload": {
            "id": "tls-smoke-workout",
            "date": "2026-08-27",
            "templateId": "template-a",
            "templateCode": "A",
            "templateName": "STALE",
            "exercises": []
        }
    });
    let stale = authenticated_json(
        client,
        base_url,
        "/v1/sync/push",
        &json!({ "compatibility": compatibility, "operations": [stale_resurrection] }),
        &token,
    )
    .await?;
    if stale["serverRevision"] != delete_revision || stale["outcomes"][0]["status"] != "conflict" {
        return Err("stale mutation resurrected a tombstoned Workout".into());
    }

    let pull = authenticated_json(
        client,
        base_url,
        "/v1/sync/pull",
        &json!({
            "compatibility": compatibility,
            "afterRevision": initial_revision,
            "limit": 100
        }),
        &token,
    )
    .await?;
    let changes = pull["changes"]
        .as_array()
        .ok_or_else(|| "pull changes are missing".to_string())?;
    let workout = changes
        .iter()
        .find(|change| change["entityId"] == "tls-smoke-workout")
        .ok_or_else(|| "pull did not return the Workout tombstone".to_string())?;
    let daily = changes
        .iter()
        .find(|change| change["entityId"] == "2026-08-27")
        .ok_or_else(|| "pull did not return the DailyEntry".to_string())?;
    if pull["serverRevision"] != delete_revision
        || changes.len() != 2
        || workout["deletedAt"].is_null()
        || daily["payload"]["protein"] != 177
    {
        return Err("pinned HTTPS pull was not semantically equivalent after retries".into());
    }

    let revoke = with_auth(client.post(format!("{base_url}/v1/device/revoke")), &token)
        .send()
        .await
        .map_err(|error| format!("device revoke failed: {error}"))?;
    require_status(&revoke, StatusCode::NO_CONTENT, "device revoke")?;
    let revoked = with_auth(
        client
            .post(format!("{base_url}/v1/handshake"))
            .json(&compatibility),
        &token,
    )
    .send()
    .await
    .map_err(|error| format!("revoked-token request failed: {error}"))?;
    require_status(&revoked, StatusCode::UNAUTHORIZED, "revoked token")?;

    println!(
        "PASS pinned HTTPS mismatch/lost-response/idempotency/tombstone/revocation client gate"
    );
    Ok(())
}

async fn authenticated_json(
    client: &Client,
    base_url: &str,
    path: &str,
    body: &Value,
    token: &str,
) -> Result<Value, String> {
    let response = with_auth(client.post(format!("{base_url}{path}")).json(body), token)
        .send()
        .await
        .map_err(|error| format!("request {path} failed: {error}"))?;
    require_status(&response, StatusCode::OK, path)?;
    response
        .json()
        .await
        .map_err(|error| format!("response {path} was not valid JSON: {error}"))
}

fn require_status(
    response: &reqwest::Response,
    expected: StatusCode,
    operation: &str,
) -> Result<(), String> {
    if response.status() == expected {
        Ok(())
    } else {
        Err(format!(
            "{operation} returned HTTP {}, expected {}",
            response.status(),
            expected
        ))
    }
}
