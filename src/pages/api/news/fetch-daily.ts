import type { APIRoute } from 'astro';
import * as Sentry from '@sentry/astro';
import { connectDB } from '../../../lib/mongodb';
import { checkAirLoggerFreshness } from '../../../lib/kiez/airFreshness';
import { announceNewBlogPosts } from '../../../lib/blog/blogNotify';
import { sendForumDigest } from '../../../lib/forum/forumNotify';
import { sendKiezBrief } from '../../../lib/newsletter/kiezBrief';
import type { NewsItem } from '../../../types';
import { decodeHtmlEntities } from '../../../utils/decodeHtmlEntities';
import crypto from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

interface FetchedArticle {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  sourceName: string;
  publishedAt: string;
  category?: string;
}

interface ScoredArticle extends FetchedArticle {
  relevanceScore: number;
  aiCategory: string;
  aiReason: string;
  aiSummary: string;
}

// ============================================================================
// RSS PARSING
// ============================================================================

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'))
    || xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

function isJunkImage(url: string): boolean {
  return /gravatar\.com|\/mu\.gif|\/avatar\//i.test(url)
    || /\bs=\d{1,2}\b/.test(url); // tiny images like s=96
}

function cleanWpImageUrl(url: string): string {
  // WordPress.com feeds append ?w=100 etc. for thumbnails — remove to get full-size
  return url.replace(/\?w=\d+(&.*)?$/, '');
}

function extractImageFromItem(xml: string): string | undefined {
  // Try all media:content or media:thumbnail tags (some feeds put junk avatars first)
  const mediaMatches = xml.matchAll(/<media:(?:content|thumbnail)[^>]+url=["']([^"']+)["']/gi);
  for (const match of mediaMatches) {
    const url = match[1].replace(/&#38;/g, '&');
    if (!isJunkImage(url)) return cleanWpImageUrl(url);
  }

  // Try enclosure
  const enclosureMatch = xml.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
  if (enclosureMatch && !isJunkImage(enclosureMatch[1])) return enclosureMatch[1];

  // Try <image><url> block
  const imgMatch = xml.match(/<image>[^]*?<url>([^<]+)<\/url>/i);
  if (imgMatch && !isJunkImage(imgMatch[1])) return imgMatch[1];

  // Fallback: extract first <img src> from description HTML (e.g. WordPress feeds)
  const htmlImgMatch = xml.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (htmlImgMatch && !isJunkImage(htmlImgMatch[1])) {
    // Prefer larger image — try to get the original URL from <a href> wrapping the img
    const linkedImgMatch = xml.match(/<a[^>]+href=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["'][^>]*>\s*<img/i);
    if (linkedImgMatch && !isJunkImage(linkedImgMatch[1])) return linkedImgMatch[1];
    return htmlImgMatch[1];
  }

  return undefined;
}

async function scrapeOgImage(articleUrl: string): Promise<string | undefined> {
  try {
    const response = await fetch(articleUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mahalle-News-Bot/1.0' },
    });
    if (!response.ok) return undefined;

    // Read only first 20KB to find og:image (it's always in <head>)
    const reader = response.body?.getReader();
    if (!reader) return undefined;

    let html = '';
    while (html.length < 20000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
    }
    reader.cancel();

    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return ogMatch?.[1] || undefined;
  } catch {
    return undefined;
  }
}

async function fetchRSS(feedUrl: string, sourceName: string): Promise<FetchedArticle[]> {
  try {
    const response = await fetch(feedUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mahalle-News-Bot/1.0' },
    });

    if (!response.ok) {
      console.error(`RSS fetch failed for ${sourceName}: ${response.status}`);
      return [];
    }

    const xml = await response.text();

    // Split into items
    const items = xml.split(/<item[\s>]/i).slice(1);
    const articles: FetchedArticle[] = [];

    for (const item of items.slice(0, 30)) { // Max 30 per feed
      // Feeds deliver entity-encoded punctuation („ as &#8222;). Decode at
      // ingest with the shared decoder — the old inline chain only knew five
      // named entities, passed numeric ones through (the literal "&#8222;" on
      // the newsboard), and ran &amp; FIRST (double-decoding &amp;lt; to "<").
      const title = decodeHtmlEntities(extractTag(item, 'title'));
      const link = extractTag(item, 'link');
      const description = decodeHtmlEntities(
        extractTag(item, 'description').replace(/<[^>]+>/g, '') // Strip HTML tags BEFORE decoding
      )
        .replace(/mehr\.\.\.$/, '') // taz "mehr..." suffix
        .trim()
        .substring(0, 500);
      const pubDate = extractTag(item, 'pubDate');
      const category = extractTag(item, 'category');
      const imageUrl = extractImageFromItem(item);

      if (title && link) {
        articles.push({
          title,
          description: description || title,
          url: link,
          imageUrl,
          sourceName,
          publishedAt: pubDate || new Date().toISOString(),
          category: category || undefined,
        });
      }
    }

    return articles;
  } catch (error) {
    console.error(`RSS error for ${sourceName}:`, error);
    return [];
  }
}

// ============================================================================
// NEWSDATA.IO API
// ============================================================================

async function fetchNewsDataIO(apiKey: string): Promise<FetchedArticle[]> {
  const articles: FetchedArticle[] = [];

  // Separate queries: OR logic not supported, so split into focused queries
  const queries = [
    'q=Neukölln OR Kreuzberg OR Schillerkiez&country=de&language=de',
    'q=Berlin&country=de&language=de&category=politics,environment,health,education',
    'q=Berlin&country=de&language=de&category=business,science,entertainment',
  ];

  for (const query of queries) {
    try {
      const url = `https://newsdata.io/api/1/latest?apikey=${apiKey}&${query}&size=10`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error(`NewsData.io query failed: ${response.status}`);
        continue;
      }

      const data = await response.json();

      if (data.results) {
        for (const item of data.results) {
          articles.push({
            // NewsData delivers entity-encoded punctuation („ as &#8222;) —
            // decode at ingest so dedup-by-title and the stored doc see real text.
            title: decodeHtmlEntities(item.title || ''),
            description: decodeHtmlEntities(item.description || item.title || ''),
            url: item.link || '',
            imageUrl: item.image_url || undefined,
            sourceName: item.source_id || 'NewsData.io',
            publishedAt: item.pubDate || new Date().toISOString(),
            category: Array.isArray(item.category) ? item.category[0] : item.category,
          });
        }
      }
    } catch (error) {
      console.error('NewsData.io error:', error);
    }
  }

  return articles;
}

