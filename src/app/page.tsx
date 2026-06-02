'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, BarChart3, Clock, Zap, RefreshCw, Bot, ArrowUpCircle, ArrowDownCircle, Radio, Wifi, WifiOff, Wallet, Target, AlertTriangle, DollarSign, Power, PowerOff, X } from 'lucide-react';
import { runStrategy } from '@/lib/rsi';

const GoldChart = dynamic(() => import('@/components/GoldChart'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[500px] bg-[#0a0e17]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-2 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin" />
        <span className="text-zinc-400 text-sm">Loading chart engine...</span>
      </div>
    </div>
  ),
});

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

interface BotStatus {
  active: boolean;
  position: string;
  currentRSI: number | null;
  currentSMA: number | null;
  lastPing: string | null;
  lastPingAgoMs: number;
  totalSignals: number;
  autoTrade: boolean;
  quantity: number;
  leverage: number;
  stoplossPercent: number;
  takeprofitPercent: number;
  engine?: {
    startedAt: string | null;
    lastCheckAt: string | null;
    nextCheckAt: string | null;
    lastResult: string | null;
    lastTradeResult: string | null;
    checkCount: number;
    errorCount: number;
    isRunning: boolean;
    autoTrade: boolean;
  };
}

interface SignalRecord {
  id: number;
  type: string;
  price: number;
  rsi: number;
  rsiSma: number;
  candleTime: number;
  createdAt: string;
}

interface MudrexFunds {
  balance: string;
  locked_amount: string;
  first_time_user: boolean;
}

interface MudrexPosition {
  id: string;
  created_at: string;
  updated_at: string;
  entry_price: string;
  quantity: string;
  leverage: string;
  liquidation_price: string;
  order_type: 'LONG' | 'SHORT';
  status: string;
  symbol: string;
  asset_uuid: string;
  stoploss: { price: string; order_id: string; order_type: string } | null;
  takeprofit: { price: string; order_id: string; order_type: string } | null;
}

interface TradeLog {
  id: number;
  source: string;
  orderType: string;
  price: number;
  quantity: number;
  leverage: number;
  slPrice: number | null;
  tpPrice: number;
  slPercent: number | null;
  tpPercent: number | null;
  orderId: string | null;
  status: string;
  result: string | null;
  createdAt: string;
}

interface BotStats {
  totalSignals: number;
  totalBuys: number;
  totalSells: number;
  totalPnL: number;
  winCount: number;
  lossCount: number;
  winRate: number;
}

function useSecondsAgo(since: Date | null): number {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const tick = () => setSeconds(since ? Math.floor((Date.now() - since.getTime()) / 1000) : 0);
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [since]);
  return seconds;
}

