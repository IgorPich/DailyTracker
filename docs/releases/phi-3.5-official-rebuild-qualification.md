# Phi-3.5 official-source rebuild qualification

Qualification date: 2026-09-22. Status: **PASS — authoritative candidate
provenance and quality gates closed**.

## Scope and selection boundary

This record covers only source provenance, redistribution material,
official-source conversion, Q4_0 quantization, structural verification, and
the unchanged GreekGod quality corpus. It does not change the model selected by
the application. The rebuilt candidate is qualified but is not automatically
installed, packaged, hosted, downloaded, or substituted for the previously
qualified development asset.

No production AppData or user data was used. Source repositories, Python
environment, weights, GGUFs, and raw qualification output remained outside the
repository. The corpus contains synthetic fixtures only.

## Authoritative source

- repository: `microsoft/Phi-3.5-mini-instruct` in the official verified
  Microsoft Hugging Face organization;
- immutable revision: `2fe192450127e6a83f7441aef6e3ca586c338b77`;
- retrieval date: 2026-09-22;
- acquisition: detached Git checkout followed by Git LFS materialization;
- checkout normalization: Windows Git `core.autocrlf=true`, as represented by
  the source byte hashes in the manifest;
- materialization check: `git lfs fsck` passed;
- source inventory: 20/20 files matched the byte sizes and SHA-256 values in
  `legal/companion-model/provenance.json` before conversion.

The two Safetensors shards were 4,972,489,328 and 2,669,692,552 bytes with
SHA-256 values `c5214cdb995ed3dd716add8d9efbfe016b76bb2f1c4c1e6c1c6a95497d7a8837`
and `41246eed2b75b66526339c5d32d6f7acdefe0bd24180f97c74303f4656877344`.
The manifest records every other config, tokenizer, index, license, notice, and
supporting source file used or retained by the source checkout.

The source materialization sequence was:

```text
git -c core.autocrlf=true clone https://huggingface.co/microsoft/Phi-3.5-mini-instruct <source>
git -C <source> checkout --detach 2fe192450127e6a83f7441aef6e3ca586c338b77
git -C <source> lfs pull
git -C <source> lfs fsck
```

## Toolchain and commands

- Windows x86_64;
- Python 3.12.10 from a valid Python Software Foundation Authenticode-signed
  installer, SHA-256
  `67b5635e80ea51072b87941312d00ec8927c4db9ba18938f7ad2d27b328b95fb`;
- exact resolved Python environment in
  `scripts/model-provenance/requirements-phi35-b10760.txt`;
- llama.cpp b10760, revision
  `0f3a71be15af836d277c9f918adfafb45732677e`;
- verified Windows Vulkan x64 archive SHA-256
  `34dfb5aab953a1e69faf0fc185edda10ff08e515f5607f7b8cdda740b1ed88cb`;
- archive quantizer SHA-256
  `abde9c543104ba064354eab6acafb1f02fbe704cddb5f81591bcee42250bf372`;
- archive reported build 10760 / commit `0f3a71be1`, compiled with Clang
  20.1.8 for Windows x86_64.

Exact parameterized commands:

```text
<python> <llama.cpp>/convert_hf_to_gguf.py <source> --outfile <output>/Phi-3.5-mini-instruct-2fe19245-F16.gguf --outtype f16
<llama-quantize> <output>/Phi-3.5-mini-instruct-2fe19245-F16.gguf <output>/Phi-3.5-mini-instruct-2fe19245-Q4_0.gguf Q4_0
```

`scripts/model-provenance/Convert-Phi35Official.ps1` verifies the exact source
revision and inventory, llama.cpp revision and tools, Python version and full
dependency lock, refuses to overwrite outputs, executes those commands, and
requires the resulting hashes below. It accepts all machine paths as
parameters and contains no credentials or machine identity.

## Rebuilt outputs and structural verification

| Output | Bytes | SHA-256 |
|---|---:|---|
| `Phi-3.5-mini-instruct-2fe19245-F16.gguf` | 7,643,297,280 | `dfb7f35ff9b60e406728c99bf6247454ebe51218766371e9381a995547cffba3` |
| `Phi-3.5-mini-instruct-2fe19245-Q4_0.gguf` | 2,176,177,152 | `3913ce8d702ec0cb053c2c5238c4438596f2da99ecab56480e252f20580673db` |

The Q4_0 is GGUF v3 with 197 tensors, architecture `phi3`, identity
`Phi 3.5 Mini Instruct`, file type 2/Q4_0, 131,072 context length and 4,096
original RoPE context length. It contains the expected Llama tokenizer,
BOS 1, EOS/PAD 32000, and the Phi system/user/assistant plus `<|end|>` chat
template. The existing GreekGod raw Phi template remains compatible.

The pinned b10760 server loaded the candidate, passed authenticated loopback
health readiness, completed every inference request, and shut down. No
candidate sidecar remained after the harness.

## Quality requalification and comparison

The unchanged synthetic corpus ran with schema enforcement on, raw-parity
transport, context 4096, temperature 0, seed 42, one parallel slot, and 99 GPU
layers:

| Suite | Cases | Passed |
|---|---:|---:|
| original | 9 | 9 |
| generalization | 9 | 9 |
| grounding-adversarial | 9 | 9 |
| **total** | **27** | **27** |

There were zero structural/schema, grounding/identity, action-safety,
timeout, and inference failures. A fresh comparison run of the previously
qualified asset also passed 27/27. The rebuilt and previous assets produced
identical raw model output in 27/27 cases and identical application-validated
output in 27/27 cases.

The previous file was also 2,176,177,152 bytes but had SHA-256
`b5374915da534cb93df39f03bd4f2cd5a0c533df0d5e21957dc9556c260be9eb`.
Relevant GGUF metadata values match, while metadata key ordering and tensor
bytes differ. No byte-for-byte lineage from the old asset is claimed. Sequential
single-host timings were not treated as a performance comparison because cache
and run ordering were uncontrolled; no behavioral regression was observed.

## Licensing and release blockers

The pinned Microsoft source contains an MIT license plus `NOTICE.md` with the
flash-attention BSD 3-Clause notice. Their authoritative text is retained under
`legal/companion-model`. The pinned llama.cpp MIT text is retained there too.
The existing runtime manifest and acquisition process continue to identify and
retain the archive's exact `LICENSE-LLVM-OpenMP` (Apache-2.0 with LLVM
exception). GreekGod's EULA remains `apps/desktop/src-tauri/LICENSE.txt`.
No unsupported conclusion about the combined distribution is made.

Closed by this qualification:

- authoritative Microsoft Phi-3.5 source provenance for the rebuilt candidate;
- model LICENSE/NOTICE repository material;
- reproducible official source -> F16 -> Q4_0 chain;
- rebuilt candidate structural and 27/27 quality requalification.

Still open and unchanged:

- production model/runtime hosting and acquisition strategy;
- explicit production asset-selection and application-manifest update;
- MSVC/UCRT redistribution or prerequisite policy;
- Windows certificate/signing/timestamp setup;
- Android signing/distribution;
- application/update channel;
- the recorded installer upgrade-UX hardening observation.

Conversion and quantization were reproduced once on the recorded Windows host.
The checked-in script pins every observed input and output hash; any different
host result must be treated as a new candidate and investigated, never silently
accepted.
