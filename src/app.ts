import express from "express";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { ThumbnailApi } from "./ThumbnailApi";
import { Client } from "@elastic/elasticsearch";
import { default as cluster } from "node:cluster";
import { cpus } from "node:os";

const numCPUs = Number(process.env.PS_COUNT) || cpus().length;
const mustFork =
  process.env.MUST_FORK === "true" || process.env.NODE_ENV === "production";

if (cluster.isPrimary && mustFork) {
  doFork(numCPUs);
} else {
  doWorker();
}

function doWorker() {
  const port = process.env.PORT || 3000;
  const awsOptions = { region: process.env.REGION || "us-east-1" };
  const bucket = process.env.BUCKET || "dpla-thumbnails";
  const elasticsearch =
    process.env.ELASTIC_URL || "http://search.internal.dp.la:9200/";

  const app = express();
  const s3Client = new S3Client(awsOptions);
  const sqsClient = new SQSClient(awsOptions);

  const esClient: Client = new Client({
    node: elasticsearch,
    maxRetries: 5,
    requestTimeout: 60000,
    sniffOnStart: true,
  });

  const thumbnailApi: ThumbnailApi = new ThumbnailApi(
    bucket,
    s3Client,
    sqsClient,
    esClient,
  );

  app.get("/thumb/*", (req: express.Request, res: express.Response) =>
    thumbnailApi.handle(req, res),
  );
  app.get("/health", (req: express.Request, res: express.Response) =>
    res.sendStatus(200),
  );

  app.listen(port, () => {
    console.log(`Server is listening on ${port}`);
  });
}

function doFork(numCPUs: number) {
  cluster
    .on("exit", (worker) => {
      console.log(`worker ${worker.process.pid} died`);
    })
    .on("online", (worker) => {
      console.log(`worker ${worker.process.pid} online`);
    });
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
}
