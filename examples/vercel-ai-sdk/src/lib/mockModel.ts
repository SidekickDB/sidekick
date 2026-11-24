import { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';

/**
 * Creates a mock language model instance that is used when no model key is
 * set. Returns the model and a promise that resolves to the matched prompt
 * (always null here) once the model has been called.
 */
export function createMockModel(): {
  model: LanguageModelV3;
  matchedPrompt: Promise<string | null>;
} {
  let resolvePrompt: (prompt: string | null) => void;
  const matchedPrompt = new Promise<string | null>((resolve) => {
    resolvePrompt = resolve;
  });

  async function fetchCode(
    prompt: Parameters<LanguageModelV3['doGenerate']>[0]['prompt'],
  ) {
    const lastMessage = prompt.at(-1);
    const userText =
      lastMessage?.role === 'user' &&
      typeof lastMessage.content[0] === 'object' &&
      'text' in lastMessage.content[0]
        ? lastMessage.content[0].text
        : 'Default prompt';

    // SidekickDB: upstream sends the prompt to an example server run by
    // Instant and returns stored code from it. SidekickDB has no such server,
    // so without a model key the starter says how to set one and sends the
    // prompt nowhere.
    void userText;
    resolvePrompt(null);
    return [
      'No AI model is configured, so nothing was generated.',
      '',
      'Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in `.env` (and `AI_MODEL` to pick a model), then restart the dev server.',
    ].join('\n');
  }

  const mockUsage = {
    inputTokens: {
      total: 0,
      noCache: 0,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 0, text: 0, reasoning: undefined },
    totalTokens: 0,
  };

  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'mock-provider',
    modelId: 'mock-model',
    supportedUrls: {},

    doGenerate: async (
      options: Parameters<LanguageModelV3['doGenerate']>[0],
    ) => {
      const text = await fetchCode(options.prompt);

      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: mockUsage,
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
        warnings: [],
      };
    },

    doStream: async (options: Parameters<LanguageModelV3['doStream']>[0]) => {
      const fullText = await fetchCode(options.prompt);

      const chunks: LanguageModelV3StreamPart[] = [
        { type: 'text-start', id: 'mock-text-id' },
      ];
      const chunkSize = 20;
      for (let i = 0; i < fullText.length; i += chunkSize) {
        chunks.push({
          type: 'text-delta',
          id: 'mock-text-id',
          delta: fullText.slice(i, i + chunkSize),
        });
      }
      chunks.push({ type: 'text-end', id: 'mock-text-id' });
      chunks.push({
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: mockUsage,
      });

      return {
        stream: simulateReadableStream({
          chunks,
          chunkDelayInMs: 20,
        }),
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      };
    },
  };

  return { model, matchedPrompt };
}
