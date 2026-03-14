import { useEffect, useState } from "react";

export default function App() {
  const [health, setHealth] = useState("checking");

  useEffect(() => {
    let ignore = false;

    fetch("/api/health")
      .then((response) => response.json())
      .then((data) => {
        if (!ignore) {
          setHealth(data.status || "ok");
        }
      })
      .catch(() => {
        if (!ignore) {
          setHealth("unreachable");
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Frontend / Backend Split</p>
        <h1>Jaybee Lab Starter</h1>
        <p className="description">
          프론트엔드와 백엔드를 분리해서 각각 커져도 관리하기 쉬운 구조로 구성했습니다.
          프론트는 React와 Vite, 백엔드는 Express API, 라우팅은 Nginx가 담당합니다.
        </p>
        <div className="statusRow">
          <span className="label">API status</span>
          <strong className={`badge badge-${health}`}>{health}</strong>
        </div>
        <div className="actions">
          <a href="/api/health" target="_blank" rel="noreferrer">
            Open Health API
          </a>
          <span>Route / goes to frontend, /api goes to backend</span>
        </div>
      </section>
    </main>
  );
}
