# Telegram deployment notifications

jaybee-lab-prod가 배포를 시작하거나 완료 또는 실패하면 자동매매 봇과
같은 Telegram 대화방으로 알림을 보냅니다. 알림에는 배포 리비전, Git 작성자,
커밋 메시지, 그리고 GitHub Actions가 기록한 변경 파일 목록이 포함됩니다.

## 1. 기존 자동매매 Telegram 자격 증명 재사용

자동매매용 Secret은 jaybee-lab 네임스페이스에 있고 Argo CD Notifications는
argocd 네임스페이스에서 실행됩니다. Kubernetes Secret은 네임스페이스를
넘어 직접 참조할 수 없으므로, 기존 값을 출력하지 않고 Argo CD 전용 Secret으로
복사합니다.

~~~bash
TELEGRAM_BOT_TOKEN="$(kubectl -n jaybee-lab get secret jaybee-secret \
  -o jsonpath='{.data.TELEGRAM_BOT_TOKEN}' | base64 -d)"
TELEGRAM_CHAT_ID="$(kubectl -n jaybee-lab get secret jaybee-secret \
  -o jsonpath='{.data.TELEGRAM_CHAT_ID}' | base64 -d)"

kubectl -n argocd create secret generic argocd-notifications-secret \
  --from-literal=telegram-token="$TELEGRAM_BOT_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -
~~~

실제 토큰은 Git에 커밋하지 않습니다.

## 2. 알림 설정 적용

~~~bash
kubectl apply -k k8s/argocd

kubectl -n argocd annotate application jaybee-lab-prod \
  "notifications.argoproj.io/subscribe.jaybee-on-deployment-started.telegram=$TELEGRAM_CHAT_ID" \
  "notifications.argoproj.io/subscribe.jaybee-on-deployment-succeeded.telegram=$TELEGRAM_CHAT_ID" \
  "notifications.argoproj.io/subscribe.jaybee-on-deployment-failed.telegram=$TELEGRAM_CHAT_ID" \
  --overwrite
~~~

Argo CD 설치에 Notifications Controller가 포함돼 있어야 합니다.

~~~bash
kubectl -n argocd get deployment argocd-notifications-controller
~~~

## 3. 확인

~~~bash
kubectl -n argocd get application jaybee-lab-prod \
  -o jsonpath='{.metadata.annotations}' && echo
kubectl -n argocd get configmap argocd-notifications-cm
kubectl -n argocd logs deployment/argocd-notifications-controller --tail=100
~~~

배포 시작과 완료 알림은 리비전마다 한 번만 전송됩니다. 실패 알림도 실패한
리비전마다 한 번만 전송됩니다.
