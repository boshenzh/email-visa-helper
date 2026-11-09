export function canonicalAddress(value: unknown): { local: string; domain: string; address: string } | null;
export function sameMailbox(envelopeTo: string, mailbox: string): boolean;
export function authorizedForwardAddress(env: {
  MAILBOX?: string;
  OPERATOR_FORWARD_ADDRESS?: string;
  OPERATOR_FORWARD_VERIFIED?: string;
}): string | null;
export function handleEmail(
  message: {
    to: string;
    from?: string;
    rawSize?: number;
    raw: string | ReadableStream<Uint8Array>;
    headers?: { get(name: string): string | null };
    canBeForwarded?: boolean;
    setReject(reason: string): void;
    forward(dest: string): Promise<unknown>;
  },
  env: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<{ outcome: string; reason: string }>;
