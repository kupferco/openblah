import { useState } from "react";
import { Linking } from "react-native";
import { useOnboarding, type OpenBlahApi } from "@openblah/react-native";
import { Body, Button, ErrorText, Field, Screen } from "../ui.js";

/**
 * First run: choose the model, add your own key (the free Gemini key is suggested first) or
 * start the 5-minute trial. Uses the SDK's `useOnboarding` and renders everything itself.
 */
export function OnboardingScreen(props: { api: OpenBlahApi; onDone: () => void }) {
  const ob = useOnboarding({ api: props.api });
  const [key, setKey] = useState("");

  if (ob.loading)
    return (
      <Screen title="Welcome">
        <Body muted>Loading…</Body>
      </Screen>
    );

  const next = ob.missingKeys[0];
  const finish = async () => {
    try {
      await ob.finish();
      props.onDone();
    } catch {
      // the error is shown from `ob.error`
    }
  };
  const addKey = async () => {
    if (!next) return;
    try {
      await ob.addKey(next, key.trim());
      setKey("");
    } catch {
      // shown from `ob.error`
    }
  };

  return (
    <Screen title="Set up your assistant">
      {ob.intro && <Body>{ob.intro}</Body>}
      {ob.providers.map((p) => (
        <Button
          key={p.id}
          label={`${p.label}${p.recommended ? " (suggested)" : ""}${ob.selected?.id === p.id ? " ✓" : ""}`}
          primary={ob.selected?.id === p.id}
          onPress={() => ob.select(p.id)}
        />
      ))}
      {ob.selected && <Body muted>{ob.selected.copy}</Body>}

      {!ob.ready && next && (
        <>
          <Field label={`Your ${next} key`} value={key} onChangeText={setKey} secure />
          {ob.keyUrl && next === "gemini" && (
            <Button
              label="Get a free Gemini key"
              onPress={() => void Linking.openURL(ob.keyUrl!)}
            />
          )}
          <Button
            primary
            label="Check and save key"
            disabled={ob.busy || key.trim() === ""}
            onPress={() => void addKey()}
          />
        </>
      )}
      {!ob.ready && ob.selected?.id === "gemini" && ob.trialAvailable && (
        <Button
          label="Start the 5-minute trial"
          disabled={ob.busy}
          onPress={() => void ob.startTrial().catch(() => undefined)}
        />
      )}
      {ob.dataTerms && <Body muted>{ob.dataTerms}</Body>}
      <ErrorText error={ob.error} />
      <Button
        primary
        label="Continue"
        disabled={!ob.ready || ob.busy}
        onPress={() => void finish()}
      />
    </Screen>
  );
}
