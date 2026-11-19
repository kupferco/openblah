import AsyncStorage from "@react-native-async-storage/async-storage";
import { defaultPrefs, type PrefsStore } from "./prefs.js";

const KEY = "openblah.prefs";

/** Prefs on the phone, in AsyncStorage. */
export const asyncStoragePrefs: PrefsStore = {
  async load() {
    const raw = await AsyncStorage.getItem(KEY);
    try {
      const p = raw ? (JSON.parse(raw) as { agentName?: string }) : {};
      return { agentName: p.agentName?.trim() || defaultPrefs.agentName };
    } catch {
      return defaultPrefs;
    }
  },
  save: (prefs) => AsyncStorage.setItem(KEY, JSON.stringify(prefs)),
};
