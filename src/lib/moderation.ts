/**
 * Content Moderation Utility
 * Uses OpenAI's omni-moderation-latest model for text and image moderation
 *
 * Approach:
 * - Clean content → Auto-publish
 * - Flagged/Blocked content → Review queue (soft-reject)
 * - Admin can override any decision
 * - Nothing is permanently deleted without admin review
 */

import * as Sentry from '@sentry/astro';

// ============================================================================
// TYPES
// ============================================================================

export interface ModerationInput {
  text?: string;
  imageUrls?: string[];
}

export interface ModerationScores {
  harassment: number;
  'harassment/threatening': number;
  hate: number;
  'hate/threatening': number;
  illicit: number;
  'illicit/violent': number;
  'self-harm': number;
  'self-harm/intent': number;
  'self-harm/instructions': number;
  sexual: number;
  'sexual/minors': number;
  violence: number;
  'violence/graphic': number;
}

export type ModerationDecision = 'approved' | 'pending_review' | 'urgent_review';

export interface ModerationResult {
  // Final decision
  decision: ModerationDecision;

  // Can be published immediately?
  canPublish: boolean;

  // Needs human review?
  needsReview: boolean;

  // Is this urgent (potential CSAM or threats)?
  isUrgent: boolean;

  // Categories that triggered flagging
  flaggedCategories: string[];

  // All scores
  scores: Partial<ModerationScores>;

  // Highest scoring category
  highestCategory: string;
  maxScore: number;

  // User-facing message
  userMessage: string;

  // Admin-facing reason
  adminReason: string;
}

// FlaggedContent type is imported from types/index.ts
import type { FlaggedContent, ModeratedContentType } from '../types';
import { shortTextVerdict } from './shortTextVerdict';

// ============================================================================
// THRESHOLDS
// ============================================================================

// Flag thresholds - content above these scores goes to review queue
// Lower = more strict (more things flagged for review)
const FLAG_THRESHOLDS: Record<string, number> = {
  // URGENT: These trigger immediate urgent review
  'sexual/minors': 0.1,         // Very low threshold - any hint gets urgent review
  'self-harm/intent': 0.3,
  'self-harm/instructions': 0.3,

  // HIGH PRIORITY: These need review but less urgent
  'harassment/threatening': 0.4,
  'hate/threatening': 0.4,
  'illicit/violent': 0.5,
  'violence/graphic': 0.5,

  // NORMAL REVIEW
  'sexual': 0.2,                // Low threshold - no legitimate nudity in a community platform
  'harassment': 0.5,
  'hate': 0.5,
  'violence': 0.5,
  'self-harm': 0.4,
  'illicit': 0.6,

  // Default for any unlisted category
  default: 0.5,
};

// Categories that trigger URGENT review (potential legal issues)
const URGENT_CATEGORIES = [
  'sexual',
  'sexual/minors',
  'self-harm/intent',
  'self-harm/instructions',
];

// ============================================================================
// TURKISH PROFANITY FILTER
// ============================================================================

// Turkish swear words and offensive terms (expand as needed)
// Note: OpenAI's moderation is English-focused, so we need this for Turkish content
const TURKISH_BLOCKLIST = [
  // Common Turkish swear words (add more as needed)
  'amk', 'aq', 'amına', 'amina', 'amını', 'amini',
  'orospu', 'oç', 'oc', 'oçlar',
  'siktir', 'sikeyim', 'sikerim', 'siktirgit', 'sik',
  'piç', 'pic', 'piçlik',
  'götün', 'gotun',
  'yarak', 'yarrak', 'yarrağ',
  'taşak', 'tasak', 'taşşak',
  'ibne', 'ibné',
  'kahpe', 'kaltak',
  'bok', 'boktan',
  'gerizekalı', 'gerizekali', 'salak', 'aptal', 'dangalak',
  'haysiyetsiz', 'şerefsiz', 'serefsiz', 'namussuz',
  'gavat', 'pezevenk',
  // REMOVED cross-language collisions (2026-09-01): 'mal' (German „mal" —
  // flagged virtually every German post), 'meme' (internet loanword),
  // 'lan' (LAN-Party), bare 'göt'/'got' (English "got"; Turkish-char folding
  // makes them identical — inflected forms above stay). Contextual abuse of
  // these words is caught by the OpenAI + GPT checks.
];

