import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConsensusService } from './consensus.service';
import { ConsensusController } from './consensus.controller';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [ConsensusService],
  controllers: [ConsensusController],
  exports: [ConsensusService],
})
export class ConsensusModule {}
