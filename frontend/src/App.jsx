import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const MOBILE_BREAKPOINT = 820;

const SIDEBAR_ICONS = {
  indices: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 14.5L7 9.5L11 12L17 5.5"/>
      <path d="M2 17.5h16"/>
    </svg>
  ),
  stocks: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="9" cy="9" r="5.5"/>
      <path d="M13.5 13.5L17 17"/>
    </svg>
  ),
  news: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="13" rx="2"/>
      <path d="M7 9h6M7 12.5h4"/>
    </svg>
  ),
  investor: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,15 7,10 11,13 17,6"/>
      <polyline points="13,6 17,6 17,10"/>
    </svg>
  ),
  "ai-analysis": (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2L11.5 7.5H17L12.5 11L14 16.5L10 13L6 16.5L7.5 11L3 7.5H8.5Z"/>
    </svg>
  )
};

function getNaverStockChartUrl(stockCode, isMobile) {
  const normalizedCode = String(stockCode || "")
    .trim()
    .replace(/[^0-9A-Z]/gi, "")
    .toUpperCase();

  if (!normalizedCode) {
    return isMobile
      ? "https://m.stock.naver.com/"
      : "https://finance.naver.com/";
  }

  return isMobile
    ? `https://m.stock.naver.com/domestic/stock/${encodeURIComponent(normalizedCode)}/total`
    : `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(normalizedCode)}`;
}

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

function formatStockNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const number = Number(String(value).replace(/,/g, "").trim());

  if (!Number.isFinite(number)) {
    return String(value);
  }

  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0
  }).format(number);
}

