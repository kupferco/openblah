/**
 * The eval set: spoken requests (as text; audio is generated from the same
 * text, see audio.ts) and the tool call a good model makes for each. Written
 * against the fake MCP server in fake-mcp.ts. English and Portuguese (Brazil).
 */
export interface EvalCase {
  id: string;
  lang: "en" | "pt";
  /** What the person says, as the speech-to-text engine would hand it over. */
  text: string;
  /**
   * Expected call. `tool: null` means no tool should be called (small talk).
   * Each `args` value must appear (case-insensitive, accents ignored) in the
   * model's argument; numbers must be equal.
   */
  expect: { tool: string | null; args?: Record<string, string | number> };
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: "en-weather",
    lang: "en",
    text: "What's the weather like in Lisbon today?",
    expect: { tool: "get_weather", args: { city: "Lisbon" } },
  },
  {
    id: "pt-weather",
    lang: "pt",
    text: "Qual é a previsão do tempo em São Paulo amanhã?",
    expect: { tool: "get_weather", args: { city: "São Paulo" } },
  },
  {
    id: "en-events",
    lang: "en",
    text: "What do I have on my calendar on the twelfth of March?",
    expect: { tool: "list_events", args: { date: "03-12" } },
  },
  {
    id: "pt-events",
    lang: "pt",
    text: "O que eu tenho na agenda no dia vinte de junho?",
    expect: { tool: "list_events", args: { date: "06-20" } },
  },
  {
    id: "en-restaurants",
    lang: "en",
    text: "Find me a good Italian restaurant in London.",
    expect: { tool: "find_restaurants", args: { cuisine: "Italian", city: "London" } },
  },
  {
    id: "pt-restaurants",
    lang: "pt",
    text: "Procura um restaurante japonês no Rio de Janeiro.",
    expect: { tool: "find_restaurants", args: { cuisine: "japon", city: "Rio" } },
  },
  {
    id: "en-stock",
    lang: "en",
    text: "How is the Apple stock doing? The ticker is AAPL.",
    expect: { tool: "get_stock_price", args: { symbol: "AAPL" } },
  },
  {
    id: "pt-stock",
    lang: "pt",
    text: "Quanto está a ação da Petrobras? O código é PETR4.",
    expect: { tool: "get_stock_price", args: { symbol: "PETR4" } },
  },
  {
    id: "en-convert",
    lang: "en",
    text: "How much is fifty pounds in Brazilian reais?",
    expect: { tool: "convert_currency", args: { amount: 50, from: "GBP", to: "BRL" } },
  },
  {
    id: "pt-convert",
    lang: "pt",
    text: "Quanto são cem dólares em reais?",
    expect: { tool: "convert_currency", args: { amount: 100, from: "USD", to: "BRL" } },
  },
  {
    id: "en-smalltalk",
    lang: "en",
    text: "Thanks, that was really helpful!",
    expect: { tool: null },
  },
  { id: "pt-smalltalk", lang: "pt", text: "Obrigado, você ajudou muito!", expect: { tool: null } },
];
