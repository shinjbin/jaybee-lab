import { useEffect, useState } from "react";

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

function formatAmount(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const numeric = Number(value);

  if (Number.isNaN(numeric)) {
    return String(value);
  }

  return `${new Intl.NumberFormat("ko-KR").format(numeric)}원`;
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

function DatePicker({ label, value, onChange }) {
  return (
    <label className="datePicker">
      <span>{label}</span>
      <input type="date" value={value || ""} onChange={onChange} />
    </label>
  );
}

function NewsPanel({ meta, briefing, articles, newsDate, onNewsDateChange, error }) {
  const latestRun = briefing?.latestRun;
  const spotlight = briefing?.spotlight || [];
  const categories = briefing?.categories || [];

  return (
    <>
      <section className="hero">
        <div className="heroHeader">
          <div>
            <p className="eyebrow">News Briefing</p>
            <h1>날짜별 AI 뉴스 브리핑</h1>
          </div>
          <DatePicker label="브리핑 날짜" value={newsDate} onChange={onNewsDateChange} />
        </div>

        <p className="description">
          뉴스 워커가 수집한 증시 및 시사 기사를 날짜별로 모아 보고, AI 또는 기본
          요약으로 빠르게 핵심만 확인할 수 있습니다.
        </p>

        <div className="statsGrid">
          <article className="statCard">
            <span className="statLabel">Selected Date</span>
            <strong className="statValue statValue-small">
              {formatDateLabel(briefing?.effectiveDate)}
            </strong>
            <span className="statHint">현재 보고 있는 브리핑 일자</span>
          </article>
          <article className="statCard">
            <span className="statLabel">Scheduler</span>
            <strong className="statValue">
              {meta?.scheduler?.intervalMinutes || "-"} min
            </strong>
            <span className="statHint">수집 주기</span>
          </article>
          <article className="statCard">
            <span className="statLabel">AI Summary</span>
            <strong className="statValue">
              {meta?.ai?.enabled ? "enabled" : "fallback"}
            </strong>
            <span className="statHint">
              {meta?.ai?.model || "규칙 기반 요약"}
            </span>
          </article>
          <article className="statCard">
            <span className="statLabel">Articles</span>
            <strong className="statValue">{briefing?.totalArticles || 0}</strong>
            <span className="statHint">선택 일자 기사 수</span>
          </article>
        </div>

        <div className="actions">
          <a href={`/api/briefing/latest${newsDate ? `?date=${newsDate}` : ""}`} target="_blank" rel="noreferrer">
            Briefing API
          </a>
          <a href={`/api/news?limit=12${newsDate ? `&date=${newsDate}` : ""}`} target="_blank" rel="noreferrer">
            News API
          </a>
        </div>

        {latestRun ? (
          <div className="runSummary">
            <span>마지막 뉴스 수집: {formatDateTime(latestRun.finishedAt || latestRun.startedAt)}</span>
            <span>seen {latestRun.articlesSeen}</span>
            <span>new {latestRun.articlesInserted}</span>
            <span>summarized {latestRun.articlesSummarized}</span>
            <span className={`runStatus runStatus-${latestRun.status}`}>
              {latestRun.status}
            </span>
          </div>
        ) : null}

        {error ? <p className="errorMessage">{error}</p> : null}
      </section>

      <section className="contentGrid">
        <div className="panel">
          <div className="panelHeader">
            <div>
              <p className="sectionEyebrow">Spotlight</p>
              <h2>핵심 기사</h2>
            </div>
          </div>
          <div className="spotlightList">
            {spotlight.length > 0 ? (
              spotlight.map((article) => (
                <article className="spotlightCard" key={article.id}>
                  <div className="cardMeta">
                    <span>{article.categoryLabel}</span>
                    <span>{article.sourceName}</span>
                    <span>{formatDateTime(article.publishedAt)}</span>
                  </div>
                  <h3>{article.title}</h3>
                  <p>{article.summary || article.description}</p>
                  <div className="tagRow">
                    {(article.keywords || []).map((keyword) => (
                      <span className="tag" key={`${article.id}-${keyword}`}>
                        {keyword}
                      </span>
                    ))}
                  </div>
                  <a href={article.url} target="_blank" rel="noreferrer">
                    원문 보기
                  </a>
                </article>
              ))
            ) : (
              <div className="emptyState">선택한 날짜에 브리핑할 뉴스가 없습니다.</div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <div>
              <p className="sectionEyebrow">Categories</p>
              <h2>분야별 묶음</h2>
            </div>
          </div>
          <div className="categoryGrid">
            {categories.map((section) => (
              <section className="categoryColumn" key={section.key}>
                <div className="categoryTitleRow">
                  <h3>{section.label}</h3>
                  <span>{section.count}</span>
                </div>
                {section.items.length > 0 ? (
                  section.items.map((article) => (
                    <article className="miniCard" key={article.id}>
                      <div className="cardMeta">
                        <span>{article.sourceName}</span>
                        <span>{formatDateTime(article.publishedAt)}</span>
                      </div>
                      <h4>{article.title}</h4>
                      <p>{article.summary || article.description}</p>
                    </article>
                  ))
                ) : (
                  <div className="emptyState small">선택한 날짜의 항목이 없습니다.</div>
                )}
              </section>
            ))}
          </div>
        </div>
      </section>

      <section className="panel latestPanel">
        <div className="panelHeader">
          <div>
            <p className="sectionEyebrow">Latest</p>
            <h2>선택 일자 기사 목록</h2>
          </div>
        </div>
        <div className="newsList">
          {articles.length > 0 ? (
            articles.map((article) => (
              <article className="newsItem" key={article.id}>
                <div className="newsPrimary">
                  <div className="cardMeta">
                    <span>{article.categoryLabel}</span>
                    <span>{article.sourceName}</span>
                    <span>{formatDateTime(article.publishedAt)}</span>
                  </div>
                  <h3>{article.title}</h3>
                  <p>{article.summary || article.description}</p>
                </div>
                <div className="newsAside">
                  <span className={`impact impact-${article.marketImpact || "low"}`}>
                    impact {article.marketImpact || "low"}
                  </span>
                  <span className="sentiment">{article.sentiment || "neutral"}</span>
                  <a href={article.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </div>
              </article>
            ))
          ) : (
            <div className="emptyState">선택한 날짜의 뉴스가 없습니다.</div>
          )}
        </div>
      </section>
    </>
  );
}

function FlowColumn({ title, items }) {
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
            <article className="flowCard" key={`${item.investorType}-${item.stockCode}`}>
              <div className="flowRank">#{item.rank}</div>
              <div className="flowBody">
                <div className="flowNameRow">
                  <h3>{item.stockName}</h3>
                  <span>{item.stockCode}</span>
                </div>
                <p>순매수금액 {formatAmount(item.netBuyAmount)}</p>
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

  return (
    <>
      <section className="hero">
        <div className="heroHeader">
          <div>
            <p className="eyebrow">Investor Flow</p>
            <h1>외국인·기관 순매수 상위 종목</h1>
          </div>
          <DatePicker label="조회 날짜" value={investorDate} onChange={onInvestorDateChange} />
        </div>

        <p className="description">
          한국투자증권 REST API 기반으로 수집한 KOSPI 외국인 및 기관 순매수 랭킹입니다.
          워커가 주기적으로 스냅샷을 저장하고, 선택한 날짜의 최신 데이터를 보여줍니다.
        </p>

        <div className="statsGrid investorStatsGrid">
          <article className="statCard">
            <span className="statLabel">Selected Date</span>
            <strong className="statValue statValue-small">
              {formatDateLabel(investorData?.effectiveDate)}
            </strong>
            <span className="statHint">저장된 스냅샷 기준</span>
          </article>
          <article className="statCard">
            <span className="statLabel">Source</span>
            <strong className="statValue statValue-small">KIS REST</strong>
            <span className="statHint">한국투자증권 시세 API</span>
          </article>
          <article className="statCard">
            <span className="statLabel">Market</span>
            <strong className="statValue statValue-small">
              {meta?.kis?.market || investorData?.market || "KOSPI"}
            </strong>
            <span className="statHint">현재 랭킹 시장</span>
          </article>
          <article className="statCard">
            <span className="statLabel">Last Snapshot</span>
            <strong className="statValue statValue-small">
              {formatDateTime(investorData?.latestCollectedAt)}
            </strong>
            <span className="statHint">최근 수집 시각</span>
          </article>
        </div>

        <div className="actions">
          <a href={`/api/investor-flows/kospi${investorDate ? `?date=${investorDate}` : ""}`} target="_blank" rel="noreferrer">
            Investor Flow API
          </a>
        </div>

        {!enabled ? (
          <div className="emptyState inlineNotice">
            KIS_APP_KEY, KIS_APP_SECRET를 설정하면 투자자별 매매동향 수집이 활성화됩니다.
          </div>
        ) : null}
      </section>

      <section className="flowGrid">
        <div className="panel">
          <FlowColumn title="외국인 순매수 TOP 10" items={investorData?.foreign || []} />
        </div>
        <div className="panel">
          <FlowColumn title="기관 순매수 TOP 10" items={investorData?.institution || []} />
        </div>
      </section>
    </>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("news");
  const [health, setHealth] = useState("checking");
  const [meta, setMeta] = useState(null);
  const [newsDate, setNewsDate] = useState("");
  const [investorDate, setInvestorDate] = useState("");
  const [briefing, setBriefing] = useState(null);
  const [articles, setArticles] = useState([]);
  const [investorData, setInvestorData] = useState(null);
  const [error, setError] = useState("");

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

        setBriefing(briefingData);
        setArticles(newsData.items || []);

        if (!newsDate && briefingData?.effectiveDate) {
          setNewsDate(briefingData.effectiveDate);
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
  }, [newsDate]);

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

      {activeTab === "news" ? (
        <NewsPanel
          meta={meta}
          briefing={briefing}
          articles={articles}
          newsDate={newsDate}
          onNewsDateChange={(event) => setNewsDate(event.target.value)}
          error={error}
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
