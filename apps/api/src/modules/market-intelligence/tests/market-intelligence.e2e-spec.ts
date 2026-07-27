import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { MarketIntelligenceModule } from '../market-intelligence.module';

describe('MarketIntelligenceController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [MarketIntelligenceModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/market-intelligence/timeframes (GET)', async () => {
    const response = await request(app.getHttpServer()).get('/market-intelligence/timeframes');
    expect(response.status).toBe(200);
  });
});
