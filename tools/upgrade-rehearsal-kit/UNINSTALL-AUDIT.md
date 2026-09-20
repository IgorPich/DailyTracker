# RC1 uninstall behavior — non-destructive source audit

Status: source audit only. No installer or uninstaller was executed on the development host.

The NSIS pre-uninstall hook invokes the installed `sync-service-lifecycle.ps1 -Action Uninstall` and aborts if lifecycle cleanup fails. That action stops the exact Sync Service process, unregisters the `GreekGod Sync Service` scheduled task, and removes the two GreekGod Sync Service firewall rules. The hook then removes the GreekGod/Formlog desktop shortcuts. Normal NSIS removal removes installed application binaries, including the Sync Service executable and uninstaller, from the current-user installation directory.

No custom uninstall hook deletes `%APPDATA%\com.igorpich.formlog`, `greekgod-v3.sqlite`, or user data. No shared user-data deletion was found in the audited uninstall path.

Expected disposable-environment verification for a later, separately approved uninstall test:

- application binaries and shortcuts removed;
- scheduled task and product firewall rules removed;
- `%APPDATA%\com.igorpich.formlog\greekgod-v3.sqlite` preserved byte-for-byte unless the application legitimately wrote before uninstall;
- unrelated tasks, firewall rules, and files unchanged.

This audit is not a substitute for that later physical uninstall test.
