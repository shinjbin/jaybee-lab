export default function App() {
  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">React + Docker + Nginx</p>
        <h1>샘플 React 배포 앱</h1>
        <p className="description">
          이 화면은 Vite로 빌드된 React 정적 파일을 Express가 서빙하고,
          바깥쪽에서는 Nginx가 리버스 프록시로 연결하는 구조입니다.
        </p>
        <div className="actions">
          <a href="/health" target="_blank" rel="noreferrer">
            Health Check
          </a>
          <span>GitHub Actions로 자동 배포 가능</span>
        </div>
      </section>
    </main>
  );
}
