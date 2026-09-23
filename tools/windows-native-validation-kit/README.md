# GreekGod 4.0 clean-Windows native validation

Use only on a disposable Windows 10/11 x64 machine. Do not install VC_redist,
remove system runtimes, alter system DLLs, or use personal GreekGod data. Run all
commands from this kit. Generated evidence stays in `evidence\`.

## Exact sequence

1. Double-click `01-PREFLIGHT.cmd`. Continue only when it reports
   `CLEAN_ENOUGH`. Installed Microsoft VC++ Redistributables are informational and
   do not by themselves invalidate the test.
2. Run the single installer in `installer\`. If installation reports a missing
   prerequisite, capture the exact error and stop; do not install VC_redist.
3. Launch GreekGod and confirm the tracker opens.
4. Double-click `04-RECORD-TRACKER-PASS.cmd`.
5. Double-click `05-VERIFY-SYNC-MODULE.cmd`; it must report that
   `vcruntime140.dll` came from `APPLICATION_DIRECTORY`.
6. In Settings, import the included `ai-pack\` directory. Wait for successful
   verification/activation.
7. Run one real Companion message. While the response is complete and before the
   five-minute idle unload, double-click `07-RECORD-COMPANION-PASS.cmd`.
8. Immediately double-click `08-VERIFY-LLAMA-MODULES.cmd`; all three DLLs must
   report `ACTIVE_AI_PACK/runtime/...` origins.
9. Close GreekGod.
10. Double-click `10-VERIFY-NO-ORPHAN.cmd`.
11. Double-click `11-COLLECT-EVIDENCE.cmd`. A strict pass requires
    `finalVerdict: PASS` in `evidence\windows-native-validation-result.json`.

For a manual failure, run from PowerShell:

```powershell
.\scripts\Record-ManualResult.ps1 -Kind TrackerLaunch -Result FAIL -FailureCode EXACT_SAFE_CODE
.\scripts\Record-ManualResult.ps1 -Kind CompanionInference -Result FAIL -FailureCode EXACT_SAFE_CODE
```

`FailureCode` accepts only short letters/numbers/punctuation and must not contain
usernames, tokens, machine names, or personal paths. Preserve screenshots or raw
installer errors separately only if release review explicitly requests them.
