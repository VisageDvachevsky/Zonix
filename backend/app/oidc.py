from __future__ import annotations

from base64 import urlsafe_b64decode, urlsafe_b64encode
from dataclasses import dataclass
from hashlib import sha256
from hmac import compare_digest
from hmac import new as hmac_new
from json import dumps, loads
from time import time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.domain.models import IdentityProvider, PermissionGrant, Role, ZoneAction
from app.identity_providers import IdentityProviderService


class OIDCProviderNotFoundError(RuntimeError):
    def __init__(self, provider_name: str) -> None:
        super().__init__(f"identity provider '{provider_name}' is not configured")


class OIDCStateError(RuntimeError):
    pass


class OIDCExchangeError(RuntimeError):
    pass


@dataclass(frozen=True)
class OIDCLoginRequest:
    provider_name: str
    authorization_url: str


@dataclass(frozen=True)
class OIDCIdentity:
    username: str
    claims: dict[str, object]


@dataclass(frozen=True)
class OIDCMappingResult:
    role: Role
    grants: tuple[PermissionGrant, ...]


class OIDCStateManager:
    def __init__(self, secret_key: str, ttl_seconds: int = 600) -> None:
        if not secret_key:
            raise ValueError("oidc state secret key must not be empty")
        if ttl_seconds <= 0:
            raise ValueError("oidc state ttl must be positive")
        self.secret_key = secret_key.encode("utf-8")
        self.ttl_seconds = ttl_seconds

    def issue(self, provider_name: str) -> str:
        payload = {
            "provider": provider_name,
            "exp": int(time()) + self.ttl_seconds,
        }
        encoded_payload = self._encode_json(payload)
        signature = self._sign(encoded_payload)
        return f"{encoded_payload}.{signature}"

    def validate(self, state: str, provider_name: str) -> None:
        if "." not in state:
            raise OIDCStateError("oidc state is malformed")
        encoded_payload, signature = state.split(".", maxsplit=1)
        expected_signature = self._sign(encoded_payload)
        if not compare_digest(signature, expected_signature):
            raise OIDCStateError("oidc state signature is invalid")

        payload = self._decode_json(encoded_payload)
        if int(payload["exp"]) < int(time()):
            raise OIDCStateError("oidc state has expired")
        if str(payload["provider"]) != provider_name:
            raise OIDCStateError("oidc state does not match provider")

    def _sign(self, encoded_payload: str) -> str:
        digest = hmac_new(self.secret_key, encoded_payload.encode("ascii"), sha256).digest()
        return urlsafe_b64encode(digest).decode("ascii").rstrip("=")

    @staticmethod
    def _encode_json(payload: dict[str, object]) -> str:
        raw = dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    @staticmethod
    def _decode_json(encoded_payload: str) -> dict[str, object]:
        padding = "=" * (-len(encoded_payload) % 4)
        raw = urlsafe_b64decode(f"{encoded_payload}{padding}".encode("ascii"))
        payload = loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise OIDCStateError("oidc state payload is invalid")
        return payload


