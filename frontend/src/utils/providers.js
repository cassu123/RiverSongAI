/**
 * providers.js
 * -----------------------------------------------------------------------------
 * One display name per LLM provider id.
 *
 * The same map was written out inline in four places — the admin visibility
 * list, the provider switches, the cloud fallback selector and the model
 * section — which is how the one provider ended up reading as "Qwen" on one
 * screen and "Qwen (cloud)" on the next. Import from here rather than adding
 * a fifth copy.
 *
 * `provider_order` comes back from GET /api/models and should be preferred for
 * ordering; PROVIDER_ORDER is the fallback for when that response has not
 * arrived yet.
 */

export const PROVIDER_LABELS = {
  ollama:     'Local (Ollama)',
  nvidia_nim: 'NVIDIA NIM',
  qwen:       'Qwen',
  deepseek:   'DeepSeek',
  anthropic:  'Claude',
  openai:     'OpenAI',
  gemini:     'Google Gemini',
  mistral_ai: 'Mistral AI',
  bedrock:    'Amazon Bedrock',
}

//: Mirrors PROVIDER_ORDER in api/routes/models_settings.py.
export const PROVIDER_ORDER = [
  'ollama',
  'nvidia_nim',
  'qwen',
  'deepseek',
  'anthropic',
  'openai',
  'gemini',
  'mistral_ai',
  'bedrock',
]

export function providerLabel(id) {
  return PROVIDER_LABELS[id] || id
}