// English swear words and offensive terms
const ENGLISH_BLOCKLIST = [
  'fuck', 'fucker', 'fucking', 'motherfucker', 'fck', 'fuk',
  'shit', 'shitty', 'bullshit',
  'asshole', 'arsehole', 'arse', // bare 'ass' removed: German „Ass" (ace)
  'bitch', 'bitches',
  'dickhead', // bare 'dick' removed: German „dick" (thick/fat) is everyday German
  'cock', 'cocksucker',
  'cunt', 'cunts',
  'penis', 'vagina',
  'nigger', 'nigga', 'negro',
  'faggot', 'fag',
  'retard', 'retarded',
  'whore', 'slut', 'hoe',
  'wanker', 'twat', 'prick', 'tosser',
  'bastard',
];

// German swear words and offensive terms
const GERMAN_BLOCKLIST = [
  'scheiße', 'scheisse', 'scheiß', 'scheiss',
  'arschloch', 'arsch',
  'ficken', 'fick', 'ficker',
  'hurensohn', 'hure', 'nutte',
  'fotze', 'möse', 'moese',
  'wichser', 'wichsen',
  'schwanz', 'schwanzlutscher',
  'missgeburt', 'miststück', 'miststueck',
  'drecksau', 'dreckschwein', // 'dreckig' removed: legit adjective („der Platz ist dreckig")
  'schlampe', 'tussi',
  'vollidiot', 'idiot', 'depp', 'trottel', 'dummkopf',
  'spast', 'spasti', // 'behindert' removed: blocks legit accessibility discussion; slur usage caught by AI
  'pisser', 'pisse',
  'kacke', 'kackbratze',
  'bastard', 'wixer',
];

/**
 * Check text for Turkish profanity
 * Returns matched words if found, empty array if clean
 */
function checkTurkishProfanity(text: string): string[] {
  if (!text) return [];

  const normalizedText = normalizeLeetspeak(text)
    .toLowerCase()
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c');

  const foundWords: string[] = [];

  for (const word of TURKISH_BLOCKLIST) {
    const normalizedWord = word
      .toLowerCase()
      .replace(/[ıİ]/g, 'i')
      .replace(/[şŞ]/g, 's')
      .replace(/[ğĞ]/g, 'g')
      .replace(/[üÜ]/g, 'u')
      .replace(/[öÖ]/g, 'o')
      .replace(/[çÇ]/g, 'c');

    // Check for word boundary match (not just substring)
    const regex = new RegExp(`\\b${normalizedWord}\\b`, 'gi');
    if (regex.test(normalizedText)) {
      foundWords.push(word);
    }
  }

  return foundWords;
}

/**
 * Create a moderation result for Turkish profanity detection
 */
function createTurkishProfanityResult(foundWords: string[]): ModerationResult {
  return {
    decision: 'pending_review',
    canPublish: false,
    needsReview: true,
    isUrgent: false,
    flaggedCategories: ['turkish_profanity'],
    scores: { harassment: 0.8 }, // Map to harassment category
    highestCategory: 'turkish_profanity',
    maxScore: 0.8,
    userMessage: 'Your submission is under review for potentially inappropriate language.',
    adminReason: `Turkish profanity detected: ${foundWords.join(', ')}`,
  };
}

/**
 * Normalize leetspeak / number-letter substitutions to plain text.
 * Applied before blocklist matching to catch obfuscated profanity like "m0therfu5ker5".
 * Multi-char replacements (|<, ph) are processed first, then single-char.
 */
function normalizeLeetspeak(text: string): string {
  return text
    // Multi-char replacements first
    .replace(/\|</g, 'k')
    .replace(/ph/gi, 'f')
    // Single-char replacements
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/!/g, 'i')
    .replace(/\(/g, 'c')
    .replace(/\+/g, 't');
}

