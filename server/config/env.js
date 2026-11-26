/*
This file is responsible for loading environment variables and validating them from the .env file into the process.env object before exporting them when needed. 
*/

import dotenv from "dotenv";
import {fileURLToPath} from "node:url";

/*
fileURLroPath is used to convert the file URL to a path string, which is necessary for dotenv to correctly locate the .env file.
dotenv.config() is used to load environment variables from the .env file into process.env (default server root).
Since the .env file is located in the parent directory of the server folder, we specify the path to it using fileURLToPath and URL.
import.meta.url is used to get the current module's URL, which is then used to construct the path to the .env file.
*/

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const PORT = process.env.BACKEND_PORT;
if (!PORT) {
  console.error("Error: BACKEND_PORT is not defined in the .env file.");
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET){
  console.error("Error: JWT_SECRET is not defined in the .env file.");
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
if(!MONGODB_URI){
  console.error("Error: MONGODB_URI is not defined in the .env file.");
  process.exit(1);
}

const NODE_ENV = process.env.NODE_ENV;
if(!NODE_ENV){
  console.error("Error: NODE_ENV is not defined in the .env file.");
  process.exit(1);
}

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
if(!CLOUDINARY_CLOUD_NAME){
  console.error("Error: CLOUDINARY_CLOUD_NAME is not defined in the .env file.");
  process.exit(1);
}

const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
if(!CLOUDINARY_API_KEY){
  console.error("Error: CLOUDINARY_API_KEY is not defined in the .env file.");
  process.exit(1);
}

const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
if(!CLOUDINARY_API_SECRET){
  console.error("Error: CLOUDINARY_API_SECRET is not defined in the .env file.");
  process.exit(1);
}

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY || !STRIPE_SECRET_KEY.startsWith("sk_test_")) {
  console.error("Error: Valid STRIPE_SECRET_KEY is not defined in the .env file.");
  process.exit(1);
}

// reset + notification mail share these. without them, notify still saves in-app and skips SMTP;
// forgot-password throws when it tries to send
const NOTIFY_SMTP_USER = process.env.NOTIFY_SMTP_USER;
const NOTIFY_SMTP_PASS = process.env.NOTIFY_SMTP_PASS;

export const env = {
  backendPort: PORT,
  jwtSecret: JWT_SECRET,
  mongoDB: MONGODB_URI,
  nodeEnv: NODE_ENV,
  cloudinaryCloudName: CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: CLOUDINARY_API_KEY,
  cloudinaryApiSecret: CLOUDINARY_API_SECRET
};
