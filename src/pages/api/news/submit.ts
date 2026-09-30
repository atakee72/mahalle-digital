import type { APIRoute } from 'astro';
import { connectDB } from '../../../lib/mongodb';
import type { NewsItem, FlaggedContent } from '../../../types';
import { NewsSubmitSchema } from '../../../schemas/news.schema';
import { parseRequestBody } from '../../../schemas/validation.utils';
import { moderateText, checkSpamWithGPT, mergeModerationResults, createFlaggedContentRecord } from '../../../lib/moderation';
import { requireMemberSession } from '../../../lib/auth';
import { alertModerationFlagged } from '../../../lib/adminAlerts';
import { decodeHtmlEntities } from '../../../utils/decodeHtmlEntities';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId } = gate;

    // Daily submit limit (5 per rolling 24h) — mirrors topics/events/listings.
    const dbEarly = await connectDB();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayCount = await dbEarly.collection('news').countDocuments({
      submittedBy: userId,
      source: 'user_submitted',
      createdAt: { $gte: dayAgo },
    });
    // Admins are exempt from the daily limit (they post official content in bursts).
    if (session.user.role !== 'admin' && todayCount >= 5) {
      return new Response(JSON.stringify({
        error: 'Daily submission limit reached',
        message: 'You can submit up to 5 news items per day. Please try again tomorrow.',
        dailyLimit: 5,
        currentCount: todayCount,
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    // Validate request body
    const validation = await parseRequestBody(request, NewsSubmitSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { title: rawTitle, description: rawDescription, sourceUrl, sourceName, imageUrl, submitterComment, sektion } = validation.data;

    // Pasted headlines/descriptions often carry HTML entities („ as &#8222;
    // etc.). Decode at the ingest boundary so the stored text is real
    // characters — the newsboard renders titles as escaped text and would
    // otherwise show the entity literally.
    const title = decodeHtmlEntities(rawTitle);
    const description = decodeHtmlEntities(rawDescription);

    // Check for duplicate URL
    const db = dbEarly;
    const newsCollection = db.collection<NewsItem>('news');

    const existing = await newsCollection.findOne({ sourceUrl });
    if (existing) {
      return new Response(JSON.stringify({ error: 'This news article has already been submitted' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Admins are exempt from AI moderation AND editorial review (the admin IS
    // the editor) — their submissions go straight to the newsboard.
    const skipModeration = session.user.role === 'admin';

    let mergedResult: ReturnType<typeof mergeModerationResults> = null;
    if (!skipModeration) {
      // Run content moderation on title + description + comment.
      // Parity with all other content types (CLAUDE.md): the OpenAI safety scan
      // (moderateText) runs in parallel with the GPT spam/ad/hate/harassment check
      // (checkSpamWithGPT); merged → null when nothing flagged, else a combined result.
      const textToModerate = `${title}\n\n${description}${submitterComment ? `\n\n${submitterComment}` : ''}`;
      const [moderationResult, spamResult] = await Promise.all([
        moderateText(textToModerate),
        checkSpamWithGPT(textToModerate, 'neighborhood news submission'),
      ]);
      mergedResult = mergeModerationResults(moderationResult, spamResult);
    }

    // All user-submitted news goes to moderation queue regardless of AI result
    // (admin reviews every submission before it appears on the newsboard);
    // admin submissions publish immediately.
    const moderationStatus = skipModeration ? 'approved' : 'pending';

    const newNewsItem: NewsItem = {
      source: 'user_submitted',
      title,
      description,
      imageUrl: imageUrl || undefined,
      sourceUrl,
      sourceName,
      aiCategory: sektion,
      submittedBy: userId as any,
      submitterComment: submitterComment || undefined,
      moderationStatus,
      // Admin-approved-on-submit items need the stamps processReviewAction
      // would otherwise set on approval (reviewAction.ts) — without fetchDate
      // the item sorts dead-last on the newsboard and the landing Kurier
      // strip ($exists: true filter) drops it entirely.
      ...(skipModeration ? { approvedAt: new Date(), fetchDate: new Date().toISOString().split('T')[0] } : {}),
      viewCount: 0,
      publishedAt: new Date(),
      fetchedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await newsCollection.insertOne(newNewsItem);

    if (!skipModeration) {
      // Create flagged content record for admin review
      const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');

      if (mergedResult) {
        // Flagged by the safety scan and/or the GPT check — record merged details
        const flaggedRecord = createFlaggedContentRecord(
          'news',
          { title, body: description },
          {
            id: userId,
            name: session.user.name || undefined,
            email: session.user.email || undefined
          },
          mergedResult
        );
        flaggedRecord.contentId = result.insertedId.toString();
        await flaggedCollection.insertOne(flaggedRecord as FlaggedContent);
      } else {
        // Not AI-flagged, but still needs admin approval — create a simple pending record
        await flaggedCollection.insertOne({
          source: 'ai_moderation',
          contentType: 'news',
          contentId: result.insertedId.toString(),
          title,
          body: description,
          authorId: userId,
          authorName: session.user.name || undefined,
          authorEmail: session.user.email || undefined,
          decision: 'pending_review',
          flaggedCategories: [],
          scores: {},
          highestCategory: 'user_submission',
          maxScore: 0,
          reviewStatus: 'pending',
          createdAt: new Date(),
          updatedAt: new Date()
        } as FlaggedContent);
      }

      await alertModerationFlagged({ contentType: 'news', title, authorName: session.user.name });
    }

    return new Response(
      JSON.stringify({
        news: { ...newNewsItem, _id: result.insertedId },
        message: skipModeration
          ? 'News published to the newsboard.'
          : 'News submitted successfully. It will appear on the newsboard after admin approval.',
        moderationStatus
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('News submission error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
