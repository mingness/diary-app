/**
 * Translation API configuration.
 *
 * OpenAI-compatible API used for translating diary content and comments.
 * Settings can be overridden via environment variables (TRANSLATE_API_BASE_URL,
 * TRANSLATE_API_KEY, TRANSLATE_MODEL) in wrangler.toml or Cloudflare dashboard.
 */
export const translateConfig = {
  apiBaseUrl: 'https://apihub.agnes-ai.com/v1',
  apiKey: 'sk-h9XEj7iRPFuIgnFFXWfdg4vsEMlk1myxxMFS8R13tpuQTd8B',
  model: 'agnes-2.5-flash',
};
