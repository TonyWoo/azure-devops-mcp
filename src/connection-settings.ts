// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getOrgFromUrl } from "./utils.js";

/** Resolve a cloud organization name or an explicit Server collection URL. */
export function resolveConnectionSettings(organization: string, authentication?: string, cloudDefaultAuthentication = "interactive") {
  const isUrl = /^[a-z][a-z\d+.-]*:/i.test(organization);
  if (!isUrl && !/^[a-z\d][a-z\d-]*$/i.test(organization)) {
    throw new Error("Provide an Azure DevOps organization name or a full HTTPS collection URL.");
  }
  const url = new URL(isUrl ? organization : `https://dev.azure.com/${organization}`);
  const collectionName = url.pathname.split("/").filter(Boolean).at(-1);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !collectionName) {
    throw new Error("The collection URL must use HTTPS, include the collection path, and contain no credentials, query string, or fragment.");
  }
  const serverUrl = url.toString().replace(/\/+$/, "");
  const onPremises = isServerUrl(serverUrl);
  const authType = authentication ?? (onPremises ? "pat" : cloudDefaultAuthentication);
  if (onPremises && authType !== "pat") {
    throw new Error("Azure DevOps Server currently requires PAT authentication (-a pat). Windows integrated authentication is not implemented.");
  }
  return { serverUrl, onPremises, authentication: authType, organization: getOrgFromUrl(serverUrl) ?? collectionName };
}

export function isServerUrl(serverUrl: string): boolean {
  return getOrgFromUrl(serverUrl) === null;
}

/** Server paths include the virtual directory and collection, unlike cloud URLs. */
export function isWithinCollection(target: string, collection: string): boolean {
  try {
    const targetUrl = new URL(target);
    const collectionUrl = new URL(collection);
    const basePath = collectionUrl.pathname.replace(/\/+$/, "").toLowerCase();
    const targetPath = targetUrl.pathname.toLowerCase();
    return !targetUrl.username && !targetUrl.password && targetUrl.origin === collectionUrl.origin && (targetPath === basePath || targetPath.startsWith(`${basePath}/`));
  } catch {
    return false;
  }
}

/** Keep cloud API versions unchanged; use an endpoint-specific 7.1 version on Server 2022.1. */
export function getRestApiVersion(serverUrl: string, cloudVersion: string, serverVersion = "7.1"): string {
  return isServerUrl(serverUrl) ? serverVersion : cloudVersion;
}

export function getServiceUrl(serverUrl: string, service: "search" | "identities"): string {
  if (isServerUrl(serverUrl)) return serverUrl.replace(/\/+$/, "");
  const host = service === "search" ? "almsearch.dev.azure.com" : "vssps.dev.azure.com";
  return `https://${host}/${getOrgFromUrl(serverUrl)}`;
}
