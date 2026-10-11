"""Read-only Upbit authentication probe. No order endpoints are implemented."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid

import requests


class UpbitError(RuntimeError):
    def __init__(self, status, reason):
        super().__init__(reason)
        self.status, self.reason = status, reason


class UpbitHealthClient:
    def __init__(self, base_url, access_key, secret_key, timeout=10, session=None):
        self.base_url = base_url.rstrip("/")
        self.access_key, self.secret_key = access_key, secret_key
        self.timeout, self.session = timeout, session or requests.Session()

    def _token(self):
        # Parameter-free /accounts: HS512 JWT with a fresh nonce; no query_hash.
        def b64(data):
            return base64.urlsafe_b64encode(data).rstrip(b"=")
        header = b64(json.dumps({"alg": "HS512", "typ": "JWT"}, separators=(",", ":")).encode())
        payload = b64(json.dumps({"access_key": self.access_key, "nonce": str(uuid.uuid4())},
                                separators=(",", ":")).encode())
        body = header + b"." + payload
        signature = b64(hmac.new(self.secret_key.encode(), body, hashlib.sha512).digest())
        return (body + b"." + signature).decode()

    def check_account(self):
        response = self.session.get(self.base_url + "/v1/accounts",
            headers={"Authorization": "Bearer " + self._token()}, timeout=self.timeout)
        try:
            data = response.json()
        except ValueError:
            raise UpbitError(response.status_code, "응답 형식 오류") from None
        error = data.get("error") if isinstance(data, dict) else None
        if response.status_code >= 400 or error:
            name = error.get("name") if isinstance(error, dict) else None
            # Report only our own descriptions; raw API messages can contain credentials.
            reasons = {"no_authorization_ip": "허용 IP 확인 필요", "out_of_scope": "자산조회 권한 확인 필요",
                       "invalid_access_key": "API 키 인증 실패", "jwt_verification": "JWT 인증 실패",
                       "expired_access_key": "API 키 만료"}
            raise UpbitError(response.status_code, reasons.get(name, "인증·연결 확인 실패"))
        if not isinstance(data, list) or any(not isinstance(b, dict) or not {"currency", "balance", "locked"} <= b.keys() for b in data):
            raise UpbitError(response.status_code, "응답 형식 오류")
        # An empty authenticated balance array is also a valid connection result.
