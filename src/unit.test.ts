import {
  DplaMap,
  getCacheHeaders,
  getImageUrlFromSearchResult,
  getItemId,
  getS3Key,
  isProbablyURL,
  ThumbnailApi,
} from "./ThumbnailApi";
import { mockClient } from "aws-sdk-client-mock";
import "aws-sdk-client-mock-jest";
jest.mock("@opensearch-project/opensearch");
import { Client } from "@opensearch-project/opensearch";
import {
  HeadObjectCommand,
  HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
jest.mock("@aws-sdk/s3-request-presigner");
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as matchers from "jest-extended";
expect.extend(matchers);

const fakeBucket = "foobar";
const fakeSQS = "bazbuzz";

test.each([
  [
    "223ea5040640813b6c8204d1e0778d30",
    "2/2/3/e/223ea5040640813b6c8204d1e0778d30.jpg",
  ],
  [
    "11111111111111111111111111111111",
    "1/1/1/1/11111111111111111111111111111111.jpg",
  ],
])("getS3Key", (input, output) => {
  expect(getS3Key(input)).toBe(output);
});

test.each([
  [
    "/thumb/223ea5040640813b6c8204d1e0778d30",
    "223ea5040640813b6c8204d1e0778d30",
  ],
  [
    "/thumb/11111111111111111111111111111111",
    "11111111111111111111111111111111",
  ],
  ["/thumb//11111111111111111111111111111111", undefined],
  ["/thumb/111111111111111111111111111111111/", undefined],
  ["/thumb/oneoneoneoneoneoneoneoneoneoneon", undefined],
  ["223ea5040640813b6c8204d1e0778d30", undefined],
  ["/thumb", undefined],
  ["/thumb/", undefined],
  ["/thumb/1234", undefined],
])("getItemId", (input: string, output: string | undefined): void => {
  expect(getItemId(input)).toBe(output);
});

test("getImageUrlFromSearchResult: String", (): void => {
  const test = {
    _source: {
      object: "https://google.com",
    },
  } as DplaMap;
  expect(getImageUrlFromSearchResult(test)).toBe("https://google.com");
});

test("getImageUrlFromSearchResult: Array", (): void => {
  const test = {
    _source: {
      object: ["https://google.com"],
    },
  };
  expect(getImageUrlFromSearchResult(test)).toBe("https://google.com");
});

test("getImageUrlFromSearchResult: Bad URL", () => {
  const test = {
    _source: {
      object: ["blah:hole"],
    },
  };
  expect(getImageUrlFromSearchResult(test)).toBe(undefined);
});

test("getImageUrlFromSearchResult: Empty result", () => {
  const test = {};
  expect(getImageUrlFromSearchResult(test)).toBe(undefined);
});

test("getImageUrlFromSearchResult: Record has no thumbnail", () => {
  const test = {
    _source: {
      foo: ["bar"],
      object: undefined,
    },
  };
  expect(getImageUrlFromSearchResult(test)).toBe(undefined);
});

test.each([
  ["foo", false],
  ["gopher:hole", false],
  ["https://foo.com", true],
  ["http://foo.com", true],
  ["https://foo.com", true],
])("isProbablyURL", (input, output) => {
  expect(isProbablyURL(input)).toBe(output);
});

test("getCacheHeaders", (): void => {
  const result: Map<string, string> = getCacheHeaders(2);
  expect(result.get("Cache-Control")).toBe("public, max-age=2");
  const expires = result.get("Expires");
  expect(expires).toMatch(
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\W\d{2}\W(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\W\d{4}\W\d{2}:\d{2}:\d{2}\WGMT$/,
  );
});

describe("ThumbnailApi class tests", () => {
  const mockOsClient = jest.mocked(Client);
  const mockS3Client = mockClient(S3Client);
  const mockSqsClient = mockClient(SQSClient);
  const api = new ThumbnailApi(
    fakeBucket,
    fakeSQS,
    mockS3Client as unknown as S3Client,
    mockSqsClient as unknown as SQSClient,
    mockOsClient as unknown as Client,
  );

  beforeEach(() => {
    mockS3Client.reset();
    mockSqsClient.reset();
    mockOsClient.mockReset();
  });

  test("lookupImageInS3", async () => {
    const id = "12345";
    mockS3Client.on(HeadObjectCommand).resolves({} as HeadObjectCommandOutput);
    await api.lookupImageInS3(id);
    expect(mockS3Client).toHaveReceivedCommandWith(HeadObjectCommand, {
      Bucket: fakeBucket,
      Key: "1/2/3/4/12345.jpg",
    });
  });

  test("getS3Url", async () => {
    const id = "12345";
    const url = "https://example.com/12345";
    const mockedGetSignedUrl = jest.mocked(getSignedUrl);
    mockedGetSignedUrl.mockResolvedValue(url);
    const result = await api.getS3Url(id);
    expect(mockedGetSignedUrl).toHaveBeenCalledWith(
      mockS3Client,
      expect.toBeObject(),
    );
    expect(result).toBe(url);
  });
});