/**
 * Normalize unicode characters (umlauts, Turkish chars) for blocklist matching
 */
function normalizeUnicode(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/[ßẞ]/g, 'ss')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[çÇ]/g, 'c');
}

/**
 * Check text against a blocklist (generic helper)
 * Runs multiple normalization passes to catch leetspeak variants
 * (e.g. "5" can mean "s" or "c", so we check both)
 */
function checkBlocklist(text: string, blocklist: string[]): string[] {
  if (!text) return [];

  // Generate multiple normalized variants to catch ambiguous leetspeak
  const variants = [
    normalizeUnicode(normalizeLeetspeak(text)),
    // Alternate pass: 5→c instead of 5→s (catches "fu5k" → "fuck")
    normalizeUnicode(normalizeLeetspeak(text.replace(/5/g, 'c'))),
  ];

  const foundWords: string[] = [];

  for (const word of blocklist) {
    const normalizedWord = normalizeUnicode(word);

    for (const normalizedText of variants) {
      const regex = new RegExp(`\\b${normalizedWord}\\b`, 'gi');
      if (regex.test(normalizedText)) {
        foundWords.push(word);
        break; // found in at least one variant, no need to check others
      }
    }
  }

  return foundWords;
}

/**
 * Shared core for short public-text fields (display name, profile motto,
 * ...): blocklist word-boundary check, concatenated-profanity substring
 * check, then the OpenAI moderation + GPT spam/hate-speech safety net.
 * Deliberately has NO length gate — that's field-specific (name: 2-30 via
 * checkNameProfanity below; motto: 1-80 via MOTTO_MAX_LEN + zod in
 * src/pages/api/users/update.ts) and callers validate it before calling in.
 * `label` feeds both the returned `reason` string (capitalized noun, e.g.
 * "Name"/"Motto") and, as free text, the GPT context prompt.
 */
async function checkShortTextProfanity(
  text: string,
  label: string,
  gptContext: string
): Promise<{ clean: boolean; reason?: string }> {
  const allBlocklists = [...TURKISH_BLOCKLIST, ...ENGLISH_BLOCKLIST, ...GERMAN_BLOCKLIST];

  // Standard word-boundary check
  const wordBoundaryHits = checkBlocklist(text, allBlocklists);
  if (wordBoundaryHits.length > 0) {
    return { clean: false, reason: `${label} contains inappropriate language` };
  }

  // Substring check for concatenated profanity (e.g. "PenisPenisPenis", "m0therfu5ker5")
  const textVariants = [
    normalizeUnicode(normalizeLeetspeak(text)).replace(/[^a-z]/g, ''),
    normalizeUnicode(normalizeLeetspeak(text.replace(/5/g, 'c'))).replace(/[^a-z]/g, ''),
  ];

  for (const word of allBlocklists) {
    const normalizedWord = normalizeUnicode(word);
    if (normalizedWord.length >= 4) {
      for (const variant of textVariants) {
        if (variant.includes(normalizedWord)) {
          return { clean: false, reason: `${label} contains inappropriate language` };
        }
      }
    }
  }

  // OpenAI safety net: Moderation API + GPT hate speech check in parallel
  try {
    const apiKey = import.meta.env.OPENAI_API_KEY;
    if (apiKey) {
      const [moderationResult, gptResult] = await Promise.all([
        moderateText(text),
        checkSpamWithGPT(text, gptContext)
      ]);
      // Neither call throws on an OpenAI failure — they RETURN the fail-safe
      // result. shortTextVerdict() skips those (the blocklists above already
      // ran) and refuses only on a real flag. See shortTextVerdict.ts.
      if (shortTextVerdict([moderationResult, gptResult]) === 'refused') {
        return { clean: false, reason: `${label} contains inappropriate content` };
      }
    }
  } catch {
    // Defensive only: an unexpected throw must not block a signup either.
  }

  return { clean: true };
}

