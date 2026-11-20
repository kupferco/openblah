import { useEffect, useState } from "react";
import { useOnboarding, type OpenBlahApi } from "@openblah/react-native";
import type { Prefs, PrefsStore } from "../prefs.js";
import { Body, Button, ErrorText, Field, Screen } from "../ui.js";

type Language = "en" | "pt" | "auto";
const LANGUAGES: { id: Language; label: string }[] = [
  { id: "auto", label: "Automatic" },
  { id: "en", label: "English" },
  { id: "pt", label: "Português" },
];

/** Settings: model, key, language override and agent name. */
export function SettingsScreen(props: {
  api: OpenBlahApi;
  prefs: PrefsStore;
  onPrefs: (p: Prefs) => void;
  onBack: () => void;
  onSignOut: () => void;
}) {
  const ob = useOnboarding({ api: props.api });
  const [key, setKey] = useState("");
  const [agentName, setAgentName] = useState("");
  const [language, setLanguage] = useState<Language | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void props.prefs.load().then((p) => setAgentName(p.agentName));
  }, [props.prefs]);

  const lang = language ?? ob.current?.language ?? "auto";
  const next = ob.missingKeys[0];

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      const name = agentName.trim();
      if (!name) throw new Error("Give your assistant a name");
      await props.prefs.save({ agentName: name });
      props.onPrefs({ agentName: name });
      await props.api.updateSettings({ language: lang });
      await ob.finish();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen title="Settings">
      <Body muted>Model</Body>
      {ob.providers.map((p) => (
        <Button
          key={p.id}
          label={`${p.label}${ob.selected?.id === p.id ? " ✓" : ""}${p.usable ? "" : " (needs a key)"}`}
          primary={ob.selected?.id === p.id}
          onPress={() => ob.select(p.id)}
        />
      ))}
      {next && (
        <>
          <Field label={`Your ${next} key`} value={key} onChangeText={setKey} secure />
          <Button
            label="Check and save key"
            disabled={ob.busy || key.trim() === ""}
            onPress={() =>
              void ob.addKey(next, key.trim()).then(
                () => setKey(""),
                () => undefined,
              )
            }
          />
        </>
      )}
      <Body muted>Language</Body>
      {LANGUAGES.map((l) => (
        <Button
          key={l.id}
          label={`${l.label}${lang === l.id ? " ✓" : ""}`}
          primary={lang === l.id}
          onPress={() => setLanguage(l.id)}
        />
      ))}
      <Field label="Assistant name" value={agentName} onChangeText={setAgentName} />
      <ErrorText error={error ?? ob.error} />
      {saved && <Body>Saved.</Body>}
      <Button primary label="Save" disabled={ob.busy} onPress={() => void save()} />
      <Button label="Back" onPress={props.onBack} />
      <Button label="Sign out" onPress={props.onSignOut} />
    </Screen>
  );
}
