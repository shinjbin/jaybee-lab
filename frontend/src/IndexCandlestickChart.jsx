import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart } from "lightweight-charts";

export function normalizeCandles(history = []) {
  const days = new Map();
  for (const row of history) {
    const values = [row.open, row.high, row.low, row.close];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        values.some((value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)))) continue;
    const [open, high, low, close] = values.map(Number);
    if (low > Math.min(open, close) || high < Math.max(open, close) || low > high) continue;
    days.set(row.date, { time: row.date, open, high, low, close });
  }
  return [...days.values()].sort((a, b) => a.time.localeCompare(b.time));
}

const price = (value) => value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

export default function IndexCandlestickChart({ history, name }) {
  const containerRef = useRef(null);
  const candles = useMemo(() => normalizeCandles(history), [history]);
  const [selected, setSelected] = useState(null);
  const active = selected || candles.at(-1);

  useEffect(() => {
    setSelected(null);
    if (!candles.length || !containerRef.current) return;
    const element = containerRef.current;
    const chart = createChart(element, {
      autoSize: true,
      height: 240,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, fontFamily: "inherit", fontSize: 11, attributionLogo: true },
      localization: { locale: "ko-KR", priceFormatter: price },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderVisible: false, rightOffset: 2, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: { vertTouchDrag: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#ef5350", downColor: "#3b82f6", borderVisible: false,
      wickUpColor: "#ef5350", wickDownColor: "#3b82f6", priceLineVisible: false,
    });
    series.setData(candles);
    chart.timeScale().fitContent();
    const updateTheme = () => {
      const styles = getComputedStyle(element);
      chart.applyOptions({
        layout: { textColor: styles.getPropertyValue("--muted").trim() || "#6b7684" },
        grid: { vertLines: { visible: false }, horzLines: { color: styles.getPropertyValue("--line").trim() || "#e5e8eb", style: 1 } },
      });
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const select = (event) => setSelected(event.seriesData.get(series) || null);
    chart.subscribeCrosshairMove(select);
    chart.subscribeClick(select);
    return () => { observer.disconnect(); chart.remove(); };
  }, [candles]);

  return (
    <div className="indexCandleWrap">
      <div className="indexCandleHeader"><span>일봉</span><span className="indexCandleLegend"><i />상승 <i />하락</span></div>
      {active ? <div className="indexCandleQuote">
        <time>{active.time}</time>
        <span>시가 <b>{price(active.open)}</b></span><span>고가 <b>{price(active.high)}</b></span>
        <span>저가 <b>{price(active.low)}</b></span><span>종가 <b>{price(active.close)}</b></span>
      </div> : null}
      {candles.length ? <div ref={containerRef} className="indexCandleChart" role="img" aria-label={`${name} 일봉 캔들 차트. 상승 빨강, 하락 파랑. 날짜별 시가, 고가, 저가, 종가는 차트 위에 표시됩니다.`} /> :
        <div className="emptySparkline">캔들 데이터가 없습니다</div>}
      {candles.length ? <p className="indexCandleHint">드래그하여 이동 · 스크롤하거나 두 손가락으로 확대</p> : null}
      <a className="indexChartAttribution" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.</a>
    </div>
  );
}
