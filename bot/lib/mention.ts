import { fileURLToPath } from "node:url";
import { readJson } from "../../src/files.js";

type Handler = (args: { config: unknown; mention: Mention; token: string }) => Promise<{ requested: number }>;
type Mention = { channel: string; ts: string; threadTs: string; user: string | null; text: string };
type Kv = { get(key: string): Promise<unknown>; put(key: string, value: unknown): Promise<void> };

const CONFIG = fileURLToPath(new URL("../../config/apps.json", import.meta.url));
const DAY_MS = 24 * 3600 * 1000;

/**
 * An `onAppMention` handler that runs `handle` once per Slack message and never starts a model
 * turn. Slack may deliver the same event again; the key in kv makes the second one a no-op.
 */
export function mentionHandler(prefix: string, handle: Handler) {
  return async (ctx: { host: { kv: Kv } }, message: { ts: string; threadTs: string; channelId: string; body: string; author?: { userId: string; isBot: boolean } }) => {
    if (message.author?.isBot) return null;
    const key = `mention:${prefix}:${message.channelId}:${message.ts}`;
    const seen = (await ctx.host.kv.get(key).catch(() => null)) as { exp?: number } | null;
    if (seen && (seen.exp ?? 0) > Date.now()) return null;
    await ctx.host.kv.put(key, { exp: Date.now() + DAY_MS }).catch(() => {});

    const token = process.env[`${prefix}_SLACK_BOT_TOKEN`]?.trim();
    if (!token) {
      console.error(`Falta ${prefix}_SLACK_BOT_TOKEN.`);
      return null;
    }
    const mention = {
      channel: message.channelId,
      ts: message.ts,
      threadTs: message.threadTs || message.ts,
      user: message.author?.userId || null,
      text: message.body,
    };
    try {
      const out = await handle({ config: readJson(CONFIG), mention, token });
      console.log(`[${prefix}] ${mention.channel} ${mention.ts}: ${out.requested} petición(es) activada(s)`);
    } catch (err) {
      console.error(`[${prefix}] ${mention.channel} ${mention.ts}: ${(err as Error).message}`);
    }
    return null;
  };
}
