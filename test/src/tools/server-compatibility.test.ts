// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebApi } from "azure-devops-node-api";
import { Readable } from "stream";
import { searchIdentities } from "../../../src/tools/auth";
import { configureSearchTools } from "../../../src/tools/search";
import { configureWikiTools } from "../../../src/tools/wiki";
import { configureTestPlanTools } from "../../../src/tools/test-plans";
import { configureWorkItemTools } from "../../../src/tools/work-items";
import { configureRepoTools } from "../../../src/tools/repositories";
import { configurePipelineTools } from "../../../src/tools/pipelines";

describe("Azure DevOps Server 2022.1 tool routing", () => {
  const collection = "https://ado.example.com/tfs/DefaultCollection";
  const originalFetch = globalThis.fetch;
  const tokenProvider = jest.fn().mockResolvedValue("test-token");
  const userAgent = () => "test-agent";
  let server: McpServer;
  let connectionProvider: () => Promise<WebApi>;
  let fetchMock: jest.Mock;
  let getPageText: jest.Mock;
  let getTestRuns: jest.Mock;
  let getTestResults: jest.Mock;
  let getTestResultsApi: jest.Mock;

  beforeEach(() => {
    server = { tool: jest.fn() } as unknown as McpServer;
    getPageText = jest.fn().mockImplementation(() => Promise.resolve(Readable.from(["# Server wiki"])));
    getTestRuns = jest.fn().mockResolvedValue([{ id: 10 }]);
    getTestResults = jest.fn().mockResolvedValue([{ id: 20, testCaseTitle: "Server test", outcome: "Passed" }]);
    getTestResultsApi = jest.fn().mockRejectedValue(new Error("Cloud TestResults API must not be used"));
    connectionProvider = jest.fn().mockResolvedValue({
      serverUrl: collection,
      getGitApi: jest.fn().mockResolvedValue({}),
      getWikiApi: jest.fn().mockResolvedValue({ getPageText }),
      getTestApi: jest.fn().mockResolvedValue({ getTestRuns, getTestResults }),
      getTestResultsApi,
    });
    fetchMock = jest.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ value: [], results: [] }))));
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function handler(name: string) {
    const registration = (server.tool as jest.Mock).mock.calls.find(([toolName]) => toolName === name);
    if (!registration) throw new Error(`Missing tool ${name}`);
    return registration.at(-1);
  }

  function requestedUrl() {
    return new URL(fetchMock.mock.calls[0][0]);
  }

  it.each([
    ["search_code", "codesearchresults"],
    ["search_wiki", "wikisearchresults"],
    ["search_workitem", "workitemsearchresults"],
  ])("routes %s to the collection search endpoint", async (tool, endpoint) => {
    configureSearchTools(server, tokenProvider, connectionProvider, userAgent);
    await handler(tool)({ searchText: "hello", includeFacets: false, skip: 0, top: 5 });
    expect(requestedUrl().origin).toBe("https://ado.example.com");
    expect(requestedUrl().pathname).toBe(`/tfs/DefaultCollection/_apis/search/${endpoint}`);
    expect(requestedUrl().searchParams.get("api-version")).toBe("7.1");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("looks up identities in the configured collection", async () => {
    await searchIdentities("DOMAIN\\user", tokenProvider, connectionProvider, userAgent);
    expect(requestedUrl().pathname).toBe("/tfs/DefaultCollection/_apis/identities");
    expect(requestedUrl().searchParams.get("api-version")).toBe("7.1");
    expect(requestedUrl().searchParams.get("filterValue")).toBe("DOMAIN\\user");
  });

  it.each(["list_plans", "list_suites", "list_cases"])("uses 7.1 for test plan action %s", async (action) => {
    configureTestPlanTools(server, tokenProvider, connectionProvider, userAgent);
    const response = await handler("testplan")({ action, project: "My Project", planId: 1, suiteId: 2, continuationToken: "next" });
    expect(response.isError).toBeUndefined();
    expect(requestedUrl().pathname).toMatch(/^\/tfs\/DefaultCollection\/My%20Project\/_apis\/testplan\/Plans/);
    expect(requestedUrl().searchParams.get("api-version")).toBe("7.1");
    expect(requestedUrl().searchParams.get("continuationToken")).toBe("next");
  });

  it("reads build test results using the Server Test API", async () => {
    configureTestPlanTools(server, tokenProvider, connectionProvider, userAgent);
    const response = await handler("testplan_show_test_results_from_build_id")({ project: "Project", buildid: 123 });
    expect(response.isError).toBeUndefined();
    expect(getTestResultsApi).not.toHaveBeenCalled();
    expect(getTestRuns.mock.calls[0].slice(0, 2)).toEqual(["Project", "vstfs:///Build/Build/123"]);
    expect(getTestResults.mock.calls[0].slice(0, 2)).toEqual(["Project", 10]);
    expect(response.content[0].text).toContain("Server test");
  });

  it("reads wiki metadata with the Server API version", async () => {
    configureWikiTools(server, tokenProvider, connectionProvider, userAgent);
    const response = await handler("wiki")({ action: "get_page", project: "Project", wikiIdentifier: "Wiki", path: "/Home" });
    expect(response.isError).toBeUndefined();
    expect(requestedUrl().pathname).toBe("/tfs/DefaultCollection/Project/_apis/wiki/wikis/Wiki/pages");
    expect(requestedUrl().searchParams.get("api-version")).toBe("7.1");
  });

  it("accepts a full internal wiki URL and extracts project, wiki and page", async () => {
    configureWikiTools(server, tokenProvider, connectionProvider, userAgent);
    const response = await handler("wiki")({ action: "get_page_content", url: `${collection}/My%20Project/_wiki/wikis/My%20Wiki?pagePath=%2FHome` });
    expect(response.isError).toBeUndefined();
    expect(getPageText).toHaveBeenCalledWith("My Project", "My Wiki", "/Home", undefined, undefined, true);
    expect(response.content[0].text).toContain("# Server wiki");
  });

  it.each(["https://other.example.com/tfs/DefaultCollection/Project/_wiki/wikis/Wiki?pagePath=%2FHome", "https://ado.example.com/tfs/OtherCollection/Project/_wiki/wikis/Wiki?pagePath=%2FHome"])(
    "rejects wiki URLs outside the configured collection: %s",
    async (url) => {
      configureWikiTools(server, tokenProvider, connectionProvider, userAgent);
      const response = await handler("wiki")({ action: "get_page_content", url });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Cross-collection requests are not allowed");
      expect(getPageText).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each(["add", "update"])("uses the Server comments API for %s", async (action) => {
    configureWorkItemTools(server, tokenProvider, connectionProvider, userAgent);
    const response = await handler("wit_work_item_comment_write")({ action, project: "Project", workItemId: 1, commentId: 2, text: "Hello", format: "Html" });
    expect(response.isError).toBeUndefined();
    expect(requestedUrl().searchParams.get("api-version")).toBe("7.1-preview.4");
    expect(requestedUrl().pathname).toContain("/tfs/DefaultCollection/Project/_apis/wit/workItems/1/comments");
  });

  it("does not send commit search to the cloud for Server collections", async () => {
    configureRepoTools(server, tokenProvider, connectionProvider, userAgent);
    const response = await handler("repo_search_commits")({ searchText: "fix" });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("not supported");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates build stages using 7.1 under the collection path", async () => {
    configurePipelineTools(server, tokenProvider, connectionProvider, userAgent);
    const response = await handler("pipelines_write")({ action: "update_build_stage", project: "Project", buildId: 1, stageName: "Build", status: "Retry" });
    expect(response.isError).toBeUndefined();
    expect(requestedUrl().pathname).toBe("/tfs/DefaultCollection/Project/_apis/build/builds/1/stages/Build");
    expect(requestedUrl().searchParams.get("api-version")).toBe("7.1");
  });
});
