'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts';

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
}

function formatPrice(price: number): string {
  return price.toFixed(2);
}

function formatVolume(volume: number): string {
  if (volume >= 1_000_000) return (volume / 1_000_000).toFixed(2) + 'M';
  if (volume >= 1_000) return (volume / 1_000).toFixed(1) + 'K';
  return volume.toFixed(2);
}

export default function GoldChart({ data }: GoldChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<{ value: number; percent: number } | null>(null);
  const [high24h, setHigh24h] = useState<number>(0);
  const [low24h, setLow24h] = useState<number>(0);
  const [volume24h, setVolume24h] = useState<number>(0);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [prevCandle, setPrevCandle] = useState<KlineData | null>(null);

  const currentCandleRef = useRef<KlineData | null>(null);
  const currentPriceRef = useRef<number>(0);

  const derivedStats = useMemo(() => {
    if (data.length === 0) return null;
    const latest = data[data.length - 1];
    const first = data[0];
    let maxHigh = 0;
    let minLow = Infinity;
    let totalVol = 0;
    for (const d of data) {
      if (d.high > maxHigh) maxHigh = d.high;
      if (d.low < minLow) minLow = d.low;
      totalVol += d.volume;
    }
    return {
      initialPrice: latest.close,
      priceChange: {
        value: latest.close - first.open,
        percent: ((latest.close - first.open) / first.open) * 100,
      },
      high24h: maxHigh,
      low24h: minLow,
      volume24h: totalVol,
      prevCandle: data.length >= 2 ? data[data.length - 2] : null,
      latestCandle: latest,
    };
  }, [data]);

  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<{ value: number; percent: number } | null>(null);
  const [high24h, setHigh24h] = useState<number>(0);
  const [low24h, setLow24h] = useState<number>(0);
  const [volume24h, setVolume24h] = useState<number>(0);
  const [prevCandle, setPrevCandle] = useState<KlineData | null>(null);

  // Sync derived stats to state on initial load
  useEffect(() => {
    if (derivedStats) {
      currentPriceRef.current = derivedStats.initialPrice;
      setCurrentPrice(derivedStats.initialPrice);
      setPriceChange(derivedStats.priceChange);
      setHigh24h(derivedStats.high24h);
      setLow24h(derivedStats.low24h);
      setVolume24h(derivedStats.volume24h);
      setPrevCandle(derivedStats.prevCandle);
      currentCandleRef.current = { ...derivedStats.latestCandle };
    }
  }, [derivedStats]);

  const initChart = useCallback(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;
    const rect = container.getBoundingClientRect();

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0e17' },
        textColor: '#8892a0',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.4)', style: LineStyle.Dotted },
        horzLines: { color: 'rgba(42, 46, 57, 0.4)', style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255, 215, 0, 0.3)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#d4a017',
        },
        horzLine: {
          color: 'rgba(255, 215, 0, 0.3)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#d4a017',
        },
      },
      rightPriceScale: {
        borderColor: '#1e222d',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#1e222d',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
        minBarSpacing: 2,
      },
      handleScroll: { vertTouchDrag: false },
    });

    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    const candleData: CandlestickData[] = data.map((d) => ({
      time: d.time as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    const volumeData: HistogramData[] = data.map((d) => ({
      time: d.time as Time,
      value: d.volume,
      color: d.close >= d.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)',
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (container) {
        const newRect = container.getBoundingClientRect();
        chart.applyOptions({
          width: newRect.width,
          height: newRect.height,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [data]);

  useEffect(() => {
    const cleanup = initChart();
    return () => {
      cleanup?.();
    };
  }, [initChart]);

  useEffect(() => {
    const connectWebSocket = () => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = new WebSocket(
        'wss://stream.binance.com:9443/ws/xauusdt@kline_3m'
      );

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const k = message.k;

          const time = Math.floor(k.t / 1000);
          const open = parseFloat(k.o);
          const high = parseFloat(k.h);
          const low = parseFloat(k.l);
          const close = parseFloat(k.c);
          const volume = parseFloat(k.v);

          const candleUpdate: CandlestickData = {
            time: time as Time,
            open,
            high,
            low,
            close,
          };

          if (candleSeriesRef.current) {
            candleSeriesRef.current.update(candleUpdate);
          }

          if (volumeSeriesRef.current) {
            volumeSeriesRef.current.update({
              time: time as Time,
              value: volume,
              color: close >= open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)',
            });
          }

          setCurrentPrice(close);
          currentPriceRef.current = close;
          setLastUpdate(new Date());

          if (currentCandleRef.current) {
            const prevClose = currentCandleRef.current.close;
            setPriceChange((prev) => {
              if (prev && prevCandleRef.current) {
                const baseOpen = prevCandleRef.current.open;
                return {
                  value: close - baseOpen,
                  percent: ((close - baseOpen) / baseOpen) * 100,
                };
              }
              return prev;
            });
          }

          if (parseFloat(k.h) > high24h) setHigh24h(parseFloat(k.h));
          if (parseFloat(k.l) < low24h || low24h === 0) setLow24h(parseFloat(k.l));
        } catch (err) {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const prevClose = prevCandle?.close;
  const priceColorClass = prevClose
    ? currentPrice! > prevClose
      ? 'text-emerald-400'
      : currentPrice! < prevClose
        ? 'text-red-400'
        : 'text-white'
    : 'text-white';

  const changeColorClass =
    priceChange && priceChange.value > 0
      ? 'text-emerald-400'
      : priceChange && priceChange.value < 0
        ? 'text-red-400'
        : 'text-zinc-400';

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header Stats Bar */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-zinc-800/60 bg-[#0d1117]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <span className="text-white font-bold text-lg tracking-tight">XAU/USDT</span>
            <span className="text-zinc-500 text-xs ml-2">3 Min</span>
          </div>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <div
            className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`}
          />
          <span className={`text-xs ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
            {isConnected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className={`text-2xl font-mono font-bold tabular-nums ${priceColorClass} transition-colors duration-200`}>
              {currentPrice ? formatPrice(currentPrice) : '---'}
            </div>
          </div>

          {priceChange && (
            <div className="text-right min-w-[100px]">
              <div className={`text-sm font-mono font-semibold tabular-nums ${changeColorClass}`}>
                {priceChange.value >= 0 ? '+' : ''}
                {formatPrice(priceChange.value)}
              </div>
              <div className={`text-xs font-mono tabular-nums ${changeColorClass}`}>
                {priceChange.percent >= 0 ? '+' : ''}
                {priceChange.percent.toFixed(2)}%
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800/40 border-b border-zinc-800/60">
        <MetricItem label="24h High" value={high24h ? formatPrice(high24h) : '---'} />
        <MetricItem label="24h Low" value={low24h ? formatPrice(low24h) : '---'} />
        <MetricItem label="Volume" value={volume24h ? formatVolume(volume24h) : '---'} />
        <MetricItem
          label="Last Update"
          value={lastUpdate ? lastUpdate.toLocaleTimeString() : '---'}
        />
      </div>

      {/* Chart Container */}
      <div className="flex-1 relative bg-[#0a0e17] min-h-[300px]">
        <div ref={chartContainerRef} className="absolute inset-0 w-full h-full" />
        {(!currentPrice || !isConnected) && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0e17]/80 z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin" />
              <span className="text-zinc-400 text-sm">Loading XAU/USDT data...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-[#0d1117]">
      <span className="text-zinc-500 text-xs">{label}</span>
      <span className="text-zinc-200 text-sm font-mono tabular-nums">{value}</span>
    </div>
  );
}
