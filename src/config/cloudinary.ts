import { v2 as cloudinary } from "cloudinary";
import 'dotenv/config';
// Read once, and fail loudly and immediately if anything is missing —
// better to crash on startup than get a cryptic error mid-upload.
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  throw new Error(
    "Missing Cloudinary env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET"
  );
}

// At this point TypeScript knows cloudName/apiKey/apiSecret are `string`,
// not `string | undefined` — that's what fixes the overload error.
cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
});

export default cloudinary;