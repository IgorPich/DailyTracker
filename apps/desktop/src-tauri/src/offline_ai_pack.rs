use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

pub const CONTRACT_JSON: &str = include_str!("../ai-pack/greekgod-ai-pack-4.0.json");
pub const ACTIVE_POINTER: &str = "active-pack.json";
#[cfg(test)]
pub const OLD_MODEL_SHA256: &str =
    "b5374915da534cb93df39f03bd4f2cd5a0c533df0d5e21957dc9556c260be9eb";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const COPY_BUFFER_BYTES: usize = 1024 * 1024;
const DISK_RESERVE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackContract {
    pub manifest_format_version: u32,
    pub pack_id: String,
    pub pack_version: String,
    pub greek_god_compatibility: Compatibility,
    pub model: ModelContract,
    pub runtime: RuntimeContract,
    pub required_files: Vec<RequiredFile>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Compatibility {
    pub product: String,
    pub release_line: String,
    pub platform: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelContract {
    pub identity: String,
    pub source_repository: String,
    pub source_revision: String,
    pub relative_path: String,
    pub bytes: u64,
    pub sha256: String,
    pub quantization: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeContract {
    pub build: String,
    pub commit: String,
    pub relative_path: String,
    pub files: Vec<RuntimeFile>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeFile {
    pub relative_path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequiredFile {
    pub kind: RequiredFileKind,
    pub relative_path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RequiredFileKind {
    Legal,
    Provenance,
}

#[derive(Clone, Debug)]
struct ExpectedFile {
    relative_path: String,
    bytes: u64,
    sha256: String,
    class: FileClass,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FileClass {
    Model,
    Runtime,
    Legal,
    Provenance,
}

#[derive(Clone, Debug)]
pub struct VerifiedPack {
    pub root: PathBuf,
    pub model: PathBuf,
    pub runtime: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub phase: &'static str,
    pub relative_path: Option<String>,
    pub completed_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Clone, Debug)]
pub struct PackError {
    pub code: &'static str,
    pub detail: String,
}

impl PackError {
    fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for PackError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for PackError {}

fn is_reparse_or_symlink(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivePointer {
    format_version: u32,
    directory: String,
    pack_id: String,
    pack_version: String,
    model_sha256: String,
}

pub fn expected_contract() -> PackContract {
    serde_json::from_str(CONTRACT_JSON).expect("checked-in AI Pack contract must be valid")
}

fn safe_relative(value: &str) -> bool {
    if value.is_empty() || value.contains('\\') || value.contains(':') || value.starts_with('/') {
        return false;
    }
    Path::new(value)
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
        && Path::new(value)
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/")
            == value
}

fn validate_contract(contract: &PackContract) -> Result<(), PackError> {
    if contract.manifest_format_version != 1 {
        return Err(PackError::new(
            "UNSUPPORTED_MANIFEST_VERSION",
            "Only AI Pack manifest format 1 is supported",
        ));
    }
    if contract.pack_id != "com.igorpich.greekgod.offline-ai-pack"
        || contract.pack_version != "4.0.0"
        || contract.greek_god_compatibility.product != "GreekGod"
        || contract.greek_god_compatibility.release_line != "4.0"
        || contract.greek_god_compatibility.platform != "windows-x86_64"
    {
        return Err(PackError::new(
            "PACK_INCOMPATIBLE",
            "AI Pack identity or GreekGod compatibility is not allowlisted",
        ));
    }
    let mut paths = BTreeSet::new();
    let mut add = |path: &str| -> Result<(), PackError> {
        if !safe_relative(path) {
            return Err(PackError::new(
                "UNSAFE_PATH",
                format!("Unsafe relative path: {path}"),
            ));
        }
        if !paths.insert(path.to_lowercase()) {
            return Err(PackError::new(
                "DUPLICATE_PATH",
                format!("Duplicate or case-ambiguous path: {path}"),
            ));
        }
        Ok(())
    };
    add(&contract.model.relative_path)?;
    if !safe_relative(&contract.runtime.relative_path) {
        return Err(PackError::new("UNSAFE_PATH", "Unsafe runtime path"));
    }
    for file in &contract.runtime.files {
        add(&format!(
            "{}/{}",
            contract.runtime.relative_path, file.relative_path
        ))?;
    }
    for file in &contract.required_files {
        add(&file.relative_path)?;
    }
    Ok(())
}

fn expected_files(contract: &PackContract) -> Result<BTreeMap<String, ExpectedFile>, PackError> {
    validate_contract(contract)?;
    let mut files = BTreeMap::new();
    let model = ExpectedFile {
        relative_path: contract.model.relative_path.clone(),
        bytes: contract.model.bytes,
        sha256: contract.model.sha256.clone(),
        class: FileClass::Model,
    };
    files.insert(model.relative_path.to_lowercase(), model);
    for file in &contract.runtime.files {
        let relative_path = format!("{}/{}", contract.runtime.relative_path, file.relative_path);
        files.insert(
            relative_path.to_lowercase(),
            ExpectedFile {
                relative_path,
                bytes: file.bytes,
                sha256: file.sha256.clone(),
                class: FileClass::Runtime,
            },
        );
    }
    for file in &contract.required_files {
        let class = match file.kind {
            RequiredFileKind::Legal => FileClass::Legal,
            RequiredFileKind::Provenance => FileClass::Provenance,
        };
        files.insert(
            file.relative_path.to_lowercase(),
            ExpectedFile {
                relative_path: file.relative_path.clone(),
                bytes: file.bytes,
                sha256: file.sha256.clone(),
                class,
            },
        );
    }
    Ok(files)
}

fn read_manifest(root: &Path) -> Result<PackContract, PackError> {
    let path = root.join("manifest.json");
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| PackError::new("MANIFEST_MISSING", "manifest.json is missing"))?;
    if !metadata.is_file()
        || is_reparse_or_symlink(&metadata)
        || metadata.len() > MAX_MANIFEST_BYTES
    {
        return Err(PackError::new(
            "MANIFEST_INVALID",
            "manifest.json must be a small regular file",
        ));
    }
    let bytes =
        fs::read(path).map_err(|error| PackError::new("MANIFEST_INVALID", error.to_string()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| PackError::new("MANIFEST_INVALID", error.to_string()))
}

fn collect_files(root: &Path, current: &Path, output: &mut Vec<String>) -> Result<(), PackError> {
    for entry in fs::read_dir(current)
        .map_err(|error| PackError::new("PACK_UNREADABLE", error.to_string()))?
    {
        let entry = entry.map_err(|error| PackError::new("PACK_UNREADABLE", error.to_string()))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| PackError::new("PACK_UNREADABLE", error.to_string()))?;
        if is_reparse_or_symlink(&metadata) {
            return Err(PackError::new(
                "UNSAFE_REPARSE_POINT",
                format!(
                    "Symbolic link or reparse point is forbidden: {}",
                    path.display()
                ),
            ));
        }
        if metadata.is_dir() {
            collect_files(root, &path, output)?;
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| PackError::new("UNSAFE_PATH", "File escaped pack root"))?;
            let value = relative
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            if !safe_relative(&value) {
                return Err(PackError::new(
                    "UNSAFE_PATH",
                    format!("Unsafe pack path: {value}"),
                ));
            }
            output.push(value);
        } else {
            return Err(PackError::new(
                "PACK_INVALID",
                format!("Unsupported filesystem object: {}", path.display()),
            ));
        }
    }
    Ok(())
}

fn file_hash(path: &Path, mut on_bytes: impl FnMut(u64)) -> Result<String, PackError> {
    let mut file =
        File::open(path).map_err(|error| PackError::new("FILE_UNREADABLE", error.to_string()))?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| PackError::new("FILE_UNREADABLE", error.to_string()))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
        on_bytes(count as u64);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn class_error(class: FileClass, missing: bool) -> &'static str {
    match (class, missing) {
        (FileClass::Model, true) => "MODEL_MISSING",
        (FileClass::Model, false) => "MODEL_INVALID",
        (FileClass::Runtime, true) => "RUNTIME_MISSING",
        (FileClass::Runtime, false) => "RUNTIME_INVALID",
        (FileClass::Legal, _) => "LEGAL_INVALID",
        (FileClass::Provenance, _) => "PROVENANCE_INVALID",
    }
}

pub fn verify_pack(
    root: &Path,
    expected: &PackContract,
    progress: &(dyn Fn(ImportProgress) + Send + Sync),
) -> Result<VerifiedPack, PackError> {
    let root_metadata = fs::symlink_metadata(root)
        .map_err(|_| PackError::new("PACK_MISSING", "Selected AI Pack directory does not exist"))?;
    if !root_metadata.is_dir() || is_reparse_or_symlink(&root_metadata) {
        return Err(PackError::new(
            "UNSAFE_REPARSE_POINT",
            "AI Pack root must be a regular directory",
        ));
    }
    let imported = read_manifest(root)?;
    validate_contract(&imported)?;
    if &imported != expected {
        return Err(PackError::new(
            "PACK_CONTRACT_MISMATCH",
            "manifest.json does not match the production GreekGod 4.0 trust contract",
        ));
    }
    let expected_files = expected_files(expected)?;
    let mut actual = Vec::new();
    collect_files(root, root, &mut actual)?;
    let mut actual_casefold = BTreeSet::new();
    for path in &actual {
        if !actual_casefold.insert(path.to_lowercase()) {
            return Err(PackError::new(
                "DUPLICATE_PATH",
                format!("Case-ambiguous pack path: {path}"),
            ));
        }
        if path != "manifest.json" && !expected_files.contains_key(&path.to_lowercase()) {
            return Err(PackError::new(
                "UNEXPECTED_FILE",
                format!("Unexpected AI Pack file: {path}"),
            ));
        }
    }
    if !actual.iter().any(|path| path == "manifest.json") {
        return Err(PackError::new(
            "MANIFEST_MISSING",
            "manifest.json is missing",
        ));
    }
    let total = expected_files.values().map(|file| file.bytes).sum();
    let mut completed = 0_u64;
    for file in expected_files.values() {
        if !actual.iter().any(|path| path == &file.relative_path) {
            return Err(PackError::new(
                class_error(file.class, true),
                format!("Required file is missing: {}", file.relative_path),
            ));
        }
        let path = root.join(Path::new(&file.relative_path));
        let metadata = fs::symlink_metadata(&path).map_err(|_| {
            PackError::new(
                class_error(file.class, true),
                format!("Required file is missing: {}", file.relative_path),
            )
        })?;
        if !metadata.is_file() || is_reparse_or_symlink(&metadata) || metadata.len() != file.bytes {
            return Err(PackError::new(
                class_error(file.class, false),
                format!("Size or file type mismatch: {}", file.relative_path),
            ));
        }
        let hash = file_hash(&path, |count| {
            completed = completed.saturating_add(count);
            progress(ImportProgress {
                phase: "VERIFYING",
                relative_path: Some(file.relative_path.clone()),
                completed_bytes: completed,
                total_bytes: total,
            });
        })?;
        if hash != file.sha256 {
            return Err(PackError::new(
                class_error(file.class, false),
                format!("SHA-256 mismatch: {}", file.relative_path),
            ));
        }
    }
    Ok(VerifiedPack {
        root: root.to_path_buf(),
        model: root.join(&expected.model.relative_path),
        runtime: root.join(&expected.runtime.relative_path),
    })
}

fn available_space(path: &Path) -> Result<u64, PackError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut available = 0_u64;
        let result = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if result == 0 {
            return Err(PackError::new(
                "DISK_SPACE_UNKNOWN",
                "Could not determine available disk space",
            ));
        }
        Ok(available)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(u64::MAX)
    }
}

fn copy_verified(
    source: &Path,
    destination: &Path,
    expected: &ExpectedFile,
    cancel: &AtomicBool,
    completed: &mut u64,
    total: u64,
    progress: &(dyn Fn(ImportProgress) + Send + Sync),
    interrupt_after: Option<u64>,
) -> Result<(), PackError> {
    if cancel.load(Ordering::SeqCst) {
        return Err(PackError::new(
            "IMPORT_CANCELLED",
            "AI Pack import was cancelled",
        ));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
    }
    let source_metadata = fs::symlink_metadata(source)
        .map_err(|error| PackError::new("SOURCE_CHANGED", error.to_string()))?;
    if !source_metadata.is_file() || is_reparse_or_symlink(&source_metadata) {
        return Err(PackError::new(
            "UNSAFE_REPARSE_POINT",
            format!(
                "Source file became unsafe before copying: {}",
                expected.relative_path
            ),
        ));
    }
    let mut input =
        File::open(source).map_err(|error| PackError::new("SOURCE_CHANGED", error.to_string()))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    let mut copied = 0_u64;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(PackError::new(
                "IMPORT_CANCELLED",
                "AI Pack import was cancelled",
            ));
        }
        let count = input
            .read(&mut buffer)
            .map_err(|error| PackError::new("SOURCE_CHANGED", error.to_string()))?;
        if count == 0 {
            break;
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
        digest.update(&buffer[..count]);
        copied = copied.saturating_add(count as u64);
        *completed = completed.saturating_add(count as u64);
        progress(ImportProgress {
            phase: "COPYING",
            relative_path: Some(expected.relative_path.clone()),
            completed_bytes: *completed,
            total_bytes: total,
        });
        if interrupt_after.is_some_and(|limit| *completed >= limit) {
            return Err(PackError::new(
                "IMPORT_INTERRUPTED",
                "Synthetic interrupted-copy boundary",
            ));
        }
    }
    output
        .sync_all()
        .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
    if copied != expected.bytes || format!("{:x}", digest.finalize()) != expected.sha256 {
        return Err(PackError::new(
            "SOURCE_CHANGED",
            format!("Source changed while copying: {}", expected.relative_path),
        ));
    }
    Ok(())
}

fn ensure_owned_directory(path: &Path) -> Result<(), PackError> {
    fs::create_dir_all(path)
        .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
    if !metadata.is_dir() || is_reparse_or_symlink(&metadata) {
        return Err(PackError::new(
            "UNSAFE_REPARSE_POINT",
            format!(
                "Managed directory must not be a reparse point: {}",
                path.display()
            ),
        ));
    }
    Ok(())
}

fn recover_staging(managed_root: &Path) -> Result<(), PackError> {
    let legacy_staging = managed_root.join("staging");
    ensure_owned_directory(&legacy_staging)?;
    let active_directory = fs::read(managed_root.join(ACTIVE_POINTER))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ActivePointer>(&bytes).ok())
        .map(|pointer| pointer.directory);
    let packs = managed_root.join("packs");
    ensure_owned_directory(&packs)?;
    for root in [&legacy_staging, &packs] {
        for entry in fs::read_dir(root)
            .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?
        {
            let entry =
                entry.map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("install-") || active_directory.as_deref() == Some(name.as_str()) {
                continue;
            }
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
            if is_reparse_or_symlink(&metadata) {
                return Err(PackError::new(
                    "UNSAFE_REPARSE_POINT",
                    "Refusing to follow a staging reparse point",
                ));
            }
            if metadata.is_dir() {
                fs::remove_dir_all(&path)
                    .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
            } else if metadata.is_file() {
                fs::remove_file(&path)
                    .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
            }
        }
    }
    Ok(())
}

fn atomically_replace_pointer(temporary_path: &Path, destination: &Path) -> Result<(), PackError> {
    #[cfg(windows)]
    {
        if !destination.exists() {
            fs::rename(temporary_path, destination)
                .map_err(|error| PackError::new("PROMOTION_FAILED", error.to_string()))?;
            return Ok(());
        }
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING};
        let source: Vec<u16> = temporary_path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let target: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result =
            unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), MOVEFILE_REPLACE_EXISTING) };
        if result == 0 {
            let error = std::io::Error::last_os_error();
            let _ = fs::remove_file(temporary_path);
            return Err(PackError::new("PROMOTION_FAILED", error.to_string()));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(temporary_path, destination)
            .map_err(|error| PackError::new("PROMOTION_FAILED", error.to_string()))?;
        Ok(())
    }
}

