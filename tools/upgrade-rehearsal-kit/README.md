# GreekGod Phase 6 physical installer-validation kit

This portable kit validates the exact Phase 6 `PRIVATE_UNSIGNED` Windows
installer in one disposable Windows 10/11 x64 environment. It covers a fresh
install, safe cancellation of a detected stable upgrade, the completed stable
3.0.3 upgrade, schema/data determinism, and system-integration cleanup.

Never run this kit on the developer/production Windows account. The scripts do
not launch an installer automatically. Every installation, cancellation,
launch, close, and uninstall is an explicit human action.

## Safety boundary

- `Test-Preflight.ps1 -Stage Clean` is read-only and requires no existing
  GreekGod install, AppData, process, Sync task, or firewall rule.
- The database is a synthetic `SANITIZED_REHEARSAL_COPY`; the verifier opens it
  read-only and rejects pairing or initialized service identity material.
- AppData cleanup is permitted only after fresh-test uninstall and only when the
  exact kit-owned marker proves ownership. Seeded schema-7 AppData is never
  deleted by a kit script.
- Evidence omits usernames, machine names, private notes, secrets, and personal
  absolute paths.
- Any non-zero command, failed comparison, or human `FAIL` means the validation
  fails. Preserve the disposable environment for diagnosis.

Run commands below from the kit root in Windows PowerShell 5.1. Always type the
`-AcknowledgeDisposableEnvironment` switch yourself.

## Scenario 1 — fresh Phase 6 installation

1. Read-only clean preflight:

   ```powershell
   .\scripts\Test-Preflight.ps1 -Stage Clean -AcknowledgeDisposableEnvironment
   ```

2. Double-click `installers\GreekGod_4.0.0-rc.1-Phase6_x64-setup.exe` and
   complete a normal fresh installation. Confirm normal fresh-install wording
   and no blank page.
3. Before first launch, create the deletion-safety marker:

   ```powershell
   .\scripts\Mark-FreshTestData.ps1 -AcknowledgeDisposableEnvironment
   ```

4. Launch GreekGod. An empty/new tracker is acceptable. Confirm the installed
   ProductVersion, `%LOCALAPPDATA%\GreekGod`, and coherent Sync task/firewall.
   Close GreekGod, then capture:

   ```powershell
   .\scripts\Capture-SystemState.ps1 -Stage FreshInstalled -OutputName fresh-install-system.json -AcknowledgeDisposableEnvironment
   ```

5. Run the installed uninstaller normally. Do not select any option that claims
   to delete unrelated data.
6. Verify binaries, task, rules, and processes are gone while marker-owned
   AppData remains, then capture:

   ```powershell
   .\scripts\Capture-SystemState.ps1 -Stage Uninstalled -OutputName fresh-uninstalled-system.json -AcknowledgeDisposableEnvironment
   ```

7. Delete only the marker-proven fresh test AppData and return to clean state:

   ```powershell
   .\scripts\Remove-KitOwnedAppData.ps1 -AcknowledgeDisposableEnvironment
   .\scripts\Test-Preflight.ps1 -Stage Clean -AcknowledgeDisposableEnvironment
   ```

## Scenario 2 — stable upgrade with controlled cancellation

8. Install and verify only the sanitized schema-7 seed:

   ```powershell
   .\scripts\Install-RehearsalData.ps1 -AcknowledgeDisposableEnvironment
   .\scripts\Test-Preflight.ps1 -Stage SeededData -AcknowledgeDisposableEnvironment
   ```

9. Double-click `installers\GreekGod_3.0.3_x64-setup.exe` and complete the normal
   current-user installation.
10. Launch stable 3.0.3 once, verify the representative data, close it, and wait
    until the app process is gone.
11. Capture the immutable schema-7 baseline:

    ```powershell
    .\scripts\Capture-Baseline.ps1 -AcknowledgeDisposableEnvironment
    ```

12. Start the Phase 6 installer normally. Verify the bilingual detected-update
    page appears, then click **Cancel** on that page before proceeding.
13. Launch stable 3.0.3 again only to prove it remains usable; do not edit data.
    Close it, then verify canonical data and system integration:

    ```powershell
    .\scripts\Capture-Cancellation.ps1 -AcknowledgeDisposableEnvironment
    ```

The cancellation result passes only if ProductVersion is still 3.0.3, schema is
still 7, canonical state equals the baseline, the same installation remains
usable, and exactly one coherent Sync task/firewall set exists.

## Scenario 3 — completed stable upgrade

14. Start the exact Phase 6 installer again and continue from the detected-update
    page.
15. Visually confirm that the update wording is understandable, there is no
    unexplained blank page, no foreground 3.0.3 uninstaller, and no request for
    manual uninstall. Complete the installation.
16. Launch Phase 6 once. Verify representative data without editing, then close
    and capture:

    ```powershell
    .\scripts\Capture-PostUpgrade.ps1 -LaunchNumber First -AcknowledgeDisposableEnvironment
    ```

17. Launch and close twice more, capturing each unchanged state:

    ```powershell
    .\scripts\Capture-PostUpgrade.ps1 -LaunchNumber Second -AcknowledgeDisposableEnvironment
    .\scripts\Capture-PostUpgrade.ps1 -LaunchNumber Third -AcknowledgeDisposableEnvironment
    ```

18. Edit `ux-checklist.json`: set every item explicitly to `PASS` or `FAIL` and
    add concise, non-secret human evidence. Never record identity or personal
    paths.
19. Collect the final sanitized evidence:

    ```powershell
    .\scripts\Collect-Evidence.ps1 -AcknowledgeDisposableEnvironment
    ```

`FINAL-EVIDENCE.json` is PASS only when schema 7 remains unchanged after
cancellation; the completed upgrade reaches schema 8 with protocol 1; baseline
to first launch and both restart comparisons pass; ProductVersion/install path,
task and firewall state are coherent; fresh uninstall evidence is present; and
all human UX items explicitly pass.

## What is automated and what remains human

Automated verification covers exact installer hashes/size, seed integrity and
classification, schema versions, protocol 1, canonical domain projections and
hashes, duplicate detection, repeated-launch determinism, ProductVersion,
install-path token, process/task/firewall counts and target coherence, uninstall
cleanup, and the absence of missing evidence.

Human observation alone decides whether wording is understandable, the update
page is visibly correct in Polish, the English source configuration is coherent,
the blank-page interval is gone, the old uninstaller is not visible,
cancellation is understandable, stable remains usable, and no manual uninstall
is requested.
