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

// Catch-all 404 for API
app.use((req, res) => {
  res.status(404).json({ error: `Path ${req.path} not found` });
});

app.use(errorHandler);

const HOST = process.env.HOST || "0.0.0.0";
const START_PORT = Number(process.env.PORT || 5000);
const PORT_RETRIES = Number(process.env.PORT_RETRIES || 10);
const server = http.createServer(app);

const startServer = async () => {
  await initDb();
  initSockets(server);

  const listenWithRetry = (port, retriesLeft) =>
    new Promise((resolve, reject) => {
      const onListening = () => {
        server.off("error", onError);
        resolve(port);
      };

      const onError = (error) => {
        server.off("listening", onListening);

        if (error?.code === "EADDRINUSE" && retriesLeft > 0) {
          const nextPort = port + 1;
          // eslint-disable-next-line no-console
          console.warn(
            `Port ${port} is already in use. Retrying on ${nextPort}...`,
          );
          resolve(listenWithRetry(nextPort, retriesLeft - 1));
          return;
        }

        reject(error);
      };

      server.once("listening", onListening);
      server.once("error", onError);
      server.listen(port, HOST);
    });

  const activePort = await listenWithRetry(START_PORT, PORT_RETRIES);

  // eslint-disable-next-line no-console
  console.log(`Backend running on http://localhost:${activePort}`);
};

await startServer();
