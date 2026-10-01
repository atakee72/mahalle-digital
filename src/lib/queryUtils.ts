import type { Db, Document } from 'mongodb';

interface QueryOptions {
  fields?: string | string[];
  limit?: string | number;
  offset?: string | number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  tags?: string | string[];
  category?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Parse query parameters for field selection and pagination
 */
export function parseQueryParams(url: URL): QueryOptions {
  const params = url.searchParams;

  return {
    fields: params.get('fields')?.split(',').filter(Boolean),
    limit: params.get('limit') || undefined,
    offset: params.get('offset') || undefined,
    sortBy: params.get('sortBy') || undefined,
    sortOrder: (params.get('sortOrder') || 'desc') as 'asc' | 'desc',
    search: params.get('search') || undefined,
    tags: params.get('tags')?.split(',').filter(Boolean),
    category: params.get('category') || undefined,
    dateFrom: params.get('dateFrom') || undefined,
    dateTo: params.get('dateTo') || undefined
  };
}

/**
 * Build MongoDB projection from field selection
 */
function buildProjection(fields?: string[]): Record<string, 0 | 1> | undefined {
  if (!fields || fields.length === 0) {
    return undefined;
  }

  const projection: Record<string, 0 | 1> = {};

  // Always include _id unless explicitly excluded
  if (!fields.includes('-_id')) {
    projection._id = 1;
  }

  // Add requested fields
  fields.forEach(field => {
    if (field.startsWith('-')) {
      // Exclude field
      projection[field.substring(1)] = 0;
    } else {
      // Include field
      projection[field] = 1;
    }
  });

  return projection;
}

/**
 * Build MongoDB sort options
 */
function buildSort(sortBy?: string, sortOrder: 'asc' | 'desc' = 'desc'): Record<string, 1 | -1> {
  const sortValue = sortOrder === 'asc' ? 1 : -1;

  switch (sortBy) {
    case 'date':
      return { date: sortValue, createdAt: sortValue };
    case 'startDate':
      return { startDate: sortValue, createdAt: sortValue };
    case 'likes':
      return { likes: sortValue, date: -1 };
    case 'views':
      return { views: sortValue, date: -1 };
    case 'comments':
      return { 'comments.length': sortValue, date: -1 };
    default:
      return { date: -1, createdAt: -1 };
  }
}

/**
 * Build MongoDB filter from search, tags, category, and date range
 */
export function buildFilter(options: QueryOptions): Record<string, any> {
  const filter: Record<string, any> = {};

  if (options.search) {
    // Text search on title and body/description
    filter.$or = [
      { title: { $regex: options.search, $options: 'i' } },
      { body: { $regex: options.search, $options: 'i' } },
      { description: { $regex: options.search, $options: 'i' } }
    ];
  }

  if (options.tags && options.tags.length > 0) {
    // Filter by tags
    filter.tags = { $in: options.tags };
  }

  if (options.category) {
    // Filter by category
    filter.category = options.category;
  }

  // Date range filtering for events
  // Events should be included if they overlap with the date range
  if (options.dateFrom || options.dateTo) {
    const dateFilter: Record<string, any> = {};

    if (options.dateFrom && options.dateTo) {
      // Event overlaps with date range if:
      // - Event starts before or during the range AND
      // - Event ends during or after the range
      filter.$and = [
        { startDate: { $lte: new Date(options.dateTo) } },
        { endDate: { $gte: new Date(options.dateFrom) } }
      ];
    } else if (options.dateFrom) {
      // Events that end on or after dateFrom
      filter.endDate = { $gte: new Date(options.dateFrom) };
    } else if (options.dateTo) {
      // Events that start on or before dateTo
      filter.startDate = { $lte: new Date(options.dateTo) };
    }
  }

  return filter;
}

/**
 * Apply query options to MongoDB collection
 */
export async function applyQueryOptions<T extends Document>(
  collection: any,
  options: QueryOptions,
  filter: Record<string, any> = {}
): Promise<T[]> {
  let query = collection.find(filter);

  // Apply projection for field selection
  const projection = buildProjection(options.fields as string[]);
  if (projection) {
    query = query.project(projection);
  }

  // Apply sorting
  const sort = buildSort(options.sortBy, options.sortOrder);
  query = query.sort(sort);

  // Apply pagination
  const limit = parseInt(options.limit as string) || 20;
  const offset = parseInt(options.offset as string) || 0;

  query = query.skip(offset).limit(limit);

  return query.toArray();
}

/**
 * Get total count for pagination metadata
 */
export async function getTotalCount(
  collection: any,
  filter: Record<string, any> = {}
): Promise<number> {
  return collection.countDocuments(filter);
}

/**
 * Build pagination metadata
 */
export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  page: number;
  totalPages: number;
}

export function buildPaginationMeta(
  total: number,
  limit: number,
  offset: number
): PaginationMeta {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  return {
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
    page,
    totalPages
  };
}