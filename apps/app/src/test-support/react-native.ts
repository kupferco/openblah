import { createElement, type ReactNode } from "react";

/** A stand-in for `react-native` in tests: host elements named after the components. */
const host = (name: string) => (props: Record<string, unknown> & { children?: ReactNode }) =>
  createElement(name, props);

export const View = host("View");
export const Text = host("Text");
export const TextInput = host("TextInput");
export const Pressable = host("Pressable");
export const SafeAreaView = host("SafeAreaView");
export const StyleSheet = { create: <T>(s: T) => s };

type UrlHandler = (e: { url: string }) => void;
export const linking = { initial: null as string | null, handlers: new Set<UrlHandler>() };
export const Linking = {
  getInitialURL: async () => linking.initial,
  openURL: async () => undefined,
  addEventListener: (_: "url", h: UrlHandler) => {
    linking.handlers.add(h);
    return { remove: () => linking.handlers.delete(h) };
  },
};

type StateHandler = (s: string) => void;
export const appState = { handlers: new Set<StateHandler>() };
export const AppState = {
  addEventListener: (_: "change", h: StateHandler) => {
    appState.handlers.add(h);
    return { remove: () => appState.handlers.delete(h) };
  },
};
