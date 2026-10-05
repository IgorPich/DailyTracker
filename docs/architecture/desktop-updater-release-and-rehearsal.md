# Desktop updater release pipeline and rehearsal

## Stable production release contract

The only production trigger is a pushed tag in the form `vX.Y.Z`. The workflow still receives broad `v*` GitHub tag events so that its first executable step can reject every non-canonical value. It accepts only three numeric SemVer components, requires every Desktop/root version to equal the tag, and requires the version to be greater than historical PC `4.0.0`.

The production workflow checks out the exact tag commit, installs npm dependencies with `npm ci`, pins Node 22.16.0 and Rust 1.95.0, runs shared-core and Desktop checks, and invokes the official `tauri-apps/tauri-action` in build-only mode. The build process receives only `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. It never receives a GitHub token.

The actual NSIS filename is discovered from the single `.sig` produced in a clean Tauri NSIS bundle directory. The release contract contains exactly:

1. `<Tauri-generated-name>-setup.exe` — both the human-installable NSIS installer and updater-consumable Windows artifact;
2. `<Tauri-generated-name>-setup.exe.sig` — its Tauri updater signature;
3. `latest.json` — static Tauri update manifest.

`latest.json` contains the exact tag version, exact signature-file contents, and an HTTPS URL to the exact tagged GitHub Release asset. It declares both `windows-x86_64-nsis` and the compatible `windows-x86_64` alias, selecting the same signed NSIS file.

After local validation, the second job uses only GitHub's job-scoped token with `contents: write`. Release workflows are serialized globally. Immediately before any mutation, the job requires the candidate tag to be newer than GitHub's current stable release. It uploads assets to a draft release, downloads them again, repeats the contract validation, then publishes the draft and marks it latest. Any earlier failure leaves no release or only a draft, which cannot satisfy the production `/releases/latest/` endpoint.

## Stable-channel and bootstrap rules

GitHub's latest-release endpoint excludes drafts and prereleases. The workflow additionally rejects RC, beta, alpha, dev, smoke, rehearsal, test, build-metadata, malformed and non-monotonic tags before building or publishing. `allowDowngrades` remains false.

Versions released before updater support cannot self-update. Existing 3.x installations therefore require one manual installation of the first updater-capable recovery release. That recovery release must be greater than `4.0.0` and must already contain the final production updater public key. No legacy injection or update magic exists. After this bootstrap installation, later stable releases can update automatically.

## GitHub owner configuration

Create a GitHub Environment named `production-release` under **Repository Settings → Environments**. Require owner approval, prevent self-review when another trusted reviewer exists, restrict deployment branches/tags to protected stable tags, and consider a short wait timer.

Add these Environment secrets under **production-release → Environment secrets**:

- `TAURI_SIGNING_PRIVATE_KEY` — complete private-key contents;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — private-key passphrase.

Under **Repository Settings → Actions → General → Workflow permissions**, allow GitHub Actions to use the workflow-declared permissions. The workflow defaults to `contents: read`; only its publish job requests `contents: write`. No PAT is required or accepted by the workflow.

Protect tags matching `v*` so only the owner/release role can create them. A stable release tag must point to a reviewed commit whose root package, Desktop package, Desktop Cargo package, and Tauri configuration already contain the exact same version.

## Isolated physical updater rehearsal

Use a separate repository named `IgorPich/DailyTracker-updater-rehearsal`. Its only purpose is rehearsal assets; do not change the production repository's latest release. It must be publicly readable because the installed updater does not authenticate. If that is unacceptable, use a dedicated public HTTPS artifact host and change only the rehearsal override. The checked-in override uses identifier `com.igorpich.formlog.updater-rehearsal`, product/start-menu/shortcut names `GreekGod Updater Rehearsal`, a separate AppData namespace, separate scheduled-task and firewall-rule names, and this dedicated endpoint:

`https://github.com/IgorPich/DailyTracker-updater-rehearsal/releases/latest/download/latest.json`

Do not embed a GitHub token in the app. Use the existing production updater signing identity so the rehearsal exercises the real cryptographic path, but never copy that identity into the rehearsal repository.

### Version A to B physical run

1. Use disposable Windows data and uninstall any older Updater Rehearsal build. Do not use production GreekGod data.
2. Prepare two stable rehearsal versions greater than `4.0.0`, for example A=`4.0.1` and B=`4.0.2`. Create temporary files outside the repository named `A-version.json` and `B-version.json`, containing respectively `{ "version": "4.0.1" }` and `{ "version": "4.0.2" }`. Never tag or release those versions in the production repository.
3. From `apps/desktop`, build A with `npx tauri build --features native-sqlite-production-authority --config src-tauri/tauri.updater-rehearsal.conf.json --config C:\path\to\A-version.json` and the existing signing secrets in the process environment. (`npm run tauri:updater-rehearsal:check` performs an unsigned no-bundle configuration compile.)
4. Install and launch A. Confirm Settings reports A and no update. Create disposable journal/training data and wait for its saved state.
5. Build B in the same way with `B-version.json`. From the repository root run `node apps/desktop/scripts/release/stage-release-assets.mjs --tag v4.0.2 --repository IgorPich/DailyTracker-updater-rehearsal --bundle-dir apps/desktop/src-tauri/target/release/bundle/nsis --output C:\path\to\rehearsal-staging`, then run `validate-release-assets.mjs` with the same tag/repository and `--directory C:\path\to\rehearsal-staging`.
6. Using an authenticated local `gh` session, create `v4.0.2` and a normal non-prerelease release in the dedicated rehearsal repository, uploading exactly the staged installer, signature and `latest.json`. This is never done by the production workflow.
7. Launch A. Confirm B is discovered and downloads in the background while A remains usable. Make another disposable write during the download.
8. Close A normally. Confirm the write completes, the passive installer runs, and B relaunches.
9. Confirm Settings reports B, both disposable writes remain, and Sync/runtime startup and normal operations remain healthy.

Record timestamps, screenshots, installed versions, artifact SHA-256 values, and the disposable data assertions. Delete rehearsal releases only after evidence is retained; deleting them cannot affect production clients because the endpoint and identifier are different.

### Negative controls

Run each against disposable rehearsal data and restore a valid B release between cases:

- malformed manifest: replace the dedicated `latest.json` with invalid JSON; A must remain usable and retry next launch;
- invalid signature: change the manifest signature without changing the installer; download verification must fail and A must remain installed;
- unreachable service: temporarily use a dedicated unreachable HTTPS rehearsal endpoint or block GitHub for the rehearsal executable; startup must continue;
- older version: serve a correctly shaped manifest below A; Tauri must report no update;
- prerelease: publish B as a GitHub prerelease; the repository `/releases/latest/` endpoint must continue to resolve to the previous stable rehearsal release;
- interrupted download: disconnect networking during B download; A must remain installed and usable, then retry on a later launch;
- failed update usability: after every failure, create and reopen a disposable entry to confirm reads and writes still work.

The automated release tests separately reject malformed JSON, mismatched signatures, older/tag-mismatched manifests, prerelease versions, changed public keys/endpoints, downgrade enablement, non-passive install mode, missing signing output and unsigned artifact selection.
