import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import cookieParser from 'cookie-parser';
import { startScheduledReports } from './lib/notifications';
import rateLimitMiddleware from './middlewares/rateLimit';
import metrics, { middleware as metricsMiddleware } from './lib/metrics';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { z } from 'zod';

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(metricsMiddleware());
app.use(rateLimitMiddleware);
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// start background scheduled reports (hourly)
startScheduledReports(1000 * 60 * 60);

// Expose Prometheus metrics
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

// Swagger setup
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'BotTrading API', version: '1.0.0' },
  },
  apis: ['./src/routes/*.ts'],
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// basic env validation
const envSchema = z.object({ NODE_ENV: z.string().optional(), JWT_ACCESS_SECRET: z.string().optional(), JWT_REFRESH_SECRET: z.string().optional(), REDIS_URL: z.string().url().optional() });
const env = envSchema.safeParse(process.env);
if (!env.success) {
  logger.warn('Environment validation warnings', env.error.format());
}

export default app;
