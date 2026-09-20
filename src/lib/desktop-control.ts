import { z } from "zod";

export const desktopActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tunnel-check"), mode: z.enum(["named", "external"]), origin: z.string().trim().url().max(300), token: z.string().trim().max(4096).optional() }).strict(),
  z.object({ action: z.literal("tunnel-apply"), id: z.string().uuid(), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("tunnel-cancel") }).strict(),
  z.object({ action: z.literal("tunnel-base"), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("share"), origin: z.string().url().max(300) }).strict(),
  z.object({ action: z.literal("start") }).strict(),
  z.object({ action: z.literal("stop"), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("auto"), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("verify"), token: z.string().trim().min(20).max(300) }).strict(),
  z.object({ action: z.literal("pair"), mode: z.enum(["private", "group"]) }).strict(),
  z.object({ action: z.literal("test"), chatId: z.string().max(100) }).strict(),
  z.object({ action: z.literal("remove"), chatId: z.string().max(100) }).strict(),
  z.object({ action: z.literal("management"), chatId: z.string().max(100), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("retry") }).strict(),
]);
export const desktopStateSchema = z.object({
  connection: z.object({
    mode: z.enum(["quick", "named", "external"]), baseMode: z.enum(["quick", "external"]),
    configuredOrigin: z.string(), hasToken: z.boolean(), auto: z.boolean(), busy: z.boolean(),
    pending: z.object({ id: z.string(), origin: z.string(), mode: z.enum(["named", "external"]), expires: z.number() }).nullable(),
  }).optional(),
  externalTunnel: z.boolean().optional(),
  origin: z.string(),
  addresses: z.array(z.object({ origin: z.string(), label: z.string() })),
  tunnel: z.enum(["off", "connecting", "connected", "recovering"]),
  ca: z.boolean(),
  telegram: z.object({
    bot: z.object({ name: z.string(), username: z.string() }).nullable(),
    chats: z.array(z.object({ id: z.string(), title: z.string(), type: z.string(), managementEnabled: z.boolean().optional() })),
    autoTunnel: z.boolean(), receiver: z.string(),
  }),
});
export type DesktopState = z.infer<typeof desktopStateSchema>;
export type DesktopAction = z.infer<typeof desktopActionSchema>;
declare global {
  var __liveConfDesktopControl: {
    snapshot: () => DesktopState;
    run: (action: DesktopAction) => Promise<{ error?: string; link?: string }>;
    notifyOrigin?: (origin: string) => void;
  } | undefined;
  var __liveConfDesktopBusy: boolean | undefined;
}

/** x-forwarded-proto is sanitized by the custom server, never trusted raw. */
export function desktopTransportAllowed(url: string, headers: Headers): boolean {
  const host = new URL(url).hostname;
  return headers.get("x-forwarded-proto") === "https" || new URL(url).protocol === "https:" ||
    (["localhost", "127.0.0.1", "[::1]"].includes(host) &&
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(headers.get("x-lct-ip") ?? ""));
}
