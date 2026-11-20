import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking } from "react-native";
import { OpenBlahProvider, type OpenBlahApi, type OpenBlahClient } from "@openblah/react-native";
import type { AuthService, AuthUser } from "./auth/types.js";
import { config } from "./config.js";
import { parseInviteLink } from "./invite-link.js";
import { defaultPrefs, type Prefs, type PrefsStore } from "./prefs.js";
import { CallScreen } from "./screens/Call.js";
import { ConsentScreen } from "./screens/Consent.js";
import { HomeScreen } from "./screens/Home.js";
import { OnboardingScreen } from "./screens/Onboarding.js";
import { SettingsScreen } from "./screens/Settings.js";
import { SignInScreen } from "./screens/SignIn.js";
import { Body, Screen } from "./ui.js";
import { useWarmup } from "./warmup.js";

type Step = "loading" | "onboarding" | "home" | "settings" | "consent" | "call";

export interface AppRootProps {
  auth: AuthService;
  api: OpenBlahApi;
  client: OpenBlahClient;
  prefs: PrefsStore;
  livekitUrl?: string;
}

/**
 * The app's flow: sign in, onboarding (until a model can run), home, then consent and the call.
 * Everything it needs is passed in, so tests run it with a fake auth and a mocked SDK.
 */
export function AppRoot(props: AppRootProps) {
  const { auth, api } = props;
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [step, setStep] = useState<Step>("loading");
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [terms, setTerms] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);

  useEffect(() => auth.subscribe(setUser), [auth]);

  // Opening the emailed sign-in link or an invite link (universal link) brings the app here.
  useEffect(() => {
    const finish = (url: string | null | undefined) => {
      if (!url) return;
      const token = parseInviteLink(url);
      if (token) setInvite(token);
      else void auth.completeEmailLink(url).catch(() => undefined);
    };
    void Linking.getInitialURL().then(finish);
    const sub = Linking.addEventListener("url", (e) => finish(e.url));
    return () => sub.remove();
  }, [auth]);

  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!uid) {
      setStep("loading");
      return;
    }
    let live = true;
    void props.prefs.load().then((p) => live && setPrefs(p));
    api.getSettings().then(
      (s) => live && setStep(s.usable ? "home" : "onboarding"),
      () => live && setStep("onboarding"),
    );
    return () => {
      live = false;
    };
  }, [uid, api, props.prefs]);

  useWarmup(uid ? api : null);

  const goConsent = useCallback(() => {
    setStep("consent");
    api.getOnboarding().then(
      (o) => setTerms(o.dataTerms),
      () => setTerms(null),
    );
  }, [api]);

  const content = useMemo(() => {
    if (user === undefined)
      return (
        <Screen title="OpenBlah">
          <Body muted>Loading…</Body>
        </Screen>
      );
    if (user === null) return <SignInScreen auth={auth} />;
    const name = user.displayName ?? user.email ?? "there";
    switch (step) {
      case "loading":
        return (
          <Screen title="OpenBlah">
            <Body muted>Loading…</Body>
          </Screen>
        );
      case "onboarding":
        return <OnboardingScreen api={api} onDone={() => setStep("home")} />;
      case "settings":
        return (
          <SettingsScreen
            api={api}
            prefs={props.prefs}
            onPrefs={setPrefs}
            onBack={() => setStep("home")}
            onSignOut={() => void auth.signOut()}
          />
        );
      case "consent":
        return (
          <ConsentScreen
            agentName={prefs.agentName}
            terms={terms}
            onAccept={() => setStep("call")}
            onDecline={() => setStep("home")}
          />
        );
      case "call":
        return (
          <CallScreen
            api={api}
            displayName={name}
            agentName={prefs.agentName}
            livekitUrl={props.livekitUrl ?? config.livekitUrl}
            onLeave={() => setStep("home")}
          />
        );
      default:
        return (
          <HomeScreen
            name={name}
            agentName={prefs.agentName}
            invite={invite}
            onStart={goConsent}
            onSettings={() => setStep("settings")}
          />
        );
    }
  }, [user, step, auth, api, prefs, terms, goConsent, props.prefs, props.livekitUrl]);

  return <OpenBlahProvider client={props.client}>{content}</OpenBlahProvider>;
}
