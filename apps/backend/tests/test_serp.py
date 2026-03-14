from keyword_intel.serp import parse_google_serp_html


def test_parse_google_serp_html_extracts_core_signals() -> None:
    html = """
    <html>
      <body>
        <div>Sponsored</div>
        <a href="/url?q=https://shawq.co/products/hoodie&sa=U">
          <h3>Shawq Hoodie Collection</h3>
        </a>
        <a href="/url?q=https://competitor.example.com/hoodie&sa=U">
          <h3>Top Palestine Hoodie Deals</h3>
        </a>
        <div role="heading">What is the best Palestine hoodie?</div>
        <a href="/search?q=palestine+hoodie+gift&source=hp">palestine hoodie gift</a>
        <a href="/search?q=keffiyeh+hoodie&source=hp">keffiyeh hoodie</a>
      </body>
    </html>
    """
    payload = parse_google_serp_html(
        html=html,
        query="palestine hoodie",
        fetched_url="https://www.google.com/search?q=palestine+hoodie",
        gl="us",
        hl="en-US",
    )
    assert payload["status"] == "ok"
    assert payload["source"] == "google-html"
    assert payload["ads_count"] >= 1
    assert len(payload["organic_results"]) >= 2
    assert "shawq.co" in payload["competitor_domains"]
    assert "competitor.example.com" in payload["competitor_domains"]
    assert any("?" in item for item in payload["people_also_ask"])
    assert len(payload["related_searches"]) >= 2
