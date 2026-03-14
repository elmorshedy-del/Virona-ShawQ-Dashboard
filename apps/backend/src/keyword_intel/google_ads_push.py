from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlparse

import requests

from .models import AdGroup, StoreProfile
from .settings import ProviderSettings


GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com"


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _host_url(value: str) -> str:
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        return value
    return f"{parsed.scheme}://{parsed.netloc}"


def _to_micros(usd: float) -> int:
    return int(max(1_000_000, round(float(usd) * 1_000_000)))


@dataclass
class GoogleAdsCampaignPusher:
    settings: ProviderSettings
    _access_token: str = ""
    _access_token_expiry: float = 0.0

    def _get_access_token(self) -> str:
        now = time.time()
        if self._access_token and now < (self._access_token_expiry - 60):
            return self._access_token

        body = {
            "client_id": self.settings.google_ads_client_id,
            "client_secret": self.settings.google_ads_client_secret,
            "refresh_token": self.settings.google_ads_refresh_token,
            "grant_type": "refresh_token",
        }
        response = requests.post(
            GOOGLE_OAUTH_TOKEN_URL,
            data=body,
            timeout=self.settings.http_timeout_sec,
        )
        payload = response.json() if response.content else {}
        if not response.ok or "access_token" not in payload:
            message = payload.get("error_description") or payload.get("error") or response.text
            raise RuntimeError(f"oauth_exchange_failed:{message}")

        self._access_token = str(payload["access_token"])
        self._access_token_expiry = now + int(payload.get("expires_in", 3600))
        return self._access_token

    def _build_operations(
        self,
        *,
        profile: StoreProfile,
        ad_groups: list[AdGroup],
        customer_id: str,
        campaign_name: str,
    ) -> list[dict]:
        customer = "".join(ch for ch in customer_id if ch.isdigit())
        if not customer:
            raise RuntimeError("missing_google_ads_customer_id")

        operations: list[dict] = []
        temp_id = -1

        budget_id = temp_id
        temp_id -= 1
        budget_resource = f"customers/{customer}/campaignBudgets/{budget_id}"
        monthly_budget = sum(group.budget_usd_daily for group in ad_groups) * 30
        operations.append(
            {
                "campaignBudgetOperation": {
                    "create": {
                        "resourceName": budget_resource,
                        "name": f"{campaign_name} Budget {_utc_now_iso()}",
                        "deliveryMethod": "STANDARD",
                        "amountMicros": _to_micros(max(50.0, monthly_budget)),
                    }
                }
            }
        )

        campaign_id = temp_id
        temp_id -= 1
        campaign_resource = f"customers/{customer}/campaigns/{campaign_id}"
        operations.append(
            {
                "campaignOperation": {
                    "create": {
                        "resourceName": campaign_resource,
                        "name": campaign_name,
                        "status": "PAUSED",
                        "advertisingChannelType": "SEARCH",
                        "campaignBudget": budget_resource,
                        "manualCpc": {},
                    }
                }
            }
        )

        final_url = _host_url(profile.url)
        for group in ad_groups:
            ad_group_id = temp_id
            temp_id -= 1
            ad_group_resource = f"customers/{customer}/adGroups/{ad_group_id}"
            operations.append(
                {
                    "adGroupOperation": {
                        "create": {
                            "resourceName": ad_group_resource,
                            "name": group.name,
                            "status": "PAUSED",
                            "campaign": campaign_resource,
                            "type": "SEARCH_STANDARD",
                            "cpcBidMicros": _to_micros(max(0.25, group.budget_usd_daily / 12)),
                        }
                    }
                }
            )

            for keyword in group.keywords:
                match_type = group.keyword_match_types.get(keyword, "PHRASE")
                operations.append(
                    {
                        "adGroupCriterionOperation": {
                            "create": {
                                "adGroup": ad_group_resource,
                                "status": "ENABLED",
                                "keyword": {
                                    "text": keyword[:80],
                                    "matchType": match_type,
                                },
                            }
                        }
                    }
                )

            headlines = [
                {"text": item}
                for item in group.headlines[:15]
                if item and len(item) <= 30
            ]
            descriptions = [
                {"text": item}
                for item in group.descriptions[:4]
                if item and len(item) <= 90
            ]
            if len(headlines) >= 3 and len(descriptions) >= 2:
                operations.append(
                    {
                        "adGroupAdOperation": {
                            "create": {
                                "adGroup": ad_group_resource,
                                "status": "PAUSED",
                                "ad": {
                                    "finalUrls": [final_url],
                                    "responsiveSearchAd": {
                                        "headlines": headlines,
                                        "descriptions": descriptions,
                                    },
                                },
                            }
                        }
                    }
                )

        return operations

    def push_campaign(
        self,
        *,
        profile: StoreProfile,
        ad_groups: list[AdGroup],
        customer_id: str,
        campaign_name: str | None = None,
        dry_run: bool = True,
    ) -> dict:
        final_campaign_name = (
            campaign_name
            or f"Keyword Intel | {profile.url.split('://')[-1].split('/')[0]} | Search"
        )[:125]
        operations = self._build_operations(
            profile=profile,
            ad_groups=ad_groups,
            customer_id=customer_id,
            campaign_name=final_campaign_name,
        )

        if dry_run:
            return {
                "status": "dry_run",
                "campaign_name": final_campaign_name,
                "customer_id": "".join(ch for ch in customer_id if ch.isdigit()),
                "operation_count": len(operations),
                "operations": operations,
            }

        if not self.settings.google_ads_ready:
            raise RuntimeError(
                "google_ads_not_configured_for_push:missing_oauth_or_developer_token"
            )

        token = self._get_access_token()
        customer = "".join(ch for ch in customer_id if ch.isdigit())
        endpoint = (
            f"{GOOGLE_ADS_API_BASE}/{self.settings.google_ads_api_version}/customers/"
            f"{customer}/googleAds:mutate"
        )
        headers = {
            "Authorization": f"Bearer {token}",
            "developer-token": self.settings.google_ads_developer_token,
            "Content-Type": "application/json",
        }
        if self.settings.google_ads_login_customer_id:
            headers["login-customer-id"] = self.settings.google_ads_login_customer_id

        payload = {
            "mutateOperations": operations,
            "partialFailure": True,
            "validateOnly": False,
            "responseContentType": "MUTABLE_RESOURCE",
        }
        response = requests.post(
            endpoint,
            headers=headers,
            json=payload,
            timeout=max(30.0, self.settings.http_timeout_sec),
        )
        body = response.json() if response.content else {}
        if not response.ok:
            message = body.get("error") or body or response.text
            raise RuntimeError(f"google_ads_mutate_failed:{message}")
        return {
            "status": "ok",
            "campaign_name": final_campaign_name,
            "customer_id": customer,
            "operation_count": len(operations),
            "response": body,
        }
