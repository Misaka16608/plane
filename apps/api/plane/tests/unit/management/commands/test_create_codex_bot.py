# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from plane.db.models import APIToken, BotTypeEnum, ProjectMember, User, WorkspaceMember
from plane.tests.factories import ProjectFactory, WorkspaceFactory


@pytest.mark.unit
@pytest.mark.django_db
class TestCreateCodexBot:
    def test_creates_bot_member_and_token(self):
        workspace = WorkspaceFactory()

        call_command("create_codex_bot", workspace=workspace.slug)

        bot = User.objects.get(username="codex_bot")
        assert bot.is_bot is True
        assert bot.bot_type == BotTypeEnum.CODEX
        assert WorkspaceMember.objects.filter(workspace=workspace, member=bot, role=15, is_active=True).exists()
        token = APIToken.objects.get(user=bot)
        assert token.user_type == 1
        assert token.workspace_id == workspace.id
        assert token.token.startswith("plane_api_")

    def test_joins_project_when_requested(self):
        workspace = WorkspaceFactory()
        project = ProjectFactory(workspace=workspace)

        call_command("create_codex_bot", workspace=workspace.slug, project=str(project.id))

        bot = User.objects.get(username="codex_bot")
        assert ProjectMember.objects.filter(project=project, workspace=workspace, member=bot, role=15).exists()

    def test_idempotent_for_user_and_membership(self):
        workspace = WorkspaceFactory()

        call_command("create_codex_bot", workspace=workspace.slug)
        call_command("create_codex_bot", workspace=workspace.slug)

        bot = User.objects.get(username="codex_bot")
        assert User.objects.filter(username="codex_bot").count() == 1
        assert WorkspaceMember.objects.filter(workspace=workspace, member=bot).count() == 1
        assert APIToken.objects.filter(user=bot).count() == 2

    def test_missing_workspace_raises(self):
        with pytest.raises(CommandError):
            call_command("create_codex_bot", workspace="does-not-exist")
