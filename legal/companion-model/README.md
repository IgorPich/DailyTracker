# Companion model redistribution material

This directory records the legal and provenance boundary for the qualified
GreekGod Phi-3.5 candidate. It does not contain model weights or runtime
binaries and does not select an asset for automatic acquisition or packaging.

- `LICENSE-Microsoft-Phi-3.5` and `NOTICE-Microsoft-Phi-3.5.md` are exact copies
  from the pinned official Microsoft source revision recorded in
  `provenance.json`.
- `LICENSE-llama.cpp` is the exact license from the pinned llama.cpp revision.
- The exact archive-provided `LICENSE-LLVM-OpenMP` is identified by filename and
  SHA-256 in the checked-in runtime manifest and is retained by the existing
  runtime acquisition/package process.
- GreekGod's application EULA remains authoritative at
  `apps/desktop/src-tauri/LICENSE.txt`; third-party texts do not replace it.

Any distribution containing the model and runtime must include all applicable
files above. Hosting, acquisition, signing, installer inclusion, and update
policy remain separate release decisions.
