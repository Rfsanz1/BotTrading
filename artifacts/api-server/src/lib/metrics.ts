import client from 'prom-client';

client.collectDefaultMetrics({ prefix: 'bottrading_' });

export const httpRequestDuration = new client.Histogram({
  name: 'bottrading_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

export function middleware() {
  return (req: any, res: any, next: any) => {
    const end = httpRequestDuration.startTimer();
    res.on('finish', () => {
      end({ method: req.method, route: req.path, code: res.statusCode });
    });
    next();
  };
}

export default client;
