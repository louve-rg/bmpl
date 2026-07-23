import type { NotificationChannel, NotificationType } from '@bmpl/shared';

/**
 * Channel-agnostic notification foundation.
 *
 * The API persists an in-app Notification row and then dispatches to any
 * registered channel providers (email, push). Phase 1 ships the interfaces plus
 * a console/log provider; real email/push transports plug in without changing
 * callers.
 */

export interface NotificationMessage {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface NotificationRecipient {
  userId: string;
  email?: string | null;
  pushTokens?: string[];
}

export interface ChannelProvider {
  readonly channel: NotificationChannel;
  send(message: NotificationMessage, recipient: NotificationRecipient): Promise<void>;
}

/** Dev/default provider — logs instead of sending. Safe to run anywhere. */
export class ConsoleChannelProvider implements ChannelProvider {
  constructor(public readonly channel: NotificationChannel = 'EMAIL') {}

  async send(message: NotificationMessage, recipient: NotificationRecipient): Promise<void> {
    // eslint-disable-next-line no-console
    console.info(
      `[notifications:${this.channel}] -> ${recipient.email ?? recipient.userId}: ${message.title}`,
    );
  }
}

/** Pre-built templates for the Phase 1 lifecycle events. */
export const templates = {
  emailVerification(link: string): { title: string; body: string } {
    return {
      title: 'Verify your email',
      body: `Welcome to Belize Marketplace & Logistics. Confirm your email to activate your account: ${link}`,
    };
  },
  passwordReset(link: string): { title: string; body: string } {
    return {
      title: 'Reset your password',
      body: `Use this link to reset your password (expires soon): ${link}`,
    };
  },
  roleApproved(roleLabel: string): { title: string; body: string } {
    return {
      title: `${roleLabel} approved`,
      body: `Your ${roleLabel} role has been approved. You can now switch to it from your account.`,
    };
  },
  roleRejected(roleLabel: string, reason: string): { title: string; body: string } {
    return {
      title: `${roleLabel} application update`,
      body: `Your ${roleLabel} application was not approved. Reason: ${reason}`,
    };
  },
  roleMoreInfo(roleLabel: string, message: string): { title: string; body: string } {
    return {
      title: `More information needed for ${roleLabel}`,
      body: message,
    };
  },
  roleSuspended(roleLabel: string, reason: string): { title: string; body: string } {
    return {
      title: `${roleLabel} suspended`,
      body: `Your ${roleLabel} role has been suspended. Reason: ${reason}`,
    };
  },
} as const;
