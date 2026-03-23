import { useEffect, useMemo, useRef, useState } from "react";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const MOBILE_BREAKPOINT = 820;

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateLabel(value) {
  if (!value) {
    return "날짜 없음";
  }

  const date = new Date(`${value}T00:00:00+09:00`);

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

function formatShortDateLabel(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(`${value}T00:00:00+09:00`);

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric"
  }).format(date);
}

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);

  return `${year}년 ${month}월`;
}

function formatAmount(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const normalized = String(value).replace(/,/g, "").trim();

  if (/^[-+]?\d+$/.test(normalized)) {
    const amount = BigInt(normalized);
    const sign = amount < 0n ? "-" : "";
    const absolute = amount < 0n ? -amount : amount;

    if (absolute >= 100000000n) {
      const scaled = (absolute * 10n + 5000000n) / 100000000n;
      const whole = scaled / 10n;
      const decimal = scaled % 10n;
      return `${sign}${whole.toString()}.${decimal.toString()}억원`;
    }

    if (absolute >= 10000n) {
      const inManwon = (absolute + 5000n) / 10000n;
      return `${sign}${inManwon.toString()}만원`;
    }

    return `${sign}${absolute.toLocaleString("ko-KR")}원`;
  }

  const amount = Number(normalized);

  if (!Number.isFinite(amount)) {
    return String(value);
  }

  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);

  if (absolute >= 100000000) {
    return `${sign}${(absolute / 100000000).toFixed(1)}억원`;
  }

  if (absolute >= 10000) {
    return `${sign}${(absolute / 10000).toFixed(0)}만원`;
  }

  return `${sign}${new Intl.NumberFormat("ko-KR").format(absolute)}원`;
}
function formatIndexNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(Number(value));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}


function getChangeTone(value) {
  if (Number(value) > 0) {
    return "positive";
  }

  if (Number(value) < 0) {
    return "negative";
  }

  return "neutral";
}


function getMonthKey(dateString) {
  if (!dateString) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  return dateString.slice(0, 7);
}

function shiftMonth(monthKey, delta) {
  const [year, month] = monthKey.split("-").map(Number);
  const nextDate = new Date(year, month - 1 + delta, 1);

  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
}

