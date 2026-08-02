# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workflow transition endpoints (assign / advance / return / escalate)."""

from django.utils.html import escape
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE
from plane.app.permissions.base import allow_permission
from plane.app.serializers import IssueSerializer
from plane.app.services.workflow import WorkflowError, advance, assign, escalate, return_task
from plane.app.views.base import BaseViewSet
from plane.db.models import Issue, IssueComment, Notification, ProjectMember


class IssueWorkflowViewSet(BaseViewSet):
    model = Issue
    serializer_class = IssueSerializer

    def get_queryset(self):
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"), project_id=self.kwargs.get("project_id"))
        )

    def _get_issue(self, slug, project_id, issue_id):
        return Issue.objects.get(workspace__slug=slug, project_id=project_id, pk=issue_id)

    def _is_project_admin(self, request, slug, project_id):
        return ProjectMember.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            member=request.user,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()

    def _check_handler(self, request, issue, slug, project_id):
        if issue.workflow_current_handler_id == request.user.id:
            return
        if self._is_project_admin(request, slug, project_id):
            return
        raise WorkflowError("Only the current handler (or a project admin) can perform this action", 403)

    def _validate_member_ids(self, member_ids, slug, project_id):
        ids = [str(member_id) for member_id in member_ids if member_id]
        if not ids:
            return
        valid_ids = set(
            ProjectMember.objects.filter(
                project_id=project_id,
                workspace__slug=slug,
                is_active=True,
                member_id__in=ids,
            ).values_list("member_id", flat=True)
        )
        valid_ids = {str(member_id) for member_id in valid_ids}
        missing = [member_id for member_id in ids if member_id not in valid_ids]
        if missing:
            raise WorkflowError(f"Members are not active project members: {', '.join(missing)}")

    def _write_comment(self, request, issue, note):
        if not note:
            return
        IssueComment.objects.create(
            workspace_id=issue.workspace_id,
            project_id=issue.project_id,
            issue=issue,
            actor=request.user,
            comment_stripped=note,
            comment_html=f"<p>{escape(note)}</p>",
        )

    def _notify(self, request, issue, receiver_id, title, note):
        if not receiver_id:
            return
        Notification.objects.create(
            workspace_id=issue.workspace_id,
            project_id=issue.project_id,
            entity_identifier=issue.id,
            entity_name="issue",
            title=title,
            message={"note": note},
            message_stripped=note,
            sender="in_app:issue_workflow",
            triggered_by=request.user,
            receiver_id=receiver_id,
        )

    def _save_all(self, issue, related):
        issue.save()
        for obj in related:
            obj.save()

    def _response(self, issue):
        serializer = IssueSerializer(issue)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def assign(self, request, slug, project_id, issue_id):
        issue = self._get_issue(slug, project_id, issue_id)
        member_ids = [
            request.data.get("workflow_evaluator"),
            request.data.get("workflow_splitter"),
            request.data.get("workflow_executor"),
            request.data.get("workflow_reviewer"),
            request.data.get("workflow_current_handler"),
        ]
        try:
            self._validate_member_ids(member_ids, slug, project_id)
            assign(issue, request.user.id, request.data)
            self._save_all(issue, [])
        except WorkflowError as e:
            return Response({"error": e.message}, status=e.status_code)
        return self._response(issue)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def advance(self, request, slug, project_id, issue_id):
        issue = self._get_issue(slug, project_id, issue_id)
        note = request.data.get("note", "")
        try:
            self._check_handler(request, issue, slug, project_id)
            result = advance(issue, request.user.id, note)
            self._save_all(issue, result.get("related", []))
            if result["action"] == "resolved":
                self._notify(request, issue, issue.workflow_current_handler_id, "任务已返回原处", note)
        except WorkflowError as e:
            return Response({"error": e.message}, status=e.status_code)
        return self._response(issue)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def return_task(self, request, slug, project_id, issue_id):
        issue = self._get_issue(slug, project_id, issue_id)
        note = request.data.get("note", "")
        target = request.data.get("target")
        try:
            self._check_handler(request, issue, slug, project_id)
            result = return_task(issue, request.user.id, note, target)
            self._write_comment(request, issue, note)
            self._save_all(issue, result.get("related", []))
            self._notify(request, issue, issue.workflow_current_handler_id, "任务被退回", note)
        except WorkflowError as e:
            return Response({"error": e.message}, status=e.status_code)
        return self._response(issue)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def escalate(self, request, slug, project_id, issue_id):
        issue = self._get_issue(slug, project_id, issue_id)
        note = request.data.get("note", "")
        try:
            self._check_handler(request, issue, slug, project_id)
            result = escalate(issue, request.user.id, note)
            self._write_comment(request, issue, note)
            self._save_all(issue, result.get("related", []))
            self._notify(request, issue, issue.workflow_current_handler_id, "任务上抛", note)
        except WorkflowError as e:
            return Response({"error": e.message}, status=e.status_code)
        return self._response(issue)
