import { env } from "./config/env.js";
import "./services/mail-service/emailWorker.js";
import server from "./server.js";

const port = env.port || 3000;

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