#[derive(Default)]
struct InstallOptions {
    available_bytes: Option<u64>,
    interrupt_after_bytes: Option<u64>,
    corrupt_after_copy: Option<String>,
}

fn install_with_options(
    source: &Path,
    managed_root: &Path,
    expected: &PackContract,
    cancel: &AtomicBool,
    progress: &(dyn Fn(ImportProgress) + Send + Sync),
    options: InstallOptions,
) -> Result<VerifiedPack, PackError> {
    ensure_owned_directory(managed_root).map_err(|error| {
        if error.code == "UNSAFE_REPARSE_POINT" {
            error
        } else {
            PackError::new("INSTALL_ROOT_FAILED", error.detail)
        }
    })?;
    let canonical_source = fs::canonicalize(source)
        .map_err(|error| PackError::new("PACK_MISSING", error.to_string()))?;
    let canonical_managed = fs::canonicalize(managed_root)
        .map_err(|error| PackError::new("INSTALL_ROOT_FAILED", error.to_string()))?;
    if canonical_source.starts_with(&canonical_managed)
        || canonical_managed.starts_with(&canonical_source)
    {
        return Err(PackError::new(
            "UNSAFE_SOURCE_LOCATION",
            "The source AI Pack must be outside the GreekGod managed installation root",
        ));
    }
    recover_staging(managed_root)?;
    progress(ImportProgress {
        phase: "VERIFYING_SOURCE",
        relative_path: None,
        completed_bytes: 0,
        total_bytes: 0,
    });
    verify_pack(source, expected, progress)?;
    let files = expected_files(expected)?;
    let total: u64 = files.values().map(|file| file.bytes).sum();
    let available = options
        .available_bytes
        .unwrap_or(available_space(managed_root)?);
    if available < total.saturating_add(DISK_RESERVE_BYTES) {
        return Err(PackError::new(
            "INSUFFICIENT_DISK_SPACE",
            "Not enough free space for a verified staged AI Pack installation",
        ));
    }
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random)
        .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
    let id = format!(
        "install-{}",
        random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    let staging = managed_root.join("packs").join(&id);
    fs::create_dir(&staging)
        .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
    let result = (|| {
        let manifest_path = staging.join("manifest.json");
        let mut manifest = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&manifest_path)
            .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
        serde_json::to_writer_pretty(&mut manifest, expected)
            .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
        manifest
            .write_all(b"\n")
            .and_then(|_| manifest.sync_all())
            .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
        let mut completed = 0_u64;
        for file in files.values() {
            copy_verified(
                &source.join(&file.relative_path),
                &staging.join(&file.relative_path),
                file,
                cancel,
                &mut completed,
                total,
                progress,
                options.interrupt_after_bytes,
            )?;
        }
        if let Some(relative) = &options.corrupt_after_copy {
            OpenOptions::new()
                .append(true)
                .open(staging.join(relative))
                .and_then(|mut file| file.write_all(b"corrupt"))
                .map_err(|error| PackError::new("STAGING_FAILED", error.to_string()))?;
        }
        progress(ImportProgress {
            phase: "VERIFYING_STAGING",
            relative_path: None,
            completed_bytes: 0,
            total_bytes: total,
        });
        let verified = verify_pack(&staging, expected, progress)?;
        let installed = staging.clone();
        let pointer = ActivePointer {
            format_version: 1,
            directory: id.clone(),
            pack_id: expected.pack_id.clone(),
            pack_version: expected.pack_version.clone(),
            model_sha256: expected.model.sha256.clone(),
        };
        let temporary_path = managed_root.join(format!(".active-{id}.tmp"));
        let mut temporary = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|error| PackError::new("PROMOTION_FAILED", error.to_string()))?;
        serde_json::to_writer_pretty(&mut temporary, &pointer)
            .map_err(|error| PackError::new("PROMOTION_FAILED", error.to_string()))?;
        temporary
            .write_all(b"\n")
            .and_then(|_| temporary.sync_all())
            .map_err(|error| PackError::new("PROMOTION_FAILED", error.to_string()))?;
        drop(temporary);
        if let Err(error) =
            atomically_replace_pointer(&temporary_path, &managed_root.join(ACTIVE_POINTER))
        {
            let _ = fs::remove_file(&temporary_path);
            return Err(error);
        }
        progress(ImportProgress {
            phase: "COMPLETE",
            relative_path: None,
            completed_bytes: total,
            total_bytes: total,
        });
        Ok(VerifiedPack {
            root: installed,
            model: verified.model,
            runtime: verified.runtime,
        })
    })();
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