// ============================================================================
// GPT-4o RELEVANCE SCORING
// ============================================================================

async function scoreArticlesWithGPT(
  articles: FetchedArticle[],
  openaiKey: string
): Promise<{ scored: ScoredArticle[]; degraded: boolean }> {
  if (articles.length === 0) return { scored: [], degraded: false };

  const articleList = articles.map((a, i) => ({
    id: i,
    title: a.title,
    description: a.description.substring(0, 200),
    source: a.sourceName,
    category: a.category || 'unknown',
  }));

  const prompt = `You are a strict news curator for "Mahalle", a community platform for Schillerkiez neighborhood in Neukölln, Berlin, Germany.

ONLY select news that is directly relevant to Berlin and its residents. Be very strict with scoring:
- 90-100: Directly about Schillerkiez, Neukölln, Kreuzberg, or Tempelhof
- 80-89: Berlin city-wide news (transport, politics, events, housing, culture)
- 70-79: News that significantly affects Berlin residents (Berlin-Brandenburg region, major German policy affecting Berlin)
- 0-69: NOT relevant — national/international news without direct Berlin connection, general German politics, sports, celebrity news, business news without local impact

Be strict: most articles should score below 70. Only pass articles a Berlin neighborhood resident would genuinely care about.

Assign a category: local, city, regional, culture, environment, politics, health, education, housing, transport, community

For each article, write a 2-3 sentence summary in German that explains the key points so readers understand the topic without needing to read the full (often paywalled) article. The summary should be informative and neutral.

Return JSON array only, no markdown. Format:
[{"id": 0, "score": 85, "category": "city", "reason": "2-3 word reason", "summary": "German summary here..."}]

Articles:
${JSON.stringify(articleList)}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`GPT-4o scoring failed: ${response.status}`);
      // Fallback: return all articles with default score (below threshold)
      return {
        degraded: true,
        scored: articles.map(a => ({
          ...a,
          relevanceScore: 50,
          aiCategory: a.category || 'unknown',
          aiReason: 'AI scoring unavailable',
          aiSummary: '',
        })),
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '[]';

    // Parse JSON — handle potential markdown wrapping
    const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const scores: Array<{ id: number; score: number; category: string; reason: string; summary: string }> = JSON.parse(jsonStr);

    const scoreMap = new Map(scores.map(s => [s.id, s]));

    return {
      degraded: false,
      scored: articles.map((article, i) => {
        const score = scoreMap.get(i);
        return {
          ...article,
          relevanceScore: score?.score ?? 50,
          aiCategory: score?.category ?? article.category ?? 'unknown',
          aiReason: score?.reason ?? 'unscored',
          aiSummary: score?.summary ?? '',
        };
      }),
    };
  } catch (error) {
    console.error('GPT-4o scoring error:', error);
    return {
      degraded: true,
      scored: articles.map(a => ({
        ...a,
        relevanceScore: 50,
        aiCategory: a.category || 'unknown',
        aiReason: 'AI scoring error',
        aiSummary: '',
      })),
    };
  }
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

function hashUrl(url: string): string {
  return crypto.createHash('md5').update(url.toLowerCase().trim()).digest('hex');
}

// ============================================================================
// MAIN ENDPOINT
// ============================================================================

const RELEVANCE_THRESHOLD = 70;
const MAX_DAILY_ARTICLES = 20;

export const GET: APIRoute = async ({ request }) => {
  try {
    // Verify cron secret (Vercel sends this header for cron jobs)
    const authHeader = request.headers.get('authorization');
    const cronSecret = import.meta.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Piggy-backed watchdog, unrelated to news: alerts if the GitHub-Actions
    // air logger has gone silent. It rides this cron because Vercel-native
    // schedules can't be broken by a domain/alias change — the failure mode
    // that killed the logger unnoticed for two days. Runs before the early
    // returns below so a news-side outage can't also blind the air check.
    await checkAirLoggerFreshness();
    // Also unrelated to news: announce a blog post nobody has opened yet since the deploy
    // (the blog pages do the same on their first visit). Never throws.
    await announceNewBlogPosts();

  // The forum digest rides the same morning job: once per Berlin day (the afternoon
  // run of this route finds the day claimed), never throws.
  await sendForumDigest();

  // The weekly member mail rides this job twice: (1) on ANY day it sends the next GROUP of an
  // issue whose members are still waiting (groups of 75, one per UTC day); (2) on a Berlin Monday,
  // when Sunday's GitHub run never claimed the issue, it starts the issue itself (the key is the
  // ISO week of now − 24 h, so Monday morning still belongs to Sunday's issue). Never throws.
  await sendKiezBrief({ fallback: true });

    const openaiKey = import.meta.env.OPENAI_API_KEY;
    const newsDataKey = import.meta.env.NEWSDATA_API_KEY;

    if (!openaiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('[fetch-daily] Starting daily news fetch...');

    // Step 1: Fetch from all sources in parallel
    const rssFeeds: Array<[string, string]> = [
      ['https://www.tagesspiegel.de/contentexport/feed/home', 'Tagesspiegel'],
      ['https://www.berliner-zeitung.de/feed.xml', 'Berliner Zeitung'],
      ['https://www.berliner-kurier.de/feed.xml', 'Berliner Kurier'],
      ['https://www.nd-aktuell.de/rss/berlin.xml', 'nd-aktuell'],
      ['https://taz.de/!p4608;rss/', 'taz'],
      ['https://www.kiezundkneipe.de/feed', 'Kiez und Kneipe'],
      ['https://www.schillerpromenade.berlin/feed/', 'Schillerpromenade'],
      ['https://facettenneukoelln.wordpress.com/feed/', 'Facetten Neukölln'],
      ['https://proschillerkiezblog.wordpress.com/feed/', 'Pro Schillerkiez'],
    ];

    const rssResults = await Promise.all(
      rssFeeds.map(([url, name]) => fetchRSS(url, name))
    );
    const newsApiArticles = newsDataKey ? await fetchNewsDataIO(newsDataKey) : [];

    const rssArticles = rssResults.flat();
    const allArticles = [...rssArticles, ...newsApiArticles];
    console.log(`[fetch-daily] Fetched ${allArticles.length} articles (RSS: ${rssArticles.length}, API: ${newsApiArticles.length})`);

    if (allArticles.length === 0) {
      return new Response(JSON.stringify({ message: 'No articles found', fetched: 0, saved: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 2: Deduplicate by URL and title
    const db = await connectDB();
    const newsCollection = db.collection<NewsItem>('news');

    const existingDocs = await newsCollection
      .find({
        $or: [
          { sourceUrl: { $in: allArticles.map(a => a.url) } },
          { title: { $in: allArticles.map(a => a.title) } },
        ]
      })
      .project({ sourceUrl: 1, title: 1 })
      .toArray();

    const existingUrlSet = new Set(existingDocs.map(e => e.sourceUrl));
    const existingTitleSet = new Set(existingDocs.map(e => e.title));

    const newArticles = allArticles.filter(a => a.url && !existingUrlSet.has(a.url) && !existingTitleSet.has(a.title));
    console.log(`[fetch-daily] ${newArticles.length} new articles after dedup (${allArticles.length - newArticles.length} duplicates)`);

    if (newArticles.length === 0) {
      return new Response(JSON.stringify({ message: 'No new articles', fetched: allArticles.length, saved: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 3: Score with GPT-4o
    const { scored: scoredArticles, degraded } = await scoreArticlesWithGPT(newArticles, openaiKey);

    // Scoring failure is swallowed above (fallback score 50 < threshold), so
    // without an explicit capture the cron "succeeds" daily while the board
    // silently starves — exactly what happened Aug 1-4 2026 (OpenAI credits
    // exhausted). captureMessage bypasses the beforeSend transient-exception
    // filter (it only inspects event.exception); flush before returning or
    // Vercel's post-response freeze eats the event (see src/middleware.ts).
    if (degraded) {
      Sentry.captureMessage('news: GPT scoring degraded — daily fetch will save nothing', {
        level: 'error',
        extra: { fetched: allArticles.length, newArticles: newArticles.length },
      });
      await Sentry.flush(2000);
    }

    // Step 4: Filter by relevance threshold, sort by score, cap at MAX_DAILY_ARTICLES
    const qualifyingArticles = scoredArticles
      .filter(a => a.relevanceScore >= RELEVANCE_THRESHOLD)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, MAX_DAILY_ARTICLES);
    console.log(`[fetch-daily] ${qualifyingArticles.length} articles above threshold (${RELEVANCE_THRESHOLD}, max ${MAX_DAILY_ARTICLES})`);

    if (qualifyingArticles.length === 0) {
      return new Response(JSON.stringify({
        message: 'No relevant articles found',
        fetched: allArticles.length,
        scored: scoredArticles.length,
        saved: 0,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 5: Scrape og:image for articles missing images (only qualifying ones, max ~15)
    const articlesWithoutImages = qualifyingArticles.filter(a => !a.imageUrl);
    if (articlesWithoutImages.length > 0) {
      console.log(`[fetch-daily] Scraping og:image for ${articlesWithoutImages.length} articles without images...`);
      await Promise.all(
        articlesWithoutImages.map(async (article) => {
          const ogImage = await scrapeOgImage(article.url);
          if (ogImage) {
            article.imageUrl = ogImage;
            console.log(`[fetch-daily] Found og:image for: ${article.title.substring(0, 40)}`);
          }
        })
      );
    }

    // Step 6: Insert into news collection (auto-approved, no moderation needed)
    const now = new Date();
    let savedCount = 0;

    for (const article of qualifyingArticles) {
      try {
        // Use AI summary if available, otherwise fall back to RSS description
        const description = article.aiSummary || article.description;

        const newsItem: NewsItem = {
          source: 'ai_fetched',
          title: article.title,
          description,
          imageUrl: article.imageUrl,
          sourceUrl: article.url,
          sourceName: article.sourceName,
          aiRelevanceScore: article.relevanceScore,
          aiCategory: article.aiCategory,
          aiReason: article.aiReason,
          moderationStatus: 'approved',
          viewCount: 0,
          publishedAt: new Date(article.publishedAt),
          fetchedAt: now,
          fetchDate: now.toISOString().split('T')[0],
          approvedAt: now,
          createdAt: now,
          updatedAt: now,
        };

        await newsCollection.insertOne(newsItem);

        savedCount++;
      } catch (error) {
        // Skip duplicates from race conditions
        console.error(`Failed to save article: ${article.title}`, error);
      }
    }

    console.log(`[fetch-daily] Saved ${savedCount} articles (auto-approved)`);

    return new Response(JSON.stringify({
      message: `Daily fetch complete`,
      fetched: allArticles.length,
      newArticles: newArticles.length,
      scored: scoredArticles.length,
      aboveThreshold: qualifyingArticles.length,
      saved: savedCount,
      timestamp: now.toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[fetch-daily] Fatal error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
