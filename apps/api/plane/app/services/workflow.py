# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workflow transition logic for the Codex role integration.

Each function mutates the passed ``Issue`` instance (and, for parent
completion, collects additionally mutated objects in ``result["related"]``).
Callers are responsible for persisting the mutated instances.
"""

from django.utils import timezone

from plane.db.models import Issue, WorkflowStage

# The reporter is the origin of the issue, not a pipeline stage.
REPORTER_STAGE = "reporter"

# Escalation order for returned tasks (leaf pipeline positions only).
ESCALATION_CHAIN = [
    WorkflowStage.EXECUTION,
    WorkflowStage.SPLITTING,
    WorkflowStage.EVALUATION,
]


class WorkflowError(Exception):
    """Raised when a workflow transition is invalid."""

    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def handler_id_for_stage(issue, stage):
    """Return the user id responsible for a pipeline stage of an issue."""
    if stage == WorkflowStage.EVALUATION:
        return issue.workflow_evaluator_id
    if stage == WorkflowStage.SPLITTING:
        return issue.workflow_splitter_id
    if stage == WorkflowStage.EXECUTION:
        return issue.workflow_executor_id
    if stage == WorkflowStage.REVIEW:
        return issue.workflow_reviewer_id
    if stage == REPORTER_STAGE:
        return issue.created_by_id
    return None


def _append_history(issue, action, actor_id, note=""):
    history = list(issue.workflow_history or [])
    history.append(
        {
            "action": action,
            "stage": issue.workflow_stage,
            "actor_id": str(actor_id),
            "note": note or "",
            "at": timezone.now().isoformat(),
        }
    )
    issue.workflow_history = history


def _complete_issue(issue):
    issue.workflow_stage = WorkflowStage.COMPLETED
    issue.workflow_current_handler_id = None
    issue.workflow_returned_from = None
    issue.workflow_returned_to = None
    issue.completed_at = timezone.now()


def _complete_parent_if_ready(issue, related):
    """Auto-complete the parent once every subtask is completed."""
    parent = issue.parent
    if parent is None or parent.workflow_stage == WorkflowStage.COMPLETED:
        return
    # The issue being saved is already COMPLETED in memory; exclude it from the
    # DB check so a not-yet-persisted stage change does not block completion.
    siblings = Issue.objects.filter(parent=parent).exclude(pk=issue.pk)
    if not siblings.exists():
        return
    if siblings.exclude(workflow_stage=WorkflowStage.COMPLETED).exists():
        return
    _complete_issue(parent)
    related.append(parent)


def assign(issue, actor_id, data, note=""):
    """Assign stage handlers and optionally move the issue to a stage."""
    stage = data.get("workflow_stage")
    if stage is not None and stage not in WorkflowStage.values:
        raise WorkflowError(f"Invalid workflow stage: {stage}")

    if stage is not None:
        issue.workflow_stage = stage

    for attr in (
        "workflow_evaluator",
        "workflow_splitter",
        "workflow_executor",
        "workflow_reviewer",
    ):
        value = data.get(attr)
        if value is not None:
            setattr(issue, f"{attr}_id", value)

    handler = data.get("workflow_current_handler")
    if handler is not None:
        issue.workflow_current_handler_id = handler
    elif stage is not None:
        issue.workflow_current_handler_id = handler_id_for_stage(issue, stage)

    _append_history(issue, "assigned", actor_id, note)
    return {"action": "assigned", "stage": issue.workflow_stage}


def advance(issue, actor_id, note=""):
    """Advance an issue to its next stage (or resolve a returned task)."""
    if issue.workflow_stage == WorkflowStage.COMPLETED:
        raise WorkflowError("Task is already completed")

    # A returned task is resolved by its current holder: move it back to the
    # stage it was returned from, with the original handler.
    if issue.workflow_stage == WorkflowStage.RETURNED:
        origin = issue.workflow_returned_from
        if not origin:
            raise WorkflowError("Returned task has no recorded origin stage")
        issue.workflow_stage = origin
        issue.workflow_current_handler_id = handler_id_for_stage(issue, origin)
        issue.workflow_returned_from = None
        issue.workflow_returned_to = None
        _append_history(issue, "resolved", actor_id, note)
        return {"action": "resolved", "stage": issue.workflow_stage, "related": []}

    next_stage = None
    if issue.workflow_stage == WorkflowStage.EVALUATION:
        next_stage = WorkflowStage.SPLITTING
    elif issue.workflow_stage == WorkflowStage.SPLITTING:
        if issue.parent_issue.exists():
            raise WorkflowError("Parent issue completes automatically once all subtasks are completed")
        next_stage = WorkflowStage.EXECUTION
    elif issue.workflow_stage == WorkflowStage.EXECUTION:
        next_stage = WorkflowStage.REVIEW
    elif issue.workflow_stage == WorkflowStage.REVIEW:
        next_stage = WorkflowStage.COMPLETED
    else:
        raise WorkflowError("Task is not in a stage that can be advanced")

    related = []
    issue.workflow_stage = next_stage
    issue.workflow_returned_from = None
    issue.workflow_returned_to = None

    if next_stage == WorkflowStage.COMPLETED:
        issue.workflow_current_handler_id = None
        issue.completed_at = timezone.now()
        _complete_parent_if_ready(issue, related)
        _append_history(issue, "completed", actor_id, note)
        return {"action": "completed", "stage": WorkflowStage.COMPLETED, "related": related}

    issue.workflow_current_handler_id = handler_id_for_stage(issue, next_stage)
    _append_history(issue, "advanced", actor_id, note)
    return {"action": "advanced", "stage": next_stage, "related": related}


def return_task(issue, actor_id, note, target=None):
    """Return a task to the previous-level handler (escalation)."""
    if not note or not note.strip():
        raise WorkflowError("note is required to return a task")
    if issue.workflow_stage == WorkflowStage.COMPLETED:
        raise WorkflowError("Cannot return a completed task")

    # A task that is already returned escalates one level further up.
    if issue.workflow_stage == WorkflowStage.RETURNED:
        return escalate(issue, actor_id, note)

    original_stage = issue.workflow_stage
    if original_stage == WorkflowStage.EVALUATION:
        target_stage = REPORTER_STAGE
    elif original_stage == WorkflowStage.SPLITTING:
        target_stage = WorkflowStage.EVALUATION
    elif original_stage == WorkflowStage.EXECUTION:
        target_stage = WorkflowStage.SPLITTING
    elif original_stage == WorkflowStage.REVIEW:
        if target not in (None, "executor", "splitter"):
            raise WorkflowError("Invalid return target for review stage")
        target_stage = WorkflowStage.EXECUTION if target in (None, "executor") else WorkflowStage.SPLITTING
    else:
        raise WorkflowError("Task is not in a stage that can be returned")

    target_handler_id = handler_id_for_stage(issue, target_stage)
    if target_handler_id is None:
        raise WorkflowError("No handler is assigned for the target stage")

    issue.workflow_stage = WorkflowStage.RETURNED
    issue.workflow_returned_from = original_stage
    issue.workflow_returned_to = target_stage
    issue.workflow_current_handler_id = target_handler_id
    _append_history(issue, "returned", actor_id, note)
    return {"action": "returned", "stage": WorkflowStage.RETURNED, "target_stage": target_stage, "related": []}


def escalate(issue, actor_id, note=""):
    """Escalate a returned task one level further up."""
    if issue.workflow_stage != WorkflowStage.RETURNED:
        raise WorkflowError("Only a returned task can be escalated")

    current = issue.workflow_returned_to
    if current == REPORTER_STAGE:
        raise WorkflowError("Task is already with the reporter and cannot be escalated further")

    try:
        idx = ESCALATION_CHAIN.index(current)
    except ValueError:
        raise WorkflowError("Task is not in an escapable return state")

    target_stage = REPORTER_STAGE if idx == len(ESCALATION_CHAIN) - 1 else ESCALATION_CHAIN[idx + 1]
    target_handler_id = handler_id_for_stage(issue, target_stage)
    if target_handler_id is None:
        raise WorkflowError("No handler is assigned for the escalation target stage")

    issue.workflow_returned_to = target_stage
    issue.workflow_current_handler_id = target_handler_id
    _append_history(issue, "escalated", actor_id, note)
    return {"action": "escalated", "stage": WorkflowStage.RETURNED, "target_stage": target_stage, "related": []}
