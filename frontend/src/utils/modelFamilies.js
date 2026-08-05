/**
 * modelFamilies.js
 * -----------------------------------------------------------------------------
 * Two-step model selector data: families and their Fast / Thinking / Pro tiers.
 *
 * Each family represents a coherent model line (DeepSeek, Llama, Claude, etc).
 * Tiers map to actual model_ids in providers/llm/registry.py.
 *
 * Phase A: this file is the source of truth for the chat selector.
 * Phase B (admin) will let users override displayName / blurb / tier mapping.
 *
 * If a family doesn't have a clean three-tier mapping in the registry, leave
 * the missing tier as null — the UI grays the row out in the variant sheet.
 */

export const MODEL_FAMILIES = [
  // ---------------------------------------------------------------------------
  // Auto — intent router picks the best model per message
  // ---------------------------------------------------------------------------
  {
    id: 'auto',
    displayName: 'River Decides',
    provider: 'auto',
    blurb: 'Auto-routes each message to the best model',
    icon: 'auto_awesome',
    tiers: {
      fast:     null,
      thinking: null,
      pro:      null,
    },
    isAuto: true,
  },

  // ---------------------------------------------------------------------------
  // Local — Ollama
  // ---------------------------------------------------------------------------
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    provider: 'ollama',
    blurb: 'Reasoning + code, local',
    icon: 'think',
    tiers: {
      fast:     'deepseek-r1:1.5b',
      thinking: 'deepseek-r1:7b',
      pro:      'deepseek-r1:14b',
    },
  },
  {
    id: 'llama',
    displayName: 'Llama',
    provider: 'ollama',
    blurb: "Meta's general purpose, local",
    icon: 'memory',
    tiers: {
      fast:     'llama3.2:1b',
      thinking: 'llama3.2:3b',
      pro:      'llama3.1:8b',
    },
  },
  {
    id: 'phi',
    displayName: 'Phi',
    provider: 'ollama',
    blurb: "Microsoft's efficient small models",
    icon: 'memory',
    tiers: {
      fast:     'phi3.5',
      thinking: 'phi4-mini',
      pro:      'phi4',
    },
  },
  {
    id: 'gemma',
    displayName: 'Gemma',
    provider: 'ollama',
    blurb: "Google's local models",
    icon: 'memory',
    tiers: {
      fast:     'gemma3:1b',
      thinking: 'gemma3:4b',
      pro:      'gemma3:12b',
    },
  },
  {
    id: 'qwen',
    displayName: 'Qwen',
    provider: 'ollama',
    blurb: 'Alibaba — multilingual + math',
    icon: 'memory',
    tiers: {
      fast:     'qwen2.5:3b',
      thinking: 'qwen2.5:7b',
      pro:      'qwen2.5:14b',
    },
  },
  {
    id: 'mistral-local',
    displayName: 'Mistral (local)',
    provider: 'ollama',
    blurb: 'Fast and efficient, local',
    icon: 'memory',
    tiers: {
      fast:     'mistral:7b',
      thinking: 'mistral-nemo',
      pro:      'mixtral:8x7b',
    },
  },

  // ---------------------------------------------------------------------------
  // Cloud
  // ---------------------------------------------------------------------------
  {
    id: 'claude',
    displayName: 'Claude',
    provider: 'anthropic',
    blurb: 'Anthropic — balanced + thoughtful',
    icon: 'chat',
    tiers: {
      fast:     'claude-haiku-4-5-20251001',
      thinking: 'claude-sonnet-4-6',
      pro:      'claude-opus-4-7',
    },
  },
  {
    id: 'gemini',
    displayName: 'Gemini',
    provider: 'gemini',
    blurb: 'Google — huge context windows',
    icon: 'google',
    tiers: {
      fast:     'gemini-2.0-flash',
      thinking: 'gemini-2.5-flash-preview-04-17',
      pro:      'gemini-2.5-pro-preview-05-06',
    },
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    provider: 'openai',
    blurb: 'GPT — general workhorse',
    icon: 'chat',
    tiers: {
      fast:     'gpt-4o-mini',
      thinking: 'o4-mini',
      pro:      'gpt-4o',
    },
  },
  {
    id: 'mistral-cloud',
    displayName: 'Mistral (cloud)',
    provider: 'mistral_ai',
    blurb: 'Mistral hosted — fast and cheap',
    icon: 'chat',
    tiers: {
      fast:     'mistral-small-latest',
      thinking: null,
      pro:      'mistral-large-latest',
    },
  },

  // ---------------------------------------------------------------------------
  // NVIDIA NIM — full model list, not 3-tier — isFullList flag triggers
  // a dedicated model sheet in ChatPage/ConversationPage
  // ---------------------------------------------------------------------------
  {
    id: 'nvidia-nim',
    displayName: 'NVIDIA NIM',
    provider: 'nvidia_nim',
    blurb: 'Free cloud inference — pick any model',
    icon: 'memory_alt',
    isFullList: true,
    tiers: {
      fast:     'meta/llama-3.1-70b-instruct',
      thinking: 'moonshotai/kimi-k2',
      pro:      'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    },
  },
]

