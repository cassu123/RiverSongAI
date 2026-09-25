"""
The news feed shows each story once.

Every BBC story was showing twice on the Feeds page. Either cause does it:
BBC News saved twice in a user's sources, or the feed itself listing a story
twice under slightly different links. fetch_articles de-duplicated nothing.
"""
import asyncio

import providers.feeds.news as news


def _story(title, url, source="BBC News", when="2026-09-25T20:27:00+00:00"):
    return {"id": news._article_id(url), "title": title, "summary": "",
            "url": url, "source": source, "published_at": when, "image_url": ""}


def _run(monkeypatch, sources, by_url):
    calls = []

    async def fake_fetch(url, name, limit=10):
        calls.append(url)
        return [dict(a) for a in by_url.get(url, [])]

    monkeypatch.setattr(news, "fetch_rss_feed", fake_fetch)
    return asyncio.run(news.fetch_articles(sources)), calls


BBC = {"name": "BBC News", "url": "https://feeds.bbci.co.uk/news/rss.xml", "category": "world"}


def test_a_source_saved_twice_is_fetched_once(monkeypatch):
    stories = [_story("Watch: two leaders met", "https://www.bbc.com/news/videos/a1")]
    arts, calls = _run(monkeypatch, [BBC, dict(BBC)], {BBC["url"]: stories})
    assert calls == [BBC["url"]]
    assert [a["title"] for a in arts] == ["Watch: two leaders met"]


def test_the_same_story_under_two_links_shows_once(monkeypatch):
    stories = [
        _story("Media outlets banned", "https://www.bbc.com/news/articles/c1?at_medium=RSS&at_campaign=rss"),
        _story("Media outlets banned", "https://www.bbc.co.uk/news/articles/c1#0"),
        _story("Netanyahu defends action", "https://www.bbc.com/news/articles/c2#0"),
        _story("Netanyahu defends action", "https://www.bbc.com/news/articles/c2#1"),
    ]
    arts, _ = _run(monkeypatch, [BBC], {BBC["url"]: stories})
    assert [a["title"] for a in arts] == ["Media outlets banned", "Netanyahu defends action"]


def test_different_stories_all_stay(monkeypatch):
    other = {"name": "NPR", "url": "https://feeds.npr.org/1001/rss.xml", "category": "world"}
    arts, _ = _run(monkeypatch, [BBC, other], {
        BBC["url"]: [_story("One", "https://www.bbc.com/news/articles/c1"),
                     _story("Two", "https://www.bbc.com/news/articles/c2")],
        # Same headline from a different outlet is a different article.
        other["url"]: [_story("One", "https://www.npr.org/2026/09/25/one", source="NPR")],
    })
    assert len(arts) == 3


def test_a_real_query_string_still_tells_articles_apart(monkeypatch):
    arts, _ = _run(monkeypatch, [BBC], {BBC["url"]: [
        _story("A", "https://example.com/story.php?id=1"),
        _story("B", "https://example.com/story.php?id=2"),
    ]})
    assert len(arts) == 2


def test_stories_without_links_are_not_merged(monkeypatch):
    arts, _ = _run(monkeypatch, [BBC], {BBC["url"]: [_story("A", ""), _story("B", "")]})
    assert len(arts) == 2
