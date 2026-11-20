import { useCallback, useEffect, useMemo, useState } from "react";
import {
  OpenBlahApi,
  type KeyProviderName,
  type KeyStatus,
  type OpenBlahApiOptions,
} from "./api.js";
import { useOnboarding } from "./onboarding.js";

/** Plain-language texts of the add-your-own-key sheet, for translation. @public */
export interface KeySheetTexts {
  /** The message shown when the product does not pay (any more). */
  keyRequired: string;
  /** The same when the free allowance ran out. */
  keyRequiredTrialUsed: string;
  /** Title of the sheet. */
  title: string;
  /** Why an API key and not a ChatGPT / Claude / Gemini app subscription. */
  subscriptionNote: string;
  /** Shown with the free Gemini key: the free tier may be used by Google. */
  freeTierWarning: string;
  /** Shown instead of saving a free key in a sensitive room. */
  sensitiveRefusal: string;
}

/** The English texts. @public */
export const defaultKeySheetTexts: KeySheetTexts = {
  keyRequired: "Add your own key to keep using voice.",
  keyRequiredTrialUsed: "The free allowance is used up. Add your own key to keep using voice.",
  title: "Add your own key",
  subscriptionNote:
    "ChatGPT Plus, the Claude app and the Gemini app cannot power other apps, so an API key is needed. A free Gemini key is the easy way to start.",
  freeTierWarning:
    "A free Gemini key is free, but Google may use what you say to improve its products. Never use it for private or sensitive conversations.",
  sensitiveRefusal:
    "This is a sensitive conversation, so a free Gemini key cannot be used. Use a paid key (Gemini paid, OpenAI or Claude) that does not train on your data.",
};

/** The provider order of the sheet: Gemini (free key) first, then OpenAI and Claude. */
const ORDER = ["gemini", "openai", "claude"];

export interface UseAddKeySheetOptions {
  api: OpenBlahApi | OpenBlahApiOptions;
  /** The product's user id; omit it in the standalone app (same sheet, same hook). */
  userId?: string;
  /** The room is sensitive: a free key is refused. */
  sensitive?: boolean;
  /** Called after the keys were saved. */
  onDone?: () => void;
}

/**
 * State of the shared add-your-own-key sheet (the standalone app uses the same one). Built on
 * {@link useOnboarding}: pick a provider (Gemini first), fill `fields`, call `submit()`.
 * @public
 */
export function useAddKeySheet(options: UseAddKeySheetOptions) {
  const ob = useOnboarding({ api: options.api, userId: options.userId });
  const [values, setValues] = useState<Partial<Record<KeyProviderName, string>>>({});
  const [paidGemini, setPaidGemini] = useState(false);
  const { onDone, sensitive } = options;

  const providers = useMemo(
    () => [...ob.providers].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)),
    [ob.providers],
  );
  const selected = ob.selected;
  const isFreeGemini = selected?.id === "gemini" && !paidGemini;
  const blocked = !!sensitive && isFreeGemini;
  const fields = ob.missingKeys;
  const complete = fields.length > 0 && fields.every((f) => (values[f] ?? "").trim() !== "");

  const submit = useCallback(async () => {
    if (!selected || blocked) return;
    for (const f of fields) {
      const gemini = f === "gemini";
      await ob.addKey(f, (values[f] ?? "").trim(), {
        tier: gemini && !paidGemini ? "free" : "paid",
        noTrainingConfirmed: gemini && paidGemini ? true : undefined,
      });
    }
    await ob.finish();
    setValues({});
    onDone?.();
  }, [selected, blocked, fields, ob, values, paidGemini, onDone]);

  return {
    loading: ob.loading,
    busy: ob.busy,
    error: ob.error,
    intro: ob.intro,
    /** Gemini first, then OpenAI and Claude. */
    providers,
    selected,
    select: ob.select,
    /** The keys to ask for, in order (the provider's key, then speech keys). */
    fields,
    values,
    setValue: (k: KeyProviderName, v: string) => setValues((x) => ({ ...x, [k]: v })),
    /** Where to get the selected provider's key. */
    keyUrl: ob.keyUrl,
    /** Show the free-tier warning: a free Gemini key is selected. */
    showFreeTierWarning: isFreeGemini,
    /** Gemini only: confirm the key is a paid one (no training on the data). */
    paidGemini,
    setPaidGemini,
    /** A free key cannot be used in a sensitive room; show `sensitiveRefusal`. */
    blocked,
    complete,
    canSubmit: complete && !blocked && !ob.busy,
    submit,
  };
}

/**
 * The product's pre-check (`GET /v1/users/:userId/key-status`): `needs_key` means the next voice
 * start would ask for the user's own key, so show the banner and the sheet before they tap.
 * `status` is `null` while loading or when the check fails (then do nothing special).
 * @public
 */
export function useKeyStatus(options: { api: OpenBlahApi | OpenBlahApiOptions; userId: string }): {
  status: KeyStatus | null;
  refresh: () => Promise<void>;
} {
  const api = useMemo(
    () => (options.api instanceof OpenBlahApi ? options.api : new OpenBlahApi(options.api)),
    [options.api],
  );
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const { userId } = options;
  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getKeyStatus(userId));
    } catch {
      setStatus(null);
    }
  }, [api, userId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, refresh };
}
