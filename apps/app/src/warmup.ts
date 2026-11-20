import { useEffect } from "react";
import { AppState } from "react-native";
import type { OpenBlahApi } from "@openblah/react-native";

/**
 * Wake the agent worker when the app opens and again each time it comes to the foreground,
 * so the agent joins quickly when the person taps "Start talking". Failures are ignored.
 */
export function useWarmup(api: OpenBlahApi | null): void {
  useEffect(() => {
    if (!api) return;
    void api.warmup();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void api.warmup();
    });
    return () => sub.remove();
  }, [api]);
}
