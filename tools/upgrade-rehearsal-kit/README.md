# GreekGod 4.0.0-rc.1 isolated upgrade rehearsal kit

This kit validates the real 3.0.3 → 4.0.0-rc.1 current-user installer path on a disposable Windows 10/11 x64 machine or a dedicated disposable Windows user. It never uses production data and it does not automate installer execution.

## Safety boundary

- Never run this rehearsal as the production Windows user.
- The clean preflight refuses the builder machine/user combination and any existing GreekGod install, AppData, scheduled task, firewall rule, or process.
- The seed must be schema 7, classified `SANITIZED_REHEARSAL_COPY`, and contain no paired devices, pairing windows, or initialized Sync Service identity.
- Scripts do not delete existing data. A failed preflight requires discarding/recreating the disposable environment.
- The verifier opens SQLite read-only. Evidence contains counts, projections, and SHA-256 values, not notes, tokens, certificates, keys, or raw payloads.

## Build the portable kit (repository host only)

Prepare a sanitized directory containing `greekgod-v3.sqlite`, `rehearsal-data-manifest.json`, and `expectations.json`. Use the supplied examples. Then run:

`expectations.json` must list every template code and every representative user-added exercise ID present in the sanitized copy (for the approved representative dataset, include its A/B/C/D codes). The verifier derives no user-specific template, gym, exercise, or priority rule.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\upgrade-rehearsal-kit\New-RehearsalKit.ps1 `
  -OutputRoot C:\Temp\GreekGod-RC1-Rehearsal-Kit `
  -StableInstaller .\apps\desktop\src-tauri\target\release\bundle\nsis\GreekGod_3.0.3_x64-setup.exe `
  -Rc1Installer .\apps\desktop\src-tauri\target\release\bundle\nsis\GreekGod_4.0.0-rc.1_x64-setup.exe `
  -RehearsalDataRoot C:\Temp\GreekGod-Sanitized-Schema7
```

Copy the resulting directory to the disposable environment. Do not copy production AppData.

## Exact disposable-machine sequence

All commands below are run from the kit root in Windows PowerShell 5.1.

1. Confirm a clean, disposable environment:

   ```powershell
   .\scripts\Test-Preflight.ps1 -Stage Clean -AcknowledgeDisposableEnvironment
   ```

2. Install only the sanitized schema-7 seed:

   ```powershell
   .\scripts\Install-RehearsalData.ps1 -AcknowledgeDisposableEnvironment
   .\scripts\Test-Preflight.ps1 -Stage SeededData -AcknowledgeDisposableEnvironment
   ```

3. Double-click `installers\GreekGod_3.0.3_x64-setup.exe` and complete the normal current-user installation. Do not use silent flags.
4. Launch GreekGod 3.0.3 normally once. Inspect representative data, then close GreekGod and wait until both GreekGod processes are gone.
5. Capture the immutable schema-7 baseline:

   ```powershell
   .\scripts\Capture-Baseline.ps1 -AcknowledgeDisposableEnvironment
   ```

6. Double-click `installers\GreekGod_4.0.0-rc.1_x64-setup.exe` and complete the in-place upgrade. Do not uninstall 3.0.3 first and do not use silent flags.
7. Launch RC1 normally once and inspect preservation without making any edits. Close it and capture:

   ```powershell
   .\scripts\Capture-PostUpgrade.ps1 -LaunchNumber First -AcknowledgeDisposableEnvironment
   ```

8. Launch and close RC1 normally two more times, capturing after each close:

   ```powershell
   .\scripts\Capture-PostUpgrade.ps1 -LaunchNumber Second -AcknowledgeDisposableEnvironment
   .\scripts\Capture-PostUpgrade.ps1 -LaunchNumber Third -AcknowledgeDisposableEnvironment
   ```

9. Only after all three deterministic captures, launch RC1 again and perform the mutating AI-free functional checks against the disposable synthetic data. Close it. Set every item in `ai-free-checklist.json` and `installer-behavior-checklist.json` to `PASS` or `FAIL` and add non-secret evidence. No local-model download or inference is required. Do not recapture the idempotency manifests after these intentional edits.
10. Collect and validate all evidence with one command:

    ```powershell
    .\scripts\Collect-Evidence.ps1 -AcknowledgeDisposableEnvironment
    ```

Any non-zero exit or `FAIL` verdict fails the rehearsal. Preserve the disposable machine and `evidence` directory for diagnosis; do not retry by modifying the database.

## What the deterministic verifier proves

It requires schema 7 before upgrade and schema 8 after upgrade, protocol 1, SQLite integrity, exact installer versions, unchanged application data version, no duplicate logical IDs/dates, and unchanged canonical hashes for daily entries, workout snapshots, arbitrary templates and ordering/prescriptions, exercise IDs/aliases, settings, journal tracking history, gym data, and waist/steps. Existing sync counts and tombstones are compared where present. The second and third launches must produce identical canonical state.

See `docs\UNINSTALL-AUDIT.md` for the non-destructive source audit. Actual uninstall is outside this rehearsal and must only be tested later in a disposable environment.