pub fn install_pack(
    source: &Path,
    managed_root: &Path,
    cancel: &AtomicBool,
    progress: &(dyn Fn(ImportProgress) + Send + Sync),
) -> Result<VerifiedPack, PackError> {
    install_with_options(
        source,
        managed_root,
        &expected_contract(),
        cancel,
        progress,
        InstallOptions::default(),
    )
}

pub fn active_pack(managed_root: &Path) -> Result<VerifiedPack, PackError> {
    let expected = expected_contract();
    let pointer_path = managed_root.join(ACTIVE_POINTER);
    let bytes = fs::read(&pointer_path).map_err(|_| {
        PackError::new(
            "ACTIVE_PACK_MISSING",
            "No approved offline AI Pack is active",
        )
    })?;
    let pointer: ActivePointer = serde_json::from_slice(&bytes)
        .map_err(|error| PackError::new("ACTIVE_PACK_INVALID", error.to_string()))?;
    let safe_directory = pointer.directory.starts_with("install-")
        && pointer.directory.len() == 40
        && pointer.directory[8..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit());
    if pointer.format_version != 1
        || !safe_directory
        || pointer.pack_id != expected.pack_id
        || pointer.pack_version != expected.pack_version
        || pointer.model_sha256 != expected.model.sha256
    {
        return Err(PackError::new(
            "ACTIVE_PACK_INVALID",
            "Active AI Pack pointer is not trusted",
        ));
    }
    verify_pack(
        &managed_root.join("packs").join(pointer.directory),
        &expected,
        &|_| {},
    )
}

