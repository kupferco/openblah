import { Body, Button, Screen } from "../ui.js";

/** Home: one big button. Tap to start (no wake word). */
export function HomeScreen(props: {
  name: string;
  agentName: string;
  /** Token of an invite link the app was opened with, if any. */
  invite?: string | null;
  onStart: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onTools: () => void;
}) {
  return (
    <Screen title={`Hi ${props.name}`}>
      <Body muted>{`${props.agentName} is ready when you are.`}</Body>
      {props.invite && (
        <Body>
          You opened an invite link. Joining a call from an invite is coming to the app soon; for
          now, open the link in your browser.
        </Body>
      )}
      <Button primary label="Start talking" onPress={props.onStart} />
      <Button label="Call history" onPress={props.onHistory} />
      <Button label="Tools" onPress={props.onTools} />
      <Button label="Settings" onPress={props.onSettings} />
    </Screen>
  );
}
