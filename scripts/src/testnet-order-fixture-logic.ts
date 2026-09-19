export function buildRiskValidLevels(entryPrice: number): { stopLoss: number; targetPrice: number } {
  const stopDistance = Math.max(Number((entryPrice * 0.005).toFixed(2)), 0.01);
  const targetDistance = Number((stopDistance * 2).toFixed(2));
  return {
    stopLoss: Number((entryPrice - stopDistance).toFixed(2)),
    targetPrice: Number((entryPrice + targetDistance).toFixed(2)),
  };
}
