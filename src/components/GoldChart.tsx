'use client';

import { useEffect, useRef, useCallback, useReducer } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts';
import { runStrategy } from '@/lib/rsi';

interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  takerBuyBase: number;
  takerBuyQuote: number;
}

interface GoldChartProps {
  data: KlineData[];
  lastFetchTime: Date | null;
}

interface ChartState {
  currentPrice: number | null;
  priceChange: { value: number; percent: number } | null;
  high24h: number;
  low24h: number;
  volume24h: number;
  prevCandle: KlineData | null;
  isConnected: boolean;
}

function computeInitialState(data: KlineData[]): ChartState {
  if (data.length === 0) return { currentPrice: null, priceChange: null, high24h: 0, low24h: 0, volume24h: 0, prevCandle: null, isConnected: false };
  const latest = data[data.length - 1];
  const first = data[0];
  let maxHigh = 0, minLow = Infinity, totalVol = 0;
  for (const d of data) { if (d.high > maxHigh) maxHigh = d.high; if (d.low < minLow) minLow = d.low; totalVol += d.volume; }
  return {
    currentPrice: latest.close,
    priceChange: { value: latest.close - first.open, percent: ((latest.close - first.open) / first.open) * 100 },
    high24h: maxHigh, low24h: minLow, volume24h: totalVol,
    prevCandle: data.length >= 2 ? data[data.length - 2] : null,
    isConnected: false,
  };
}

const formatPrice = (p: number) => p.toFixed(2);
const formatVolume = (v: number) => v >= 1_000_000 ? (v / 1_000_000).toFixed(2) + 'M' : v >= 1_000 ? (v / 1_000).toFixed(1) + 'K' : v.toFixed(2);

