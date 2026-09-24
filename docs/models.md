# Models

Reasoning and embeddings are required. The default local profile uses Ollama with `qwen3:4b` and `qwen3-embedding:0.6b`. Download both with `ollama pull`. These are practical local defaults, not a universal quality ranking.

[Qwen3](https://github.com/QwenLM/Qwen3) provides open-weight models; review the license of the exact weights used. Hardware and hosted inference costs are separate from model-weight availability.

Larger Qwen models can be configured when hardware permits. Evaluate their structured output and investigation quality on representative evidence before adoption. Faster UI/API responses do not imply fast model inference; CPU investigations can take minutes.

## Compatible hosted inference

A chat-completions-compatible provider can be configured in the private `llm` object:

```json
{
  "provider": "openai-compatible",
  "url": "https://api.openai.com/v1/chat/completions",
  "model": "gpt-4.1-mini",
  "embeddingUrl": "https://api.openai.com/v1/embeddings",
  "embeddingModel": "text-embedding-3-small",
  "timeoutMs": 120000
}
```

Set `CG_LLM_API_KEY` in the server environment; preserve identity configuration. Clear `CG_MODEL_BASE` when switching away from local Ollama. Both endpoints share the same key, so use a compatible pair. Providers/models must accept the implemented temperature, completion-token cap and JSON-object response parameters.

This is a compatibility example, not a claim that these are the newest or best models. Provider catalogs and costs change. Consult [OpenAI model documentation](https://developers.openai.com/api/docs/models), [Together compatibility](https://docs.together.ai/docs/inference/openai-compatibility) or [Fireworks compatibility](https://docs.fireworks.ai/tools-sdks/openai-compatibility) for current supported pairs. A different native API requires a transport adapter and tests.

External inference transmits operational evidence. Obtain organizational approval for provider, retention, residency and confidentiality before using it. The application does not certify a provider's data handling.

## Grounding and limits

Three bounded reasoning passes plan, synthesize and review. Typed tools perform dependency traversal, telemetry comparison, temporal change correlation and recovery evidence checks. Retrieval combines dense similarity and lexical ranking using reciprocal-rank fusion.

Hypotheses need valid tool and runbook citations. Dependency paths and structured fields are validated. The summary uses calculated facts; findings remain unverified hypotheses. The reviewer uses the same model and can share its biases. These safeguards do not establish causality or eliminate hallucinations.

Runbooks have explicit expiry. Document edits invalidate cached vectors. Changing underlying model weights without changing the configured model identity requires re-ingesting documents to avoid reuse of stale embeddings.