function buildCalendar(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [];

  for (let index = 0; index < startWeekday; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({
      date,
      day,
      monthKey
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function getSentimentLabel(sentiment) {
  if (sentiment === "positive") {
    return "positive";
  }

  if (sentiment === "negative") {
    return "negative";
  }

  return "neutral";
}

function getEnglishSummary(article) {
  return article.description || article.content || article.title;
}

function getEnglishBody(article) {
  return article.content || article.description || article.title;
}

function buildSparklineGeometry(history, width = 260, height = 140) {
  if (!history?.length) {
    return null;
  }

  const padding = {
    top: 10,
    right: 10,
    bottom: 28,
    left: 42
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = history.map((point) => Number(point.close)).filter((value) => Number.isFinite(value));

  if (!values.length) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = history.map((point, index) => {
    const value = Number(point.close);
    const x = padding.left + (index / Math.max(history.length - 1, 1)) * plotWidth;
    const y = padding.top + plotHeight - ((value - min) / range) * plotHeight;

    return {
      ...point,
      value,
      x,
      y
    };
  });

  return {
    width,
    height,
    padding,
    min,
    max,
    points,
    polyline: points.map((point) => `${point.x},${point.y}`).join(" ")
  };
}

function findClosestPointIndex(points, chartWidth, clientX, bounds) {
  if (!points.length || !bounds.width) {
    return -1;
  }

  const scaledX = ((clientX - bounds.left) / bounds.width) * chartWidth;
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  points.forEach((point, index) => {
    const distance = Math.abs(point.x - scaledX);

    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  });

  return closestIndex;
}

function HealthPill({ health }) {
  return (
    <strong className={`badge badge-${health}`}>
      {health === "checking" ? "checking" : health}
    </strong>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      className={`tabButton ${active ? "tabButton-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function CalendarPicker({ label, value, onChange }) {
  const [visibleMonth, setVisibleMonth] = useState(getMonthKey(value));

  useEffect(() => {
    if (value) {
      setVisibleMonth(getMonthKey(value));
    }
  }, [value]);

  const cells = useMemo(() => buildCalendar(visibleMonth), [visibleMonth]);

  return (
    <section className="calendarCard">
      <div className="calendarHeader">
        <div>
          <span className="calendarLabel">{label}</span>
          <strong>{formatDateLabel(value)}</strong>
        </div>
        <div className="calendarControls">
          <button type="button" onClick={() => setVisibleMonth(shiftMonth(visibleMonth, -1))}>
            이전
          </button>
          <span>{formatMonthLabel(visibleMonth)}</span>
          <button type="button" onClick={() => setVisibleMonth(shiftMonth(visibleMonth, 1))}>
            다음
          </button>
        </div>
      </div>
      <div className="calendarWeekdays">
        {WEEKDAY_LABELS.map((labelText) => (
          <span key={labelText}>{labelText}</span>
        ))}
      </div>
      <div className="calendarGrid">
        {cells.map((cell, index) =>
          cell ? (
            <button
              key={cell.date}
              type="button"
              className={`calendarDay ${value === cell.date ? "calendarDay-active" : ""}`}
              onClick={() => onChange({ target: { value: cell.date } })}
            >
              <span>{cell.day}</span>
            </button>
          ) : (
            <span className="calendarSpacer" key={`empty-${visibleMonth}-${index}`} />
          )
        )}
      </div>
    </section>
  );
}

function IndexCard({ item }) {
  const cardRef = useRef(null);
  const tone = getChangeTone(item.changesPercentage);
  const geometry = useMemo(() => buildSparklineGeometry(item.history || []), [item.history]);
  const [selectedPointIndex, setSelectedPointIndex] = useState(null);
  const selectedPoint =
    geometry && selectedPointIndex !== null && geometry.points[selectedPointIndex]
      ? geometry.points[selectedPointIndex]
      : null;

  useEffect(() => {
    setSelectedPointIndex(null);
  }, [geometry, item.symbol]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!cardRef.current?.contains(event.target)) {
        setSelectedPointIndex(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  function handleChartClick(event) {
    if (!geometry?.points?.length) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const nextIndex = findClosestPointIndex(
      geometry.points,
      geometry.width,
      event.clientX,
      bounds
    );

    if (nextIndex >= 0) {
      setSelectedPointIndex(nextIndex);
    }
  }

  const tooltipWidth = 112;
  const tooltipHeight = 36;
  const tooltipX = selectedPoint
    ? Math.min(
        Math.max(selectedPoint.x - tooltipWidth / 2, geometry.padding.left + 6),
        geometry.width - geometry.padding.right - tooltipWidth
      )
    : 0;
  const tooltipY = selectedPoint
    ? Math.max(selectedPoint.y - tooltipHeight - 10, geometry.padding.top + 4)
    : 0;

  return (
    <article className="indexCard" ref={cardRef}>
      <div className="indexCardHeader">
        <div>
          <p className="sectionEyebrow">{item.market}</p>
          <h3>{item.name}</h3>
        </div>
        <span className="indexSymbol">{item.symbol}</span>
      </div>
      <div className="indexValueRow">
        <strong>{formatIndexNumber(item.price)}</strong>
        <div className={`indexChange indexChange-${tone}`}>
          <span>{item.change > 0 ? "+" : ""}{formatIndexNumber(item.change)}</span>
          <span>{formatPercent(item.changesPercentage)}</span>
        </div>
      </div>
      <div className="sparklineWrap">
        {geometry ? (
          <svg
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            className="sparkline"
            preserveAspectRatio="none"
            onClick={handleChartClick}
            role="img"
            aria-label={`${item.name} 최근 추이 그래프`}
          >
            <line
              className="sparklineAxis"
              x1={geometry.padding.left}
              y1={geometry.padding.top}
              x2={geometry.padding.left}
              y2={geometry.height - geometry.padding.bottom}
            />
            <line
              className="sparklineAxis"
              x1={geometry.padding.left}
              y1={geometry.height - geometry.padding.bottom}
              x2={geometry.width - geometry.padding.right}
              y2={geometry.height - geometry.padding.bottom}
            />
            <line
              className="sparklineGrid"
              x1={geometry.padding.left}
              y1={geometry.padding.top}
              x2={geometry.width - geometry.padding.right}
              y2={geometry.padding.top}
            />
            <line
              className="sparklineGrid"
              x1={geometry.padding.left}
              y1={geometry.height - geometry.padding.bottom}
              x2={geometry.width - geometry.padding.right}
              y2={geometry.height - geometry.padding.bottom}
            />
            <text className="sparklineLabel sparklineLabel-y" x={geometry.padding.left - 6} y={geometry.padding.top + 4}>
              {formatIndexNumber(geometry.max)}
            </text>
            <text className="sparklineLabel sparklineLabel-y" x={geometry.padding.left - 6} y={geometry.height - geometry.padding.bottom}>
              {formatIndexNumber(geometry.min)}
            </text>
            <text className="sparklineLabel sparklineLabel-x" x={geometry.padding.left} y={geometry.height - 8}>
              {formatShortDateLabel(geometry.points[0]?.date)}
            </text>
            <text className="sparklineLabel sparklineLabel-x sparklineLabel-xEnd" x={geometry.width - geometry.padding.right} y={geometry.height - 8}>
              {formatShortDateLabel(geometry.points[geometry.points.length - 1]?.date)}
            </text>
            <polyline
              fill="none"
              stroke={tone === "negative" ? "#fca5a5" : tone === "positive" ? "#86efac" : "#93c5fd"}
              strokeWidth="3"
              points={geometry.polyline}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {selectedPoint ? (
              <>
                <line
                  className="sparklineCursor"
                  x1={selectedPoint.x}
                  y1={geometry.padding.top}
                  x2={selectedPoint.x}
                  y2={geometry.height - geometry.padding.bottom}
                />
                <circle
                  cx={selectedPoint.x}
                  cy={selectedPoint.y}
                  r="5"
                  className="sparklineDot"
                />
                <g className="sparklineTooltipGroup">
                  <rect
                    className="sparklineTooltipBox"
                    x={tooltipX}
                    y={tooltipY}
                    width={tooltipWidth}
                    height={tooltipHeight}
                    rx="10"
                    ry="10"
                  />
                  <text className="sparklineTooltipText" x={tooltipX + 10} y={tooltipY + 14}>
                    일자: {formatShortDateLabel(selectedPoint.date)}
                  </text>
                  <text className="sparklineTooltipText sparklineTooltipText-strong" x={tooltipX + 10} y={tooltipY + 28}>
                    지수: {formatIndexNumber(selectedPoint.value)}
                  </text>
                </g>
              </>
            ) : null}
          </svg>
        ) : (
          <div className="emptySparkline">그래프 데이터가 없습니다</div>
        )}
      </div>
      <p className="indexMeta">최근 {item.history?.length || 0}개 종가 기준 · {formatDateTime(item.updatedAt)}</p>
    </article>
  );
}

function IndicesPanel({ meta, indicesData, error }) {
  return (
    <>
      <section className="hero panelHero">
        <div className="heroCopy heroCopy-compact">
          <p className="eyebrow">Market Indices</p>
          <div className="compactMetaList">
            <p className="compactMetaItem">주요 지수 요약과 단기 흐름을 한 번에 확인합니다.</p>
            <p className="compactMetaItem">지수 수 {indicesData?.items?.length || 0} · 히스토리 {meta?.marketIndices?.historyDays || "-"}일</p>
            <p className="compactMetaItem">데이터 소스 {meta?.scheduler?.provider || "financial-modeling-prep"}</p>
            {indicesData?.generatedAt ? (
              <p className="compactMetaItem">마지막 갱신 {formatDateTime(indicesData.generatedAt)}</p>
            ) : null}
            {error ? <p className="compactMetaItem compactMetaItem-error">{error}</p> : null}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="sectionEyebrow">Snapshot</p>
            <h2>주요 지수 요약</h2>
          </div>
        </div>
        {indicesData?.items?.length ? (
          <div className="indicesGrid">
            {indicesData.items.map((item) => (
              <IndexCard item={item} key={item.symbol} />
            ))}
          </div>
        ) : (
          <div className="emptyState">주요 지수 데이터를 불러오지 못했습니다.</div>
        )}
      </section>
    </>
  );
}

function NewsListItem({ article, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`newsListButton ${selected ? "newsListButton-active" : ""}`}
      onClick={() => onSelect(article.id)}
    >
      <div className="newsListButtonMeta">
        <span>{article.sourceName}</span>
        <span>{formatDateTime(article.publishedAt)}</span>
      </div>
      <h3>{article.title}</h3>
      <div className="newsAnalysisRow">
        <span className={`impact impact-${article.marketImpact || "low"}`}>
          impact {article.marketImpact || "low"}
        </span>
        <span className={`sentiment sentiment-${article.sentiment || "neutral"}`}>
          {getSentimentLabel(article.sentiment)}
        </span>
      </div>
    </button>
  );
}

function NewsDetail({ article, isMobile, onBack }) {
  if (!article) {
    return <div className="emptyState">목록에서 뉴스를 선택하면 상세 내용을 볼 수 있습니다.</div>;
  }

  const englishSummary = getEnglishSummary(article);
  const englishBody = getEnglishBody(article);
  const translatedBody =
    article.translatedContent || article.summary || "AI 번역 내용이 아직 없습니다.";

  return (
    <article className={`newsDetailCard ${isMobile ? "newsDetailCard-mobile" : ""}`}>
      <div className="newsDetailHeader">
        <div className="newsDetailTitleBlock">
          {isMobile ? (
            <button type="button" className="detailBackButton" onClick={onBack}>
              목록으로
            </button>
          ) : null}
          <p className="sectionEyebrow">Selected News</p>
          <h2>{article.translatedTitle || article.title}</h2>
          <p className="newsDetailSubtitle">{article.title}</p>
        </div>
        <a href={article.url} target="_blank" rel="noreferrer">
          Open Source
        </a>
      </div>

      <div className="cardMeta">
        <span>{article.categoryLabel}</span>
        <span>{article.sourceName}</span>
        <span>{formatDateTime(article.publishedAt)}</span>
      </div>

      <div className="newsAnalysisRow">
        <span className={`impact impact-${article.marketImpact || "low"}`}>
          impact {article.marketImpact || "low"}
        </span>
        <span className={`sentiment sentiment-${article.sentiment || "neutral"}`}>
          {getSentimentLabel(article.sentiment)}
        </span>
      </div>

      <section className="newsOverviewCard newsOverviewCard-english">
        <span className="languageLabel">English Summary</span>
        <p>{englishSummary}</p>
      </section>

      <div className="detailLanguageStack">
        <section className="languageCard">
          <span className="languageLabel">English Full Text</span>
          <p>{englishBody}</p>
        </section>
        <section className="languageCard languageCard-korean">
          <span className="languageLabel">Korean Translation</span>
          <p>{translatedBody}</p>
        </section>
      </div>
    </article>
  );
}

function NewsPanel({
  meta,
  briefing,
  articles,
  selectedArticleId,
  onSelectArticle,
  newsDate,
  onNewsDateChange,
  error,
  isMobile,
  mobileDetailOpen,
  onOpenMobileDetail,
  onCloseMobileDetail
}) {
  const latestRun = briefing?.latestRun;
  const selectedArticle =
    articles.find((article) => article.id === selectedArticleId) || articles[0] || null;

  function handleSelectArticle(articleId) {
    onSelectArticle(articleId);

    if (isMobile) {
      onOpenMobileDetail();
    }
  }

  return (
    <>
      <section className="hero hero-grid hero-grid-compact">
        <div className="heroCopy heroCopy-compact">
          <p className="eyebrow">News Feed</p>
          <div className="compactMetaList">
            <p className="compactMetaItem">선택 날짜 {formatDateLabel(briefing?.effectiveDate)}</p>
            <p className="compactMetaItem">
              기사 수 {briefing?.totalArticles || articles.length || 0} · 수집 주기 {meta?.scheduler?.intervalMinutes || "-"}분
            </p>
            <p className="compactMetaItem">
              수집 소스 {meta?.scheduler?.provider || "-"} · {meta?.scheduler?.endpoint || "-"}
            </p>
            <p className="compactMetaItem">
              AI 분석 {meta?.ai?.enabled ? "enabled" : "fallback"} · impact, sentiment, 번역 포함
            </p>
            {latestRun ? (
              <p className="compactMetaItem">
                마지막 수집 {formatDateTime(latestRun.finishedAt || latestRun.startedAt)} · seen {latestRun.articlesSeen} · new {latestRun.articlesInserted} · analyzed {latestRun.articlesSummarized} · {latestRun.status}
              </p>
            ) : null}
            {error ? <p className="compactMetaItem compactMetaItem-error">{error}</p> : null}
          </div>
        </div>

        <CalendarPicker label="조회 날짜" value={newsDate} onChange={onNewsDateChange} />
      </section>

      <section className="panel latestPanel">
        <div className="panelHeader">
          <div>
            <p className="sectionEyebrow">Latest</p>
            <h2>News List</h2>
          </div>
        </div>

        {articles.length > 0 ? (
          <div className={`newsWorkspace ${isMobile ? "newsWorkspace-mobile" : ""}`}>
            {!(isMobile && mobileDetailOpen) ? (
              <div className="newsListRail">
                {articles.map((article) => (
                  <NewsListItem
                    key={article.id}
                    article={article}
                    selected={article.id === selectedArticle?.id}
                    onSelect={handleSelectArticle}
                  />
                ))}
              </div>
            ) : null}
            {isMobile ? (
              mobileDetailOpen ? (
                <NewsDetail
                  article={selectedArticle}
                  isMobile={isMobile}
                  onBack={onCloseMobileDetail}
                />
              ) : null
            ) : (
              <NewsDetail article={selectedArticle} isMobile={false} onBack={onCloseMobileDetail} />
            )}
          </div>
        ) : (
          <div className="emptyState">선택한 날짜의 뉴스가 없습니다.</div>
        )}
      </section>
    </>
  );
}

function buildInvestorTrendGeometry(history, width = 520, height = 220) {
  if (!history?.length) {
    return null;
  }

  const padding = {
    top: 16,
    right: 16,
    bottom: 28,
    left: 56
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const rows = history.map((item) => ({
    ...item,
    buyValue: Number(item.grossBuyAmount || 0),
    sellValue: -Number(item.grossSellAmount || 0),
    netValue: Number(item.netAmount || 0)
  }));
  const values = rows.flatMap((item) => [item.buyValue, item.sellValue, item.netValue, 0]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  function createPoints(valueKey) {
    return rows.map((item, index) => {
      const value = Number(item[valueKey] || 0);
      const x = padding.left + (index / Math.max(rows.length - 1, 1)) * plotWidth;
      const y = padding.top + plotHeight - ((value - min) / range) * plotHeight;

      return {
        date: item.date,
        value,
        x,
        y
      };
    });
  }

  const buyPoints = createPoints("buyValue");
  const sellPoints = createPoints("sellValue");
  const netPoints = createPoints("netValue");
  const zeroY = padding.top + plotHeight - ((0 - min) / range) * plotHeight;

  return {
    width,
    height,
    padding,
    min,
    max,
    zeroY,
    buyPoints,
    sellPoints,
    netPoints,
    buyPolyline: buyPoints.map((point) => `${point.x},${point.y}`).join(" "),
    sellPolyline: sellPoints.map((point) => `${point.x},${point.y}`).join(" "),
    netPolyline: netPoints.map((point) => `${point.x},${point.y}`).join(" ")
  };
}

function InvestorTrendCard({ title, summary, history }) {
  const geometry = useMemo(() => buildInvestorTrendGeometry(history || []), [history]);

  return (
    <article className="investorTrendCard">
      <div className="panelHeader investorTrendHeader">
        <div>
          <p className="sectionEyebrow">Trend</p>
          <h2>{title}</h2>
        </div>
        <div className="trendStatGrid">
          <div className="trendStat trendStat-buy">
            <span>Buy</span>
            <strong>{formatAmount(summary?.grossBuyAmount)}</strong>
          </div>
          <div className="trendStat trendStat-sell">
            <span>Sell</span>
            <strong>{formatAmount(summary?.grossSellAmount)}</strong>
          </div>
          <div className="trendStat trendStat-net">
            <span>Net</span>
            <strong>{formatAmount(summary?.netAmount)}</strong>
          </div>
        </div>
      </div>
      {geometry ? (
        <div className="sparklineWrap investorTrendWrap">
          <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} className="sparkline investorTrendChart" preserveAspectRatio="none" role="img" aria-label={`${title} flow trend`}>
            <line
              className="sparklineAxis"
              x1={geometry.padding.left}
              y1={geometry.padding.top}
              x2={geometry.padding.left}
              y2={geometry.height - geometry.padding.bottom}
            />
            <line
              className="sparklineAxis"
              x1={geometry.padding.left}
              y1={geometry.height - geometry.padding.bottom}
              x2={geometry.width - geometry.padding.right}
              y2={geometry.height - geometry.padding.bottom}
            />
            <line
              className="sparklineGrid"
              x1={geometry.padding.left}
              y1={geometry.zeroY}
              x2={geometry.width - geometry.padding.right}
              y2={geometry.zeroY}
            />
            <text className="sparklineLabel sparklineLabel-y" x={geometry.padding.left - 8} y={geometry.padding.top + 4}>
              {formatAmount(geometry.max)}
            </text>
            <text className="sparklineLabel sparklineLabel-y" x={geometry.padding.left - 8} y={geometry.zeroY}>
              0
            </text>
            <text className="sparklineLabel sparklineLabel-y" x={geometry.padding.left - 8} y={geometry.height - geometry.padding.bottom}>
              {formatAmount(Math.abs(geometry.min))}
            </text>
            <text className="sparklineLabel sparklineLabel-x" x={geometry.padding.left} y={geometry.height - 8}>
              {formatShortDateLabel(geometry.buyPoints[0]?.date)}
            </text>
            <text className="sparklineLabel sparklineLabel-x sparklineLabel-xEnd" x={geometry.width - geometry.padding.right} y={geometry.height - 8}>
              {formatShortDateLabel(geometry.buyPoints[geometry.buyPoints.length - 1]?.date)}
            </text>
            <polyline className="trendFillLine" points={geometry.netPolyline} />
            <polyline className="trendLine trendLine-buy" points={geometry.buyPolyline} />
            <polyline className="trendLine trendLine-sell" points={geometry.sellPolyline} />
            <polyline className="trendLine trendLine-net" points={geometry.netPolyline} />
          </svg>
          <div className="trendLegend">
            <span><i className="trendLegendSwatch trendLegendSwatch-buy" />Buy</span>
            <span><i className="trendLegendSwatch trendLegendSwatch-sell" />Sell</span>
            <span><i className="trendLegendSwatch trendLegendSwatch-net" />Net</span>
          </div>
        </div>
      ) : (
        <div className="emptyState">No trend data is available for this date yet.</div>
      )}
    </article>
  );
}

function FlowColumn({ title, items, amountLabel }) {
  return (
    <section className="flowColumn">
      <div className="panelHeader">
        <div>
          <p className="sectionEyebrow">Ranking</p>
          <h2>{title}</h2>
        </div>
      </div>
      {items.length > 0 ? (
        <div className="flowList">
          {items.map((item) => (
            <article className="flowCard" key={`${title}-${item.stockCode}-${item.rank}`}>
              <div className="flowRank">#{item.rank}</div>
              <div className="flowBody">
                <div className="flowNameRow">
                  <h3>{item.stockName}</h3>
                  <span>{item.stockCode}</span>
                </div>
                <p>{amountLabel} {formatAmount(item.displayAmount || item.netBuyAmount)}</p>
                {item.activeDays ? (
                  <span className="flowSubtext">Active days {item.activeDays}</span>
                ) : null}
                {!item.activeDays && item.closePrice ? (
                  <span className="flowSubtext">
                    Close {formatAmount(item.closePrice)}
                    {item.displayQuantity || item.netBuyQuantity ? ` - Qty ${new Intl.NumberFormat("ko-KR").format(Number(item.displayQuantity || item.netBuyQuantity))}` : ""}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="emptyState">No ranked data is available for this date.</div>
      )}
    </section>
  );
}

function InvestorPanel({ meta, investorData, investorDate, onInvestorDateChange }) {
  const enabled = investorData?.enabled;
  const weekly = investorData?.weekly;
  const daily = investorData?.daily;
  const trend = investorData?.trend;
  const summary = investorData?.summary;

  return (
    <>
      <section className="hero hero-grid investorHero hero-grid-compact">
        <div className="heroCopy investorHeroCopy heroCopy-compact">
          <p className="eyebrow">Investor Flow</p>
          <div className="compactMetaList">
            <p className="compactMetaItem">Date {formatDateLabel(investorData?.effectiveDate || investorDate)}</p>
            <p className="compactMetaItem">
              Market {meta?.kis?.market || investorData?.market || "KOSPI"} - Universe {investorData?.collectionUniverseCount ? `${new Intl.NumberFormat("ko-KR").format(investorData.collectionUniverseCount)} stocks` : meta?.kis?.universeCount ? `max ${new Intl.NumberFormat("ko-KR").format(meta.kis.universeCount)} stocks` : "all KOSPI stocks"}
            </p>
            <p className="compactMetaItem">Trend window {trend?.startDate || "-"} ~ {trend?.endDate || "-"}</p>
            <p className="compactMetaItem">Weekly window {weekly?.startDate || "-"} ~ {weekly?.endDate || "-"}</p>
            <p className="compactMetaItem">Daily and weekly top movers now include both net buying and net selling.</p>
            {!enabled ? (
              <p className="compactMetaItem compactMetaItem-error">
                Set KIS_APP_KEY and KIS_APP_SECRET to enable investor flow collection.
              </p>
            ) : null}
          </div>
        </div>

        <CalendarPicker label="Date" value={investorDate} onChange={onInvestorDateChange} />
      </section>

      <section className="flowGrid investorFlowGrid trendGrid">
        <InvestorTrendCard title="Foreign flow trend" summary={summary?.foreign} history={trend?.foreign || []} />
        <InvestorTrendCard title="Institution flow trend" summary={summary?.institution} history={trend?.institution || []} />
      </section>

      <section className="flowGrid investorFlowGrid">
        <div className="panel">
          <FlowColumn title="Foreign daily net buy top 10" items={daily?.foreign?.buy || []} amountLabel="Net buy" />
        </div>
        <div className="panel">
          <FlowColumn title="Institution daily net buy top 10" items={daily?.institution?.buy || []} amountLabel="Net buy" />
        </div>
      </section>

      <section className="flowGrid investorFlowGrid">
        <div className="panel">
          <FlowColumn title="Foreign daily net sell top 10" items={daily?.foreign?.sell || []} amountLabel="Net sell" />
        </div>
        <div className="panel">
          <FlowColumn title="Institution daily net sell top 10" items={daily?.institution?.sell || []} amountLabel="Net sell" />
        </div>
      </section>

      <section className="flowGrid investorFlowGrid">
        <div className="panel">
          <FlowColumn title="Foreign 7-day net buy top 10" items={weekly?.foreign?.buy || []} amountLabel="7-day net buy" />
        </div>
        <div className="panel">
          <FlowColumn title="Institution 7-day net buy top 10" items={weekly?.institution?.buy || []} amountLabel="7-day net buy" />
        </div>
      </section>

      <section className="flowGrid investorFlowGrid">
        <div className="panel">
          <FlowColumn title="Foreign 7-day net sell top 10" items={weekly?.foreign?.sell || []} amountLabel="7-day net sell" />
        </div>
        <div className="panel">
          <FlowColumn title="Institution 7-day net sell top 10" items={weekly?.institution?.sell || []} amountLabel="7-day net sell" />
        </div>
      </section>
    </>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("indices");
  const [health, setHealth] = useState("checking");
  const [meta, setMeta] = useState(null);
  const [newsDate, setNewsDate] = useState("");
  const [investorDate, setInvestorDate] = useState("");
  const [briefing, setBriefing] = useState(null);
  const [articles, setArticles] = useState([]);
  const [indicesData, setIndicesData] = useState(null);
  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.innerWidth <= MOBILE_BREAKPOINT;
  });
  const [investorData, setInvestorData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    function handleResize() {
      const nextIsMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobile(nextIsMobile);

      if (!nextIsMobile) {
        setMobileDetailOpen(false);
      }
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadHealth() {
      try {
        const response = await fetch("/api/health");
        const data = await response.json();

        if (ignore) {
          return;
        }

        setMeta(data);
        setHealth(data.status || "ok");
      } catch (loadError) {
        if (!ignore) {
          setHealth("unreachable");
          setError(loadError.message);
        }
      }
    }

    loadHealth();
    const timer = window.setInterval(loadHealth, 60000);

    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadIndices() {
      try {
        const response = await fetch("/api/market-indices");

        if (!response.ok) {
          throw new Error("주요 지수 데이터를 불러오지 못했습니다.");
        }

        const data = await response.json();

        if (!ignore) {
          setIndicesData(data);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError.message);
        }
      }
    }

    loadIndices();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadNews() {
      try {
        const briefingUrl = newsDate
          ? `/api/briefing/latest?date=${newsDate}`
          : "/api/briefing/latest";
        const newsUrl = newsDate
          ? `/api/news?limit=12&date=${newsDate}`
          : "/api/news?limit=12";

        const [briefingResponse, newsResponse] = await Promise.all([
          fetch(briefingUrl),
          fetch(newsUrl)
        ]);

        if (!briefingResponse.ok || !newsResponse.ok) {
          throw new Error("뉴스 데이터를 불러오지 못했습니다.");
        }

        const [briefingData, newsData] = await Promise.all([
          briefingResponse.json(),
          newsResponse.json()
        ]);

        if (ignore) {
          return;
        }

        const nextArticles = newsData.items || [];
        setBriefing(briefingData);
        setArticles(nextArticles);
        setSelectedArticleId((currentId) => {
          if (nextArticles.some((article) => article.id === currentId)) {
            return currentId;
          }

          return nextArticles[0]?.id || null;
        });

        if (!newsDate && briefingData?.effectiveDate) {
          setNewsDate(briefingData.effectiveDate);
        }

        if (isMobile) {
          setMobileDetailOpen(false);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError.message);
        }
      }
    }

    loadNews();

    return () => {
      ignore = true;
    };
  }, [isMobile, newsDate]);

  useEffect(() => {
    let ignore = false;

    async function loadInvestorData() {
      try {
        const url = investorDate
          ? `/api/investor-flows/kospi?date=${investorDate}`
          : "/api/investor-flows/kospi";
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error("투자자별 매매동향을 불러오지 못했습니다.");
        }

        const data = await response.json();

        if (ignore) {
          return;
        }

        setInvestorData(data);

        if (!investorDate && data?.effectiveDate) {
          setInvestorDate(data.effectiveDate);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError.message);
        }
      }
    }

    loadInvestorData();

    return () => {
      ignore = true;
    };
  }, [investorDate]);

  return (
    <main className="page">
      <header className="topbar">
        <div className="brandBlock">
          <strong>JAYBEE LAB</strong>
        </div>
        <nav className="tabNav">
          <TabButton active={activeTab === "indices"} onClick={() => setActiveTab("indices")}>
            주요 지수 요약
          </TabButton>
          <TabButton active={activeTab === "news"} onClick={() => setActiveTab("news")}>
            뉴스
          </TabButton>
          <TabButton
            active={activeTab === "investor"}
            onClick={() => setActiveTab("investor")}
          >
            투자자별 매매동향
          </TabButton>
        </nav>
      </header>

      {activeTab === "indices" ? (
        <IndicesPanel meta={meta} indicesData={indicesData} error={error} />
      ) : activeTab === "news" ? (
        <NewsPanel
          meta={meta}
          briefing={briefing}
          articles={articles}
          selectedArticleId={selectedArticleId}
          onSelectArticle={setSelectedArticleId}
          newsDate={newsDate}
          onNewsDateChange={(event) => setNewsDate(event.target.value)}
          error={error}
          isMobile={isMobile}
          mobileDetailOpen={mobileDetailOpen}
          onOpenMobileDetail={() => setMobileDetailOpen(true)}
          onCloseMobileDetail={() => setMobileDetailOpen(false)}
        />
      ) : (
        <InvestorPanel
          meta={meta}
          investorData={investorData}
          investorDate={investorDate}
          onInvestorDateChange={(event) => setInvestorDate(event.target.value)}
        />
      )}
    </main>
  );
}