/**
 * Check username/display name for profanity across all languages.
 * Also checks for profanity embedded without word boundaries (e.g. "PenisPenisPenis").
 * Returns { clean: true } or { clean: false, reason: string }
 */
export async function checkNameProfanity(name: string): Promise<{ clean: boolean; reason?: string }> {
  if (!name || name.trim().length < 2 || name.trim().length > 30) {
    return { clean: false, reason: 'Name must be between 2 and 30 characters' };
  }
  return checkShortTextProfanity(name, 'Name', 'user display name');
}

/**
 * Check a profile motto (Steckbrief line, ≤80 chars, printed + public) for
 * profanity. Same blocklist + OpenAI safety net as checkNameProfanity, but
 * without its 2-30 char gate — length is validated separately (zod
 * MOTTO_MAX_LEN) since mottos are optional and can legitimately run past 30
 * chars. Returns { clean: true } or { clean: false, reason: string }.
 */
export async function checkMottoProfanity(motto: string): Promise<{ clean: boolean; reason?: string }> {
  return checkShortTextProfanity(motto, 'Motto', 'profile motto, printed on a public neighbor card');
}

// ============================================================================
// MAIN MODERATION FUNCTION
// ============================================================================

/**
 * Moderate content using OpenAI's moderation API
 * Returns decision: approved, pending_review, or urgent_review
 */