function formatMarketCap(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const normalized = String(value).replace(/,/g, "").trim();
  const eok = 100000000n;
  const jo = 1000000000000n;

  if (/^[-+]?\d+$/.test(normalized)) {
    const amount = BigInt(normalized);
    const sign = amount < 0n ? "-" : "";
    const absolute = amount < 0n ? -amount : amount;

    if (absolute < eok) {
      return `${sign}0억`;
    }

    const joUnit = absolute / jo;
    const eokUnit = (absolute % jo) / eok;

    if (joUnit > 0n) {
      return eokUnit > 0n
        ? `${sign}${joUnit.toString()}조 ${eokUnit.toString()}억`
        : `${sign}${joUnit.toString()}조`;
    }

    return `${sign}${eokUnit.toString()}억`;
  }

  const amount = Number(normalized);

  if (!Number.isFinite(amount)) {
    return String(value);
  }

  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  const eokUnit = Math.floor(absolute / 100000000);

  if (eokUnit === 0) {
    return `${sign}0억`;
  }

  const joUnit = Math.floor(eokUnit / 10000);
  const remainderEok = eokUnit % 10000;

  if (joUnit > 0) {
    return remainderEok > 0
      ? `${sign}${joUnit}조 ${remainderEok}억`
      : `${sign}${joUnit}조`;
  }

  return `${sign}${eokUnit}억`;
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

function isDateWithinRange(date, startDate, endDate) {
  if (!date || !startDate || !endDate) {
    return false;
  }

  return date >= startDate && date <= endDate;
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

function Sidebar({
  activeTab,
  onTabChange,
  health,
  collapsed,
  onToggle,
  isMobile,
  mobileOpen,
  onMobileClose
}) {
  const tabs = [
    { id: "indices", label: "시장요약" },
    { id: "stocks", label: "종목조회" },
    { id: "news", label: "뉴스" },
    { id: "investor", label: "수급동향" },
    { id: "ai-analysis", label: "AI분석" }
  ];

  function handleTabClick(tabId) {
    onTabChange(tabId);
    if (isMobile) {
      onMobileClose();
    }
  }

  const isCollapsed = !isMobile && collapsed;
  const sidebarClass = [
    "sidebar",
    isCollapsed ? "sidebar-collapsed" : "",
    isMobile && mobileOpen ? "sidebar-mobileOpen" : ""
  ].filter(Boolean).join(" ");

  return (
    <aside className={sidebarClass}>
      <div className="sidebarBrand">
        <div className="brandBlock">
          <p className="topbarLabel">Market Monitor</p>
          <strong>JAYBEE LAB</strong>
        </div>
        {!isMobile ? (
          <button
            type="button"
            className="sidebarToggle"
            onClick={onToggle}
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          >
            {collapsed ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 3l6 5-6 5"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 3L5 8l6 5"/>
              </svg>
            )}
          </button>
        ) : null}
      </div>

      <nav className="sidebarNav" aria-label="Primary">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`sideNavItem${activeTab === tab.id ? " sideNavItem-active" : ""}`}
            onClick={() => handleTabClick(tab.id)}
            title={isCollapsed ? tab.label : undefined}
          >
            <span className="sideNavIcon">{SIDEBAR_ICONS[tab.id]}</span>
            <span className="sideNavLabel">{tab.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebarFooter">
        <HealthPill health={health} />
      </div>
    </aside>
  );
}

function CalendarPicker({ label, value, onChange, rangeStart, rangeEnd }) {
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
              className={`calendarDay ${isDateWithinRange(
                cell.date,
                rangeStart,
                rangeEnd
              ) ? "calendarDay-inRange" : ""} ${value === cell.date ? "calendarDay-active" : ""}`}
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

function CalendarRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange
}) {
  return (
    <div className="calendarRangeGrid">
      <CalendarPicker
        label="조회 시작일"
        value={startDate}
        onChange={onStartDateChange}
        rangeStart={startDate}
        rangeEnd={endDate}
      />
      <CalendarPicker
        label="조회 종료일"
        value={endDate}
        onChange={onEndDateChange}
        rangeStart={startDate}
        rangeEnd={endDate}
      />
    </div>
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

      <section className="languageCard">
        <span className="languageLabel">English Full Text</span>
        <p>{englishBody}</p>
      </section>
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

function buildInvestorTrendGeometry(series, width = 520, height = 220) {
  const normalizedSeries = (series || []).filter((item) => item?.history?.length);

  if (!normalizedSeries.length) {
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
  const preparedSeries = normalizedSeries.map((item) => ({
    ...item,
    values: (item.history || []).map((row) => ({
      date: row.date,
      value: Number(row.netAmount || 0)
    }))
  }));
  const values = preparedSeries.flatMap((item) => item.values.map((point) => point.value).concat(0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const chartSeries = preparedSeries.map((item) => {
    const points = item.values.map((point, index) => {
      const x = padding.left + (index / Math.max(item.values.length - 1, 1)) * plotWidth;
      const y = padding.top + plotHeight - ((point.value - min) / range) * plotHeight;

      return {
        date: point.date,
        value: point.value,
        x,
        y
      };
    });

    return {
      key: item.key,
      label: item.label,
      legendClassName: item.legendClassName,
      lineClassName: item.lineClassName,
      points,
      polyline: points.map((point) => `${point.x},${point.y}`).join(" ")
    };
  });
  const zeroY = padding.top + plotHeight - ((0 - min) / range) * plotHeight;
  const firstSeries = chartSeries[0];

  return {
    width,
    height,
    padding,
    min,
    max,
    zeroY,
    startDate: firstSeries?.points[0]?.date,
    endDate: firstSeries?.points[firstSeries.points.length - 1]?.date,
    series: chartSeries
  };
}

function InvestorTrendCard({ foreignSummary, foreignHistory, institutionSummary, institutionHistory }) {
  const chartSeries = useMemo(
    () => [
      {
        key: "foreign",
        label: "외국인",
        history: foreignHistory || [],
        legendClassName: "trendLegendSwatch trendLegendSwatch-foreign",
        lineClassName: "trendLine trendLine-foreign"
      },
      {
        key: "institution",
        label: "기관",
        history: institutionHistory || [],
        legendClassName: "trendLegendSwatch trendLegendSwatch-institution",
        lineClassName: "trendLine trendLine-institution"
      }
    ],
    [foreignHistory, institutionHistory]
  );
  const geometry = useMemo(() => buildInvestorTrendGeometry(chartSeries), [chartSeries]);

  return (
    <article className="investorTrendCard">
      <div className="panelHeader investorTrendHeader">
        <div>
          <p className="sectionEyebrow">추이</p>
          <h2>외국인/기관 매매 추이</h2>
        </div>
        <div className="trendSummaryGrid">
          <div className="trendStat trendStat-buy">
            <span>순매수</span>
            <strong>{formatAmount(summary?.grossBuyAmount)}</strong>
          </div>
          <div className="trendStat trendStat-sell">
            <span>순매도</span>
            <strong>{formatAmount(summary?.grossSellAmount)}</strong>
          </div>
          <div className="trendStat trendStat-net">
            <span>순매수</span>
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
              {formatAmount(geometry.min)}
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
            <span><i className="trendLegendSwatch trendLegendSwatch-buy" />순매수</span>
            <span><i className="trendLegendSwatch trendLegendSwatch-sell" />순매도</span>
            <span><i className="trendLegendSwatch trendLegendSwatch-net" />순매수</span>
          </div>
        </div>
      ) : (
        <div className="emptyState">선택한 날짜의 추이 데이터가 아직 없습니다.</div>
      )}
    </article>
  );
}

function buildCombinedInvestorTrendGeometry(series, width = 520, height = 220) {
  const normalizedSeries = (series || []).filter((item) => item?.history?.length);

  if (!normalizedSeries.length) {
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
  const values = normalizedSeries.flatMap((item) =>
    (item.history || []).map((point) => Number(point.netAmount || 0)).concat(0)
  );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const chartSeries = normalizedSeries.map((item) => {
    const points = (item.history || []).map((point, index, source) => {
      const x = padding.left + (index / Math.max(source.length - 1, 1)) * plotWidth;
      const y = padding.top + plotHeight - ((Number(point.netAmount || 0) - min) / range) * plotHeight;

      return {
        date: point.date,
        x,
        y
      };
    });

    return {
      key: item.key,
      label: item.label,
      lineClassName: item.lineClassName,
      legendClassName: item.legendClassName,
      points,
      polyline: points.map((point) => `${point.x},${point.y}`).join(" ")
    };
  });
  const zeroY = padding.top + plotHeight - ((0 - min) / range) * plotHeight;
  const firstSeries = chartSeries[0];

  return {
    width,
    height,
    padding,
    min,
    max,
    zeroY,
    startDate: firstSeries?.points[0]?.date,
    endDate: firstSeries?.points[firstSeries.points.length - 1]?.date,
    series: chartSeries
  };
}

function CombinedInvestorTrendCard({ foreignSummary, foreignHistory, institutionSummary, institutionHistory }) {
  const series = useMemo(
    () => [
      {
        key: "foreign",
        label: "외국인",
        history: foreignHistory || [],
        lineClassName: "trendLine trendLine-foreign",
        legendClassName: "trendLegendSwatch trendLegendSwatch-foreign"
      },
      {
        key: "institution",
        label: "기관",
        history: institutionHistory || [],
        lineClassName: "trendLine trendLine-institution",
        legendClassName: "trendLegendSwatch trendLegendSwatch-institution"
      }
    ],
    [foreignHistory, institutionHistory]
  );
  const geometry = useMemo(() => buildCombinedInvestorTrendGeometry(series), [series]);

  return (
    <article className="investorTrendCard">
      <div className="panelHeader investorTrendHeader">
        <div>
          <p className="sectionEyebrow">추이</p>
          <h2>외국인/기관 매매 추이</h2>
        </div>
        <div className="trendSummaryGrid">
          <div className="trendSummaryCard">
            <div className="trendSummaryTitle">
              <i className="trendLegendSwatch trendLegendSwatch-foreign" />
              <strong>외국인</strong>
            </div>
            <div className="trendStatGrid">
              <div className="trendStat trendStat-buy">
                <span>매수</span>
                <strong>{formatAmount(foreignSummary?.grossBuyAmount)}</strong>
              </div>
              <div className="trendStat trendStat-sell">
                <span>매도</span>
                <strong>{formatAmount(foreignSummary?.grossSellAmount)}</strong>
              </div>
              <div className="trendStat trendStat-net">
                <span>순매수</span>
                <strong>{formatAmount(foreignSummary?.netAmount)}</strong>
              </div>
            </div>
          </div>
          <div className="trendSummaryCard">
            <div className="trendSummaryTitle">
              <i className="trendLegendSwatch trendLegendSwatch-institution" />
              <strong>기관</strong>
            </div>
            <div className="trendStatGrid">
              <div className="trendStat trendStat-buy">
                <span>매수</span>
                <strong>{formatAmount(institutionSummary?.grossBuyAmount)}</strong>
              </div>
              <div className="trendStat trendStat-sell">
                <span>매도</span>
                <strong>{formatAmount(institutionSummary?.grossSellAmount)}</strong>
              </div>
              <div className="trendStat trendStat-net">
                <span>순매수</span>
                <strong>{formatAmount(institutionSummary?.netAmount)}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
      {geometry ? (
        <div className="sparklineWrap investorTrendWrap">
          <svg
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            className="sparkline investorTrendChart"
            preserveAspectRatio="none"
            role="img"
            aria-label="외국인 기관 순매수 추이"
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
              {formatAmount(geometry.min)}
            </text>
            <text className="sparklineLabel sparklineLabel-x" x={geometry.padding.left} y={geometry.height - 8}>
              {formatShortDateLabel(geometry.startDate)}
            </text>
            <text className="sparklineLabel sparklineLabel-x sparklineLabel-xEnd" x={geometry.width - geometry.padding.right} y={geometry.height - 8}>
              {formatShortDateLabel(geometry.endDate)}
            </text>
            {geometry.series.map((item) => (
              <polyline key={item.key} className={item.lineClassName} points={item.polyline} />
            ))}
          </svg>
          <div className="trendLegend">
            {geometry.series.map((item) => (
              <span key={item.key}>
                <i className={item.legendClassName} />
                {item.label} 순매수
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="emptyState">선택한 날짜의 추이 데이터가 아직 없습니다.</div>
      )}
    </article>
  );
}

function FlowColumn({ title, items, allItems, amountLabel, isMobile }) {
  const [showAll, setShowAll] = useState(false);
  const visibleItems = showAll ? allItems || items : items;
  const hasMoreItems = (allItems?.length || 0) > (items?.length || 0);

  return (
    <section className="flowColumn">
      <div className="panelHeader">
        <div>
          <p className="sectionEyebrow">순위</p>
          <h2>{title}</h2>
        </div>
      </div>
      {visibleItems.length > 0 ? (
        <div className="flowList">
          {visibleItems.map((item) => (
            <a
              className="flowCard flowCard-link"
              href={getNaverStockChartUrl(item.stockCode, isMobile)}
              key={`${title}-${item.stockCode}-${item.rank}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`${item.stockName} 네이버 증권 종목 차트 열기`}
            >
              <div className="flowRank">#{item.rank}</div>
              <div className="flowBody">
                <div className="flowNameRow">
                  <h3>{item.stockName}</h3>
                  <span>{item.stockCode}</span>
                </div>
                <p>{amountLabel} {formatAmount(item.displayAmount || item.netBuyAmount)}</p>
                {item.activeDays ? (
                  <span className="flowSubtext">집계 일수 {item.activeDays}일</span>
                ) : null}
                {!item.activeDays && item.closePrice ? (
                  <span className="flowSubtext">
                    종가 {formatAmount(item.closePrice)}
                    {item.displayQuantity || item.netBuyQuantity ? ` · 수량 ${new Intl.NumberFormat("ko-KR").format(Number(item.displayQuantity || item.netBuyQuantity))}주` : ""}
                  </span>
                ) : null}
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="emptyState">선택한 날짜의 데이터가 없습니다.</div>
      )}
      {hasMoreItems ? (
        <button
          type="button"
          className="flowExpandButton"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "접기" : `전체 보기 (${allItems.length})`}
        </button>
      ) : null}
    </section>
  );
}

function StockLookupPanel({ kospiStocks, stockSearch, onStockSearchChange, isMobile, error }) {
  const deferredSearch = stockSearch.trim().toLowerCase();
  const filteredStocks = useMemo(() => {
    if (!deferredSearch) {
      return kospiStocks?.items || [];
    }

    return (kospiStocks?.items || []).filter((item) => {
      const stockName = String(item.stockName || "").toLowerCase();
      const stockCode = String(item.stockCode || "").toLowerCase();

      return stockName.includes(deferredSearch) || stockCode.includes(deferredSearch);
    });
  }, [deferredSearch, kospiStocks]);

  return (
    <>
      <section className="hero hero-grid hero-grid-compact">
        <div className="heroCopy heroCopy-compact">
          <p className="eyebrow">KOSPI Universe</p>
          <div className="compactMetaList">
            <p className="compactMetaItem">코스피 전체 종목을 코드와 시가총액 기준으로 빠르게 탐색할 수 있습니다.</p>
            <p className="compactMetaItem">전체 종목 {new Intl.NumberFormat("ko-KR").format(kospiStocks?.count || 0)}개</p>
            <p className="compactMetaItem">기준일 {kospiStocks?.asOfDate || "-"}</p>
            <p className="compactMetaItem">수집 소스 {kospiStocks?.source || "-"}</p>
            <p className="compactMetaItem">검색 결과 {new Intl.NumberFormat("ko-KR").format(filteredStocks.length)}개</p>
            {error ? <p className="compactMetaItem compactMetaItem-error">{error}</p> : null}
          </div>
        </div>

        <section className="panel stockSearchPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionEyebrow">Search</p>
              <h2>종목 찾기</h2>
            </div>
          </div>
          <label className="stockSearchField">
            <span>종목명 또는 종목코드</span>
            <input
              type="search"
              value={stockSearch}
              onChange={(event) => onStockSearchChange(event.target.value)}
              placeholder="예: 삼성전자, 005930"
            />
          </label>
        </section>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="sectionEyebrow">Explorer</p>
            <h2>코스피 전체 종목</h2>
          </div>
        </div>

        {filteredStocks.length ? (
          <div className={`stockGrid ${isMobile ? "stockGrid-mobile" : ""}`}>
            {filteredStocks.map((item, index) => (
              <a
                key={item.stockCode}
                className="stockCard"
                href={getNaverStockChartUrl(item.stockCode, isMobile)}
                target="_blank"
                rel="noreferrer"
              >
                <div className="stockCardTop">
                  <span className="stockRank">#{index + 1}</span>
                  <h3>{item.stockName}</h3>
                  <span className="stockCode">{item.stockCode}</span>
                </div>
                <div className="stockCardBody">
                  <p>종가 {formatStockNumber(item.closePrice)}원</p>
                  <p>시가총액 {formatMarketCap(item.marketCap)}</p>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="emptyState">검색 결과가 없습니다. 종목명 또는 종목코드를 다시 입력해 보세요.</div>
        )}
      </section>
    </>
  );
}

function InvestorPanel({
  meta,
  investorData,
  investorStartDate,
  investorEndDate,
  onInvestorStartDateChange,
  onInvestorEndDateChange,
  onResetInvestorRange,
  isMobile
}) {
  const enabled = investorData?.enabled;
  const weekly = investorData?.weekly;
  const daily = investorData?.daily;
  const trend = investorData?.trend;
  const summary = investorData?.summary;
  const requestedRange = investorData?.requestedRange;
  const selectedStartDate = requestedRange?.startDate || investorStartDate;
  const selectedEndDate = requestedRange?.endDate || investorEndDate;
  const selectedRangeLabel =
    selectedStartDate && selectedEndDate
      ? `${selectedStartDate} ~ ${selectedEndDate}`
      : formatDateLabel(investorData?.effectiveDate);
  const weeklyDays = weekly?.windowDays || investorData?.weeklyWindowDays || 0;
  const cumulativeBuyLabel = `${weeklyDays}일 누적 순매수금액`;
  const cumulativeSellLabel = `${weeklyDays}일 누적 순매도금액`;

  return (
    <>
      <section className="hero hero-grid investorHero hero-grid-compact">
        <div className="heroCopy investorHeroCopy heroCopy-compact">
          <p className="eyebrow">투자자별 매매동향</p>
          <div className="compactMetaList">
            <p className="compactMetaItem">선택 기준일 {formatDateLabel(investorData?.effectiveDate)}</p>
            <p className="compactMetaItem">조회 기간 {selectedRangeLabel || "-"}</p>
            <p className="compactMetaItem">
              시장 {meta?.kis?.market || investorData?.market || "KOSPI"} · 수집 범위 {investorData?.collectionUniverseCount ? `코스피 전체 ${new Intl.NumberFormat("ko-KR").format(investorData.collectionUniverseCount)}종목` : meta?.kis?.universeCount ? `최대 ${new Intl.NumberFormat("ko-KR").format(meta.kis.universeCount)}종목` : "코스피 전체 종목"}
            </p>
            <p className="compactMetaItem">추이 기간 {trend?.startDate || "-"} ~ {trend?.endDate || "-"}</p>
            <p className="compactMetaItem">누적 집계 {weekly?.startDate || "-"} ~ {weekly?.endDate || "-"}</p>
            <p className="compactMetaItem">
              {requestedRange?.isCustomRange
                ? "선택한 기간 기준으로 누적 상위 종목과 추이를 함께 보여줍니다."
                : "일간과 최근 7일 TOP 순위에 순매수와 순매도를 함께 표시합니다."}
            </p>
            {!enabled ? (
              <p className="compactMetaItem compactMetaItem-error">
                KIS_APP_KEY, KIS_APP_SECRET를 설정하면 투자자별 매매동향 수집이 활성화됩니다.
              </p>
            ) : null}
          </div>
        </div>

        <div className="calendarRangeSection">
          <CalendarRangePicker
            startDate={investorStartDate}
            endDate={investorEndDate}
            onStartDateChange={onInvestorStartDateChange}
            onEndDateChange={onInvestorEndDateChange}
          />
          <button type="button" className="calendarResetButton" onClick={onResetInvestorRange}>
            최근 기준으로 보기
          </button>
        </div>
      </section>

      <section className="flowGrid investorFlowGrid trendGrid">
        <CombinedInvestorTrendCard
          foreignSummary={summary?.foreign}
          foreignHistory={trend?.foreign || []}
          institutionSummary={summary?.institution}
          institutionHistory={trend?.institution || []}
        />
      </section>

      <section className="flowGrid investorFlowGrid">
        <div className="panel">
          <FlowColumn title="외국인 일간 순매수 TOP 10" items={daily?.foreign?.buy || []} allItems={daily?.foreign?.buyAll || daily?.foreign?.buy || []} amountLabel="순매수금액" isMobile={isMobile} />
        </div>
        <div className="panel">
          <FlowColumn title="기관 일간 순매수 TOP 10" items={daily?.institution?.buy || []} allItems={daily?.institution?.buyAll || daily?.institution?.buy || []} amountLabel="순매수금액" isMobile={isMobile} />
        </div>
      </section>

      <section className="flowGrid investorFlowGrid">
        <div className="panel">
          <FlowColumn title="외국인 일간 순매도 TOP 10" items={daily?.foreign?.sell || []} allItems={daily?.foreign?.sellAll || daily?.foreign?.sell || []} amountLabel="순매도금액" isMobile={isMobile} />
        </div>
        <div className="panel">
          <FlowColumn title="기관 일간 순매도 TOP 10" items={daily?.institution?.sell || []} allItems={daily?.institution?.sellAll || daily?.institution?.sell || []} amountLabel="순매도금액" isMobile={isMobile} />
        </div>
      </section>

      <section className="flowGrid investorFlowGrid">
        <div className="panel">
          <FlowColumn title={`외국인 최근 ${weeklyDays}일 순매수 TOP 10`} items={weekly?.foreign?.buy || []} allItems={weekly?.foreign?.buyAll || weekly?.foreign?.buy || []} amountLabel={cumulativeBuyLabel} isMobile={isMobile} />
        </div>
        <div className="panel">
          <FlowColumn title={`기관 최근 ${weeklyDays}일 순매수 TOP 10`} items={weekly?.institution?.buy || []} allItems={weekly?.institution?.buyAll || weekly?.institution?.buy || []} amountLabel={cumulativeBuyLabel} isMobile={isMobile} />
        </div>
      </section>

      <section className="flowGrid investorFlowGrid">
        <div className="panel">
          <FlowColumn title={`외국인 최근 ${weeklyDays}일 순매도 TOP 10`} items={weekly?.foreign?.sell || []} allItems={weekly?.foreign?.sellAll || weekly?.foreign?.sell || []} amountLabel={cumulativeSellLabel} isMobile={isMobile} />
        </div>
        <div className="panel">
          <FlowColumn title={`기관 최근 ${weeklyDays}일 순매도 TOP 10`} items={weekly?.institution?.sell || []} allItems={weekly?.institution?.sellAll || weekly?.institution?.sell || []} amountLabel={cumulativeSellLabel} isMobile={isMobile} />
        </div>
      </section>
    </>
  );
}

function AIAnalysisPanel({
  analysisDate,
  onAnalysisDateChange,
  analysisData,
  error
}) {
  const items = analysisData?.items || [];

  return (
    <>
      <section className="hero hero-grid hero-grid-compact">
        <div className="heroCopy heroCopy-compact">
          <p className="eyebrow">AI Market Analysis</p>
          <div className="compactMetaList">
            <p className="compactMetaItem">선택 날짜 {formatDateLabel(analysisDate)}</p>
            <p className="compactMetaItem">분석 {items.length}건</p>
            {error ? <p className="compactMetaItem compactMetaItem-error">{error}</p> : null}
          </div>
        </div>

        <CalendarPicker label="조회 날짜" value={analysisDate} onChange={onAnalysisDateChange} />
      </section>

      {items.length > 0 ? (
        <section className="panel aiAnalysisPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionEyebrow">AI Report</p>
              <h2>시장 분석 리포트</h2>
            </div>
          </div>

          <div className="aiCardsGrid">
            {items.map((item) => (
              <article key={item.id} className="aiAnalysisCard">
                {item.category ? (
                  <p className="aiSectionLabel">{item.category}</p>
                ) : null}
                {item.title ? <h3 className="aiCardTitle">{item.title}</h3> : null}
                <div className="aiSectionText">
                  <ReactMarkdown>{item.content}</ReactMarkdown>
                </div>
                <p className="aiCardMeta">{formatDateTime(item.createdAt)}</p>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="emptyState">선택한 날짜의 AI 분석 내용이 없습니다.</div>
        </section>
      )}
    </>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("indices");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [health, setHealth] = useState("checking");
  const [meta, setMeta] = useState(null);
  const [newsDate, setNewsDate] = useState("");
  const [stockSearch, setStockSearch] = useState("");
  const [investorStartDate, setInvestorStartDate] = useState("");
  const [investorEndDate, setInvestorEndDate] = useState("");
  const [briefing, setBriefing] = useState(null);
  const [articles, setArticles] = useState([]);
  const [indicesData, setIndicesData] = useState(null);
  const [kospiStocks, setKospiStocks] = useState(null);
  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.innerWidth <= MOBILE_BREAKPOINT;
  });
  const [investorData, setInvestorData] = useState(null);
  const [analysisDate, setAnalysisDate] = useState(() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  });
  const [analysisData, setAnalysisData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    function handleResize() {
      const nextIsMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobile(nextIsMobile);

      if (!nextIsMobile) {
        setMobileDetailOpen(false);
        setMobileMenuOpen(false);
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

    async function loadKospiStocks() {
      try {
        const response = await fetch("/api/stocks/kospi");

        if (!response.ok) {
          throw new Error("코스피 종목 데이터를 불러오지 못했습니다.");
        }

        const data = await response.json();

        if (!ignore) {
          setKospiStocks(data);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError.message);
        }
      }
    }

    loadKospiStocks();

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
        const params = new URLSearchParams();

        if (investorStartDate && investorEndDate) {
          params.set("startDate", investorStartDate);
          params.set("endDate", investorEndDate);
        }

        const queryString = params.toString();
        const url = queryString
          ? `/api/investor-flows/kospi?${queryString}`
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
  }, [investorEndDate, investorStartDate]);

  useEffect(() => {
    let ignore = false;

    async function loadAnalysis() {
      try {
        const response = await fetch(`/api/ai-analysis?date=${analysisDate}`);

        if (!response.ok) {
          throw new Error("AI 분석 데이터를 불러오지 못했습니다.");
        }

        const data = await response.json();

        if (!ignore) {
          setAnalysisData(data);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError.message);
        }
      }
    }

    loadAnalysis();

    return () => {
      ignore = true;
    };
  }, [analysisDate]);

  function handleInvestorStartDateChange(event) {
    const nextStartDate = event.target.value;

    setInvestorStartDate(nextStartDate);
    setInvestorEndDate((currentEndDate) => {
      if (!currentEndDate || nextStartDate > currentEndDate) {
        return nextStartDate;
      }

      return currentEndDate;
    });
  }

  function handleInvestorEndDateChange(event) {
    const nextEndDate = event.target.value;

    setInvestorEndDate(nextEndDate);
    setInvestorStartDate((currentStartDate) => {
      if (!currentStartDate || nextEndDate < currentStartDate) {
        return nextEndDate;
      }

      return currentStartDate;
    });
  }

  function resetInvestorRange() {
    setInvestorStartDate("");
    setInvestorEndDate("");
  }

  return (
    <div className="appLayout">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        health={health}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((current) => !current)}
        isMobile={isMobile}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />
      {isMobile && mobileMenuOpen ? (
        <div
          className="sidebarBackdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      ) : null}
      <div className="mainContent">
        {isMobile ? (
          <button
            type="button"
            className="mobileMenuToggle"
            onClick={() => setMobileMenuOpen((current) => !current)}
            aria-label="메뉴"
            aria-expanded={mobileMenuOpen}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 5h14M3 10h14M3 15h14"/>
            </svg>
          </button>
        ) : null}
        <div className="contentInner">
          {activeTab === "indices" ? (
            <IndicesPanel meta={meta} indicesData={indicesData} error={error} />
          ) : activeTab === "stocks" ? (
            <StockLookupPanel
              kospiStocks={kospiStocks}
              stockSearch={stockSearch}
              onStockSearchChange={setStockSearch}
              isMobile={isMobile}
              error={error}
            />
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
          ) : activeTab === "investor" ? (
            <InvestorPanel
              meta={meta}
              investorData={investorData}
              investorStartDate={investorStartDate}
              investorEndDate={investorEndDate}
              onInvestorStartDateChange={handleInvestorStartDateChange}
              onInvestorEndDateChange={handleInvestorEndDateChange}
              onResetInvestorRange={resetInvestorRange}
              isMobile={isMobile}
            />
          ) : (
            <AIAnalysisPanel
              analysisDate={analysisDate}
              onAnalysisDateChange={(event) => setAnalysisDate(event.target.value)}
              analysisData={analysisData}
              error={error}
            />
          )}
        </div>
      </div>
    </div>
  );
}
