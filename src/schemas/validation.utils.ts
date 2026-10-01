import { z } from 'zod';

/**
 * Format Zod errors into a more user-friendly structure
 */
function formatZodError(error: z.ZodError): Record<string, string> {
  const formattedErrors: Record<string, string> = {};

  error.errors.forEach((err) => {
    const path = err.path.join('.');
    formattedErrors[path] = err.message;
  });

  return formattedErrors;
}

/**
 * Create a standardized API error response from Zod validation errors
 */
function createValidationErrorResponse(error: z.ZodError) {
  return new Response(
    JSON.stringify({
      error: 'Validation failed',
      details: formatZodError(error),
      issues: error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code
      }))
    }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

/**
 * Parse request body with validation
 */
export async function parseRequestBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; response: Response }> {
  try {
    const body = await request.json();

    const result = schema.safeParse(body);

    if (result.success) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      response: createValidationErrorResponse(result.error)
    };
  } catch (error) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    };
  }
}

/**
 * Validate MongoDB ObjectId string
 */
export function isValidObjectId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}
