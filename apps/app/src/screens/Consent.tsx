import { Body, Button, Screen } from "../ui.js";

/**
 * Shown before joining a call with the agent. The words come from the data terms the server
 * sent with onboarding; accepting here is also given to the server once the call is open.
 */
export function ConsentScreen(props: {
  agentName: string;
  terms: string | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Screen title={`Talk with ${props.agentName}`}>
      <Body>
        {`${props.agentName} is an AI. It listens to the call, and what you say is sent to the AI model you chose so it can answer.`}
      </Body>
      {props.terms && <Body muted>{props.terms}</Body>}
      <Button primary label="I agree, start" onPress={props.onAccept} />
      <Button label="Not now" onPress={props.onDecline} />
    </Screen>
  );
}