export const TIER_ORDER = ['fast', 'thinking', 'pro']

export const TIER_META = {
  fast:     { label: 'Fast',     icon: 'pulse',      blurb: 'Quick answers, daily tasks' },
  thinking: { label: 'Thinking', icon: 'think',      blurb: 'Step-by-step reasoning' },
  pro:      { label: 'Pro',      icon: 'admin_settings', blurb: 'Advanced — largest model' },
}

/**
 * Reverse-map a (provider, model_id) selection back to the family + tier it
 * belongs to, so the chat pill can render "DeepSeek · Thinking" on page load.
 *
 * Returns { family, tier } when matched, or null when the selection is some
 * model not present in MODEL_FAMILIES (custom / unmapped).
 */
export function findFamilyForModel(provider, model_id, families = MODEL_FAMILIES) {
  if (!provider || !model_id) return null
  for (const family of families) {
    if (family.provider !== provider) continue
    for (const tier of TIER_ORDER) {
      if (family.tiers[tier] === model_id) {
        return { family, tier }
      }
    }
  }
  return null
}

/**
 * Apply admin overrides on top of the default family list. `overrides` is the
 * shape returned by /api/settings/model-families (also embedded in /api/models
 * as `family_overrides`): a map keyed by family.id with shape
 *   { enabled?: bool, quirky_name?: string|null, tiers?: { fast?, thinking?, pro? } }
 *
 * - `enabled === false` drops the family entirely.
 * - `quirky_name` replaces `displayName` when truthy.
 * - Tier entries replace the default tier model_id when truthy (empty/null = default).
 */
export function applyFamilyOverrides(defaults, overrides) {
  if (!overrides || typeof overrides !== 'object') return defaults
  const out = []
  for (const family of defaults) {
    const ov = overrides[family.id]
    if (ov && ov.enabled === false) continue
    if (!ov) { out.push(family); continue }
    const tiersOv = ov.tiers || {}
    out.push({
      ...family,
      displayName: ov.quirky_name || family.displayName,
      tiers: {
        fast:     tiersOv.fast     || family.tiers.fast     || null,
        thinking: tiersOv.thinking || family.tiers.thinking || null,
        pro:      tiersOv.pro      || family.tiers.pro      || null,
      },
    })
  }
  return out
}

/**
 * Given the /api/models response shape ({ local: [...], cloud: [...] }),
 * return a Set of "<provider>::<model_id>" strings for every model marked
 * `available: true`. Used to gray out tiers whose backing model isn't
 * installed or whose provider isn't keyed.
 */
export function buildAvailabilitySet(modelsResponse) {
  const out = new Set()
  const push = (arr) => {
    if (!Array.isArray(arr)) return
    for (const m of arr) {
      if (m && m.available && m.provider && m.model_id) {
        out.add(`${m.provider}::${m.model_id}`)
      }
    }
  }
  if (modelsResponse) {
    push(modelsResponse.local)
    push(modelsResponse.cloud)
  }
  return out
}

export function isTierAvailable(family, tier, availableSet) {
  const id = family?.tiers?.[tier]
  if (!id) return false
  if (!availableSet) return true
  return availableSet.has(`${family.provider}::${id}`)
}

export function familyHasAnyTier(family, availableSet) {
  return TIER_ORDER.some(t => isTierAvailable(family, t, availableSet))
}
