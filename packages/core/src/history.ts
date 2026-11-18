import { useCallback, useEffect, useMemo, useState } from "react";
import {
  OpenBlahApi,
  type CallListItem,
  type CallRecord,
  type HistoryRetention,
  type OpenBlahApiOptions,
} from "./api.js";

export interface UseHistoryOptions {
  api: OpenBlahApi | OpenBlahApiOptions;
  /** The signed-in person (the host app's backend vouches for it). */
  userId: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useApi(api: OpenBlahApi | OpenBlahApiOptions) {
  return useMemo(() => (api instanceof OpenBlahApi ? api : new OpenBlahApi(api)), [api]);
}

/** The list of past calls you were in (newest first), with `remove` for calls you host. */
export function useHistory(options: UseHistoryOptions) {
  const api = useApi(options.api);
  const { userId } = options;
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCalls(await api.listCalls(userId));
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [api, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Host only: delete everything stored for a call. */
  const remove = useCallback(
    async (roomId: string) => {
      await api.deleteCall(roomId, userId);
      setCalls((c) => c.filter((x) => x.roomId !== roomId));
    },
    [api, userId],
  );

  return { calls, loading, error, refresh, remove };
}

export type UseCallOptions =
  | (UseHistoryOptions & { roomId: string | null; inviteToken?: undefined })
  /** A guest reads the call through the invite link they joined with. */
  | {
      api: OpenBlahApi | OpenBlahApiOptions;
      inviteToken: string;
      roomId?: undefined;
      userId?: undefined;
    };

/** One past call: transcript, notes, actions, summary and action log. `null` until loaded. */
export function useCall(options: UseCallOptions) {
  const api = useApi(options.api);
  const { roomId, userId, inviteToken } = options;
  const [call, setCall] = useState<CallRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setCall(null);
    setError(null);
    if (!inviteToken && !(roomId && userId)) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const load = inviteToken ? api.getCallWithInvite(inviteToken) : api.getCall(roomId!, userId!);
    load.then(
      (c) => live && (setCall(c), setLoading(false)),
      (e: unknown) => live && (setError(message(e)), setLoading(false)),
    );
    return () => {
      live = false;
    };
  }, [api, roomId, userId, inviteToken, version]);

  /** Host only: delete this call's history. */
  const remove = useCallback(async () => {
    if (!roomId || !userId) throw new Error("Only a signed-in host can delete");
    await api.deleteCall(roomId, userId);
    setCall(null);
  }, [api, roomId, userId]);

  /** Host only: save notes on/off and retention for this room. */
  const setSettings = useCallback(
    async (settings: { saveNotes?: boolean; retention?: HistoryRetention }) => {
      if (!roomId || !userId) throw new Error("Only a signed-in host can change this");
      const r = await api.updateHistorySettings(roomId, userId, settings);
      setVersion((v) => v + 1);
      return r;
    },
    [api, roomId, userId],
  );

  return { call, loading, error, remove, setSettings };
}
