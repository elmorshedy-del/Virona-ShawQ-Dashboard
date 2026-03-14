from keyword_intel.competitors import build_competitor_intelligence, canonicalize_domain
from keyword_intel.models import KeywordMetric, SourceEvidence


def _metric(keyword: str, score: float, volume: int = 2000, cpc: float = 1.6) -> KeywordMetric:
    return KeywordMetric(
        keyword=keyword,
        volume=volume,
        cpc=cpc,
        competition_index=0.45,
        trend_direction="growing",
        competitor_density=0.5,
        buying_intent="transactional",
        relevance=0.9,
        score=score,
        confidence=72.0,
    )


def test_canonicalize_domain() -> None:
    assert canonicalize_domain("https://www.example.com/path") == "example.com"
    assert canonicalize_domain("example.com") == "example.com"


def test_build_competitor_intelligence_outputs_gaps() -> None:
    ranked = [
        _metric("buy palestine hoodie", 82.0),
        _metric("keffiyeh hoodie", 74.0),
    ]
    evidence_map = {
        "buy palestine hoodie": {
            "custom-serp": SourceEvidence(
                source="custom-serp",
                observed_at="2026-02-19T00:00:00+00:00",
                competitor_domains=["shawq.co", "competitor-one.com", "competitor-two.com"],
                related_searches=["palestine hoodie gift", "hoodie for men"],
                people_also_ask=["what is best palestine hoodie?"],
                ad_copies=[
                    {
                        "headline": "Premium Palestine Hoodies",
                        "description": "Fast shipping and limited drops",
                        "domain": "competitor-one.com",
                        "landing_page": "https://competitor-one.com/hoodies",
                    }
                ],
            )
        },
        "keffiyeh hoodie": {
            "custom-serp": SourceEvidence(
                source="custom-serp",
                observed_at="2026-02-19T00:00:00+00:00",
                competitor_domains=["competitor-one.com", "competitor-three.com"],
                related_searches=["keffiyeh hoodie sale"],
                ad_copies=[
                    {
                        "headline": "Limited Keffiyeh Drop",
                        "description": "Secure checkout and premium quality",
                        "domain": "competitor-three.com",
                        "landing_page": "https://competitor-three.com/drop",
                    }
                ],
            )
        },
    }

    intel = build_competitor_intelligence(
        ranked_keywords=ranked,
        evidence_map=evidence_map,
        store_domain="shawq.co",
        brand_positioning="Shawq premium cultural apparel",
    )
    assert intel.discovered_competitors
    assert intel.discovered_competitors[0].domain in {
        "competitor-one.com",
        "competitor-three.com",
        "competitor-two.com",
    }
    assert intel.keyword_gaps
    assert any("gift" in gap.keyword for gap in intel.keyword_gaps)
    assert intel.ad_copy_gaps
