import log from "loglevel";
import { Notice, request } from "obsidian";
import * as qs from "query-string";
import { PocketGetItemsResponse } from "./PocketAPITypes";
import { SupportedPlatform } from "../Types";
import { getPlatform } from "../utils";

export type ResponseBody = string;

export type DoHTTPRequest = (
  url: string,
  body: Record<string, string>
) => Promise<ResponseBody>;

const doRequest: DoHTTPRequest = async (url, body) => {
  return request({
    url: url,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: qs.stringify(body),
  });
};

export type RequestToken = string;
export type AccessToken = string;
export type Username = string;

export type UpdateTimestamp = number;

export type AccessTokenResponse = {
  accessToken: AccessToken;
  username: Username;
};

var storedRequestToken: RequestToken | null = null;

type ConsumerKey = string;

// From https://getpocket.com/developer/apps/
const PLATFORM_CONSUMER_KEYS: Record<SupportedPlatform, ConsumerKey> = {
  mac: "97653-12e003276f01f4288ac868c0",
  windows: "97653-541365a3736338ca19dae55a",
  linux: "97653-da7a5baf4f5172d3fce89c0a",
  ios: "98643-0f7acf0859cccd827a59d02f",
  android: "98644-7deaf66746d3a0457a1f7961",
};

const CONSUMER_KEY = PLATFORM_CONSUMER_KEYS[getPlatform()];

export type GetRequestToken = (
  authRedirectURI: string
) => Promise<RequestToken>;
export type GetAccessToken = () => Promise<AccessTokenResponse>;
export type GetPocketItems = (
  accessToken: AccessToken,
  lastUpdateTimestamp?: UpdateTimestamp,
  pocketSyncTag?: string
) => Promise<TimestampedPocketGetItemsResponse>;

export interface PocketAPI {
  getRequestToken: GetRequestToken;
  getAccessToken: GetAccessToken;
  getPocketItems: GetPocketItems;
}

export const buildAuthorizationURL = (
  requestToken: RequestToken,
  authRedirectURI: string
) =>
  `https://getpocket.com/auth/authorize?request_token=${requestToken}&redirect_uri=${authRedirectURI}`;

// TODO: Handle unsuccessful requests
export const getRequestToken: GetRequestToken = async (authRedirectURI) => {
  if (storedRequestToken) {
    log.warn("Found unexpected stored request token");
  }

  const REQUEST_TOKEN_URL = "https://getpocket.com/v3/oauth/request";

  const responseBody = await doRequest(REQUEST_TOKEN_URL, {
    consumer_key: CONSUMER_KEY,
    redirect_uri: authRedirectURI,
  });

  const formdata = await responseBody;
  const parsed = qs.parse(formdata);

  const requestToken = parsed["code"] as RequestToken;
  storedRequestToken = requestToken;
  return requestToken;
};

// TODO: Handle unsuccessful requests
export const getAccessToken: GetAccessToken = async () => {
  if (!storedRequestToken) {
    throw new Error("could not find stored request token");
  }

  const ACCESS_TOKEN_URL = "https://getpocket.com/v3/oauth/authorize";

  const responseBody = await doRequest(ACCESS_TOKEN_URL, {
    consumer_key: CONSUMER_KEY,
    code: storedRequestToken,
  });

  const formdata = await responseBody;
  const parsed = qs.parse(formdata);

  storedRequestToken = null;

  return {
    accessToken: parsed["access_token"] as AccessToken,
    username: parsed["username"] as Username,
  };
};

export type TimestampedPocketGetItemsResponse = {
  timestamp: UpdateTimestamp;
  response: PocketGetItemsResponse;
};

export const getPocketItems: GetPocketItems = async (
  accessToken,
  lastUpdateTimestamp?,
  pocketSyncTag?
) => {
  const GET_ITEMS_URL = "https://getpocket.com/v3/get";
  const nextTimestamp = Math.floor(Date.now() / 1000);
  const allItems: PocketGetItemsResponse = {
    status: 0,
    complete: 0,
    list: {},
  };
  let offset = 0;
  const limit = 30; // Pocket API default limit

  while (true) {
    const requestOptions = {
      consumer_key: CONSUMER_KEY,
      access_token: accessToken,
      since: !!lastUpdateTimestamp
        ? new Number(lastUpdateTimestamp).toString()
        : null,
      detailType: "complete",
      tag: pocketSyncTag,
      count: limit.toString(),
      offset: offset.toString(),
    };

    log.info(`Request Options: ${JSON.stringify(requestOptions, null, 2)}`);

    if (!!lastUpdateTimestamp && offset === 0) {
      const humanReadable = new Date(lastUpdateTimestamp * 1000).toLocaleString();
      log.info(`Fetching with Pocket item updates since ${humanReadable}`);
    } else if (offset === 0) {
      log.info(`Fetching all Pocket items`);
    } else {
      log.info(`Fetching Pocket items with offset ${offset}`);
    }

    try {
      const responseBody = await doRequest(GET_ITEMS_URL, requestOptions);
      log.info(`Pocket items fetched. Raw response body: ${responseBody}`);
      const response = JSON.parse(responseBody);

      log.info(`Parsed Pocket API response: ${JSON.stringify(response, null, 2)}`);

      if (!response.list) {
        log.warn("Response list is null or undefined.");
        break;
      }

      Object.assign(allItems.list, response.list);

      log.info(
        `Fetched ${Object.keys(response.list).length} items in this batch. Total items so far: ${Object.keys(allItems.list).length}.`
      );

      if (Object.keys(response.list).length < limit) {
        log.info("Fewer items returned than the limit. Finishing fetch loop.");
        break;
      }

      offset += limit;
    } catch (err) {
      const errorMessage = `Encountered error ${err} while fetching Pocket items with offset ${offset}`;
      log.error(errorMessage);
      new Notice(errorMessage);
      throw err;
    }
  }

  log.info(`Fetched a total of ${Object.keys(allItems.list).length} Pocket items.`);

  return {
    timestamp: nextTimestamp,
    response: allItems,
  };
};




export const buildPocketAPI = (): PocketAPI => {
  return {
    getRequestToken: getRequestToken,
    getAccessToken: getAccessToken,
    getPocketItems: getPocketItems,
  };
};