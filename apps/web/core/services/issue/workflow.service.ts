/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TIssue } from "@plane/types";
import { APIService } from "@/services/api.service";

export type TWorkflowAssignData = {
  workflow_stage?: string;
  workflow_evaluator?: string | null;
  workflow_splitter?: string | null;
  workflow_executor?: string | null;
  workflow_reviewer?: string | null;
  workflow_current_handler?: string | null;
};

export type TWorkflowReturnData = {
  note: string;
  target?: "executor" | "splitter";
};

export class IssueWorkflowService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private workflowUrl(workspaceSlug: string, projectId: string, issueId: string, action: string): string {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/workflow/${action}/`;
  }

  async assign(workspaceSlug: string, projectId: string, issueId: string, data: TWorkflowAssignData): Promise<TIssue> {
    return this.post(this.workflowUrl(workspaceSlug, projectId, issueId, "assign"), data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async advance(workspaceSlug: string, projectId: string, issueId: string, note = ""): Promise<TIssue> {
    return this.post(this.workflowUrl(workspaceSlug, projectId, issueId, "advance"), { note })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async returnTask(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: TWorkflowReturnData
  ): Promise<TIssue> {
    return this.post(this.workflowUrl(workspaceSlug, projectId, issueId, "return"), data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async escalate(workspaceSlug: string, projectId: string, issueId: string, note = ""): Promise<TIssue> {
    return this.post(this.workflowUrl(workspaceSlug, projectId, issueId, "escalate"), { note })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