export default function Home() {
  const [klineData, setKlineData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fetchCountRef = useRef(0);

  // Bot state
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [botStats, setBotStats] = useState<BotStats | null>(null);

  // Mudrex broker state
  const [brokerFunds, setBrokerFunds] = useState<MudrexFunds | null>(null);
  const [brokerPositions, setBrokerPositions] = useState<MudrexPosition[]>([]);
  const [brokerError, setBrokerError] = useState<string | null>(null);

  // Trade log
  const [recentTrades, setRecentTrades] = useState<TradeLog[]>([]);

  // Manual trade state
  const [autoTrade, setAutoTrade] = useState(false);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeMsg, setTradeMsg] = useState<string | null>(null);
  const [tradeQty, setTradeQty] = useState('0.002');
  const [tradeLeverage, setTradeLeverage] = useState('100');
  const [tradeSL, setTradeSL] = useState('');
  const [tradeTP, setTradeTP] = useState('');
  const [autoSLPct, setAutoSLPct] = useState('0.05');
  const [autoTPPct, setAutoTPPct] = useState('0.15');
  const [testSignalLoading, setTestSignalLoading] = useState(false);

  const fetchKlines = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setIsRefreshing(true);
      const res = await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=XAUUSDT&interval=3m&limit=200');
      if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
      const rawData: (string | number)[][] = await res.json();
      const data: KlineData[] = rawData.map((k) => ({
        time: Math.floor(Number(k[0]) / 1000),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
        quoteVolume: parseFloat(String(k[7])),
        trades: Number(k[8]),
        takerBuyBase: parseFloat(String(k[9])),
        takerBuyQuote: parseFloat(String(k[10])),
      }));
      setKlineData(data);
      setLastFetch(new Date());
      setError(null);
      fetchCountRef.current += 1;
    } catch (_err) {
      if (!isBackground) setError('Failed to load market data. Retrying...');
    } finally {
      setIsRefreshing(false);
      if (!isBackground) setLoading(false);
    }
  }, []);

  const fetchBotStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/status');
      if (res.ok) {
        const data = await res.json();
        setBotStatus(data);
        // Sync autoTrade state from server
        setAutoTrade(data.autoTrade ?? false);
        // Sync trade config from server
        if (data.quantity) setTradeQty(String(data.quantity));
        if (data.leverage) setTradeLeverage(String(data.leverage));
        if (data.stoplossPercent) setAutoSLPct(String(data.stoplossPercent));
        if (data.takeprofitPercent) setAutoTPPct(String(data.takeprofitPercent));
      }
    } catch { /* silent */ }
  }, []);

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/signals?limit=30');
      if (res.ok) {
        const data = await res.json();
        setSignals(data.signals);
        setBotStats(data.stats);
      }
    } catch { /* silent */ }
  }, []);

  const fetchBroker = useCallback(async () => {
    try {
      const [fundsRes, posRes] = await Promise.all([
        fetch('/api/broker/funds'),
        fetch('/api/broker/positions'),
      ]);
      if (fundsRes.ok) {
        const fundsJson = await fundsRes.json();
        if (fundsJson.success) setBrokerFunds(fundsJson.data);
        else setBrokerError(fundsJson.error || 'Funds fetch failed');
      } else {
        setBrokerError(`Funds: ${fundsRes.status}`);
      }
      if (posRes.ok) {
        const posJson = await posRes.json();
        if (posJson.success) setBrokerPositions(posJson.data || []);
      }
    } catch { /* silent */ }
  }, []);

  const fetchRecentTrades = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/trades?limit=2');
      if (res.ok) {
        const data = await res.json();
        if (data.success) setRecentTrades(data.trades || []);
      }
    } catch { /* silent */ }
  }, []);

  // Computed values (needed by callbacks below)
  const latestCandle = klineData.length > 0 ? klineData[klineData.length - 1] : null;
  const prevCandle = klineData.length > 1 ? klineData[klineData.length - 2] : null;

  const placeOrder = useCallback(async (orderType: 'LONG' | 'SHORT') => {
    setTradeLoading(true);
    setTradeMsg(null);
    try {
      const price = latestCandle?.close || 0;
      if (!price) { setTradeMsg('No price data available'); setTradeLoading(false); return; }

      // Calculate SL/TP from % or direct $
      let slPrice = tradeSL ? parseFloat(tradeSL) : undefined;
      let tpPrice = tradeTP ? parseFloat(tradeTP) : undefined;
      let slPercent: number | undefined;
      let tpPercent: number | undefined;

      // If SL is a percentage (like 0.05), calculate from price
      if (slPrice !== undefined && slPrice < 1) {
        slPercent = slPrice;
        slPrice = orderType === 'LONG'
          ? price * (1 - slPrice / 100)
          : price * (1 + slPrice / 100);
      }
      // If TP is a percentage (like 0.15), calculate from price
      if (tpPrice !== undefined && tpPrice < 1) {
        tpPercent = tpPrice;
        tpPrice = orderType === 'LONG'
          ? price * (1 + tpPrice / 100)
          : price * (1 - tpPrice / 100);
      }

      const res = await fetch('/api/broker/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_type: orderType, order_price: price, quantity: parseFloat(tradeQty),
          leverage: parseInt(tradeLeverage), trigger_type: 'MARKET',
          is_stoploss: !!slPrice, is_takeprofit: !!tpPrice,
          stoploss_price: slPrice, takeprofit_price: tpPrice,
          sl_percent: slPercent, tp_percent: tpPercent,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setTradeMsg(`${orderType} order placed ✅ — ID: ${json.data?.order_id?.slice(0, 8)}...`);
        setTimeout(() => { fetchBroker(); fetchRecentTrades(); }, 2000);
      } else {
        setTradeMsg(`Order failed: ${json.error}`);
      }
    } catch (err) {
      setTradeMsg(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setTradeLoading(false);
    }
  }, [latestCandle, tradeQty, tradeLeverage, tradeSL, tradeTP, fetchBroker, fetchRecentTrades, klineData]);

  const closePosition = useCallback(async (pos: MudrexPosition) => {
    setTradeLoading(true);
    setTradeMsg(null);
    try {
      const price = latestCandle?.close || 0;
      if (!price) { setTradeMsg('No price data'); setTradeLoading(false); return; }
      const closeType = pos.order_type === 'LONG' ? 'SHORT' : 'LONG';
      const res = await fetch('/api/broker/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_type: closeType, order_price: price, quantity: parseFloat(pos.quantity), leverage: parseInt(pos.leverage) }),
      });
      const json = await res.json();
      if (json.success) {
        setTradeMsg(`Closed ${pos.order_type} ${pos.symbol} ✅`);
        setTimeout(() => fetchBroker(), 2000);
      } else {
        setTradeMsg(`Close failed: ${json.error}`);
      }
    } catch (err) {
      setTradeMsg(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setTradeLoading(false);
    }
  }, [latestCandle, fetchBroker, klineData]);

  const toggleAutoTrade = useCallback(async (enable: boolean) => {
    try {
      const res = await fetch('/api/bot/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoTrade: enable, quantity: parseFloat(tradeQty), leverage: parseInt(tradeLeverage),
          stoplossPercent: parseFloat(autoSLPct), takeprofitPercent: parseFloat(autoTPPct),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setAutoTrade(json.autoTrade);
        setTradeMsg(`Auto-trading ${json.autoTrade ? 'ON ✅' : 'OFF'} — Qty: ${json.quantity}, ${json.leverage}x, SL: ${json.stoplossPercent}%, TP: ${json.takeprofitPercent}%`);
      }
    } catch (err) {
      setTradeMsg(`Toggle failed: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }, [tradeQty, tradeLeverage, autoSLPct, autoTPPct]);

  const generateTestSignal = useCallback(async () => {
    if (klineData.length < 50) {
      setTradeMsg('Not enough candle data yet');
      return;
    }
    setTestSignalLoading(true);
    setTradeMsg(null);
    try {
      // Send client-side kline data to avoid Binance IP blocking on server
      const candles = klineData.map(k => ({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume }));
      const res = await fetch('/api/bot/test-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candles }),
      });
      const json = await res.json();
      if (json.success) {
        setTradeMsg(`Test signal: ${json.message}`);
        setTimeout(() => { fetchSignals(); fetchBotStatus(); }, 1000);
      } else {
        setTradeMsg(`Test failed: ${json.error}`);
      }
    } catch (err) {
      setTradeMsg(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setTestSignalLoading(false);
    }
  }, [klineData, fetchSignals, fetchBotStatus]);

  // Initial fetch
  useEffect(() => {
    fetchKlines();
    fetchBotStatus();
    fetchSignals();
    fetchBroker();
    fetchRecentTrades();
  }, [fetchKlines, fetchBotStatus, fetchSignals, fetchBroker, fetchRecentTrades]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => { fetchKlines(true); fetchBotStatus(); fetchSignals(); fetchBroker(); fetchRecentTrades(); }, 10000);
    return () => clearInterval(interval);
  }, [fetchKlines, fetchBotStatus, fetchSignals, fetchBroker, fetchRecentTrades]);

  const secondsAgo = useSecondsAgo(lastFetch);
  const isUp = prevCandle ? latestCandle!.close >= prevCandle.close : true;
  const nextRefreshIn = 10 - (secondsAgo % 10);

  // Client-side RSI calculation from fetched kline data
  const { rsiPoints, signals: clientSignals } = runStrategy(klineData, 1, 14);
  const latestRSI = rsiPoints.length > 0 ? rsiPoints[rsiPoints.length - 1] : null;
  const recentClientSignals = clientSignals.slice(-2).reverse(); // Last 2 signals
  const recentDBSignals = signals.slice(0, 2); // Latest 2 from DB
  // Show client signals if available, otherwise fall back to DB signals
  const displaySignals: Array<{ type: string; price: number; rsi: number; rsiSma: number; candleTime: number; createdAt?: string; id?: number; source: 'client' | 'db' }> =
    recentClientSignals.length > 0
      ? recentClientSignals.map(s => ({ ...s, source: 'client' as const }))
      : recentDBSignals.map(s => ({ ...s, source: 'db' as const }));

  return (
    <div className="min-h-screen bg-[#080b12] text-white">
      {/* Top Navigation */}
      <header className="border-b border-zinc-800/60 bg-[#0d1117]">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center shadow-lg shadow-yellow-500/20">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-lg font-bold tracking-tight">
                <span className="text-yellow-400">Gold</span>
                <span className="text-zinc-300">Screener</span>
              </h1>
            </div>
            <Badge variant="outline" className="border-yellow-500/30 text-yellow-400 text-[10px] uppercase tracking-wider">
              <Activity className="w-3 h-3 mr-1" />
              Real-Time
            </Badge>
            <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-[10px] uppercase tracking-wider">
              <Bot className="w-3 h-3 mr-1" />
              RSI Bot
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            {lastFetch && (
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${secondsAgo < 3 ? 'bg-emerald-400' : secondsAgo < 8 ? 'bg-yellow-400' : 'bg-orange-400'} ${secondsAgo < 3 ? 'animate-pulse' : ''}`} />
                <span className={`text-xs font-mono tabular-nums ${secondsAgo < 3 ? 'text-emerald-400' : secondsAgo < 8 ? 'text-yellow-400' : 'text-orange-400'}`}>
                  {secondsAgo < 2 ? 'Just now' : `${secondsAgo}s ago`}
                </span>
                <span className="text-zinc-600 text-xs font-mono tabular-nums">next in {nextRefreshIn}s</span>
              </div>
            )}
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px]">XAUUSDT</Badge>
          </div>
        </div>
      </header>

      {/* Last Updated Banner */}
      {lastFetch && (
        <div className="bg-[#0b1019] border-b border-zinc-800/40">
          <div className="max-w-[1600px] mx-auto px-4 py-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Clock className="w-3 h-3" />
              <span>Last updated: <span className="text-zinc-300 font-mono tabular-nums">{lastFetch.toLocaleTimeString()}</span></span>
              <span className="text-zinc-600">|</span>
              <span>Interval: <span className="text-yellow-400">10s</span></span>
              <span className="text-zinc-600">|</span>
              <span>Strategy: <span className="text-purple-400">RSI(1) + SMA(14)</span></span>
            </div>
            <button onClick={() => { fetchKlines(); fetchBotStatus(); fetchSignals(); fetchBroker(); }} disabled={isRefreshing}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-yellow-400 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      )}

      <main className="max-w-[1600px] mx-auto p-3 sm:p-4">
        {/* Stats Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
          <StatCard icon={<TrendingUp className={`w-4 h-4 ${isUp ? 'text-emerald-400' : 'text-red-400'}`} />}
            label="Current Price" value={latestCandle ? `$${latestCandle.close.toFixed(2)}` : '---'}
            subtext={latestCandle ? (isUp ? 'Bullish' : 'Bearish') : ''} subtextClass={isUp ? 'text-emerald-400' : 'text-red-400'} />
          <StatCard icon={<BarChart3 className="w-4 h-4 text-zinc-400" />}
            label="Session High" value={latestCandle ? `$${Math.max(...klineData.map(k => k.high)).toFixed(2)}` : '---'} subtext="Max peak" />
          <StatCard icon={<Activity className="w-4 h-4 text-zinc-400" />}
            label="Session Low" value={latestCandle ? `$${Math.min(...klineData.map(k => k.low)).toFixed(2)}` : '---'} subtext="Min trough" />
          <StatCard icon={<BarChart3 className="w-4 h-4 text-zinc-400" />}
            label="Volume" value={latestCandle ? `${(klineData.reduce((s, k) => s + k.volume, 0) / 1000).toFixed(1)}K` : '---'} subtext="3m candles" />
          {/* RSI Cards */}
          <StatCard
            label="RSI(1)"
            value={latestRSI ? latestRSI.rsi.toFixed(1) : '---'}
            subtext={latestRSI ? (latestRSI.rsi >= 70 ? 'Overbought' : latestRSI.rsi <= 30 ? 'Oversold' : 'Neutral') : ''}
            subtextClass={latestRSI ? (latestRSI.rsi >= 70 ? 'text-red-400' : latestRSI.rsi <= 30 ? 'text-emerald-400' : 'text-zinc-500') : ''}
            icon={<Activity className={`w-4 h-4 ${latestRSI ? (latestRSI.rsi >= 70 ? 'text-red-400' : latestRSI.rsi <= 30 ? 'text-emerald-400' : 'text-purple-400') : 'text-zinc-400'}`} />}
          />
          <StatCard
            label="SMA(14)"
            value={latestRSI ? latestRSI.sma.toFixed(1) : '---'}
            subtext={latestRSI ? (latestRSI.sma >= 70 ? 'Above 70' : latestRSI.sma <= 30 ? 'Below 30' : 'Between 30-70') : ''}
            subtextClass={latestRSI ? (latestRSI.sma >= 70 ? 'text-red-400' : latestRSI.sma <= 30 ? 'text-emerald-400' : 'text-yellow-400') : ''}
            icon={<TrendingUp className={`w-4 h-4 ${latestRSI ? (latestRSI.sma >= 70 ? 'text-red-400' : latestRSI.sma <= 30 ? 'text-emerald-400' : 'text-yellow-400') : 'text-zinc-400'}`} />}
          />
          {/* Bot Status Cards */}
          <BotCard icon={botStatus?.active ? <Radio className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-red-400" />}
            label="Bot Engine" value={botStatus?.active ? 'AUTO-RUNNING' : botStatus ? 'OFFLINE' : '---'}
            subtext={botStatus?.engine?.lastCheckAt ? `Last: ${Math.round((Date.now() - new Date(botStatus.engine.lastCheckAt).getTime()) / 1000)}s ago (${botStatus.engine.checkCount}x)` : 'Waiting to start'}
            subtextClass={botStatus?.active ? 'text-emerald-400' : 'text-red-400'} />
          <BotCard icon={<Bot className={`w-4 h-4 ${botStatus?.position === 'LONG' ? 'text-emerald-400' : botStatus?.position === 'SHORT' ? 'text-red-400' : 'text-zinc-400'}`} />}
            label="Position" value={botStatus?.position || 'NEUTRAL'}
            subtext={`RSI: ${botStatus?.currentRSI?.toFixed(1) ?? '---'} | SMA: ${botStatus?.currentSMA?.toFixed(1) ?? '---'}`}
            subtextClass={botStatus?.position === 'LONG' ? 'text-emerald-400' : 'text-zinc-500'} />
        </div>

        {/* Recent Signals Banner — shows latest signals (client-side or DB fallback) */}
        {displaySignals.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {displaySignals.map((sig, i) => (
              <div key={sig.source === 'db' ? `db-${sig.id}` : `client-${i}`} className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
                sig.type === 'BUY'
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-red-500/5 border-red-500/20'
              }`}>
                {sig.type === 'BUY'
                  ? <ArrowUpCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                  : <ArrowDownCircle className="w-5 h-5 text-red-400 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono font-bold text-sm ${sig.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {sig.type}
                    </span>
                    <span className="font-mono font-bold text-sm text-white">
                      ${sig.price.toFixed(2)}
                    </span>
                    <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-500">
                      RSI {sig.rsi.toFixed(1)} | SMA {sig.rsiSma.toFixed(1)}
                    </Badge>
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                    {sig.source === 'db'
                      ? new Date(sig.createdAt).toLocaleString()
                      : new Date(sig.candleTime * 1000).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main Chart */}
        <Card className="border-zinc-800/60 bg-[#0d1117] overflow-hidden shadow-2xl shadow-black/40 mb-4">
          <CardContent className="p-0">
            <div className="h-[380px] sm:h-[480px] lg:h-[560px]">
              {loading ? (
                <div className="flex items-center justify-center h-full bg-[#0a0e17]">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-2 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin" />
                    <span className="text-zinc-400 text-sm">Fetching XAU/USDT market data...</span>
                  </div>
                </div>
              ) : error ? (
                <div className="flex items-center justify-center h-full bg-[#0a0e17]">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                      <Activity className="w-5 h-5 text-red-400" />
                    </div>
                    <span className="text-zinc-400 text-sm">{error}</span>
                  </div>
                </div>
              ) : (
                <GoldChart data={klineData} lastFetchTime={lastFetch} />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bot Dashboard: Signals + Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {/* Signal Log */}
          <Card className="lg:col-span-2 border-zinc-800/60 bg-[#0d1117] overflow-hidden">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b border-zinc-800/40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-semibold">Signal Log</span>
                  <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                    {botStats ? `${botStats.totalSignals} signals` : '...'}
                  </Badge>
                </div>
                {botStats && botStats.totalSignals > 0 && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-zinc-500">
                      Win Rate: <span className={botStats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>{botStats.winRate}%</span>
                    </span>
                    <span className="text-zinc-500">
                      P&L: <span className={botStats.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}>${botStats.totalPnL.toFixed(2)}</span>
                    </span>
                  </div>
                )}
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {signals.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-zinc-600 text-sm">
                    <Bot className="w-4 h-4 mr-2" /> No signals recorded yet — bot engine checks every 3 minutes
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[#0d1117] z-10">
                      <tr className="text-left text-[11px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800/40">
                        <th className="px-4 py-2">Type</th>
                        <th className="px-4 py-2">Price</th>
                        <th className="px-4 py-2">RSI</th>
                        <th className="px-4 py-2">SMA</th>
                        <th className="px-4 py-2">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {signals.map((sig) => (
                        <tr key={sig.id} className="border-b border-zinc-800/20 hover:bg-zinc-800/20 transition-colors">
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5">
                              {sig.type === 'BUY'
                                ? <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-400" />
                                : <ArrowDownCircle className="w-3.5 h-3.5 text-red-400" />}
                              <span className={`font-mono font-bold text-xs ${sig.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                                {sig.type}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2 font-mono text-xs tabular-nums text-zinc-300">${sig.price.toFixed(2)}</td>
                          <td className="px-4 py-2 font-mono text-xs tabular-nums text-zinc-400">{sig.rsi.toFixed(1)}</td>
                          <td className="px-4 py-2 font-mono text-xs tabular-nums text-yellow-400">{sig.rsiSma.toFixed(1)}</td>
                          <td className="px-4 py-2 font-mono text-xs tabular-nums text-zinc-500">
                            {new Date(sig.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Broker: Balance & Positions */}
          <Card className="border-zinc-800/60 bg-[#0d1117] overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-semibold">Mudrex Account</span>
                {brokerError && (
                  <span className="text-[10px] text-red-400 ml-auto">{brokerError}</span>
                )}
              </div>

              {/* Balance */}
              {brokerFunds && (
                <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/40 mb-3">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Futures Wallet</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] text-zinc-500">Available Balance</div>
                      <div className="text-lg font-mono font-bold text-emerald-400 tabular-nums">${parseFloat(brokerFunds.balance).toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-500">Locked Amount</div>
                      <div className="text-lg font-mono font-bold text-orange-400 tabular-nums">${parseFloat(brokerFunds.locked_amount).toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-zinc-800/30">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-500">Total</span>
                      <span className="font-mono text-zinc-300 tabular-nums">${(parseFloat(brokerFunds.balance) + parseFloat(brokerFunds.locked_amount)).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}
              {!brokerFunds && !brokerError && (
                <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/40 mb-3 text-center text-zinc-600 text-xs">
                  <RefreshCw className="w-3 h-3 animate-spin inline mr-1" /> Loading balance...
                </div>
              )}

              {/* Open Positions */}
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">
                Open Positions ({brokerPositions.length})
              </div>
              {brokerPositions.length === 0 ? (
                <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/30 text-center">
                  <div className="text-zinc-600 text-xs">No open positions</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {brokerPositions.map((pos) => (
                    <div key={pos.id} className={`p-3 rounded-lg border ${
                      pos.order_type === 'LONG'
                        ? 'bg-emerald-500/5 border-emerald-500/20'
                        : 'bg-red-500/5 border-red-500/20'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {pos.order_type === 'LONG'
                            ? <ArrowUpCircle className="w-4 h-4 text-emerald-400" />
                            : <ArrowDownCircle className="w-4 h-4 text-red-400" />}
                          <span className={`font-mono font-bold text-sm ${
                            pos.order_type === 'LONG' ? 'text-emerald-400' : 'text-red-400'
                          }`}>{pos.order_type}</span>
                          <span className="font-mono text-sm text-white font-semibold">{pos.symbol}</span>
                        </div>
                        <Badge variant="outline" className={`text-[9px] ${
                          pos.status === 'OPEN' ? 'border-emerald-500/30 text-emerald-400' : 'border-zinc-700 text-zinc-500'
                        }`}>
                          {pos.status}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Entry</span>
                          <span className="font-mono text-zinc-300 tabular-nums">${parseFloat(pos.entry_price).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Qty</span>
                          <span className="font-mono text-zinc-300 tabular-nums">{pos.quantity}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Leverage</span>
                          <span className="font-mono text-yellow-400 tabular-nums">{pos.leverage}x</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Liq. Price</span>
                          <span className="font-mono text-red-400 tabular-nums">${parseFloat(pos.liquidation_price).toFixed(2)}</span>
                        </div>
                        {pos.stoploss && (
                          <div className="flex justify-between">
                            <span className="text-zinc-500">SL</span>
                            <span className="font-mono text-red-400 tabular-nums">${parseFloat(pos.stoploss.price).toFixed(2)}</span>
                          </div>
                        )}
                        {pos.takeprofit && (
                          <div className="flex justify-between">
                            <span className="text-zinc-500">TP</span>
                            <span className="font-mono text-emerald-400 tabular-nums">${parseFloat(pos.takeprofit.price).toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                      <div className="mt-2 pt-2 border-t border-zinc-800/20 flex items-center justify-between">
                        <span className="text-[10px] text-zinc-600 font-mono">
                          {new Date(pos.created_at).toLocaleString()}
                        </span>
                        <button
                          onClick={() => closePosition(pos)}
                          disabled={tradeLoading}
                          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 font-mono"
                        >
                          <X className="w-3 h-3" /> Close
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Trade Log — Newest 2 Trades */}
          <Card className="border-zinc-800/60 bg-[#0d1117] overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-semibold">Recent Trades</span>
                <Badge variant="outline" className="text-[10px] border-yellow-500/30 text-yellow-400">
                  {recentTrades.length > 0 ? 'Live' : 'No trades yet'}
                </Badge>
              </div>
              {recentTrades.length === 0 ? (
                <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800/30 text-center">
                  <div className="text-zinc-600 text-xs">No trades executed yet. Enable auto-trade or place a manual order.</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentTrades.map((trade) => (
                    <div key={trade.id} className={`p-3 rounded-lg border ${
                      trade.status === 'FILLED'
                        ? trade.orderType === 'LONG'
                          ? 'bg-emerald-500/5 border-emerald-500/20'
                          : 'bg-red-500/5 border-red-500/20'
                        : 'bg-orange-500/5 border-orange-500/20'
                    }`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          {trade.orderType === 'LONG'
                            ? <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-400" />
                            : <ArrowDownCircle className="w-3.5 h-3.5 text-red-400" />}
                          <span className={`font-mono font-bold text-xs ${trade.orderType === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {trade.orderType}
                          </span>
                          <span className="font-mono text-xs text-white font-semibold">${trade.price.toFixed(2)}</span>
                          <Badge variant="outline" className={`text-[8px] ${
                            trade.source === 'AUTO'
                              ? 'border-purple-500/30 text-purple-400'
                              : 'border-zinc-700 text-zinc-400'
                          }`}>
                            {trade.source}
                          </Badge>
                        </div>
                        <div className={`text-[9px] font-mono font-bold ${
                          trade.status === 'FILLED' ? 'text-emerald-400' : 'text-orange-400'
                        }`}>
                          {trade.status}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Qty</span>
                          <span className="font-mono text-zinc-300">{trade.quantity} @ {trade.leverage}x</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">SL</span>
                          <span className="font-mono text-red-400">
                            {trade.slPrice ? `$${trade.slPrice.toFixed(2)}` : 'none'}
                            {trade.slPercent ? ` (${trade.slPercent}%)` : ''}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">TP</span>
                          <span className="font-mono text-emerald-400">
                            {trade.tpPrice ? `$${trade.tpPrice.toFixed(2)}` : 'none'}
                            {trade.tpPercent ? ` (${trade.tpPercent}%)` : ''}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Time</span>
                          <span className="font-mono text-zinc-500">{new Date(trade.createdAt).toLocaleTimeString()}</span>
                        </div>
                      </div>
                      {trade.orderId && (
                        <div className="mt-1 pt-1 border-t border-zinc-800/20 text-[8px] text-zinc-600 font-mono">
                          ID: {trade.orderId.slice(0, 16)}...
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Manual Trade Panel */}
          <Card className="border-zinc-800/60 bg-[#0d1117] overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-semibold">Manual Trade</span>
                </div>
                {tradeMsg && (
                  <div className="flex items-center gap-1">
                    <span className={`text-[10px] font-mono ${tradeMsg.includes('✅') ? 'text-emerald-400' : tradeMsg.includes('failed') || tradeMsg.includes('Error') ? 'text-red-400' : 'text-zinc-400'}`}>
                      {tradeMsg}
                    </span>
                    <button onClick={() => setTradeMsg(null)} className="text-zinc-600 hover:text-zinc-400"><X className="w-3 h-3" /></button>
                  </div>
                )}
              </div>

              {/* Auto-Trade Toggle */}
              <div className={`flex items-center justify-between p-2.5 rounded-lg border mb-3 transition-all duration-300 ${autoTrade ? 'bg-emerald-500/15 border-emerald-500/40 shadow-lg shadow-emerald-500/10' : 'bg-zinc-900/60 border-zinc-800/40'}`}>
                <div className="flex items-center gap-2">
                  {autoTrade
                    ? <div className="relative"><Power className="w-3.5 h-3.5 text-emerald-400" /><div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full animate-ping" /><div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full" /></div>
                    : <PowerOff className="w-3.5 h-3.5 text-zinc-500" />}
                  <div>
                    <div className={`text-xs font-semibold ${autoTrade ? 'text-emerald-400' : 'text-zinc-400'}`}>
                      Auto-Trade {autoTrade ? 'ACTIVE' : 'OFF'}
                    </div>
                    <div className={`text-[9px] ${autoTrade ? 'text-emerald-400/60' : 'text-zinc-600'}`}>
                      {autoTrade ? 'Bot placing orders on signals (SL 0.05% / TP 0.15%)' : 'Tap toggle to enable'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => toggleAutoTrade(!autoTrade)}
                  disabled={tradeLoading}
                  className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${autoTrade ? 'bg-emerald-500 shadow-lg shadow-emerald-500/30' : 'bg-zinc-700'} ${tradeLoading ? 'opacity-50' : ''}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${autoTrade ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {/* Trade Config */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="text-[9px] text-zinc-500 uppercase">Quantity</label>
                  <input type="number" value={tradeQty} onChange={(e) => setTradeQty(e.target.value)} step="0.001" min="0.001"
                    className="w-full mt-0.5 px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-200 focus:outline-none focus:border-purple-500/50" />
                </div>
                <div>
                  <label className="text-[9px] text-zinc-500 uppercase">Leverage</label>
                  <input type="number" value={tradeLeverage} onChange={(e) => setTradeLeverage(e.target.value)} step="1" min="1" max="200"
                    className="w-full mt-0.5 px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-200 focus:outline-none focus:border-purple-500/50" />
                </div>
              </div>

              {/* SL/TP for manual trade */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="text-[9px] text-zinc-500 uppercase">Stop Loss ($ or %)</label>
                  <input type="number" value={tradeSL} onChange={(e) => setTradeSL(e.target.value)} step="0.01" placeholder="0.05 for 0.05%"
                    className="w-full mt-0.5 px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-red-500/50" />
                  <div className="text-[8px] text-zinc-600 mt-0.5">&lt;1 = %, else $</div>
                </div>
                <div>
                  <label className="text-[9px] text-zinc-500 uppercase">Take Profit ($ or %)</label>
                  <input type="number" value={tradeTP} onChange={(e) => setTradeTP(e.target.value)} step="0.01" placeholder="0.15 for 0.15%"
                    className="w-full mt-0.5 px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-emerald-500/50" />
                  <div className="text-[8px] text-zinc-600 mt-0.5">&lt;1 = %, else $</div>
                </div>
              </div>

              {/* Auto-trade SL/TP % config */}
              {autoTrade && (
                <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 mb-3">
                  <div className="text-[9px] text-emerald-400 uppercase tracking-wider font-semibold mb-1.5">Auto-Trade SL/TP %</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-zinc-500">SL %</label>
                      <input type="number" value={autoSLPct} onChange={(e) => setAutoSLPct(e.target.value)} step="0.1" min="0.1"
                        className="w-full mt-0.5 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-red-400 focus:outline-none focus:border-red-500/50" />
                    </div>
                    <div>
                      <label className="text-[9px] text-zinc-500">TP %</label>
                      <input type="number" value={autoTPPct} onChange={(e) => setAutoTPPct(e.target.value)} step="0.1" min="0.1"
                        className="w-full mt-0.5 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500/50" />
                    </div>
                  </div>
                </div>
              )}

              {/* Buy/Sell Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => placeOrder('LONG')}
                  disabled={tradeLoading}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-mono font-bold text-sm hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                >
                  <ArrowUpCircle className="w-4 h-4" /> LONG
                </button>
                <button
                  onClick={() => placeOrder('SHORT')}
                  disabled={tradeLoading}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 font-mono font-bold text-sm hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  <ArrowDownCircle className="w-4 h-4" /> SHORT
                </button>
              </div>

              {/* Test Signal Button */}
              <button
                onClick={generateTestSignal}
                disabled={testSignalLoading}
                className="w-full mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 font-mono font-bold text-xs hover:bg-purple-500/20 transition-colors disabled:opacity-50"
              >
                {testSignalLoading ? <div className="w-3 h-3 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                {testSignalLoading ? 'Generating...' : 'TEST SIGNAL'}
              </button>

              {tradeLoading && (
                <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-zinc-500">
                  <div className="w-3 h-3 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                  Processing order...
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bot Setup Guide */}
          <Card className="border-zinc-800/60 bg-[#0d1117] overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold">24/7 Bot Setup</span>
              </div>

              <div className="space-y-3 text-xs">
                <SetupStep number={1} title="Deploy on Render" done description="Already deployed at your Render URL" />
                <SetupStep number={2} title="Set UptimeRobot" done={false} description={
                  <>
                    Go to <span className="text-yellow-400">uptimerobot.com</span> and create a new monitor:
                    <div className="mt-2 p-2 rounded bg-zinc-900/60 border border-zinc-800/60 font-mono text-[10px] text-zinc-400 break-all">
                      https://your-app.onrender.com/api/bot/check
                    </div>
                    <div className="mt-1.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500">Monitor Type:</span>
                        <span className="text-zinc-300">HTTP(s)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500">Interval:</span>
                        <span className="text-yellow-400">5 minutes (free tier min)</span>
                      </div>
                    </div>
                  </>
                } />
                <SetupStep number={3} title="Bot Runs Autonomously" done={false} description={
                  <>
                    The bot engine runs <span className="text-yellow-400">automatically every 3 minutes</span> — aligned with candle closes.
                    UptimeRobot just keeps the Render server awake (prevents cold sleep).
                    The bot works independently of the ping interval.
                  </>
                } />
              </div>

              {/* Strategy Info */}
              <div className="mt-4 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
                <div className="text-[10px] text-purple-400 uppercase tracking-wider font-semibold mb-2">Strategy Details</div>
                <div className="space-y-1.5 text-xs text-zinc-400">
                  <div className="flex justify-between">
                    <span>RSI Length</span><span className="font-mono text-zinc-300">1</span>
                  </div>
                  <div className="flex justify-between">
                    <span>SMA Length</span><span className="font-mono text-zinc-300">14</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Buy Signal</span><span className="font-mono text-emerald-400">SMA cross above 30</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sell Signal</span><span className="font-mono text-red-400">SMA cross below 70</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Timeframe</span><span className="font-mono text-zinc-300">3 Minutes</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bottom Info */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600 px-1">
          <span>RSI(1) + SMA(14) Strategy | Binance Futures | 3-minute candles</span>
          <span>Bot endpoint: /api/bot/check (ping every 5min with UptimeRobot to keep alive)</span>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, subtext, subtextClass = 'text-zinc-500' }: {
  icon: React.ReactNode; label: string; value: string; subtext?: string; subtextClass?: string;
}) {
  return (
    <Card className="border-zinc-800/60 bg-[#0d1117] hover:border-zinc-700/60 transition-colors">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
        </div>
        <div className="text-lg sm:text-xl font-mono font-bold text-white tabular-nums">{value}</div>
        {subtext && <span className={`text-[11px] ${subtextClass}`}>{subtext}</span>}
      </CardContent>
    </Card>
  );
}

function BotCard({ icon, label, value, subtext, subtextClass = 'text-zinc-500' }: {
  icon: React.ReactNode; label: string; value: string; subtext?: string; subtextClass?: string;
}) {
  return (
    <Card className="border-zinc-800/60 bg-[#0d1117] hover:border-zinc-700/60 transition-colors">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
        </div>
        <div className="text-lg sm:text-xl font-mono font-bold text-white tabular-nums">{value}</div>
        {subtext && <span className={`text-[11px] ${subtextClass}`}>{subtext}</span>}
      </CardContent>
    </Card>
  );
}

function SetupStep({ number, title, description, done }: {
  number: number; title: string; description: React.ReactNode; done: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5 ${
        done ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
      }`}>
        {done ? '✓' : number}
      </div>
      <div>
        <div className="font-semibold text-zinc-300">{title}</div>
        <div className="text-zinc-500 mt-0.5">{description}</div>
      </div>
    </div>
  );
}
