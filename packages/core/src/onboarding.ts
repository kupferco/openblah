import { useCallback, useEffect, useMemo, useState } from "react";
import {
  OpenBlahApi,
  type KeyCheckResult,
  type KeyProviderName,
  type OnboardingInfo,
  type OnboardingProvider,
  type OpenBlahApiOptions,
} from "./api.js";

export interface UseOnboardingOptions {
  api: OpenBlahApi | OpenBlahApiOptions;
  /** A product's user id (the product's backend vouches for it). Omit it in the standalone app. */
  userId?: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * First-run onboarding that you render yourself: which model provider, adding and checking
 * a key, starting the free trial. The server suggests the free Gemini key first (`intro`,
 * `providers[0]`). It needs no room, so it can run before the first call.
 *
 * Flow: `select(id)`, then `addKey(...)` for each entry of `missingKeys` (or `startTrial()` for
 * Gemini), then `finish()` saves the choice. `ready` says the selected provider can run.
 */
export function useOnboarding(options: UseOnboardingOptions) {
  const api = useMemo(
    () => (options.api instanceof OpenBlahApi ? options.api : new OpenBlahApi(options.api)),
    [options.api],
  );
  const { userId } = options;
  const [info, setInfo] = useState<OnboardingInfo | null>(null);
  const [selectedId, setSelectedId] = useState<OnboardingProvider["id"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInfo(await api.getOnboarding(userId));
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [api, userId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const selected =
    info?.providers.find((p) => p.id === (selectedId ?? info.current.llm.provider)) ?? null;

  /** Run an action with the busy flag; errors land in `error` and are rethrown. */
  const act = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(message(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const checkKey = useCallback(
    (provider: KeyProviderName, key: string): Promise<KeyCheckResult> =>
      act(() => api.checkKey(provider, key, userId)),
    [act, api, userId],
  );

  const addKey = useCallback(
    (
      provider: KeyProviderName,
      key: string,
      opts: { tier?: "free" | "paid"; noTrainingConfirmed?: boolean } = {},
    ) =>
      act(async () => {
        const check = await api.checkKey(provider, key, userId);
        if (check.status === "invalid") {
          throw new Error(`That ${provider} key was not accepted. Check it and try again.`);
        }
        if (check.status === "unreachable") {
          throw new Error("Could not check the key just now. Try again in a moment.");
        }
        await api.saveKey(
          provider,
          key,
          {
            tier: opts.tier ?? (provider === "gemini" ? "free" : "paid"),
            noTrainingConfirmed: opts.noTrainingConfirmed,
          },
          userId,
        );
        await refresh();
      }),
    [act, api, userId, refresh],
  );

  const startTrial = useCallback(
    () =>
      act(async () => {
        const r = await api.startTrial(userId);
        setSelectedId("gemini");
        await refresh();
        return r.status;
      }),
    [act, api, userId, refresh],
  );

  const finish = useCallback(
    () =>
      act(async () => {
        if (!selected) throw new Error("Choose a provider first");
        const saved = await api.updateSettings({ llm: selected.id }, userId);
        await refresh();
        return saved;
      }),
    [act, api, userId, selected, refresh],
  );

  return {
    loading,
    busy,
    error,
    /** Intro copy that suggests the free Gemini key first. */
    intro: info?.intro ?? null,
    providers: info?.providers ?? [],
    selected,
    select: (id: OnboardingProvider["id"]) => setSelectedId(id),
    /** Keys still to add to use the selected provider with your own keys. */
    missingKeys: selected?.missingKeys ?? [],
    /** Where to get the selected provider's key, when there is a free one. */
    keyUrl: selected?.keyUrl ?? null,
    trial: info?.trial ?? null,
    trialAvailable: info?.trialAvailable ?? false,
    dataTerms: info?.dataTerms ?? null,
    current: info?.current ?? null,
    /** The selected provider can run now (own keys, product keys or the trial). */
    ready: !!selected?.usable,
    checkKey,
    addKey,
    startTrial,
    finish,
    refresh,
  };
}
