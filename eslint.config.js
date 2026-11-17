import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "apps/example/{ios,android,.expo}/**",
      "apps/mock/**", // static browser-only design mock
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Vendor SDKs and their LiveKit plugins live only in the provider adapters.
    // Everything else (agent loop, "should I speak?" classifier, notes) uses LlmProvider.
    files: ["packages/**/*.{ts,tsx}"],
    ignores: ["packages/agent/src/providers/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "openai",
                "openai/*",
                "@anthropic-ai/*",
                "@google/genai",
                "@google/generative-ai",
                "@livekit/agents-plugin-openai",
                "@livekit/agents-plugin-anthropic",
                "@livekit/agents-plugin-google",
                "@livekit/agents-plugin-elevenlabs",
                "@livekit/agents-plugin-assemblyai",
                "@livekit/agents-plugin-deepgram",
                "@livekit/agents-plugin-cartesia",
              ],
              message:
                "Use the LlmProvider/SttProvider/TtsProvider interfaces from packages/agent/src/providers; vendor SDKs belong in the adapters only.",
            },
          ],
        },
      ],
    },
  },
  {
    // Expo loads config plugins with require(), so they are CommonJS.
    files: ["**/plugin/**/*.js", "**/*.cjs", "apps/example/metro.config.js"],
    languageOptions: {
      globals: { module: "writable", require: "readonly", __dirname: "readonly" },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
