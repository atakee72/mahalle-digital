import type { APIRoute } from 'astro';
import { connectDB } from '../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import type { FlaggedContent, Topic, Comment, Announcement, Recommendation, Event } from '../../../types';
import type { Listing } from '../../../types/listing';
import { ReportContentSchema, REPORT_REASON_LABELS } from '../../../schemas/moderation.schema';
import { parseRequestBody } from '../../../schemas/validation.utils';
import { requireMemberSession } from '../../../lib/auth';
import { alertReport } from '../../../lib/adminAlerts';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { session, userId: reporterUserId } = gate;

    // Validate request body with Zod
    const validation = await parseRequestBody(request, ReportContentSchema);

    if (!validation.success) {
      return validation.response;
    }

    const { contentId, contentType, reason, details } = validation.data;

    // Prevent users from reporting their own content
    const db = await connectDB();
    const topicsCollection = db.collection<Topic>('topics');
    const commentsCollection = db.collection<Comment>('comments');
    const announcementsCollection = db.collection<Announcement>('announcements');
    const recommendationsCollection = db.collection<Recommendation>('recommendations');
    const eventsCollection = db.collection<Event>('events');
    const listingsCollection = db.collection<Listing>('listings');

    // Get the original content to check author and capture snapshot
    let originalContent: Topic | Comment | Announcement | Recommendation | null = null;
    let authorId: string | null = null;
    let contentSnapshot: { title?: string; body?: string; tags?: string[] } = {};

    if (contentType === 'topic') {
      originalContent = await topicsCollection.findOne({ _id: new ObjectId(contentId) });

      if (originalContent) {
        // Handle author that could be ObjectId, string, or User object
        const author = originalContent.author;
        authorId = typeof author === 'object' && author !== null && '_id' in author
          ? String(author._id)
          : String(author);
        contentSnapshot = {
          title: originalContent.title,
          body: originalContent.body,
          tags: originalContent.tags
        };
      }
    } else if (contentType === 'comment') {
      originalContent = await commentsCollection.findOne({ _id: new ObjectId(contentId) });

      if (originalContent) {
        const author = originalContent.author;
        authorId = typeof author === 'object' && author !== null && '_id' in author
          ? String(author._id)
          : String(author);
        contentSnapshot = {
          body: originalContent.body
        };
      }
    } else if (contentType === 'announcement') {
      originalContent = await announcementsCollection.findOne({ _id: new ObjectId(contentId) });

      if (originalContent) {
        const author = originalContent.author;
        authorId = typeof author === 'object' && author !== null && '_id' in author
          ? String(author._id)
          : String(author);
        contentSnapshot = {
          title: originalContent.title,
          body: originalContent.body,
          tags: originalContent.tags
        };
      }
    } else if (contentType === 'recommendation') {
      originalContent = await recommendationsCollection.findOne({ _id: new ObjectId(contentId) });

      if (originalContent) {
        const author = originalContent.author;
        authorId = typeof author === 'object' && author !== null && '_id' in author
          ? String(author._id)
          : String(author);
        contentSnapshot = {
          title: originalContent.title,
          body: originalContent.body,
          tags: originalContent.tags
        };
      }
    } else if (contentType === 'event') {
      originalContent = await eventsCollection.findOne({ _id: new ObjectId(contentId) });

      if (originalContent) {
        const author = originalContent.author;
        authorId = typeof author === 'object' && author !== null && '_id' in author
          ? String(author._id)
          : String(author);
        contentSnapshot = {
          title: originalContent.title,
          body: originalContent.body
        };
      }
    } else if (contentType === 'marketplace') {
      const listing = await listingsCollection.findOne({ _id: new ObjectId(contentId) });

      if (listing) {
        originalContent = listing as any;
        authorId = String(listing.sellerId);
        contentSnapshot = {
          title: listing.title,
          body: listing.descriptionPlainText || ''
        };
      }
    }

    if (!originalContent) {
      return new Response(JSON.stringify({ error: 'Content not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Prevent self-reporting
    if (authorId === reporterUserId) {
      return new Response(JSON.stringify({ error: 'You cannot report your own content' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const flaggedCollection = db.collection<FlaggedContent>('flaggedContent');

    // Check if this content already has a pending report
    const existingFlaggedContent = await flaggedCollection.findOne({
      contentId,
      contentType,
      source: 'user_report',
      reviewStatus: 'pending'
    });

    if (existingFlaggedContent) {
      // Check if THIS user already reported (check array of reporter IDs)
      const reporterIds = existingFlaggedContent.reporterUserIds || [existingFlaggedContent.reporterUserId];
      if (reporterIds.includes(reporterUserId)) {
        return new Response(JSON.stringify({
          error: 'You have already reported this content',
          alreadyReported: true
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Different user - add to reporters list and increment count
      await flaggedCollection.updateOne(
        { _id: existingFlaggedContent._id },
        {
          $inc: { reportCount: 1 },
          $addToSet: { reporterUserIds: reporterUserId },
          $set: { updatedAt: new Date() }
        }
      );

      if (session.user.role !== 'admin') {
        await alertReport({ contentType, title: contentSnapshot.title, reason: REPORT_REASON_LABELS[reason] || reason });
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Thank you for reporting. Our team will review this content.',
        reportCount: (existingFlaggedContent.reportCount || 1) + 1
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get author info for the record
    const usersCollection = db.collection('users');
    const contentAuthor = authorId ? await usersCollection.findOne(
      { _id: new ObjectId(authorId) },
      { projection: { name: 1, email: 1 } }
    ) : null;

    // Create new flagged content record
    const flaggedRecord: Omit<FlaggedContent, '_id'> = {
      source: 'user_report',
      contentType,
      contentId,
      title: contentSnapshot.title,
      body: contentSnapshot.body,
      tags: contentSnapshot.tags,
      authorId: authorId || 'unknown',
      authorName: contentAuthor?.name,
      authorEmail: contentAuthor?.email,
      // For user reports, we use default moderation values
      decision: 'pending_review',
      flaggedCategories: [REPORT_REASON_LABELS[reason] || reason],
      scores: {},
      highestCategory: reason,
      maxScore: 0,
      // User report specific fields
      reporterUserId,
      reporterUserIds: [reporterUserId],  // Track all reporters for duplicate check
      reporterName: session.user.name || undefined,
      reportReason: reason,
      reportDetails: details,
      reportCount: 1,
      // Review status
      reviewStatus: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await flaggedCollection.insertOne(flaggedRecord as FlaggedContent);

    // Mark the original content as pending review
    const collectionMap: Record<string, any> = {
      topic: topicsCollection,
      comment: commentsCollection,
      announcement: announcementsCollection,
      recommendation: recommendationsCollection,
      event: eventsCollection,
      marketplace: listingsCollection
    };

    const targetCollection = collectionMap[contentType];
    if (targetCollection) {
      await targetCollection.updateOne(
        { _id: new ObjectId(contentId) },
        {
          $set: {
            moderationStatus: 'pending',
            isUserReported: true
          }
        }
      );
    }

    // Admin alert after the content is marked pending (never-throw, no-op
    // without env). Self-reports by an admin don't alert.
    if (session.user.role !== 'admin') {
      await alertReport({ contentType, title: contentSnapshot.title, reason: REPORT_REASON_LABELS[reason] || reason });
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Thank you for reporting. Our team will review this content.'
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Report submission error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