pub fn total_install_bytes() -> u64 {
    expected_files(&expected_contract())
        .expect("valid contract")
        .values()
        .map(|file| file.bytes)
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }
    fn synthetic_contract() -> (PackContract, BTreeMap<String, Vec<u8>>) {
        let data = BTreeMap::from([
            ("model/test.gguf".into(), b"qualified model".to_vec()),
            ("runtime/server.exe".into(), b"runtime".to_vec()),
            ("legal/license.txt".into(), b"license".to_vec()),
            ("provenance/source.json".into(), b"{}".to_vec()),
        ]);
        let file = |path: &str| RequiredFile {
            kind: if path.starts_with("legal") {
                RequiredFileKind::Legal
            } else {
                RequiredFileKind::Provenance
            },
            relative_path: path.into(),
            bytes: data[path].len() as u64,
            sha256: sha(&data[path]),
        };
        let contract = PackContract {
            manifest_format_version: 1,
            pack_id: "com.igorpich.greekgod.offline-ai-pack".into(),
            pack_version: "4.0.0".into(),
            greek_god_compatibility: Compatibility {
                product: "GreekGod".into(),
                release_line: "4.0".into(),
                platform: "windows-x86_64".into(),
            },
            model: ModelContract {
                identity: "test".into(),
                source_repository: "microsoft/test".into(),
                source_revision: "revision".into(),
                relative_path: "model/test.gguf".into(),
                bytes: data["model/test.gguf"].len() as u64,
                sha256: sha(&data["model/test.gguf"]),
                quantization: "Q4_0".into(),
            },
            runtime: RuntimeContract {
                build: "b10760".into(),
                commit: "0f3a".into(),
                relative_path: "runtime".into(),
                files: vec![RuntimeFile {
                    relative_path: "server.exe".into(),
                    bytes: data["runtime/server.exe"].len() as u64,
                    sha256: sha(&data["runtime/server.exe"]),
                }],
            },
            required_files: vec![file("legal/license.txt"), file("provenance/source.json")],
        };
        (contract, data)
    }
    fn write_pack(root: &Path, contract: &PackContract, data: &BTreeMap<String, Vec<u8>>) {
        fs::create_dir_all(root).unwrap();
        fs::write(
            root.join("manifest.json"),
            serde_json::to_vec_pretty(contract).unwrap(),
        )
        .unwrap();
        for (path, bytes) in data {
            let target = root.join(path);
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(target, bytes).unwrap();
        }
    }
    fn verify(root: &Path, contract: &PackContract) -> Result<VerifiedPack, PackError> {
        verify_pack(root, contract, &|_| {})
    }

    #[test]
    fn production_contract_selects_only_official_candidate() {
        let contract = expected_contract();
        assert_eq!(
            contract.model.sha256,
            "3913ce8d702ec0cb053c2c5238c4438596f2da99ecab56480e252f20580673db"
        );
        assert_eq!(contract.model.bytes, 2176177152);
        assert_ne!(contract.model.sha256, OLD_MODEL_SHA256);
        assert_eq!(contract.runtime.files.len(), 24);
    }
    #[test]
    fn verifies_complete_pack() {
        let temp = TempDir::new().unwrap();
        let (contract, data) = synthetic_contract();
        write_pack(temp.path(), &contract, &data);
        verify(temp.path(), &contract).unwrap();
    }
    #[test]
    fn rejects_model_missing_wrong_size_and_wrong_hash() {
        for mode in ["missing", "size", "hash"] {
            let temp = TempDir::new().unwrap();
            let (contract, data) = synthetic_contract();
            write_pack(temp.path(), &contract, &data);
            let model = temp.path().join("model/test.gguf");
            if mode == "missing" {
                fs::remove_file(model).unwrap();
            } else if mode == "size" {
                fs::write(model, b"x").unwrap();
            } else {
                fs::write(model, b"qualified modeL").unwrap();
            }
            assert!(verify(temp.path(), &contract)
                .unwrap_err()
                .code
                .starts_with("MODEL_"));
        }
    }
    #[test]
    fn rejects_runtime_missing_wrong_hash_and_unexpected_executable() {
        for mode in ["missing", "hash", "extra"] {
            let temp = TempDir::new().unwrap();
            let (contract, data) = synthetic_contract();
            write_pack(temp.path(), &contract, &data);
            let runtime = temp.path().join("runtime/server.exe");
            if mode == "missing" {
                fs::remove_file(runtime).unwrap();
            } else if mode == "hash" {
                fs::write(runtime, b"Runtime").unwrap();
            } else {
                fs::write(temp.path().join("runtime/evil.exe"), b"evil").unwrap();
            }
            assert!(verify(temp.path(), &contract).is_err());
        }
    }
    #[test]
    fn rejects_runtime_directory_reparse_point() {
        let source = TempDir::new().unwrap();
        let target = TempDir::new().unwrap();
        let (contract, data) = synthetic_contract();
        write_pack(source.path(), &contract, &data);
        fs::remove_dir_all(source.path().join("runtime")).unwrap();
        fs::write(target.path().join("server.exe"), b"runtime").unwrap();

        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(source.path().join("runtime"))
                .arg(target.path())
                .output()
                .unwrap();
            assert!(status.status.success(), "junction fixture must be created");
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(target.path(), source.path().join("runtime")).unwrap();

        assert_eq!(
            verify(source.path(), &contract).unwrap_err().code,
            "UNSAFE_REPARSE_POINT"
        );
        fs::remove_dir(source.path().join("runtime")).unwrap();
    }
    #[test]
    fn rejects_malformed_unsupported_traversal_and_duplicate_manifest() {
        for mode in ["malformed", "version", "traversal", "duplicate"] {
            let temp = TempDir::new().unwrap();
            let (mut contract, data) = synthetic_contract();
            write_pack(temp.path(), &contract, &data);
            if mode == "malformed" {
                fs::write(temp.path().join("manifest.json"), b"{").unwrap();
            } else {
                if mode == "version" {
                    contract.manifest_format_version = 2;
                }
                if mode == "traversal" {
                    contract.model.relative_path = "../model.gguf".into();
                }
                if mode == "duplicate" {
                    contract
                        .required_files
                        .push(contract.required_files[0].clone());
                }
                fs::write(
                    temp.path().join("manifest.json"),
                    serde_json::to_vec(&contract).unwrap(),
                )
                .unwrap();
            }
            assert!(verify(temp.path(), &synthetic_contract().0).is_err());
        }
    }
    #[test]
    fn interrupted_and_corrupt_install_never_replace_previous_pack_and_stale_staging_recovers() {
        let source_a = TempDir::new().unwrap();
        let source_b = TempDir::new().unwrap();
        let managed = TempDir::new().unwrap();
        let (contract, data) = synthetic_contract();
        write_pack(source_a.path(), &contract, &data);
        write_pack(source_b.path(), &contract, &data);
        fs::create_dir_all(managed.path().join("staging/install-stale/nested")).unwrap();
        fs::write(
            managed.path().join("staging/install-stale/nested/file"),
            b"stale",
        )
        .unwrap();
        let cancel = AtomicBool::new(false);
        let available = Some(u64::MAX);
        install_with_options(
            source_a.path(),
            managed.path(),
            &contract,
            &cancel,
            &|_| {},
            InstallOptions {
                available_bytes: available,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!managed.path().join("staging/install-stale").exists());
        let pointer = fs::read(managed.path().join(ACTIVE_POINTER)).unwrap();
        install_with_options(
            source_b.path(),
            managed.path(),
            &contract,
            &cancel,
            &|_| {},
            InstallOptions {
                available_bytes: available,
                ..Default::default()
            },
        )
        .unwrap();
        let replaced_pointer = fs::read(managed.path().join(ACTIVE_POINTER)).unwrap();
        assert_ne!(
            replaced_pointer, pointer,
            "a second valid pack must atomically replace the active pointer"
        );
        let error = install_with_options(
            source_b.path(),
            managed.path(),
            &contract,
            &cancel,
            &|_| {},
            InstallOptions {
                available_bytes: available,
                interrupt_after_bytes: Some(1),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "IMPORT_INTERRUPTED");
        assert_eq!(
            fs::read(managed.path().join(ACTIVE_POINTER)).unwrap(),
            replaced_pointer
        );
        let cancelled = AtomicBool::new(true);
        let error = install_with_options(
            source_b.path(),
            managed.path(),
            &contract,
            &cancelled,
            &|_| {},
            InstallOptions {
                available_bytes: available,
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "IMPORT_CANCELLED");
        assert_eq!(
            fs::read(managed.path().join(ACTIVE_POINTER)).unwrap(),
            replaced_pointer
        );
        let error = install_with_options(
            source_b.path(),
            managed.path(),
            &contract,
            &cancel,
            &|_| {},
            InstallOptions {
                available_bytes: available,
                corrupt_after_copy: Some("model/test.gguf".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(error.code.starts_with("MODEL_"));
        assert_eq!(
            fs::read(managed.path().join(ACTIVE_POINTER)).unwrap(),
            replaced_pointer
        );
    }
    #[test]
    fn rejects_insufficient_disk_space_and_historical_hash() {
        let source = TempDir::new().unwrap();
        let managed = TempDir::new().unwrap();
        let (contract, data) = synthetic_contract();
        write_pack(source.path(), &contract, &data);
        let error = install_with_options(
            source.path(),
            managed.path(),
            &contract,
            &AtomicBool::new(false),
            &|_| {},
            InstallOptions {
                available_bytes: Some(1),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "INSUFFICIENT_DISK_SPACE");
        let expected = expected_contract();
        let mut historical = expected.clone();
        historical.model.sha256 = OLD_MODEL_SHA256.into();
        let historical_source = TempDir::new().unwrap();
        fs::write(
            historical_source.path().join("manifest.json"),
            serde_json::to_vec(&historical).unwrap(),
        )
        .unwrap();
        assert_eq!(
            verify_pack(historical_source.path(), &expected, &|_| {})
                .unwrap_err()
                .code,
            "PACK_CONTRACT_MISMATCH"
        );
    }
}
