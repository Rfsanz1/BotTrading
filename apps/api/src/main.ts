import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, Logger } from '@nestjs/common';
import { validateEnv } from './config/env.validation';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import Redis from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import * as promClient from 'prom-client';

async function bootstrap() {
  validateEnv(process.env);
  const app = await NestFactory.create(AppModule);

  // Security & performance
  app.use(helmet());
  app.use(compression());
  app.enableCors({ origin: process.env.CORS_ORIGIN || true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Logging (pino-http middleware)
  const pino = pinoHttp();
  app.use(pino);

  // Redis-backed rate limiter
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const rateLimiter = new RateLimiterRedis({ storeClient: redis, keyPrefix: 'rlflx', points: 120, duration: 60 });
  app.use((req: any, res: any, next: any) => {
    rateLimiter.consume(req.ip).then(() => next()).catch(() => res.status(429).send({ ok: false, error: 'Too many requests' }));
  });

  // Prometheus metrics
  promClient.collectDefaultMetrics();
  app.getHttpAdapter().get('/metrics', async (req: any, res: any) => {
    try {
      res.set('Content-Type', promClient.register.contentType);
      res.send(await promClient.register.metrics());
    } catch (e) {
      res.status(500).send(e.message);
    }
  });

  const config = new DocumentBuilder().setTitle('RFSANZ API').setVersion('1.0').addBearerAuth().build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, doc);

  const port = Number(process.env.PORT || 3001);
  await app.listen(port);
  Logger.log(`API listening on ${port}`);
}

bootstrap();
