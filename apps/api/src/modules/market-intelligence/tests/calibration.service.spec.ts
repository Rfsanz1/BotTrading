import { CalibrationService } from '../services/calibration.service';

describe('CalibrationService', () => {
  const previousMinimum = process.env.PAPER_CALIBRATION_MIN_SAMPLES;

  afterEach(() => {
    if (previousMinimum === undefined) delete process.env.PAPER_CALIBRATION_MIN_SAMPLES;
    else process.env.PAPER_CALIBRATION_MIN_SAMPLES = previousMinimum;
  });

  it('returns cold-start without fabricating a calibrated probability', async () => {
    const service = new CalibrationService({
      calibrateConfidenceBucket: jest.fn().mockResolvedValue({ sampleSize: 4, calibratedProbability: null }),
    } as never);

    await expect(service.calibrate(0.9, 1000)).resolves.toEqual({
      state: 'CALIBRATION_COLD_START',
      calibratedProbability: null,
      sampleSize: 4,
      method: 'empirical-confidence-bucket-v1',
      version: '1',
    });
  });

  it('reports READY only when the database bucket has sufficient completed forward outcomes', async () => {
    process.env.PAPER_CALIBRATION_MIN_SAMPLES = '30';
    const persistence = { calibrateConfidenceBucket: jest.fn().mockResolvedValue({ sampleSize: 30, calibratedProbability: 0.63 }) };
    const service = new CalibrationService(persistence as never);

    await expect(service.calibrate(0.9, 10_000)).resolves.toMatchObject({
      state: 'CALIBRATION_READY',
      calibratedProbability: 0.63,
      sampleSize: 30,
    });
    expect(persistence.calibrateConfidenceBucket).toHaveBeenCalledWith(0.9, 10_000, 30);
  });

  it('fails closed when calibration persistence is unavailable', async () => {
    const service = new CalibrationService({
      calibrateConfidenceBucket: jest.fn().mockRejectedValue(new Error('database unavailable')),
    } as never);

    await expect(service.calibrate(0.9, 10_000)).resolves.toMatchObject({
      state: 'CALIBRATION_UNAVAILABLE',
      calibratedProbability: null,
    });
  });
});
