import { useState } from "react";
import { Body, Button, ErrorText, Field, Screen } from "../ui.js";
import type { AuthService } from "../auth/types.js";

/** Sign-in (Q6): email link or Google. Sign in with Apple is added in T26. */
export function SignInScreen(props: { auth: AuthService }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Sign in to OpenBlah">
      <Body muted>Talk to an AI that listens, helps and joins your calls.</Body>
      <Field label="Email" value={email} onChangeText={setEmail} keyboard="email-address" />
      <Button
        primary
        label="Email me a sign-in link"
        disabled={busy || !email.includes("@")}
        onPress={() =>
          void run(async () => {
            await props.auth.sendEmailLink(email.trim());
            setSent(true);
          })
        }
      />
      {sent && <Body>Check your email and open the link on this phone.</Body>}
      <Button
        label="Continue with Google"
        disabled={busy}
        onPress={() => void run(() => props.auth.signInWithGoogle())}
      />
      <ErrorText error={error} />
    </Screen>
  );
}
