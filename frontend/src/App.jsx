import { useEffect, useState } from "react";

function formatDate(value) {
  if (!value) {
    return "방금";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function HealthPill({ health }) {
  return (
    <strong className={`badge badge-${health}`}>
      {health === "checking" ? "checking" : health}
    </strong>
  );
}

export default function App() {
  const [health, setHealth] = useState("checking");
  const [meta, setMeta] = useState(null);
  const [briefing, setBriefing] = useState(null);
  const [articles, setArticles] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const [healthResponse, briefingResponse, newsResponse] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/briefing/latest"),
          fetch("/api/news?limit=12")
        ]);

        if (!healthResponse.ok || !briefingResponse.ok || !newsResponse.ok) {
          throw new Error("대시보드 데이터를 불러오지 못했습니다.");
        }

        const [healthData, briefingData, newsData] = await Promise.all([
          healthResponse.json(),
          briefingResponse.json(),
          newsResponse.json()
        ]);

        if (ignore) {
          return;
        }

        setHealth(healthData.status || "ok");
        setMeta(healthData);
        setBriefing(briefingData);
        setArticles(newsData.items || []);
        setError("");
      } catch (loadError) {
        if (!ignore) {
          setHealth("unreachable");
          setError(loadError.message);
        }
      }
    }

    load();
    const timer = window.setInterval(load, 60000);

    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, []);

  const latestRun = briefing?.latestRun;
  const spotlight = briefing?.spotlight || [];
  const categories = briefing?.categories || [];

  return (
    <main className="page">
      <section className="hero">
        <div className="heroHeader">
          <div>
            <p className="eyebrow">Automated News Briefing</p>
            <h1>시장과 시사를 한 번에 보는 AI 뉴스 대시보드</h1>
          </div>
          <HealthPill health={health} />
        </div>

        <p className="description">
          워커가 주기적으로 RSS 뉴스를 수집하고, 요약이 준비되면 API를 통해
          프론트에 노출합니다. OpenAI 키가 연결되면 한국어 AI 요약을 사용하고,
          없으면 기본 요약으로 계속 동작합니다.
        </p>

        <div className="statsGrid">
          <article className="statCard">
            <span className="statLabel">Scheduler</span>
            <strong className="statValue">
              {meta?.scheduler?.intervalMinutes || "-"} min
            </strong>
            <span className="statHint">수집 주기</span>
          </article>
          <article className="statCard">
            <span className="statLabel">Feeds</span>
            <strong className="statValue">
              {meta?.scheduler?.feedCount || 0}
            </strong>
            <span className="statHint">활성 RSS 소스</span>
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
            <span className="statHint">최근 브리핑 기준</span>
          </article>
        </div>

        <div className="actions">
          <a href="/api/briefing/latest" target="_blank" rel="noreferrer">
            Latest Briefing API
          </a>
          <a href="/api/news?limit=12" target="_blank" rel="noreferrer">
            News Feed API
          </a>
        </div>

        {latestRun ? (
          <div className="runSummary">
            <span>마지막 수집: {formatDate(latestRun.finishedAt || latestRun.startedAt)}</span>
            <span>seen {latestRun.articlesSeen}</span>
            <span>new {latestRun.articlesInserted}</span>
            <span>summarized {latestRun.articlesSummarized}</span>
            <span className={`runStatus runStatus-${latestRun.status}`}>
              {latestRun.status}
            </span>
          </div>
        ) : (
          <div className="runSummary">
            <span>첫 수집 작업이 아직 끝나지 않았습니다.</span>
          </div>
        )}

        {error ? <p className="errorMessage">{error}</p> : null}
      </section>

      <section className="contentGrid">
        <div className="panel spotlightPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionEyebrow">Spotlight</p>
              <h2>방금 주목할 만한 기사</h2>
            </div>
          </div>
          <div className="spotlightList">
            {spotlight.length > 0 ? (
              spotlight.map((article) => (
                <article className="spotlightCard" key={article.id}>
                  <div className="cardMeta">
                    <span>{article.categoryLabel}</span>
                    <span>{article.sourceName}</span>
                    <span>{formatDate(article.publishedAt)}</span>
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
              <div className="emptyState">
                워커가 뉴스를 수집하고 있습니다. 잠시 후 새로고침해 보세요.
              </div>
            )}
          </div>
        </div>

        <div className="panel categoryPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionEyebrow">Categories</p>
              <h2>분야별 브리핑</h2>
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
                        <span>{formatDate(article.publishedAt)}</span>
                      </div>
                      <h4>{article.title}</h4>
                      <p>{article.summary || article.description}</p>
                    </article>
                  ))
                ) : (
                  <div className="emptyState small">
                    아직 수집된 항목이 없습니다.
                  </div>
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
            <h2>최근 기사 목록</h2>
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
                    <span>{formatDate(article.publishedAt)}</span>
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
            <div className="emptyState">
              아직 보여줄 뉴스가 없습니다. 워커가 첫 수집을 마칠 때까지 기다려 주세요.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
