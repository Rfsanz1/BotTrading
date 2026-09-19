import { EventEmitter } from 'events';

export type NotificationType = 'order' | 'portfolio' | 'ai' | 'risk' | 'market' | 'report' | 'system';

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, any>;
  timestamp: number;
};

export type Subscription = {
  userId: string;
  types: NotificationType[]; // which types the user wants
  channels: ('app' | 'email' | 'sms')[];
};

const subscriptions = new Map<string, Subscription>();
const emitter = new EventEmitter();

// SSE connections per user
const sseConnections = new Map<string, Set<any>>();

export function subscribe(userId: string, types: NotificationType[], channels: ('app' | 'email' | 'sms')[]) {
  subscriptions.set(userId, { userId, types, channels });
}

export function unsubscribe(userId: string) {
  subscriptions.delete(userId);
}

export function getSubscription(userId: string) {
  return subscriptions.get(userId) ?? null;
}

export function sendNotification(notification: Notification, targetUserIds?: string[]) {
  const now = Date.now();
  const n = { ...notification, timestamp: now };
  if (targetUserIds && targetUserIds.length > 0) {
    for (const uid of targetUserIds) {
      // emit for each user
      emitter.emit(`notify:${uid}`, n);
      // also send to SSE connections if present
      const conns = sseConnections.get(uid);
      if (conns) {
        for (const res of conns) {
          try {
            res.write(`data: ${JSON.stringify(n)}\n\n`);
          } catch (e) {
            // ignore write errors; connection cleanup happens on close
          }
        }
      }
    }
  } else {
    // broadcast to all subscribers
    for (const [uid] of subscriptions.entries()) {
      emitter.emit(`notify:${uid}`, n);
      const conns = sseConnections.get(uid);
      if (conns) {
        for (const res of conns) {
          try { res.write(`data: ${JSON.stringify(n)}\n\n`); } catch (e) {}
        }
      }
    }
  }
}

export function sseSubscribe(userId: string, res: any) {
  res.writeHead(200, {
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  });
  res.write('\n');

  let set = sseConnections.get(userId);
  if (!set) { set = new Set(); sseConnections.set(userId, set); }
  set.add(res);

  const keepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (e) {}
  }, 20_000);

  const cleanup = () => {
    clearInterval(keepAlive);
    set!.delete(res);
    if (set!.size === 0) sseConnections.delete(userId);
  };

  res.on('close', cleanup);
  res.on('end', cleanup);
};

// Simple scheduled reports: every interval, send a report notification to users subscribed to 'report'
export function startScheduledReports(intervalMs = 1000 * 60 * 60) {
  setInterval(() => {
    const now = Date.now();
    for (const sub of subscriptions.values()) {
      if (sub.types.includes('report')) {
        const n: Notification = {
          id: `${now}:${sub.userId}`,
          type: 'report',
          title: 'Scheduled portfolio report',
          body: 'Your scheduled portfolio report is ready.',
          data: { generatedAt: now },
          timestamp: now,
        };
        sendNotification(n, [sub.userId]);
      }
    }
  }, intervalMs);
}

export default {
  subscribe,
  unsubscribe,
  getSubscription,
  sendNotification,
  sseSubscribe,
  startScheduledReports,
};
