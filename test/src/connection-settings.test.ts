// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getRestApiVersion, getServiceUrl, isWithinCollection, resolveConnectionSettings } from "../../src/connection-settings";

const collection = "https://ado.example.com/tfs/DefaultCollection";

describe("connection settings", () => {
  it("uses a complete Server collection URL and defaults to PAT", () => {
    expect(resolveConnectionSettings(`${collection}/`)).toEqual({
      serverUrl: collection,
      organization: "DefaultCollection",
      onPremises: true,
      authentication: "pat",
    });
  });

  it.each(["interactive", "azcli", "env", "envvar"])("rejects cloud authentication %s for Server", (authentication) => {
    expect(() => resolveConnectionSettings(collection, authentication)).toThrow("requires PAT authentication");
  });

  it.each([
    "http://ado.example.com/tfs/DefaultCollection",
    "https://user:password@ado.example.com/tfs/DefaultCollection",
    "https://ado.example.com",
    `${collection}?token=secret`,
    `${collection}#fragment`,
    "ado.example.com/tfs/DefaultCollection",
    "../another-org",
  ])("rejects invalid connection input %s", (input) => {
    expect(() => resolveConnectionSettings(input)).toThrow();
  });

  it("preserves cloud authentication defaults and overrides", () => {
    expect(resolveConnectionSettings("my-org")).toMatchObject({ serverUrl: "https://dev.azure.com/my-org", onPremises: false, authentication: "interactive" });
    expect(resolveConnectionSettings("my-org", undefined, "azcli").authentication).toBe("azcli");
    expect(resolveConnectionSettings("my-org", "pat").authentication).toBe("pat");
    expect(resolveConnectionSettings("https://dev.azure.com/my-org/").onPremises).toBe(false);
  });

  it("preserves non-default ports and custom virtual directories", () => {
    expect(resolveConnectionSettings("https://ado.example.com:8443/devops/Engineering/").serverUrl).toBe("https://ado.example.com:8443/devops/Engineering");
  });

  it.each(["search", "identities"] as const)("keeps Server %s requests under the collection", (service) => {
    expect(getServiceUrl(`${collection}/`, service)).toBe(collection);
  });

  it("retains cloud service routing", () => {
    expect(getServiceUrl("https://dev.azure.com/my-org", "search")).toBe("https://almsearch.dev.azure.com/my-org");
    expect(getServiceUrl("https://my-org.visualstudio.com/", "identities")).toBe("https://vssps.dev.azure.com/my-org");
  });

  it("selects endpoint versions without changing cloud versions", () => {
    expect(getRestApiVersion(collection, "7.2-preview.1")).toBe("7.1");
    expect(getRestApiVersion(collection, "7.2-preview.4", "7.1-preview.4")).toBe("7.1-preview.4");
    expect(getRestApiVersion("https://dev.azure.com/my-org", "7.2-preview.4", "7.1-preview.4")).toBe("7.2-preview.4");
  });

  it.each([collection, `${collection}/Project/_wiki/wikis/MyWiki`, "https://ADO.example.com/tfs/defaultcollection/Project"])("accepts URLs within the configured collection: %s", (url) => {
    expect(isWithinCollection(url, `${collection}/`)).toBe(true);
  });

  it.each([
    "https://other.example.com/tfs/DefaultCollection/Project",
    "https://ado.example.com:8443/tfs/DefaultCollection/Project",
    "https://ado.example.com/tfs/OtherCollection/Project",
    "https://ado.example.com/tfs/DefaultCollectionOther/Project",
    `${collection}/../OtherCollection/Project`,
    `${collection}/%2e%2e/OtherCollection/Project`,
    "http://ado.example.com/tfs/DefaultCollection/Project",
    "https://user:password@ado.example.com/tfs/DefaultCollection/Project",
    "not a URL",
  ])("rejects URLs outside the configured collection: %s", (url) => {
    expect(isWithinCollection(url, collection)).toBe(false);
  });
});
