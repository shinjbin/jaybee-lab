import { useEffect, useMemo, useState } from "react";

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

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);

  return `${year}년 ${month}월`;
}

function formatAmount(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const amount = Number(value);

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

function buildSparklinePoints(values, width = 220, height = 72) {
  if (!values.length) {
    return "";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
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
  const tone = getChangeTone(item.changesPercentage);
  const historyValues = (item.history || []).map((point) => point.close);
  const sparkline = buildSparklinePoints(historyValues);

  return (
    <article className="indexCard">
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
        {sparkline ? (
          <svg viewBox="0 0 220 72" className="sparkline" preserveAspectRatio="none">
            <polyline
              fill="none"
              stroke={tone === "negative" ? "#fca5a5" : tone === "positive" ? "#86efac" : "#93c5fd"}
              strokeWidth="3"
              points={sparkline}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <div className="emptySparkline">그래프 데이터 없음</div>
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
                <p>{amountLabel} {formatAmount(item.netBuyAmount)}</p>
                {item.activeDays ? (
                  <span className="flowSubtext">집계 일수 {item.activeDays}일</span>
                ) : null}
                {!item.activeDays && item.closePrice ? (
                  <span className="flowSubtext">
                    종가 {formatAmount(item.closePrice)}
                    {item.netBuyQuantity ? ` · 순매수 ${new Intl.NumberFormat("ko-KR").format(Number(item.netBuyQuantity))}주` : ""}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="emptyState">선택한 날짜의 데이터가 없습니다.</div>
      )}
    </section>
  );
}

function InvestorPanel({ meta, investorData, investorDate, onInvestorDateChange }) {
  const enabled = investorData?.enabled;
  const weekly = investorData?.weekly;

  return (
    <>
      <section className="hero hero-grid investorHero hero-grid-compact">
        <div className="heroCopy investorHeroCopy heroCopy-compact">
          <p className="eyebrow">Investor Flow</p>
          <div className="compactMetaList">
            <p className="compactMetaItem">선택 날짜 {formatDateLabel(investorData?.effectiveDate || investorDate)}</p>
            <p className="compactMetaItem">
              시장 {meta?.kis?.market || investorData?.market || "KOSPI"} · 수집 범위 최대 {investorData?.collectionUniverseCount || meta?.kis?.universeCount || 200}종목
            </p>
            <p className="compactMetaItem">주간 집계 {weekly?.startDate || "-"} ~ {weekly?.endDate || "-"}</p>
            <p className="compactMetaItem">일간 값은 종가 기준 순매수금액으로 보정되며 최근 7일 TOP10을 함께 표시합니다.</p>
            {!enabled ? (
              <p className="compactMetaItem compactMetaItem-error">
                KIS_APP_KEY, KIS_APP_SECRET를 설정하면 투자자별 매매동향 수집이 활성화됩니다.
              </p>
            ) : null}
          </div>
        </div>

        <CalendarPicker label="조회 날짜" value={investorDate} onChange={onInvestorDateChange} />
      </section>

      <section className="flowGrid investorFlowGrid">
        <div className="panel">
          <FlowColumn title="외국인 일간 순매수 TOP 10" items={investorData?.foreign || []} amountLabel="순매수금액" />
        </div>
        <div className="panel">
          <FlowColumn title="기관 일간 순매수 TOP 10" items={investorData?.institution || []} amountLabel="순매수금액" />
        </div>
      </section>

      <section className="flowGrid investorFlowGrid">
        <div className="panel">
          <FlowColumn title="외국인 최근 7일 TOP 10" items={weekly?.foreign || []} amountLabel="7일 누적 순매수" />
        </div>
        <div className="panel">
          <FlowColumn title="기관 최근 7일 TOP 10" items={weekly?.institution || []} amountLabel="7일 누적 순매수" />
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
          <p className="sectionEyebrow">Jaybee Lab</p>
          <strong>Market Intelligence Board</strong>
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
        <HealthPill health={health} />
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
