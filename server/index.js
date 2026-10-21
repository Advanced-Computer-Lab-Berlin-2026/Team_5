import app from "./app.js";
import {env} from "./config/env.js";

// Database connection and other setup code can go here

app.listen(env.backendPort, () => {
    console.log(`Server is running on http://localhost:${env.backendPort}`);
});
