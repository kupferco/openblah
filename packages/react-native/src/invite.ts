import { Share } from "react-native";
import type { CreateInviteOptions, Invite, OpenBlahClient } from "@openblah/core";

/** The part of React Native's `Share` used. */
export interface ShareLike {
  share(content: { message: string; url?: string }): Promise<{ action: string }>;
}

export interface ShareInviteOptions extends CreateInviteOptions {
  /** Text before the link, e.g. "Join my call". Default: "Join my call:". */
  message?: string;
  /** Override the share sheet; mainly for tests. */
  share?: ShareLike;
}

/**
 * Mid-call invite for React Native: the host taps Invite, a link is created and the
 * system share sheet opens. Resolves with the invite and whether the host actually
 * shared it (false when the sheet was dismissed: consider revoking the link then).
 */
export async function shareInvite(
  client: Pick<OpenBlahClient, "createInvite">,
  options: ShareInviteOptions = {},
): Promise<{ invite: Invite; shared: boolean }> {
  const { message = "Join my call:", share = Share, ...inviteOptions } = options;
  const invite = await client.createInvite(inviteOptions);
  const result = await share.share({ message: `${message} ${invite.url}`, url: invite.url });
  return { invite, shared: result.action !== "dismissedAction" };
}
