import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { ResearchModule } from '../research.module';

describe('ResearchModule', () => {
  it('boots the module', async () => {
    const module = await Test.createTestingModule({ imports: [ResearchModule] }).compile();
    const app = module.createNestApplication();
    await app.init();
    assert.ok(app instanceof Object);
    await app.close();
  });
});
