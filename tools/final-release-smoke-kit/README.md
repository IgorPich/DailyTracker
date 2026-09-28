# GreekGod PC 4.0.0 final physical smoke kit

This portable kit validates the exact final `PRIVATE_UNSIGNED` Windows installer
on one disposable Windows 10/11 x64 environment. It covers only the final fresh
install and the critical stable 3.0.3 to final 4.0.0 upgrade path.

Never run this kit on the production/developer Windows account. Scripts do not
launch installers. Every install, launch, close, and uninstall is a human step.
Run commands from the kit root in Windows PowerShell 5.1 and type
`-AcknowledgeDisposableEnvironment` yourself.

## Scenario A — fresh final 4.0.0

1. Run the clean preflight:

   ```powershell
   .\scripts\Test-Preflight.ps1 -Stage Clean -AcknowledgeDisposableEnvironment
   ```

2. Install `installers\GreekGod_4.0.0_x64-setup.exe`. Confirm normal installer
   UX and no blank page.
3. Before first launch, run:

   ```powershell
   .\scripts\Mark-FreshTestData.ps1 -AcknowledgeDisposableEnvironment
   ```

4. Launch GreekGod. Confirm ProductVersion 4.0.0, the tracker opens, Sync
   Service/task/firewall integration is coherent, and Settings recognizes the
   approved optional offline-AI Pack contract. No AI import or corpus rerun is
   required. Close GreekGod, then run:

   ```powershell
   .\scripts\Capture-SystemState.ps1 -Stage FreshInstalled -OutputName fresh-install-system.json -AcknowledgeDisposableEnvironment
   ```

5. Uninstall normally. Confirm there are no orphan GreekGod processes. Run:

   ```powershell
   .\scripts\Capture-SystemState.ps1 -Stage Uninstalled -OutputName fresh-uninstalled-system.json -AcknowledgeDisposableEnvironment
   .\scripts\Remove-KitOwnedAppData.ps1 -AcknowledgeDisposableEnvironment
   .\scripts\Test-Preflight.ps1 -Stage Clean -AcknowledgeDisposableEnvironment
   ```

## Scenario B — stable 3.0.3 to final 4.0.0

6. Install the sanitized schema-7 seed and verify it:

   ```powershell
   .\scripts\Install-RehearsalData.ps1 -AcknowledgeDisposableEnvironment
   .\scripts\Test-Preflight.ps1 -Stage SeededData -AcknowledgeDisposableEnvironment
   ```

7. Install `installers\GreekGod_3.0.3_x64-setup.exe`. Launch it once, confirm
   representative data, close it, and capture the immutable baseline:

   ```powershell
   .\scripts\Capture-Baseline.ps1 -AcknowledgeDisposableEnvironment
   ```

8. Install `installers\GreekGod_4.0.0_x64-setup.exe`. Confirm the detected-update
   page is correct, no blank page or visible old uninstaller appears, and no
   manual uninstall is requested.
9. Launch final 4.0.0. Confirm representative data and ProductVersion 4.0.0,
   close it, then capture:

   ```powershell
   .\scripts\Capture-FinalUpgrade.ps1 -LaunchNumber First -AcknowledgeDisposableEnvironment
   ```

10. Launch/close twice more without editing data and capture each state:

    ```powershell
    .\scripts\Capture-FinalUpgrade.ps1 -LaunchNumber Second -AcknowledgeDisposableEnvironment
    .\scripts\Capture-FinalUpgrade.ps1 -LaunchNumber Third -AcknowledgeDisposableEnvironment
    ```

11. In `ux-checklist.json`, change every item to `PASS` or `FAIL` and add concise,
    non-secret evidence. Then run:

    ```powershell
    .\scripts\Collect-Evidence.ps1 -AcknowledgeDisposableEnvironment
    ```

`FINAL-EVIDENCE.json` is PASS only when the exact installer identity, schema
7-to-8 migration, protocol 1, canonical data preservation, repeated-launch
determinism, ProductVersion, Sync integration, uninstall evidence, and all human
UX checks pass. Any non-zero command or human `FAIL` fails the release smoke.

The seed is a synthetic `SANITIZED_REHEARSAL_COPY`. Evidence excludes usernames,
machine identity, secrets, and personal paths. AppData cleanup is allowed only
for marker-proven fresh-test data; seeded upgrade data is never deleted by a kit
script.
