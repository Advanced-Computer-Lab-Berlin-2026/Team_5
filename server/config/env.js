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

export const env = {
  backendPort: PORT,
};