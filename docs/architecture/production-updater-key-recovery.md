# Production updater signing-key recovery

The GreekGod production updater uses a dedicated password-protected Tauri signing identity. Only its public key belongs in source control. The signing private key and passphrase must never be copied into the repository, application configuration, build artifacts, logs, issues, or chat.

## Owner-controlled primary copies

- Private key: `C:\Users\igorp\.greekgod-secrets\updater\greekgod-production-updater.key`
- Public-key companion file: `C:\Users\igorp\.greekgod-secrets\updater\greekgod-production-updater.key.pub`
- DPAPI-encrypted passphrase record: `C:\Users\igorp\.greekgod-secrets\credentials\greekgod-production-updater-passphrase.clixml`

The secret root is outside the Git repository. Its inheritance is disabled and the generated files grant full access only to the owner Windows account. The DPAPI record is recoverable only by the same Windows user profile; it is a convenient local record, not an independent disaster-recovery backup.

## Required offline backups

Create these backups before depending on automatic updates:

1. Copy the private key file to encrypted offline medium A. Verify the copy byte-for-byte and label it with the application and key purpose, never the passphrase.
2. Back up the passphrase separately in an offline password manager or sealed recovery medium B. Do not store it beside the private-key backup.
3. Prefer a second private-key backup on encrypted offline medium C and a second passphrase recovery copy in a separate physical location D.
4. Test recovery on an offline machine or isolated Windows account by copying the backups to temporary secure locations and signing/verifying a disposable file. Do not use or overwrite the production key during the test.
5. Record the custodians and backup locations in the owner's private asset register. Review access after any account or device change.

Losing either the private key or its passphrase prevents publishing updates accepted by installed clients. Never delete or overwrite the primary key until two verified offline recovery paths exist and a deliberate key-rotation release has been completed.

## Local release use

Load the private key path into `TAURI_SIGNING_PRIVATE_KEY` and decrypt the DPAPI record into `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only in the release process environment. Do not print either value. Clear both environment variables after the build.

For GitHub Actions, create these encrypted repository or environment secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the complete contents of the private key file, not a repository path.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the private-key passphrase.

Limit secret access to the protected production-release environment. Do not use pull-request workflows from forks for signed release jobs.

## Release manifest

Stable clients read only:

`https://github.com/IgorPich/DailyTracker/releases/latest/download/latest.json`

The manifest must describe a stable SemVer release and contain the exact signature from the generated updater artifact. Prereleases must not be marked as the GitHub latest release. Downgrades and non-HTTPS updater transport remain disabled.
