import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { ResearchModule } from '../research.module';

describe('ResearchModule', () => {
  it('boots the module', async () => {
    const module = await Test.createTestingModule({ imports: [ResearchModule] }).compile();
    assert.ok(module);
    await module.close();
  });
});
