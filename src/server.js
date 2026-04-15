import http from "http";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import adminRoutes from "./routes/adminRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { initDb } from "./db/initDb.js";
import { initSockets } from "./sockets/index.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "*",
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/admin", adminRoutes);
app.use("/api/students", studentRoutes);
app.use("/api", sessionRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

await initDb();
initSockets(server);

server.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`Backend running on http://localhost:${PORT}`);
});
