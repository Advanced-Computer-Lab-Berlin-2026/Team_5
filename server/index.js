import app from "./app.js";
import {env} from "./config/env.js";
import { connectDB } from "./config/db.js";

// Database connection and other setup code can go here

async function bootstrap() {
  await connectDB();
  app.listen(env.backendPort, () => {
    console.log(`API listening on http://localhost:${env.backendPort}`);
  });
}
bootstrap();