class OIDCClient:
    def fetch_json(self, url: str, headers: dict[str, str] | None = None) -> dict[str, object]:
        request = Request(url, headers=headers or {}, method="GET")
        with urlopen(request, timeout=5.0) as response:
            payload = loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise OIDCExchangeError("oidc endpoint returned non-object json")
        return payload

    def post_form(self, url: str, data: dict[str, str]) -> dict[str, object]:
        request = Request(
            url,
            data=urlencode(data).encode("utf-8"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urlopen(request, timeout=5.0) as response:
            payload = loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise OIDCExchangeError("oidc token endpoint returned non-object json")
        return payload


class OIDCService:
    def __init__(
        self,
        identity_provider_service: IdentityProviderService,
        state_manager: OIDCStateManager,
        client: OIDCClient | None = None,
    ) -> None:
        self.identity_provider_service = identity_provider_service
        self.state_manager = state_manager
        self.client = client or OIDCClient()

    def list_providers(self) -> tuple[IdentityProvider, ...]:
        return self.identity_provider_service.list_providers()

    def begin_login(self, provider_name: str, redirect_uri: str) -> OIDCLoginRequest:
        provider = self._require_provider(provider_name)
        metadata = self._discover(provider)
        state = self.state_manager.issue(provider.name)
        authorization_endpoint = self._require_string(metadata, "authorization_endpoint")
        query = urlencode(
            {
                "response_type": "code",
                "client_id": provider.client_id,
                "redirect_uri": redirect_uri,
                "scope": " ".join(provider.scopes),
                "state": state,
            }
        )
        return OIDCLoginRequest(
            provider_name=provider.name,
            authorization_url=f"{authorization_endpoint}?{query}",
        )

    def complete_login(
        self,
        *,
        provider_name: str,
        code: str,
        state: str,
        redirect_uri: str,
    ) -> OIDCIdentity:
        provider = self._require_provider(provider_name)
        self.state_manager.validate(state, provider.name)
        metadata = self._discover(provider)
        token_endpoint = self._require_string(metadata, "token_endpoint")
        token_response = self.client.post_form(
            token_endpoint,
            {
                "grant_type": "authorization_code",
                "code": code,
                "client_id": provider.client_id,
                "client_secret": provider.client_secret,
                "redirect_uri": redirect_uri,
            },
        )
        claims = self._resolve_claims(metadata, token_response)
        username = self._resolve_username(provider, claims)
        return OIDCIdentity(username=username, claims=claims)

    def map_identity(
        self,
        *,
        provider_name: str,
        identity: OIDCIdentity,
        known_zones: tuple[str, ...],
    ) -> OIDCMappingResult:
        provider = self._require_provider(provider_name)
        rules = provider.claims_mapping_rules
        groups = self._extract_groups(identity.claims, rules)

        role = Role.VIEWER
        if self._matches_any_group(groups, rules.get("adminGroups")):
            role = Role.ADMIN

        grants: list[PermissionGrant] = []
        if role != Role.ADMIN:
            for zone_name in known_zones:
                zone_actions: list[ZoneAction] = []
                if self._matches_zone_pattern(groups, rules.get("zoneEditorPattern"), zone_name):
                    zone_actions.append(ZoneAction.WRITE)
                elif self._matches_zone_pattern(groups, rules.get("zoneViewerPattern"), zone_name):
                    zone_actions.append(ZoneAction.READ)

                if zone_actions:
                    grants.append(
                        PermissionGrant(
                            username=identity.username,
                            zone_name=zone_name,
                            actions=tuple(zone_actions),
                        )
                    )

        if role != Role.ADMIN and any(ZoneAction.WRITE in grant.actions for grant in grants):
            role = Role.EDITOR

        return OIDCMappingResult(role=role, grants=tuple(grants))

    def _resolve_claims(
        self,
        metadata: dict[str, object],
        token_response: dict[str, object],
    ) -> dict[str, object]:
        userinfo_endpoint = metadata.get("userinfo_endpoint")
        access_token = token_response.get("access_token")
        if isinstance(userinfo_endpoint, str) and isinstance(access_token, str):
            claims = self.client.fetch_json(
                userinfo_endpoint,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if claims:
                return claims

        id_token = token_response.get("id_token")
        if isinstance(id_token, str):
            raise OIDCExchangeError(
                "oidc token response only included id_token; signed id_token validation is required and not implemented"
            )

        raise OIDCExchangeError("oidc token response did not contain usable identity claims")

    def _discover(self, provider: IdentityProvider) -> dict[str, object]:
        discovery_url = f"{provider.issuer.rstrip('/')}/.well-known/openid-configuration"
        return self.client.fetch_json(discovery_url)

    def _require_provider(self, provider_name: str) -> IdentityProvider:
        provider = self.identity_provider_service.get_provider(provider_name)
        if provider is None:
            raise OIDCProviderNotFoundError(provider_name)
        return provider

    @staticmethod
    def _require_string(payload: dict[str, object], key: str) -> str:
        value = payload.get(key)
        if not isinstance(value, str) or not value:
            raise OIDCExchangeError(f"oidc metadata field '{key}' is missing")
        return value

    @staticmethod
    def _resolve_username(provider: IdentityProvider, claims: dict[str, object]) -> str:
        username_claim = provider.claims_mapping_rules.get("usernameClaim")
        if isinstance(username_claim, str):
            value = claims.get(username_claim)
            if isinstance(value, str) and value.strip():
                return value.strip()

        for key in ("preferred_username", "email", "sub"):
            value = claims.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise OIDCExchangeError("oidc claims do not include a usable username")

    @staticmethod
    def _extract_groups(
        claims: dict[str, object],
        rules: dict[str, object],
    ) -> tuple[str, ...]:
        claim_name = rules.get("rolesClaim", "groups")
        if not isinstance(claim_name, str) or not claim_name:
            return ()
        raw_value = claims.get(claim_name)
        if not isinstance(raw_value, list):
            return ()
        groups: list[str] = []
        for item in raw_value:
            if isinstance(item, str) and item.strip() and item.strip() not in groups:
                groups.append(item.strip())
        return tuple(groups)

    @staticmethod
    def _matches_any_group(groups: tuple[str, ...], configured: object) -> bool:
        if not isinstance(configured, list):
            return False
        wanted = {item.strip() for item in configured if isinstance(item, str) and item.strip()}
        return bool(wanted.intersection(groups))

    @staticmethod
    def _matches_zone_pattern(
        groups: tuple[str, ...],
        pattern: object,
        zone_name: str,
    ) -> bool:
        if not isinstance(pattern, str) or "{zone}" not in pattern:
            return False
        expected_group = pattern.replace("{zone}", zone_name)
        return expected_group in groups
