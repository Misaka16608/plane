# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.app.services.workflow import REPORTER_STAGE, WorkflowError, advance, assign, escalate, return_task
from plane.db.models import Issue, WorkflowStage
from plane.tests.factories import (
    ProjectFactory,
    ProjectMemberFactory,
    UserFactory,
    WorkspaceFactory,
    WorkspaceMemberFactory,
)


@pytest.mark.unit
@pytest.mark.django_db
class TestWorkflowService:
    def _setup(self):
        reporter = UserFactory(username="reporter")
        workspace = WorkspaceFactory(owner=reporter)
        WorkspaceMemberFactory(workspace=workspace, member=reporter, role=20)
        project = ProjectFactory(workspace=workspace, created_by=reporter)

        users = {}
        for key in ("evaluator", "splitter", "executor", "reviewer"):
            user = UserFactory(username=f"user_{key}")
            users[key] = user
            WorkspaceMemberFactory(workspace=workspace, member=user, role=15)
            ProjectMemberFactory(project=project, member=user, role=15)

        return {
            "workspace": workspace,
            "project": project,
            "reporter": reporter,
            **users,
        }

    def _issue(self, ctx, name="task", parent=None):
        issue = Issue(
            workspace=ctx["workspace"],
            project=ctx["project"],
            name=name,
            created_by=ctx["reporter"],
            parent=parent,
        )
        issue.save(created_by_id=ctx["reporter"].id, disable_auto_set_user=True)
        return issue

    def _leaf(self, ctx, parent=None, name="task"):
        issue = self._issue(ctx, name=name, parent=parent)
        issue.workflow_stage = WorkflowStage.EXECUTION
        issue.workflow_evaluator_id = ctx["evaluator"].id
        issue.workflow_splitter_id = ctx["splitter"].id
        issue.workflow_executor_id = ctx["executor"].id
        issue.workflow_reviewer_id = ctx["reviewer"].id
        issue.workflow_current_handler_id = ctx["executor"].id
        issue.save(disable_auto_set_user=True)
        return issue

    def _save(self, issue, result):
        issue.save(disable_auto_set_user=True)
        for obj in result.get("related", []):
            obj.save(disable_auto_set_user=True)

    def test_assign_sets_handlers_and_stage(self):
        ctx = self._setup()
        issue = self._issue(ctx)

        result = assign(
            issue,
            ctx["splitter"].id,
            {
                "workflow_stage": WorkflowStage.EXECUTION,
                "workflow_executor": ctx["executor"].id,
                "workflow_reviewer": ctx["reviewer"].id,
            },
        )
        issue.save(disable_auto_set_user=True)

        issue.refresh_from_db()
        assert result["action"] == "assigned"
        assert issue.workflow_stage == WorkflowStage.EXECUTION
        assert issue.workflow_executor_id == ctx["executor"].id
        assert issue.workflow_reviewer_id == ctx["reviewer"].id
        assert issue.workflow_current_handler_id == ctx["executor"].id

    def test_assign_rejects_invalid_stage(self):
        ctx = self._setup()
        issue = self._issue(ctx)

        with pytest.raises(WorkflowError):
            assign(issue, ctx["splitter"].id, {"workflow_stage": "nope"})

    def test_advance_evaluation_to_splitting(self):
        ctx = self._setup()
        issue = self._issue(ctx)
        issue.workflow_evaluator_id = ctx["evaluator"].id
        issue.workflow_splitter_id = ctx["splitter"].id
        issue.workflow_current_handler_id = ctx["evaluator"].id
        issue.save(disable_auto_set_user=True)

        result = advance(issue, ctx["evaluator"].id)
        issue.save(disable_auto_set_user=True)

        assert result["action"] == "advanced"
        assert issue.workflow_stage == WorkflowStage.SPLITTING
        assert issue.workflow_current_handler_id == ctx["splitter"].id

    def test_advance_leaf_to_review_then_completed(self):
        ctx = self._setup()
        issue = self._leaf(ctx)

        advance(issue, ctx["executor"].id)
        issue.save(disable_auto_set_user=True)
        assert issue.workflow_stage == WorkflowStage.REVIEW
        assert issue.workflow_current_handler_id == ctx["reviewer"].id

        result = advance(issue, ctx["reviewer"].id)
        issue.save(disable_auto_set_user=True)
        assert result["action"] == "completed"
        assert issue.workflow_stage == WorkflowStage.COMPLETED
        assert issue.completed_at is not None

    def test_advance_completed_raises(self):
        ctx = self._setup()
        issue = self._leaf(ctx)
        issue.workflow_stage = WorkflowStage.COMPLETED
        issue.save(disable_auto_set_user=True)

        with pytest.raises(WorkflowError):
            advance(issue, ctx["executor"].id)

    def test_parent_auto_completes_when_all_subtasks_complete(self):
        ctx = self._setup()
        parent = self._issue(ctx, name="parent")
        parent.workflow_stage = WorkflowStage.SPLITTING
        parent.workflow_splitter_id = ctx["splitter"].id
        parent.save(disable_auto_set_user=True)
        child1 = self._leaf(ctx, parent=parent, name="child1")
        child2 = self._leaf(ctx, parent=parent, name="child2")

        for child in (child1, child2):
            result = advance(child, ctx["executor"].id)
            self._save(child, result)
            result = advance(child, ctx["reviewer"].id)
            self._save(child, result)

        parent.refresh_from_db()
        assert parent.workflow_stage == WorkflowStage.COMPLETED
        assert parent.completed_at is not None

    def test_parent_does_not_complete_with_open_subtask(self):
        ctx = self._setup()
        parent = self._issue(ctx, name="parent")
        parent.workflow_stage = WorkflowStage.SPLITTING
        parent.workflow_splitter_id = ctx["splitter"].id
        parent.save(disable_auto_set_user=True)
        child1 = self._leaf(ctx, parent=parent, name="child1")
        self._leaf(ctx, parent=parent, name="child2")

        result = advance(child1, ctx["executor"].id)
        self._save(child1, result)
        result = advance(child1, ctx["reviewer"].id)
        self._save(child1, result)

        parent.refresh_from_db()
        assert parent.workflow_stage == WorkflowStage.SPLITTING

    def test_return_execution_to_splitter(self):
        ctx = self._setup()
        issue = self._leaf(ctx)

        result = return_task(issue, ctx["executor"].id, "上游依赖缺失")
        issue.save(disable_auto_set_user=True)

        assert result["action"] == "returned"
        assert issue.workflow_stage == WorkflowStage.RETURNED
        assert issue.workflow_returned_to == WorkflowStage.SPLITTING
        assert issue.workflow_returned_from == WorkflowStage.EXECUTION
        assert issue.workflow_current_handler_id == ctx["splitter"].id
        assert len(issue.workflow_history) == 1

    def test_return_requires_note(self):
        ctx = self._setup()
        issue = self._leaf(ctx)

        with pytest.raises(WorkflowError):
            return_task(issue, ctx["executor"].id, "")

    def test_return_review_quality_to_executor(self):
        ctx = self._setup()
        issue = self._leaf(ctx)
        advance(issue, ctx["executor"].id)
        issue.save(disable_auto_set_user=True)

        return_task(issue, ctx["reviewer"].id, "功能缺陷", target="executor")
        issue.save(disable_auto_set_user=True)
        assert issue.workflow_returned_to == WorkflowStage.EXECUTION
        assert issue.workflow_current_handler_id == ctx["executor"].id

    def test_return_review_dependency_to_splitter(self):
        ctx = self._setup()
        issue = self._leaf(ctx)
        advance(issue, ctx["executor"].id)
        issue.save(disable_auto_set_user=True)

        return_task(issue, ctx["reviewer"].id, "拆分不合理", target="splitter")
        issue.save(disable_auto_set_user=True)
        assert issue.workflow_returned_to == WorkflowStage.SPLITTING
        assert issue.workflow_current_handler_id == ctx["splitter"].id

    def test_escalate_chain_to_reporter(self):
        ctx = self._setup()
        issue = self._leaf(ctx)
        return_task(issue, ctx["executor"].id, "卡点")
        issue.save(disable_auto_set_user=True)

        escalate(issue, ctx["splitter"].id, "拆分者也解决不了")
        issue.save(disable_auto_set_user=True)
        assert issue.workflow_returned_to == WorkflowStage.EVALUATION
        assert issue.workflow_current_handler_id == ctx["evaluator"].id

        escalate(issue, ctx["evaluator"].id, "评估者也解决不了")
        issue.save(disable_auto_set_user=True)
        assert issue.workflow_returned_to == REPORTER_STAGE
        assert issue.workflow_current_handler_id == ctx["reporter"].id

    def test_escalate_at_reporter_raises(self):
        ctx = self._setup()
        issue = self._leaf(ctx)
        return_task(issue, ctx["executor"].id, "卡点")
        issue.save(disable_auto_set_user=True)
        escalate(issue, ctx["splitter"].id, "上抛")
        issue.save(disable_auto_set_user=True)
        escalate(issue, ctx["evaluator"].id, "上抛")
        issue.save(disable_auto_set_user=True)

        with pytest.raises(WorkflowError):
            escalate(issue, ctx["reporter"].id, "到头了")

    def test_escalate_requires_returned_state(self):
        ctx = self._setup()
        issue = self._leaf(ctx)

        with pytest.raises(WorkflowError):
            escalate(issue, ctx["executor"].id, "不能直接上抛")

    def test_return_from_returned_escalates(self):
        ctx = self._setup()
        issue = self._leaf(ctx)
        return_task(issue, ctx["executor"].id, "卡点")
        issue.save(disable_auto_set_user=True)

        result = return_task(issue, ctx["splitter"].id, "继续上抛")
        issue.save(disable_auto_set_user=True)

        assert result["action"] == "escalated"
        assert issue.workflow_returned_to == WorkflowStage.EVALUATION
        assert issue.workflow_current_handler_id == ctx["evaluator"].id

    def test_resolve_returned_task_back_to_origin(self):
        ctx = self._setup()
        issue = self._leaf(ctx)
        return_task(issue, ctx["executor"].id, "卡点")
        issue.save(disable_auto_set_user=True)

        result = advance(issue, ctx["splitter"].id, "已解决")
        issue.save(disable_auto_set_user=True)

        assert result["action"] == "resolved"
        assert issue.workflow_stage == WorkflowStage.EXECUTION
        assert issue.workflow_current_handler_id == ctx["executor"].id
        assert issue.workflow_returned_from is None
        assert issue.workflow_returned_to is None
