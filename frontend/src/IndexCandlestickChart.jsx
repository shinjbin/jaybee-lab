import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, LineSeries, ColorType, createChart } from "lightweight-charts";

import { normalizeCandles, weeklyCandles, movingAverage, weeklyLine, rangeStart, weekStart } from "./indexChartData.mjs";
export { normalizeCandles } from "./indexChartData.mjs";

const indicators = [
  { id: "ma5", label: "5일 이동평균", period: 5, color: "#d97706" },
  { id: "ma20", label: "20일 이동평균", period: 20, color: "#8b5cf6" },
  { id: "ma60", label: "60일 이동평균", period: 60, color: "#10b981" },
  { id: "bb", label: "볼린저밴드", period: 20, color: "#0891b2" },
];

function loadPreferences(name) {
  try {
    const saved = JSON.parse(localStorage.getItem(`index-chart:${name}`));
    return { interval: saved?.interval === "week" ? "week" : "day",
      months: [1, 3, 6, 12].includes(saved?.months) ? saved.months : 12,
      enabled: Array.isArray(saved?.enabled) ? saved.enabled.filter((id) => indicators.some((item) => item.id === id)) : [] };
  } catch { return { interval: "day", months: 12, enabled: [] }; }
}

const price = (value) => value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

export default function IndexCandlestickChart({ history, name }) {
  const containerRef = useRef(null);
  const [preferences, setPreferences] = useState(() => loadPreferences(name));
  const { interval, months, enabled } = preferences;
  const daily = useMemo(() => normalizeCandles(history), [history]);
  const start = rangeStart(daily, months);
  const cutoff = interval === "week" && start ? weekStart(start) : start;
  const candles = useMemo(() => (interval === "week" ? weeklyCandles(daily) : daily)
    .filter((row) => row.time >= cutoff), [daily, interval, cutoff]);
  useEffect(() => {
    try { localStorage.setItem(`index-chart:${name}`, JSON.stringify(preferences)); } catch { /* Storage may be unavailable. */ }
  }, [name, preferences]);
  const toggle = (id) => setPreferences((current) => ({ ...current,
    enabled: current.enabled.includes(id) ? current.enabled.filter((value) => value !== id) : [...current.enabled, id] }));
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
    for (const indicator of indicators.filter((item) => enabled.includes(item.id))) {
      for (const deviation of indicator.id === "bb" ? [-2, 0, 2] : [0]) {
        const points = movingAverage(daily, indicator.period, deviation);
        const line = chart.addSeries(LineSeries, { color: indicator.color, lineWidth: 1,
          lineStyle: indicator.id === "bb" ? 2 : 0, priceLineVisible: false,
          lastValueVisible: false, crosshairMarkerVisible: false });
        line.setData((interval === "week" ? weeklyLine(points) : points).filter((point) => point.time >= cutoff));
      }
    }
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
  }, [candles, daily, interval, cutoff, enabled]);

  return (
    <div className="indexCandleWrap">
      <div className="indexCandleHeader"><div className="indexChartControls" role="group" aria-label={`${name} 봉 주기`}>
        {[['day', '일봉'], ['week', '주봉']].map(([value, label]) => <button key={value} type="button" aria-pressed={interval === value}
          onClick={() => setPreferences((current) => ({ ...current, interval: value }))}>{label}</button>)}
        </div><span className="indexCandleLegend"><i />상승 <i />하락</span></div>
      <div className="indexChartControls indexChartPeriods" role="group" aria-label={`${name} 조회 기간`}>
        {[1, 3, 6, 12].map((value) => <button key={value} type="button" aria-pressed={months === value}
          onClick={() => setPreferences((current) => ({ ...current, months: value }))}>{value === 12 ? "1년" : `${value}개월`}</button>)}
      </div>
      <fieldset className="indexChartIndicators"><legend>보조지표</legend>
        {indicators.map((item) => <label key={item.id} style={{ "--indicator-color": item.color }}>
          <input type="checkbox" checked={enabled.includes(item.id)} onChange={() => toggle(item.id)} />
          <span>{item.label}</span>
        </label>)}
      </fieldset>
      {enabled.length ? <p className="indexCandleHint">일봉 종가 기준 · 볼린저밴드 20일 평균 ±2σ{daily.length < 60 ? " · 데이터가 부족한 지표는 충분한 일봉부터 표시됩니다" : ""}</p> : null}
      {active ? <div className="indexCandleQuote">
        <time>{active.time}</time>
        <span>시가 <b>{price(active.open)}</b></span><span>고가 <b>{price(active.high)}</b></span>
        <span>저가 <b>{price(active.low)}</b></span><span>종가 <b>{price(active.close)}</b></span>
      </div> : null}
      {candles.length ? <div ref={containerRef} className="indexCandleChart" role="img" aria-label={`${name} ${interval === "week" ? "주봉" : "일봉"} 캔들 차트. 상승 빨강, 하락 파랑. 날짜별 시가, 고가, 저가, 종가는 차트 위에 표시됩니다.`} /> :
        <div className="emptySparkline">캔들 데이터가 없습니다</div>}
      {candles.length ? <p className="indexCandleHint">{candles[0].time} ~ {daily.at(-1).time} · 제공된 데이터 기준{interval === "week" ? " · 주봉은 월요일 시작, 이번 주는 진행 중일 수 있습니다" : ""}<br />드래그하여 이동 · 스크롤하거나 두 손가락으로 확대</p> : null}
      <a className="indexChartAttribution" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.</a>
    </div>
  );
}
