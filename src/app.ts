import "./instrumentation.js"; //IMPORTANT: keep this first
import * as Sentry from "@sentry/node";
import express, { Express } from "express";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { ThumbnailApi } from "./ThumbnailApi.js";
import { Client, ClientOptions } from "@opensearch-project/opensearch";
import { default as cluster, Worker } from "node:cluster";
import { cpus } from "node:os";

// How long we wait for a request from a socket
const REQUEST_TIMEOUT = 3000; // 3 secs

// How long we wait on piping a response before we give up
const RESPONSE_TIMEOUT = 10000; // 10 seconds

// How long we wait on a response from ElasticSearch
const ES_RESPONSE_TIMEOUT = 2000; // 2 seconds

// How many times to retry on Elasticsearch
const ES_RETRIES = 2;

start();

function start() {
  const numCPUs = Number(process.env.PS_COUNT) || cpus().length;
  const mustFork =
    process.env.MUST_FORK === "true" || process.env.NODE_ENV === "production";

  if (cluster.isPrimary && mustFork) {
    doFork(numCPUs);
  } else {
    doWorker();
  }
}

function doWorker() {
  const port = process.env.PORT ?? 3000;
  const awsOptions = { region: process.env.REGION ?? "us-east-1" };
  const bucket = process.env.BUCKET ?? "dpla-thumbnails";
  const elasticsearch =
    process.env.ELASTIC_URL ?? "http://search.internal.dp.la:9200/";

  const sqsURL =
    process.env.SQS_URL ??
    "https://sqs.us-east-1.amazonaws.com/283408157088/thumbp-image";

  const app: Express = express();
  const s3Client = new S3Client(awsOptions);
  const sqsClient = new SQSClient(awsOptions);

  const esClient: Client = new Client({
    node: elasticsearch,
    maxRetries: ES_RETRIES,
    requestTimeout: ES_RESPONSE_TIMEOUT,
    sniffOnStart: true,
    sniffOnConnectionFault: true,
  } as ClientOptions);

  const thumbnailApi: ThumbnailApi = new ThumbnailApi(
    bucket,
    sqsURL,
    s3Client,
    sqsClient,
    esClient,
  );

  // next two methods are like this to make
  // eslint happy about the async get handler
  const handler = async (req: express.Request, res: express.Response) => {
    res.setTimeout(RESPONSE_TIMEOUT, () => {
      res.status(504);
      res.send("Gateway Timeout");
    });
    try {
      await thumbnailApi.handle(req, res);
    } catch (error) {
      console.error("Error fetching thumb:", error);
    }
  };

  app.get("/thumb/*", (req: express.Request, res: express.Response) => {
    handler(req, res)
      .then(() => Promise.resolve())
      .catch((reason: unknown) => {
        console.error("Caught error from handler: %s", reason);
      });
  });

  app.get("/health", (req: express.Request, res: express.Response): void => {
    res.sendStatus(200).end();
  });

  Sentry.setupExpressErrorHandler(app);

  const server = app.listen(port, (): void => {
    console.log(`Server is listening on ${port}`);
  });

  // how long the server waits before the client needs to finish sending the request
  server.requestTimeout = REQUEST_TIMEOUT;

  const handleExit: NodeJS.SignalsListener = (signal: NodeJS.Signals) => {
    console.log("Received %s. Shutting down.", signal);
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", () => handleExit("SIGINT"));
  process.on("SIGQUIT", () => handleExit("SIGQUIT"));
  process.on("SIGTERM", () => handleExit("SIGTERM"));
}

function doFork(numCPUs: number): void {
  cluster
    .on("exit", (worker: Worker): void => {
      console.log(`worker ${worker.process.pid} died`);
    })
    .on("online", (worker: Worker): void => {
      console.log(`worker ${worker.process.pid} online`);
    });
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
}
