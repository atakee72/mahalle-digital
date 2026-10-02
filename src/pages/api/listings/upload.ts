import type { APIRoute } from 'astro';
import { v2 as cloudinary } from 'cloudinary';
import { requireMemberSession } from '../../../lib/auth';

// Configure Cloudinary
cloudinary.config({
  cloud_name: import.meta.env.CLOUD_NAME,
  api_key: import.meta.env.CLOUDINARY_API_KEY,
  api_secret: import.meta.env.CLOUDINARY_API_SECRET
});

export const POST: APIRoute = async ({ request }) => {
  try {
    // Session + live ban check (401 / 403 pre-shaped) — see requireMemberSession.
    const gate = await requireMemberSession(request);
    if (!gate.ok) return gate.response;
    const { userId } = gate;

    // Get the form data
    const formData = await request.formData();
    const image = formData.get('file') as File;

    if (!image) {
      return new Response(JSON.stringify({ error: 'No image provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate file type
    if (!image.type.startsWith('image/')) {
      return new Response(JSON.stringify({ error: 'File must be an image' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate file size (10MB)
    if (image.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Image must be under 10MB' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Convert File to base64
    const buffer = await image.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const base64 = Buffer.from(bytes).toString('base64');
    const dataUri = `data:${image.type};base64,${base64}`;

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(dataUri, {
      folder: 'mahalle/listings',
      public_id: `listing_${userId}_${Date.now()}`,
      transformation: [
        {
          width: 800,
          height: 800,
          crop: 'limit',
          quality: 'auto:good'
        }
      ]
    });

    return new Response(
      JSON.stringify({
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        width: uploadResult.width,
        height: uploadResult.height,
        message: 'Image uploaded successfully'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Listing image upload error:', error);
    return new Response(JSON.stringify({ error: 'Failed to upload image' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
