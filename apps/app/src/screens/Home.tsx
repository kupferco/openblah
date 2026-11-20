import { Body, Button, Screen } from "../ui.js";

/** Home: one big button. Tap to start (no wake word). */
export function HomeScreen(props: {
  name: string;
  agentName: string;
  onStart: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onTools: () => void;
}) {
  return (
    <Screen title={`Hi ${props.name}`}>
      <Body muted>{`${props.agentName} is ready when you are.`}</Body>
      <Button primary label="Start talking" onPress={props.onStart} />
      <Button label="Call history" onPress={props.onHistory} />
      <Button label="Tools" onPress={props.onTools} />
      <Button label="Settings" onPress={props.onSettings} />
    </Screen>
  );
}