export async function moderateContent(input: ModerationInput): Promise<ModerationResult> {
  const apiKey = import.meta.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('[Moderation] OPENAI_API_KEY not set - FAIL-SAFE: queuing for manual review');
    return createFailSafeResult('API key not configured');
  }

  // Check for profanity FIRST (before OpenAI API call)
  if (input.text) {
    const turkishProfanity = checkTurkishProfanity(input.text);
    if (turkishProfanity.length > 0) {
      console.log('[Moderation] Turkish profanity detected:', turkishProfanity);
      return createTurkishProfanityResult(turkishProfanity);
    }

    const englishHits = checkBlocklist(input.text, ENGLISH_BLOCKLIST);
    const germanHits = checkBlocklist(input.text, GERMAN_BLOCKLIST);
    const allHits = [...englishHits, ...germanHits];
    if (allHits.length > 0) {
      console.log('[Moderation] Profanity detected:', allHits);
      return createTurkishProfanityResult(allHits); // reuses same result shape
    }
  }

  // Build input array for OpenAI
  const moderationInput: any[] = [];

  if (input.text) {
    moderationInput.push({ type: 'text', text: input.text });
  }

  if (input.imageUrls && input.imageUrls.length > 0) {
    // Convert image URLs to base64 data URIs so OpenAI definitely receives them
    // (external URLs like Cloudinary can silently fail if OpenAI can't fetch them)
    const imagePromises = input.imageUrls.map(async (imageUrl) => {
      try {
        const imgResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
        if (!imgResponse.ok) {
          console.error(`[Moderation] Failed to fetch image: ${imgResponse.status} — ${imageUrl}`);
          return null;
        }
        const buffer = await imgResponse.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
        return `data:${contentType};base64,${base64}`;
      } catch (err) {
        console.error(`[Moderation] Error fetching image for moderation:`, err);
        return null;
      }
    });

    const base64Images = await Promise.all(imagePromises);

    for (const dataUri of base64Images) {
      if (dataUri) {
        moderationInput.push({
          type: 'image_url',
          image_url: { url: dataUri }
        });
      }
    }
  }

  if (moderationInput.length === 0) {
    return createApprovedResult();
  }

  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: moderationInput,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Moderation] OpenAI API error:', error);
      // FAIL-SAFE: Queue for manual review on API error
      return createFailSafeResult(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();

    // Process results - if multiple inputs, take the worst result
    let worstResult = {
      flagged: false,
      categories: {} as Record<string, boolean>,
      category_scores: {} as Record<string, number>,
    };

    for (const result of data.results) {
      if (result.flagged || getMaxScore(result.category_scores) > getMaxScore(worstResult.category_scores)) {
        worstResult = result;
      }
    }

    return processResult(worstResult);
  } catch (error) {
    console.error('[Moderation] Error:', error);
    // FAIL-SAFE: Queue for manual review on any error
    return createFailSafeResult(`Moderation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ============================================================================
// RESULT PROCESSING
// ============================================================================

function processResult(result: any): ModerationResult {
  const scores = result.category_scores as Partial<ModerationScores>;
  const flaggedCategories: string[] = [];
  let isUrgent = false;

  // Check each category against thresholds
  for (const [category, score] of Object.entries(scores)) {
    const threshold = FLAG_THRESHOLDS[category] ?? FLAG_THRESHOLDS.default;

    if (score >= threshold) {
      flaggedCategories.push(category);

      // Check if this is an urgent category
      if (URGENT_CATEGORIES.includes(category)) {
        isUrgent = true;
      }
    }
  }

  const maxScore = getMaxScore(scores);
  const highestCategory = getHighestCategory(scores);
  const needsReview = flaggedCategories.length > 0;

  // Determine decision
  let decision: ModerationDecision;
  if (!needsReview) {
    decision = 'approved';
  } else if (isUrgent) {
    decision = 'urgent_review';
  } else {
    decision = 'pending_review';
  }

  // Generate messages
  const userMessage = getUserMessage(decision);
  const adminReason = getAdminReason(flaggedCategories, scores);

  return {
    decision,
    canPublish: decision === 'approved',
    needsReview,
    isUrgent,
    flaggedCategories,
    scores,
    highestCategory,
    maxScore,
    userMessage,
    adminReason,
  };
}

function getMaxScore(scores: Record<string, number>): number {
  const values = Object.values(scores);
  return values.length > 0 ? Math.max(...values) : 0;
}

function getHighestCategory(scores: Record<string, number>): string {
  let highest = '';
  let highestScore = 0;
  for (const [category, score] of Object.entries(scores)) {
    if (score > highestScore) {
      highest = category;
      highestScore = score;
    }
  }
  return highest;
}

function createApprovedResult(): ModerationResult {
  return {
    decision: 'approved',
    canPublish: true,
    needsReview: false,
    isUrgent: false,
    flaggedCategories: [],
    scores: {},
    highestCategory: '',
    maxScore: 0,
    userMessage: '',
    adminReason: '',
  };
}

/**
 * FAIL-SAFE: When moderation can't complete, queue for manual review
 * Nothing gets published without either AI approval OR human review
 */
async function createFailSafeResult(reason: string): Promise<ModerationResult> {
  // Fail-safe is invisible by design (content just queues for manual review),
  // so an OpenAI outage never surfaced anywhere — see Aug 2026 credits
  // incident. Static message = one Sentry issue (variable `reason` goes in
  // extra, else every distinct error string becomes its own issue). flush
  // before returning: the surrounding request may complete fine (200), and
  // Vercel's post-response freeze would eat an unflushed event. All call
  // sites are `return createFailSafeResult(...)` inside async functions, so
  // the async-ification needs no caller changes.
  console.error(`[Moderation] FAIL-SAFE: ${reason}`);
  Sentry.captureMessage('moderation: check failed — content queued for manual review', {
    level: 'error',
    extra: { reason },
  });
  await Sentry.flush(2000);
  return {
    decision: 'pending_review',
    canPublish: false,
    needsReview: true,
    isUrgent: false,
    flaggedCategories: ['moderation_error'],
    scores: {},
    highestCategory: 'moderation_error',
    maxScore: 0,
    userMessage: 'Your submission is under review by our moderation team.',
    adminReason: `FAIL-SAFE: ${reason} - Requires manual review`,
  };
}

// ============================================================================
// USER-FACING MESSAGES
// ============================================================================

function getUserMessage(decision: ModerationDecision): string {
  switch (decision) {
    case 'approved':
      return '';
    case 'pending_review':
      return 'Your submission is under review by our moderation team.';
    case 'urgent_review':
      return 'Your submission is under review. A moderator will check it soon.';
    default:
      return '';
  }
}

function getAdminReason(flaggedCategories: string[], scores: Partial<ModerationScores>): string {
  if (flaggedCategories.length === 0) {
    return 'Content passed all checks.';
  }

  const details = flaggedCategories.map(cat => {
    const score = scores[cat as keyof ModerationScores] ?? 0;
    return `${cat}: ${(score * 100).toFixed(1)}%`;
  });

  return `Flagged for: ${details.join(', ')}`;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Quick text-only moderation
 */
export async function moderateText(text: string): Promise<ModerationResult> {
  return moderateContent({ text });
}

/**
 * Quick image-only moderation
 */
export async function moderateImages(imageUrls: string[]): Promise<ModerationResult> {
  return moderateContent({ imageUrls });
}

/**
 * Moderate text and images together (e.g., marketplace listing)
 */
export async function moderatePost(
  text: string,
  imageUrls?: string[]
): Promise<ModerationResult> {
  return moderateContent({ text, imageUrls });
}

/**
 * Create a FlaggedContent record for the database (AI moderation)
 */
export function createFlaggedContentRecord(
  contentType: ModeratedContentType,
  content: { title?: string; body?: string; tags?: string[]; imageUrls?: string[] },
  author: { id: string; name?: string; email?: string },
  moderationResult: ModerationResult
): Omit<FlaggedContent, '_id'> {
  return {
    source: 'ai_moderation',
    contentType,
    title: content.title,
    body: content.body,
    tags: content.tags,
    imageUrls: content.imageUrls,
    authorId: author.id,
    authorName: author.name,
    authorEmail: author.email,
    decision: moderationResult.decision,
    flaggedCategories: moderationResult.flaggedCategories,
    scores: moderationResult.scores,
    highestCategory: moderationResult.highestCategory,
    maxScore: moderationResult.maxScore,
    reviewStatus: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Merge multiple moderation results into a single combined result.
 * Only includes results that need review. Used to create one flagged record
 * instead of separate records per check.
 */
export function mergeModerationResults(...results: ModerationResult[]): ModerationResult | null {
  const flagged = results.filter(r => r.needsReview);
  if (flagged.length === 0) return null;

  const allCategories = flagged.flatMap(r => r.flaggedCategories);
  const allScores = Object.assign({}, ...flagged.map(r => r.scores));
  const isUrgent = flagged.some(r => r.isUrgent);
  const worst = flagged.reduce((a, b) => (a.maxScore >= b.maxScore ? a : b));

  return {
    decision: isUrgent ? 'urgent_review' : 'pending_review',
    canPublish: false,
    needsReview: true,
    isUrgent,
    flaggedCategories: allCategories,
    scores: allScores,
    highestCategory: worst.highestCategory,
    maxScore: worst.maxScore,
    userMessage: 'Your submission is under review by our moderation team.',
    adminReason: flagged.map(r => r.adminReason).filter(Boolean).join(' | '),
  };
}

// ============================================================================
// GPT-4o SPAM / RELEVANCE CHECK
// ============================================================================

export type SpamClassification = 'legitimate' | 'spam' | 'ad_promotional' | 'scam' | 'irrelevant_nonsense' | 'hate_speech' | 'harassment';

/**
 * Check content for spam, ads, scams, hate speech, harassment, or irrelevant nonsense using GPT-4o.
 * Works with any content type — pass a context hint for better classification.
 *
 * This is a SEPARATE check from the safety moderation (moderateContent/moderatePost).
 * Safety moderation catches harmful content via OpenAI Moderation API; this uses GPT-4o
 * for nuanced classification including hate speech that the Moderation API may miss.
 * Both should pass for content to auto-publish.
 *
 * @param text - The content text to check (title + body concatenated)
 * @param contentContext - What kind of content this is, e.g. "neighborhood marketplace listing", "community forum post"
 * @returns ModerationResult compatible with the existing moderation pipeline
 */
export async function checkSpamWithGPT(
  text: string,
  contentContext: string = 'neighborhood community content'
): Promise<ModerationResult> {
  const apiKey = import.meta.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('[SpamCheck] OPENAI_API_KEY not set - FAIL-SAFE: queuing for manual review');
    return createFailSafeResult('Spam check: API key not configured');
  }

  if (!text || text.trim().length === 0) {
    return createApprovedResult();
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: `You are a content moderator for a local neighborhood community platform (Mahalle). Your job is to classify ${contentContext} as one of: legitimate, spam, ad_promotional, scam, irrelevant_nonsense, hate_speech, harassment.

Rules:
- "legitimate": genuine content appropriate for a neighborhood community
- "spam": repetitive, bulk, or unsolicited promotional content
- "ad_promotional": commercial advertising, affiliate links, business promotions (not genuine peer-to-peer)
- "scam": deceptive content, phishing, too-good-to-be-true offers, fake urgency
- "irrelevant_nonsense": gibberish, random characters, completely off-topic, test posts
- "hate_speech": racism, white supremacy, antisemitism, islamophobia, homophobia, transphobia, sexism, xenophobia, ethnic/religious/national slurs, claims of racial or group superiority/inferiority, dehumanizing language targeting any group
- "harassment": personal attacks, threats, bullying, intimidation, doxxing, targeted insults

Return JSON only: {"classification": "...", "confidence": 0.0-1.0, "reason": "brief reason"}`
          },
          {
            role: 'user',
            content: text
          }
        ]
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[SpamCheck] OpenAI API error:', error);
      return createFailSafeResult(`Spam check API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error('[SpamCheck] Empty response from GPT');
      return createFailSafeResult('Spam check: empty GPT response');
    }

    // Parse JSON (strip markdown fences if present)
    const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(jsonStr) as {
      classification: SpamClassification;
      confidence: number;
      reason: string;
    };

    if (result.classification === 'legitimate' || result.classification === 'irrelevant_nonsense') {
      return createApprovedResult();
    }

    // Content flagged as spam/ad/scam/hate_speech/harassment
    return {
      decision: 'pending_review',
      canPublish: false,
      needsReview: true,
      isUrgent: result.classification === 'scam' || result.classification === 'hate_speech' || result.classification === 'harassment',
      flaggedCategories: [`spam_check:${result.classification}`],
      scores: { [result.classification]: result.confidence },
      highestCategory: `spam_check:${result.classification}`,
      maxScore: result.confidence,
      userMessage: 'Your submission is under review by our moderation team.',
      adminReason: `GPT spam check: ${result.classification} (${(result.confidence * 100).toFixed(0)}%) — ${result.reason}`,
    };
  } catch (error) {
    // AbortError = timeout, otherwise unknown error
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SpamCheck] Error:', errorMsg);
    return createFailSafeResult(`Spam check error: ${errorMsg}`);
  }
}

