'use client';

import { useEffect, useRef, useCallback } from 'react';
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

  const formatPrice = (p: number) => p.toFixed(2);

  // Initialize charts ONCE only — never rebuild
  const initChartsOnce = useCallback(() => {
    if (initializedRef.current) return;
    if (!mainContainerRef.current || !rsiContainerRef.current) return;
    initializedRef.current = true;

    const container = mainContainerRef.current;
    const rsiContainer = rsiContainerRef.current;

    const baseOpts = {
      layout: { background: { type: ColorType.Solid, color: '#0a0e17' }, textColor: '#8892a0', fontSize: 11 },
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

    const rsiLine = rsiChart.addSeries(LineSeries, {
      color: '#7c6ff7', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'RSI(1)',
    });
    rsiLineRef.current = rsiLine;

    const smaLine = rsiChart.addSeries(LineSeries, {
      color: '#f59e0b', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'SMA(14)',
    });
    smaLineRef.current = smaLine;

    const overboughtLine = rsiChart.addSeries(LineSeries, {
      color: 'rgba(239, 83, 80, 0.4)', lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    overboughtRef.current = overboughtLine;

    const oversoldLine = rsiChart.addSeries(LineSeries, {
      color: 'rgba(38, 166, 154, 0.4)', lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    oversoldRef.current = oversoldLine;

    // Sync scroll between charts
    const mainTs = chart.timeScale();
    const rsiTs = rsiChart.timeScale();
    const unsubMain = mainTs.subscribeVisibleLogicalRangeChange((range) => { if (range) rsiTs.setVisibleLogicalRange(range); });
    const unsubRsi = rsiTs.subscribeVisibleLogicalRangeChange((range) => { if (range) mainTs.setVisibleLogicalRange(range); });

    // Resize handlers
    const handleResize = () => {
      const r1 = container.getBoundingClientRect();
      chart.applyOptions({ width: r1.width, height: r1.height });
      const r2 = rsiContainer.getBoundingClientRect();
      rsiChart.applyOptions({ width: r2.width, height: r2.height });
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    ro.observe(rsiContainer);

    // Cleanup on unmount
    return () => {
      ro.disconnect();
      unsubMain();
      unsubRsi();
      candleSeriesRef.current = null; volumeSeriesRef.current = null;
      rsiLineRef.current = null; smaLineRef.current = null;
      overboughtRef.current = null; oversoldRef.current = null;
      chartRef.current = null; rsiChartRef.current = null;
      chart.remove(); rsiChart.remove();
      initializedRef.current = false;
    };
  }, []);

  // Populate initial data once charts are created
  const hasSetInitialData = useRef(false);
  useEffect(() => {
    if (data.length === 0 || !candleSeriesRef.current || hasSetInitialData.current) return;
    hasSetInitialData.current = true;

    const candleData: CandlestickData[] = data.map((d) => ({
      time: d.time as Time, open: d.open, high: d.high, low: d.low, close: d.close,
    }));
    const volumeData: HistogramData[] = data.map((d) => ({
      time: d.time as Time, value: d.volume,
      color: d.close >= d.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)',
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    // RSI data
    const { rsiPoints, signals } = runStrategy(data, 1, 14);
    if (rsiPoints.length > 0 && rsiLineRef.current && smaLineRef.current) {
      rsiLineRef.current.setData(rsiPoints.map((p) => ({ time: p.time as Time, value: p.rsi })));
      smaLineRef.current.setData(rsiPoints.map((p) => ({ time: p.time as Time, value: p.sma })));

      const first = rsiPoints[0].time as Time;
      const last = rsiPoints[rsiPoints.length - 1].time as Time;
      overboughtRef.current?.setData([{ time: first, value: 70 }, { time: last, value: 70 }]);
      oversoldRef.current?.setData([{ time: first, value: 30 }, { time: last, value: 30 }]);
    }

    // Markers
    if (signals.length > 0 && candleSeriesRef.current) {
      const markers = signals.map((sig) => ({
        time: sig.candleTime as Time,
        position: sig.type === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
        color: sig.type === 'BUY' ? '#26a69a' : '#ef5350',
        shape: sig.type === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
        text: `${sig.type} @ ${formatPrice(sig.price)}`,
      }));
      candleSeriesRef.current.applyOptions({ markers });
    }

    chartRef.current?.timeScale().fitContent();
    rsiChartRef.current?.timeScale().fitContent();

    prevDataLengthRef.current = data.length;
  }, [data.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Incremental updates when new candle arrives
  useEffect(() => {
    if (data.length === 0 || !candleSeriesRef.current || !hasSetInitialData.current) return;
    const lastCandle = data[data.length - 1];

    candleSeriesRef.current.update({
      time: lastCandle.time as Time, open: lastCandle.open, high: lastCandle.high,
      low: lastCandle.low, close: lastCandle.close,
    });
    volumeSeriesRef.current?.update({
      time: lastCandle.time as Time, value: lastCandle.volume,
      color: lastCandle.close >= lastCandle.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)',
    });

    // Update RSI when data length changes (new candle)
    if (data.length !== prevDataLengthRef.current && data.length > 16) {
      prevDataLengthRef.current = data.length;
      const { rsiPoints, signals } = runStrategy(data, 1, 14);
      if (rsiPoints.length > 0 && rsiLineRef.current && smaLineRef.current) {
        rsiLineRef.current.setData(rsiPoints.map((p) => ({ time: p.time as Time, value: p.rsi })));
        smaLineRef.current.setData(rsiPoints.map((p) => ({ time: p.time as Time, value: p.sma })));
        const first = rsiPoints[0].time as Time;
        const last = rsiPoints[rsiPoints.length - 1].time as Time;
        overboughtRef.current?.setData([{ time: first, value: 70 }, { time: last, value: 70 }]);
        oversoldRef.current?.setData([{ time: first, value: 30 }, { time: last, value: 30 }]);
      }
      if (signals.length > 0 && candleSeriesRef.current) {
        const markers = signals.map((sig) => ({
          time: sig.candleTime as Time,
          position: sig.type === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
          color: sig.type === 'BUY' ? '#26a69a' : '#ef5350',
          shape: sig.type === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
          text: `${sig.type} @ ${formatPrice(sig.price)}`,
        }));
        candleSeriesRef.current.applyOptions({ markers });
      }
    }
  }, [data]);

  // WebSocket for real-time chart updates
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new WebSocket('wss://fstream.binance.com/ws/xauusdt@kline_3m');
      ws.onopen = () => { /* connected */ };
      ws.onmessage = (event) => {
        try {
          const { k } = JSON.parse(event.data);
          const time = Math.floor(k.t / 1000) as Time;
          const open = parseFloat(k.o);
          const high = parseFloat(k.h);
          const low = parseFloat(k.l);
          const close = parseFloat(k.c);
          const volume = parseFloat(k.v);

          candleSeriesRef.current?.update({ time, open, high, low, close });
          volumeSeriesRef.current?.update({
            time, value: volume,
            color: close >= open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)',
          });
        } catch { /* ignore */ }
      };
      ws.onclose = () => { reconnectTimeout = setTimeout(connect, 3000); };
      ws.onerror = () => { ws?.close(); };
    };
    connect();
    return () => { ws?.close(); if (reconnectTimeout) clearTimeout(reconnectTimeout); };
  }, []);

  // Mount charts
  useEffect(() => {
    const cleanup = initChartsOnce();
    return () => { cleanup?.(); };
  }, [initChartsOnce]);

  return (
    <div className="flex flex-col w-full">
      {/* RSI Legend Bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0d1117] border-t border-zinc-800/40 overflow-x-auto whitespace-nowrap">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold shrink-0">RSI Strategy</span>
        <div className="flex items-center gap-3 ml-auto shrink-0">
          <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-[#7c6ff7]" /><span className="text-[10px] text-zinc-500">RSI(1)</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-yellow-500" /><span className="text-[10px] text-zinc-500">SMA(14)</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-emerald-500/40" /><span className="text-[10px] text-zinc-500">30</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-0.5 bg-red-500/40" /><span className="text-[10px] text-zinc-500">70</span></div>
          <span className="text-emerald-400 text-[10px]">&#9650; BUY</span>
          <span className="text-red-400 text-[10px]">&#9660; SELL</span>
        </div>
      </div>

      {/* Main Candlestick Chart */}
      <div className="relative bg-[#0a0e17]" style={{ height: 'clamp(280px, 45vh, 560px)' }}>
        <div ref={mainContainerRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* RSI Chart */}
      <div className="relative bg-[#0a0e17]" style={{ height: 'clamp(100px, 18vh, 180px)' }}>
        <div ref={rsiContainerRef} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  );
}
