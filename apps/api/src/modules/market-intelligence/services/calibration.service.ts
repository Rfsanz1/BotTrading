import { Injectable } from '@nestjs/common';
import { PaperOutcomePersistenceService } from './paper-outcome-persistence.service';

export type CalibrationState = 'CALIBRATION_READY' | 'CALIBRATION_COLD_START' | 'CALIBRATION_UNAVAILABLE';

export interface CalibrationResult {
  state: CalibrationState;
  calibratedProbability: number | null;
  sampleSize: number;
  method: string;
  version: string;
}

@Injectable()
export class CalibrationService {
  private readonly method = 'empirical-confidence-bucket-v1';
  private readonly version = '1';

  constructor(private readonly persistence: PaperOutcomePersistenceService) {}

  async calibrate(rawConfidence: number, decisionTimestamp: number): Promise<CalibrationResult> {
    if (!Number.isFinite(rawConfidence) || rawConfidence < 0 || rawConfidence > 1
      || !Number.isFinite(decisionTimestamp) || decisionTimestamp <= 0) {
      return this.unavailable(0);
    }
    try {
      const minimumSamples = Math.max(1, Number(process.env.PAPER_CALIBRATION_MIN_SAMPLES ?? 30));
      const result = await this.persistence.calibrateConfidenceBucket(rawConfidence, decisionTimestamp, minimumSamples);
      return {
        state: result.calibratedProbability === null ? 'CALIBRATION_COLD_START' : 'CALIBRATION_READY',
        calibratedProbability: result.calibratedProbability,
        sampleSize: result.sampleSize,
        method: this.method,
        version: this.version,
      };
    } catch {
      return this.unavailable(0);
    }
  }

  private unavailable(sampleSize: number): CalibrationResult {
    return {
      state: 'CALIBRATION_UNAVAILABLE',
      calibratedProbability: null,
      sampleSize,
      method: this.method,
      version: this.version,
    };
  }
}
