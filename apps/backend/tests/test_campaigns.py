from keyword_intel.campaigns import build_ad_groups
from keyword_intel.models import KeywordMetric, Product, StoreProfile


def test_campaign_limits() -> None:
    profile = StoreProfile(
        url="https://example.com",
        platform="shopify",
        language="en",
        market="US",
        positioning="Example",
        products=[Product(name="Running Shoes")],
    )
    ranked = [
        KeywordMetric(
            keyword=f"buy running shoes {i}",
            volume=1000,
            cpc=1.4,
            competition_index=0.3,
            trend_direction="growing",
            competitor_density=0.2,
            buying_intent="transactional",
            relevance=0.9,
            score=80,
            hidden_gem=False,
            sources=["test"],
        )
        for i in range(12)
    ]
    groups = build_ad_groups(profile, ranked, target_groups=1)
    assert groups
    assert 5 <= len(groups[0].keywords) <= 15
    assert all(
        match_type in {"EXACT", "PHRASE", "BROAD"}
        for match_type in groups[0].keyword_match_types.values()
    )
    assert len(groups[0].headlines) <= 15
    assert len(groups[0].headlines) >= 3
    assert all(len(h) <= 30 for h in groups[0].headlines)
    assert len(groups[0].descriptions) <= 4
    assert len(groups[0].descriptions) >= 2
    assert all(len(d) <= 90 for d in groups[0].descriptions)