// ============================================================================
// GPT-4o VISION IMAGE SAFETY CHECK
// ============================================================================

export type ImageSafetyClassification = 'safe' | 'sexual' | 'violence' | 'hate' | 'other_violation';

/**
 * Check images for unsafe content using GPT-4o vision.
 * This supplements the Moderation API which has known issues with image detection
 * (especially sexual/nudity content — see OpenAI GitHub issue #1497).
 *
 * Sends all images in a single request for efficiency.
 * Fail-safe: any error queues for manual review (never auto-approves).
 *
 * @param imageUrls - Array of image URLs (Cloudinary or other public URLs)
 * @returns ModerationResult compatible with the existing pipeline
 */
export async function checkImagesWithGPT(imageUrls: string[]): Promise<ModerationResult> {
  const apiKey = import.meta.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('[ImageCheck] OPENAI_API_KEY not set - FAIL-SAFE: queuing for manual review');
    return createFailSafeResult('Image check: API key not configured');
  }

  if (!imageUrls || imageUrls.length === 0) {
    return createApprovedResult();
  }

  try {
    // Fetch images and convert to base64 (OpenAI may not be able to access external URLs)
    const imageContents: any[] = [];

    for (const imageUrl of imageUrls) {
      try {
        const imgResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
        if (!imgResponse.ok) {
          console.error(`[ImageCheck] Failed to fetch image: ${imgResponse.status} — ${imageUrl}`);
          continue;
        }
        const buffer = await imgResponse.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';

        imageContents.push({
          type: 'image_url',
          image_url: { url: `data:${contentType};base64,${base64}`, detail: 'low' }
        });
      } catch (err) {
        console.error(`[ImageCheck] Error fetching image:`, err);
      }
    }

    if (imageContents.length === 0) {
      console.error('[ImageCheck] No images could be fetched - FAIL-SAFE');
      return createFailSafeResult('Image check: could not fetch any images');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: `You are a content safety moderator for a local neighborhood community platform (Mahalle). Analyze the provided image(s) and classify the WORST violation found across ALL images.

Classifications:
- "safe": No policy violations, appropriate for a family-friendly community platform
- "sexual": Nudity, sexual content, sexually suggestive imagery, revealing/provocative poses
- "violence": Graphic violence, gore, weapons used threateningly, disturbing imagery
- "hate": Hate symbols, extremist imagery, discriminatory visual content
- "other_violation": Any other content inappropriate for a community platform (drugs, illegal items, etc.)

Be strict — this is a neighborhood community platform used by families. When in doubt, flag it.

Return JSON only: {"classification": "...", "confidence": 0.0-1.0, "reason": "brief description of what was detected"}`
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Check these images for content safety violations:' },
              ...imageContents
            ]
          }
        ]
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[ImageCheck] OpenAI API error:', response.status, error);
      return createFailSafeResult(`Image check API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error('[ImageCheck] Empty response from GPT');
      return createFailSafeResult('Image check: empty GPT response');
    }

    // Parse JSON (strip markdown fences if present)
    const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(jsonStr) as {
      classification: ImageSafetyClassification;
      confidence: number;
      reason: string;
    };

    if (result.classification === 'safe') {
      return createApprovedResult();
    }

    // Image flagged as unsafe
    const isUrgent = result.classification === 'sexual' || result.classification === 'violence';
    return {
      decision: isUrgent ? 'urgent_review' : 'pending_review',
      canPublish: false,
      needsReview: true,
      isUrgent,
      flaggedCategories: [`image_safety:${result.classification}`],
      scores: { [result.classification]: result.confidence },
      highestCategory: `image_safety:${result.classification}`,
      maxScore: result.confidence,
      userMessage: 'Your submission is under review by our moderation team.',
      adminReason: `GPT image check: ${result.classification} (${(result.confidence * 100).toFixed(0)}%) — ${result.reason}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ImageCheck] Error:', errorMsg);
    return createFailSafeResult(`Image check error: ${errorMsg}`);
  }
}

/**
 * Get category display name for admin UI
 */
export function getCategoryDisplayName(category: string): string {
  const names: Record<string, string> = {
    'harassment': 'Harassment',
    'harassment/threatening': 'Threatening Harassment',
    'hate': 'Hate Speech',
    'hate/threatening': 'Threatening Hate Speech',
    'illicit': 'Illegal Activity',
    'illicit/violent': 'Violent Illegal Activity',
    'self-harm': 'Self-Harm',
    'self-harm/intent': 'Self-Harm Intent',
    'self-harm/instructions': 'Self-Harm Instructions',
    'sexual': 'Sexual Content',
    'sexual/minors': 'Child Safety',
    'violence': 'Violence',
    'violence/graphic': 'Graphic Violence',
  };
  return names[category] || category;
}

/**
 * Get severity level for admin UI (for sorting/prioritizing)
 */
export function getSeverityLevel(result: ModerationResult): 'low' | 'medium' | 'high' | 'critical' {
  if (result.isUrgent) return 'critical';
  if (result.maxScore >= 0.8) return 'high';
  if (result.maxScore >= 0.5) return 'medium';
  return 'low';
}
