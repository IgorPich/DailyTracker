use serde::{de::DeserializeOwned, Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{Builder, PluginApi, TauriPlugin},
    AppHandle, Manager, Runtime,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PlatformError {
    #[error("Android platform capability is unavailable on this target")]
    Unsupported,
    #[error("Android platform plugin failed: {0}")]
    Plugin(String),
}

pub type Result<T> = std::result::Result<T, PlatformError>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSyncConfig {
    pub database_path: String,
    pub service_id: String,
    pub device_id: String,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestTimerConfig {
    pub database_path: String,
    pub device_id: String,
    pub workout_id: String,
    pub exercise_id: String,
    pub set_id: String,
    pub template_label: String,
    pub exercise_label: String,
    pub previous_label: String,
    pub duration_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestTimerStatus {
    pub state: String,
    pub target_epoch_ms: Option<i64>,
    pub duration_seconds: Option<u64>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretPayload<'a> {
    key: &'a str,
    value: &'a str,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretKeyPayload<'a> {
    key: &'a str,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretResponse {
    value: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryPayload<'a> {
    service_id: &'a str,
    timeout_ms: u64,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryResponse {
    base_url: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkStatusResponse {
    local_network_available: bool,
}

#[derive(Debug)]
pub struct MobilePlatform<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> MobilePlatform<R> {
    pub fn store_secret(&self, key: &str, value: &str) -> Result<()> {
        validate_key_value(key, Some(value))?;
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<serde::de::IgnoredAny>(
                    "storeSecret",
                    SecretPayload { key, value },
                )
                .map_err(|error| PlatformError::Plugin(error.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        Err(PlatformError::Unsupported)
    }

    pub fn load_secret(&self, key: &str) -> Result<Option<String>> {
        validate_key_value(key, None)?;
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<SecretResponse>("loadSecret", SecretKeyPayload { key })
                .map(|response| response.value)
                .map_err(|error| PlatformError::Plugin(error.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        Err(PlatformError::Unsupported)
    }

    pub fn delete_secret(&self, key: &str) -> Result<()> {
        validate_key_value(key, None)?;
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<serde::de::IgnoredAny>(
                    "deleteSecret",
                    SecretKeyPayload { key },
                )
                .map_err(|error| PlatformError::Plugin(error.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        Err(PlatformError::Unsupported)
    }

    pub async fn discover_sync_service(
        &self,
        service_id: &str,
        timeout_ms: u64,
    ) -> Result<Option<String>> {
        if service_id.trim().is_empty() || !(1_000..=15_000).contains(&timeout_ms) {
            return Err(PlatformError::Plugin(
                "serviceId or NSD discovery timeout is invalid".into(),
            ));
        }
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin_async::<DiscoveryResponse>(
                    "discoverSyncService",
                    DiscoveryPayload {
                        service_id,
                        timeout_ms,
                    },
                )
                .await
                .map(|response| response.base_url)
                .map_err(|error| PlatformError::Plugin(error.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        Err(PlatformError::Unsupported)
    }

    pub fn local_network_available(&self) -> Result<bool> {
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<NetworkStatusResponse>("networkStatus", ())
                .map(|response| response.local_network_available)
                .map_err(|error| PlatformError::Plugin(error.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        Err(PlatformError::Unsupported)
    }

    pub fn release_local_network(&self) -> Result<()> {
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<serde::de::IgnoredAny>("releaseLocalNetwork", ())
                .map_err(|error| PlatformError::Plugin(error.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        Err(PlatformError::Unsupported)
    }

    pub fn schedule_auto_sync(&self, config: AutoSyncConfig) -> Result<()> {
        if config.database_path.trim().is_empty()
            || config.service_id.trim().is_empty()
            || config.device_id.trim().is_empty()
            || config.app_version.trim().is_empty()
        {
            return Err(PlatformError::Plugin(
                "automatic sync configuration is invalid".into(),
            ));
        }
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<serde::de::IgnoredAny>("scheduleAutoSync", config)
                .map_err(|error| PlatformError::Plugin(error.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        Err(PlatformError::Unsupported)
    }

    pub fn start_rest_timer(&self, config: RestTimerConfig) -> Result<RestTimerStatus> {
        if config.database_path.trim().is_empty()
            || config.device_id.trim().is_empty()
            || config.workout_id.trim().is_empty()
            || config.exercise_id.trim().is_empty()
            || config.set_id.trim().is_empty()
            || config.template_label.trim().is_empty()
            || config.exercise_label.trim().is_empty()
            || !(1..=3_600).contains(&config.duration_seconds)
        {
            return Err(PlatformError::Plugin(
                "rest timer configuration is invalid".into(),
            ));
        }
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<RestTimerStatus>("startRestTimer", config)
                .map_err(|error| PlatformError::Plugin(error.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        Err(PlatformError::Unsupported)
    }

    pub fn rest_timer_status(&self) -> Result<RestTimerStatus> {
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<RestTimerStatus>("restTimerStatus", ())
                .map_err(|error| PlatformError::Plugin(error.to_string()))
        }
        #[cfg(not(target_os = "android"))]
        Err(PlatformError::Unsupported)
    }
}

fn validate_key_value(key: &str, value: Option<&str>) -> Result<()> {
    if key.trim().is_empty() || key.len() > 128 || value.is_some_and(str::is_empty) {
        return Err(PlatformError::Plugin("secret key/value is invalid".into()));
    }
    Ok(())
}

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.igorpich.greekgod.mobileplatform";

fn setup<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> std::result::Result<MobilePlatform<R>, Box<dyn std::error::Error>> {
    #[cfg(target_os = "android")]
    {
        let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "GreekGodMobilePlugin")?;
        Ok(MobilePlatform { handle })
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = api;
        Ok(MobilePlatform {
            marker: std::marker::PhantomData,
        })
    }
}

pub trait MobilePlatformExt<R: Runtime> {
    fn mobile_platform(&self) -> tauri::State<'_, MobilePlatform<R>>;
}

impl<R: Runtime, T: Manager<R>> MobilePlatformExt<R> for T {
    fn mobile_platform(&self) -> tauri::State<'_, MobilePlatform<R>> {
        self.state::<MobilePlatform<R>>()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("greekgod-mobile-platform")
        .setup(|app, api| {
            app.manage(setup(app, api)?);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_aliases_are_bounded_and_plaintext_cannot_be_empty() {
        assert!(validate_key_value("sync:service-a", Some("token")).is_ok());
        assert!(validate_key_value("", Some("token")).is_err());
        assert!(validate_key_value("sync:service-a", Some("")).is_err());
    }
}
