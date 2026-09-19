# Phi-3.5 GGUF provenance assessment

Report only for final 4.0 planning. RC1 keeps the already approved model identity
and checksum and neither downloads nor replaces any model.

## Recommendation

For a final distributable asset, prefer a reproducible GreekGod conversion over
redistributing the currently evaluated GGUF:

1. Pin an immutable revision of Microsoft's official
   `microsoft/Phi-3.5-mini-instruct` repository and record hashes for every
   source weight, tokenizer/config file, `LICENSE`, and `NOTICE.md`.
2. Pin the exact llama.cpp conversion/quantization commit and complete Python
   dependency lock/environment.
3. Convert the pinned official weights to an intermediate F16 GGUF with
   `convert_hf_to_gguf.py`, recording the exact command and intermediate hash.
4. Quantize that intermediate with the pinned `llama-quantize` to the deliberately
   selected Q4_0 type, recording command, tool hashes, logs, and final SHA-256.
5. Re-run the complete GreekGod semantic/quality corpus and performance/memory
   acceptance. Any output hash change is a new model asset requiring explicit
   approval; it must not silently replace the current checksum.
6. Ship the Microsoft model license/notice and all llama.cpp/runtime third-party
   notices beside the asset manifest.

This path is supported conceptually by Microsoft's PhiCookBook, which documents
conversion of Phi-3.5 Mini Instruct with llama.cpp followed by explicit
quantization, and by llama.cpp's own conversion documentation. Authoritative
references:

- `https://huggingface.co/microsoft/Phi-3.5-mini-instruct`
- `https://github.com/microsoft/PhiCookBook/blob/main/md/01.Introduction/04/UsingLlamacppQuantifyingPhi.md`
- `https://github.com/ggml-org/llama.cpp/blob/master/docs/models.md`

## Comparison with the current evaluated GGUF

The current asset has strong runtime identity: exact filename, size behavior,
logical identity, Ollama manifest digest, and full GGUF SHA-256 are known, and it
passes the quality corpus. That proves which bytes were evaluated, but the repo
does not contain an authoritative, reproducible chain from a pinned Microsoft
source revision through exact conversion and Q4_0 quantization commands to those
bytes. Redistributing it would therefore require separately proving the
third-party GGUF's source lineage and packaging the correct notices.

The reproducible conversion costs more validation and may produce bytes or model
behavior different from the current asset, but it gives the cleanest auditable
provenance: official source revision -> pinned tools -> recorded transformation
-> signed manifest. It is the recommended final-release strategy, subject to a
separate product-owner approval and full requalification. It is not an RC1
change.
