import type { CreateInviteOptions, Invite, OpenBlahClient } from "@openblah/core";

/** The part of the browser clipboard used. */
export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/**
 * Mid-call invite for the web: the host taps Invite, a link is created and copied.
 * Returns the invite so the UI can show the link ("Link copied") and offer to revoke it.
 * Falls back to showing the link when the clipboard is not available (rejects with the
 * invite attached as `error.invite`).
 */
export async function copyInviteLink(
  client: Pick<OpenBlahClient, "createInvite">,
  options?: CreateInviteOptions & {
    clipboard?: ClipboardLike | undefined;
  },
): Promise<Invite> {
  const { clipboard = globalThis.navigator?.clipboard, ...inviteOptions } = options ?? {};
  const invite = await client.createInvite(inviteOptions);
  if (!clipboard) throw Object.assign(new Error("Clipboard not available"), { invite });
  try {
    await clipboard.writeText(invite.url);
  } catch (cause) {
    throw Object.assign(new Error("Could not copy the link", { cause }), { invite });
  }
  return invite;
}
