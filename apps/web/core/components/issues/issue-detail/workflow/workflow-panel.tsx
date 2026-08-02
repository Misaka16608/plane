/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { IssueWorkflowService } from "@/services/issue/workflow.service";

const workflowService = new IssueWorkflowService();

const STAGE_KEYS: Record<string, string> = {
  evaluation: "issue_workflow.stage.evaluation",
  splitting: "issue_workflow.stage.splitting",
  execution: "issue_workflow.stage.execution",
  review: "issue_workflow.stage.review",
  returned: "issue_workflow.stage.returned",
  completed: "issue_workflow.stage.completed",
};

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isEditable: boolean;
};

export const IssueWorkflowPanel = observer(function IssueWorkflowPanel(props: Props) {
  const { workspaceSlug, projectId, issueId, isEditable } = props;
  const { t } = useTranslation();
  const {
    issue: { getIssueById },
    fetchIssue,
  } = useIssueDetail();
  const { getUserDetails } = useMember();
  const issue = getIssueById(issueId);

  const [returnOpen, setReturnOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<"executor" | "splitter">("executor");
  const [submitting, setSubmitting] = useState(false);

  if (!issue) return <></>;

  const stageKey = STAGE_KEYS[issue.workflow_stage ?? ""];
  const currentHandler = getUserDetails(issue.workflow_current_handler ?? "");

  const handlerRows = [
    { key: "workflow_evaluator", label: t("issue_workflow.evaluator"), value: issue.workflow_evaluator ?? null },
    { key: "workflow_splitter", label: t("issue_workflow.splitter"), value: issue.workflow_splitter ?? null },
    { key: "workflow_executor", label: t("issue_workflow.executor"), value: issue.workflow_executor ?? null },
    { key: "workflow_reviewer", label: t("issue_workflow.reviewer"), value: issue.workflow_reviewer ?? null },
  ];

  const refresh = async () => {
    await fetchIssue(workspaceSlug, projectId, issueId);
  };

  const handleAssign = async (field: string, userId: string | null) => {
    if (!isEditable) return;
    try {
      await workflowService.assign(workspaceSlug, projectId, issueId, { [field]: userId });
      await refresh();
    } catch (error) {
      console.error("Workflow assign failed:", error);
    }
  };

  const handleAdvance = async () => {
    try {
      await workflowService.advance(workspaceSlug, projectId, issueId);
      await refresh();
    } catch (error) {
      console.error("Workflow advance failed:", error);
    }
  };

  const handleReturn = async () => {
    if (!note.trim() || submitting) return;
    setSubmitting(true);
    try {
      await workflowService.returnTask(workspaceSlug, projectId, issueId, { note, target });
      setReturnOpen(false);
      setNote("");
      await refresh();
    } catch (error) {
      console.error("Workflow return failed:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEscalate = async () => {
    if (!note.trim() || submitting) return;
    setSubmitting(true);
    try {
      await workflowService.escalate(workspaceSlug, projectId, issueId, note);
      setEscalateOpen(false);
      setNote("");
      await refresh();
    } catch (error) {
      console.error("Workflow escalate failed:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const textareaClassName =
    "w-full resize-none rounded-sm border border-subtle bg-surface-1 px-2 py-1.5 text-caption-sm outline-none placeholder:text-placeholder";

  return (
    <div className="mt-5 border-t border-subtle pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h5 className="text-body-xs-medium">{t("issue_workflow.panel_title")}</h5>
        <span className="text-caption-xs rounded-full bg-surface-2 px-2 py-0.5 font-medium text-secondary">
          {stageKey ? t(stageKey) : issue.workflow_stage}
        </span>
      </div>

      <div className="text-caption-sm mb-3 flex items-center gap-1.5 text-secondary">
        <span>{t("issue_workflow.current_handler")}:</span>
        <span className="font-medium text-primary">
          {currentHandler?.display_name ?? t("issue_workflow.not_assigned")}
        </span>
      </div>

      <div className="space-y-2">
        {handlerRows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-2">
            <span className="text-caption-sm text-secondary">{row.label}</span>
            <MemberDropdown
              multiple={false}
              value={row.value}
              onChange={(val) => handleAssign(row.key, val)}
              projectId={projectId}
              disabled={!isEditable}
              buttonVariant="transparent-with-text"
              className="w-40"
              placeholder={t("issue_workflow.not_assigned")}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={handleAdvance} disabled={!isEditable}>
          {t("issue_workflow.advance")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setReturnOpen((open) => !open)} disabled={!isEditable}>
          {t("issue_workflow.return")}
        </Button>
        {issue.workflow_stage === "returned" && (
          <Button variant="secondary" size="sm" onClick={() => setEscalateOpen((open) => !open)} disabled={!isEditable}>
            {t("issue_workflow.escalate")}
          </Button>
        )}
      </div>

      {returnOpen && (
        <div className="mt-3 space-y-2 rounded-md border border-subtle p-3">
          <textarea
            className={textareaClassName}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("issue_workflow.note_placeholder")}
          />
          {issue.workflow_stage === "review" && (
            <div className="text-caption-sm flex items-center gap-2 text-secondary">
              <span>{t("issue_workflow.return_target")}:</span>
              <select
                className="text-caption-sm rounded-sm border border-subtle bg-surface-1 px-2 py-1 outline-none"
                value={target}
                onChange={(e) => setTarget(e.target.value as "executor" | "splitter")}
              >
                <option value="executor">{t("issue_workflow.target_executor")}</option>
                <option value="splitter">{t("issue_workflow.target_splitter")}</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" size="sm" onClick={() => setReturnOpen(false)}>
              {t("issue_workflow.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={handleReturn} disabled={!note.trim() || submitting}>
              {t("issue_workflow.confirm")}
            </Button>
          </div>
        </div>
      )}

      {escalateOpen && (
        <div className="mt-3 space-y-2 rounded-md border border-subtle p-3">
          <textarea
            className={textareaClassName}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("issue_workflow.note_placeholder")}
          />
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" size="sm" onClick={() => setEscalateOpen(false)}>
              {t("issue_workflow.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={handleEscalate} disabled={!note.trim() || submitting}>
              {t("issue_workflow.confirm")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});