export default function GoldChart({ data, lastFetchTime }: GoldChartProps) {
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const rsiLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const smaLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const overboughtRef = useRef<ISeriesApi<'Line'> | null>(null);
  const oversoldRef = useRef<ISeriesApi<'Line'> | null>(null);
  const prevDataLengthRef = useRef<number>(0);
  const initializedRef = useRef<boolean>(false);

  const [isConnected, setIsConnected] = useReducer((_: boolean, v: boolean) => v, false);
  const [state, dispatch] = useReducer((prev: ChartState, action: Partial<ChartState>) => ({ ...prev, ...action }), data, computeInitialState);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => { dispatch(computeInitialState(data)); }, [data]);

  // === CHART INIT (once only) ===
  const initChartsOnce = useCallback(() => {
    if (initializedRef.current) return;
    if (!mainContainerRef.current || !rsiContainerRef.current) return;
    initializedRef.current = true;

    const container = mainContainerRef.current;
    const rsiContainer = rsiContainerRef.current;

    const baseOpts = {
      layout: { background: { type: ColorType.Solid, color: '#0a0e17' }, textColor: '#8892a0', fontSize: 12 },
      grid: { vertLines: { color: 'rgba(42, 46, 57, 0.4)', style: LineStyle.Dotted }, horzLines: { color: 'rgba(42, 46, 57, 0.4)', style: LineStyle.Dotted } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(255, 215, 0, 0.3)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#d4a017' },
        horzLine: { color: 'rgba(255, 215, 0, 0.3)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#d4a017' },
      },
      timeScale: { borderColor: '#1e222d', timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 8, minBarSpacing: 2 },
      handleScroll: { vertTouchDrag: false },
    };

    // --- Main Candlestick Chart ---
    const chart = createChart(container, {
      ...baseOpts,
      rightPriceScale: { borderColor: '#1e222d', scaleMargins: { top: 0.1, bottom: 0.25 } },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350', borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    // --- RSI Chart ---
    const rsiChart = createChart(rsiContainer, {
      ...baseOpts,
      rightPriceScale: { borderColor: '#1e222d', scaleMargins: { top: 0.1, bottom: 0.1 }, autoScale: false },
    });
    rsiChart.priceScale('right').applyOptions({ autoScale: false, minValue: 0, maxValue: 100 });
    rsiChartRef.current = rsiChart;

    rsiLineRef.current = rsiChart.addSeries(LineSeries, { color: '#7c6ff7', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'RSI(1)' });
    smaLineRef.current = rsiChart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'SMA(14)' });
    overboughtRef.current = rsiChart.addSeries(LineSeries, { color: 'rgba(239, 83, 80, 0.4)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    oversoldRef.current = rsiChart.addSeries(LineSeries, { color: 'rgba(38, 166, 154, 0.4)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });

    // Sync scroll
    const mainTs = chart.timeScale();
    const rsiTs = rsiChart.timeScale();
    const unsubMain = mainTs.subscribeVisibleLogicalRangeChange((r) => { if (r) rsiTs.setVisibleLogicalRange(r); });
    const unsubRsi = rsiTs.subscribeVisibleLogicalRangeChange((r) => { if (r) mainTs.setVisibleLogicalRange(r); });

    const handleResize = () => {
      const r1 = container.getBoundingClientRect(); chart.applyOptions({ width: r1.width, height: r1.height });
      const r2 = rsiContainer.getBoundingClientRect(); rsiChart.applyOptions({ width: r2.width, height: r2.height });
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    ro.observe(rsiContainer);

    return () => {
      ro.disconnect(); unsubMain(); unsubRsi();
      candleSeriesRef.current = null; volumeSeriesRef.current = null;
      rsiLineRef.current = null; smaLineRef.current = null;
      overboughtRef.current = null; oversoldRef.current = null;
      chartRef.current = null; rsiChartRef.current = null;
      chart.remove(); rsiChart.remove();
      initializedRef.current = false;
    };
  }, []);

  // === SET INITIAL DATA (once) ===
  const hasSetInitialData = useRef(false);
  useEffect(() => {
    if (data.length === 0 || !candleSeriesRef.current || hasSetInitialData.current) return;
    hasSetInitialData.current = true;

    const candleData: CandlestickData[] = data.map((d) => ({ time: d.time as Time, open: d.open, high: d.high, low: d.low, close: d.close }));
    const volumeData: HistogramData[] = data.map((d) => ({ time: d.time as Time, value: d.volume, color: d.close >= d.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)' }));
    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    const { rsiPoints, signals } = runStrategy(data, 1, 14);
    if (rsiPoints.length > 0 && rsiLineRef.current && smaLineRef.current) {
      rsiLineRef.current.setData(rsiPoints.map((p) => ({ time: p.time as Time, value: p.rsi })));
      smaLineRef.current.setData(rsiPoints.map((p) => ({ time: p.time as Time, value: p.sma })));
      const first = rsiPoints[0].time as Time, last = rsiPoints[rsiPoints.length - 1].time as Time;
      overboughtRef.current?.setData([{ time: first, value: 70 }, { time: last, value: 70 }]);
      oversoldRef.current?.setData([{ time: first, value: 30 }, { time: last, value: 30 }]);
    }
    if (signals.length > 0 && candleSeriesRef.current) {
      candleSeriesRef.current.applyOptions({ markers: signals.map((sig) => ({
        time: sig.candleTime as Time,
        position: sig.type === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
        color: sig.type === 'BUY' ? '#26a69a' : '#ef5350',
        shape: sig.type === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
        text: `${sig.type} @ ${formatPrice(sig.price)}`,
      })) });
    }
    chartRef.current?.timeScale().fitContent();
    rsiChartRef.current?.timeScale().fitContent();
    prevDataLengthRef.current = data.length;
  }, [data.length > 0]); // eslint-disable-line

  // === INCREMENTAL UPDATES ===
  useEffect(() => {
    if (data.length === 0 || !candleSeriesRef.current || !hasSetInitialData.current) return;
    const lastCandle = data[data.length - 1];
    candleSeriesRef.current.update({ time: lastCandle.time as Time, open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: lastCandle.close });
    volumeSeriesRef.current?.update({ time: lastCandle.time as Time, value: lastCandle.volume, color: lastCandle.close >= lastCandle.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)' });

    if (data.length !== prevDataLengthRef.current && data.length > 16) {
      prevDataLengthRef.current = data.length;
      const { rsiPoints, signals } = runStrategy(data, 1, 14);
      if (rsiPoints.length > 0 && rsiLineRef.current && smaLineRef.current) {
        rsiLineRef.current.setData(rsiPoints.map((p) => ({ time: p.time as Time, value: p.rsi })));
        smaLineRef.current.setData(rsiPoints.map((p) => ({ time: p.time as Time, value: p.sma })));
        const first = rsiPoints[0].time as Time, last = rsiPoints[rsiPoints.length - 1].time as Time;
        overboughtRef.current?.setData([{ time: first, value: 70 }, { time: last, value: 70 }]);
        oversoldRef.current?.setData([{ time: first, value: 30 }, { time: last, value: 30 }]);
      }
      if (signals.length > 0 && candleSeriesRef.current) {
        candleSeriesRef.current.applyOptions({ markers: signals.map((sig) => ({
          time: sig.candleTime as Time,
          position: sig.type === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
          color: sig.type === 'BUY' ? '#26a69a' : '#ef5350',
          shape: sig.type === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
          text: `${sig.type} @ ${formatPrice(sig.price)}`,
        })) });
      }
    }
  }, [data]);

  // === WEBSOCKET ===
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconTimeout: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      ws = new WebSocket('wss://fstream.binance.com/ws/xauusdt@kline_3m');
      ws.onopen = () => setIsConnected(true);
      ws.onmessage = (event) => {
        try {
          const { k } = JSON.parse(event.data);
          const time = Math.floor(k.t / 1000) as Time;
          const open = parseFloat(k.o), high = parseFloat(k.h), low = parseFloat(k.l), close = parseFloat(k.c), volume = parseFloat(k.v);
          candleSeriesRef.current?.update({ time, open, high, low, close });
          volumeSeriesRef.current?.update({ time, value: volume, color: close >= open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)' });
          const cs = stateRef.current;
          const baseOpen = cs.prevCandle ? cs.prevCandle.open : open;
          dispatch({
            currentPrice: close,
            priceChange: { value: close - baseOpen, percent: ((close - baseOpen) / baseOpen) * 100 },
            high24h: Math.max(cs.high24h, high),
            low24h: cs.low24h === 0 ? low : Math.min(cs.low24h, low),
          });
        } catch { /* ignore */ }
      };
      ws.onclose = () => { setIsConnected(false); reconTimeout = setTimeout(connect, 3000); };
      ws.onerror = () => { ws?.close(); };
    };
    connect();
    return () => { ws?.close(); if (reconTimeout) clearTimeout(reconTimeout); };
  }, []);

  useEffect(() => { const cleanup = initChartsOnce(); return () => { cleanup?.(); }; }, [initChartsOnce]);

  const { currentPrice, priceChange, high24h, low24h, volume24h, prevCandle } = state;
  const prevClose = prevCandle?.close;
  const priceColorClass = prevClose ? (currentPrice! > prevClose ? 'text-emerald-400' : currentPrice! < prevClose ? 'text-red-400' : 'text-white') : 'text-white';
  const changeColorClass = priceChange && priceChange.value > 0 ? 'text-emerald-400' : priceChange && priceChange.value < 0 ? 'text-red-400' : 'text-zinc-400';

  // RSI values for display
  const { rsiPoints, signals } = runStrategy(data, 1, 14);
  const latestRSI = rsiPoints.length > 0 ? rsiPoints[rsiPoints.length - 1] : null;

  return (
    <div className="flex flex-col h-full w-full">
      {/* === TRADINGVIEW-STYLE HEADER === */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-zinc-800/60 bg-[#0d1117]">
        {/* Logo + Pair */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <span className="text-white font-bold text-sm sm:text-lg tracking-tight">XAU/USDT</span>
            <span className="text-zinc-500 text-[10px] sm:text-xs ml-1.5">3 Min</span>
          </div>
        </div>

        {/* RSI Status Box */}
        {latestRSI && (
          <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
            <div className="text-center">
              <div className="text-[8px] sm:text-[10px] text-zinc-500 uppercase">RSI(1)</div>
              <div className={`text-xs sm:text-sm font-mono font-bold tabular-nums ${latestRSI.rsi >= 70 ? 'text-red-400' : latestRSI.rsi <= 30 ? 'text-emerald-400' : 'text-zinc-300'}`}>{latestRSI.rsi.toFixed(1)}</div>
            </div>
            <div className="w-px h-5 sm:h-6 bg-zinc-700" />
            <div className="text-center">
              <div className="text-[8px] sm:text-[10px] text-zinc-500 uppercase">SMA(14)</div>
              <div className={`text-xs sm:text-sm font-mono font-bold tabular-nums ${latestRSI.sma >= 70 ? 'text-red-400' : latestRSI.sma <= 30 ? 'text-emerald-400' : 'text-yellow-400'}`}>{latestRSI.sma.toFixed(1)}</div>
            </div>
          </div>
        )}

        {/* Right side: status + time + price */}
        <div className="flex items-center gap-2 sm:gap-3 ml-auto">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
            <span className={`text-[10px] sm:text-xs ${isConnected ? 'text-emerald-400' : 'text-zinc-600'}`}>
              {isConnected ? 'WS LIVE' : 'POLLING'}
            </span>
          </div>

          {lastFetchTime && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-800/60">
              <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${!isConnected ? 'bg-yellow-400' : 'bg-emerald-400'}`} />
              <span className="text-[11px] font-mono tabular-nums text-zinc-400">Updated {lastFetchTime.toLocaleTimeString()}</span>
            </div>
          )}

          {signals.length > 0 && (
            <div className="flex items-center gap-1 text-[10px] sm:text-[11px]">
              <span className="text-emerald-400 font-mono">{signals.filter(s => s.type === 'BUY').length}B</span>
              <span className="text-zinc-600">/</span>
              <span className="text-red-400 font-mono">{signals.filter(s => s.type === 'SELL').length}S</span>
            </div>
          )}
        </div>

        {/* Price */}
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="text-right">
            <div className={`text-xl sm:text-2xl font-mono font-bold tabular-nums ${priceColorClass} transition-colors duration-200`}>
              {currentPrice ? formatPrice(currentPrice) : '---'}
            </div>
          </div>
          {priceChange && (
            <div className="text-right min-w-[80px] sm:min-w-[100px]">
              <div className={`text-xs sm:text-sm font-mono font-semibold tabular-nums ${changeColorClass}`}>
                {priceChange.value >= 0 ? '+' : ''}{formatPrice(priceChange.value)}
              </div>
              <div className={`text-[10px] sm:text-xs font-mono tabular-nums ${changeColorClass}`}>
                {priceChange.percent >= 0 ? '+' : ''}{priceChange.percent.toFixed(2)}%
              </div>
            </div>
          )}
        </div>
      </div>

      {/* === METRICS BAR === */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800/40 border-b border-zinc-800/60">
        <MetricItem label="Session High" value={high24h ? formatPrice(high24h) : '---'} />
        <MetricItem label="Session Low" value={low24h ? formatPrice(low24h) : '---'} />
        <MetricItem label="Volume" value={volume24h ? formatVolume(volume24h) : '---'} />
        <MetricItem label="Data Source" value={isConnected ? 'WebSocket + Poll' : '10s Polling'} />
      </div>

      {/* === MAIN CHART === */}
      <div className="flex-1 relative bg-[#0a0e17] min-h-[200px]">
        <div ref={mainContainerRef} className="absolute inset-0 w-full h-full" />
        {!currentPrice && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0e17]/80 z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin" />
              <span className="text-zinc-400 text-sm">Loading XAU/USDT data...</span>
            </div>
          </div>
        )}
      </div>

      {/* === RSI SEPARATOR === */}
      <div className="flex items-center gap-2 px-3 sm:px-4 py-1 bg-[#0d1117] border-t border-b border-zinc-800/40 overflow-x-auto whitespace-nowrap">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold shrink-0">RSI Strategy</span>
        <div className="flex items-center gap-2 sm:gap-3 ml-auto shrink-0">
          <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-[#7c6ff7]" /><span className="text-[10px] text-zinc-500">RSI(1)</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-yellow-500" /><span className="text-[10px] text-zinc-500">SMA(14)</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-emerald-500/40" /><span className="text-[10px] text-zinc-500">30</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-red-500/40" /><span className="text-[10px] text-zinc-500">70</span></div>
          <span className="text-emerald-400 text-[10px]">&#9650; BUY</span>
          <span className="text-red-400 text-[10px]">&#9660; SELL</span>
        </div>
      </div>

      {/* === RSI CHART === */}
      <div className="relative bg-[#0a0e17] h-[120px] sm:h-[150px]">
        <div ref={rsiContainerRef} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-2.5 bg-[#0d1117]">
      <span className="text-zinc-500 text-[10px] sm:text-xs">{label}</span>
      <span className="text-zinc-200 text-xs sm:text-sm font-mono tabular-nums">{value}</span>
    </div>
  );
}
