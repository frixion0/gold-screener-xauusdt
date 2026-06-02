// RSI Strategy Engine
// RSI Length: 1, SMA Length: 14
// Buy: SMA crosses above 30 from below
// Sell: SMA crosses below 70 from above

export interface Signal {
  type: 'BUY' | 'SELL';
  price: number;
  rsi: number;
  rsiSma: number;
  candleTime: number;
}

export interface RSIPoint {
  time: number;
  rsi: number;
  sma: number;
}

/**
 * Calculate RSI using Wilder's smoothing method
 */
export function calculateRSI(closes: number[], length: number): number[] {
  if (closes.length < length + 1) return [];

  const rsi: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  // Initial simple average
  for (let i = 1; i <= length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= length;
  avgLoss /= length;

  // First RSI value
  if (avgLoss === 0) rsi.push(100);
  else rsi.push(100 - 100 / (1 + avgGain / avgLoss));

  // Subsequent values using Wilder's EMA smoothing
  for (let i = length + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (length - 1) + gain) / length;
    avgLoss = (avgLoss * (length - 1) + loss) / length;
    if (avgLoss === 0) rsi.push(100);
    else rsi.push(100 - 100 / (1 + avgGain / avgLoss));
  }

  return rsi;
}

/**
 * Calculate Simple Moving Average
 */
export function calculateSMA(values: number[], length: number): number[] {
  if (values.length < length) return [];
  const sma: number[] = [];
  for (let i = length - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - length + 1; j <= i; j++) {
      sum += values[j];
    }
    sma.push(sum / length);
  }
  return sma;
}

/**
 * Full strategy: calculate RSI(1) → SMA(14) → detect buy/sell signals
 */
export function runStrategy(
  candles: { time: number; close: number }[],
  rsiLength: number = 1,
  smaLength: number = 14
): { rsiPoints: RSIPoint[]; signals: Signal[] } {
  if (candles.length < rsiLength + smaLength + 1) {
    return { rsiPoints: [], signals: [] };
  }

  const closes = candles.map((c) => c.close);
  const rsi = calculateRSI(closes, rsiLength);
  const sma = calculateSMA(rsi, smaLength);

  // RSI starts at index rsiLength (first RSI computed after rsiLength+1 closes)
  // SMA starts at index smaLength - 1 of the RSI array
  // So the first SMA corresponds to candle at index: rsiLength + smaLength
  const rsiStartIdx = rsiLength;
  const smaStartIdx = smaLength - 1;

  // Build RSI points aligned with candle times
  const rsiPoints: RSIPoint[] = [];
  for (let i = smaStartIdx; i < rsi.length; i++) {
    const candleIdx = rsiStartIdx + i;
    if (candleIdx < candles.length) {
      rsiPoints.push({
        time: candles[candleIdx].time,
        rsi: Math.round(rsi[i] * 100) / 100,
        sma: Math.round(sma[i - smaStartIdx] * 100) / 100,
      });
    }
  }

  // Detect crossover signals
  const signals: Signal[] = [];
  for (let i = 1; i < sma.length; i++) {
    const prevSma = sma[i - 1];
    const currSma = sma[i];

    // BUY: SMA crosses above 30 from below
    if (prevSma <= 30 && currSma > 30) {
      const candleIdx = rsiStartIdx + i + smaStartIdx;
      if (candleIdx < candles.length) {
        signals.push({
          type: 'BUY',
          price: candles[candleIdx].close,
          rsi: Math.round(rsi[i + smaStartIdx] * 100) / 100,
          rsiSma: Math.round(currSma * 100) / 100,
          candleTime: candles[candleIdx].time,
        });
      }
    }

    // SELL: SMA crosses below 70 from above
    if (prevSma >= 70 && currSma < 70) {
      const candleIdx = rsiStartIdx + i + smaStartIdx;
      if (candleIdx < candles.length) {
        signals.push({
          type: 'SELL',
          price: candles[candleIdx].close,
          rsi: Math.round(rsi[i + smaStartIdx] * 100) / 100,
          rsiSma: Math.round(currSma * 100) / 100,
          candleTime: candles[candleIdx].time,
        });
      }
    }
  }

  return { rsiPoints, signals };
}

/**
 * Get current strategy state (for bot status)
 */
export function getCurrentState(
  candles: { time: number; close: number }[],
  rsiLength: number = 1,
  smaLength: number = 14
): {
  currentRSI: number | null;
  currentSMA: number | null;
  lastSignal: Signal | null;
  position: 'LONG' | 'SHORT' | 'NEUTRAL';
} {
  const { rsiPoints, signals } = runStrategy(candles, rsiLength, smaLength);

  const lastPoint = rsiPoints.length > 0 ? rsiPoints[rsiPoints.length - 1] : null;
  const lastSignal = signals.length > 0 ? signals[signals.length - 1] : null;

  let position: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  if (signals.length > 0) {
    // Walk through all signals to determine current position
    let pos = 'NEUTRAL';
    for (const sig of signals) {
      if (sig.type === 'BUY') pos = 'LONG';
      else if (sig.type === 'SELL') pos = 'NEUTRAL';
    }
    position = pos as 'LONG' | 'SHORT' | 'NEUTRAL';
  }

  return {
    currentRSI: lastPoint?.rsi ?? null,
    currentSMA: lastPoint?.sma ?? null,
    lastSignal,
    position,
  };
}
