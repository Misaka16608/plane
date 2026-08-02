# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Create the Codex bot account and join it to a workspace/project."""

import uuid

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError

from plane.db.models import APIToken, BotTypeEnum, Project, ProjectMember, User, Workspace, WorkspaceMember


class Command(BaseCommand):
    help = (
        "Create the Codex bot user (is_bot=True), issue an API token for it, "
        "and add it as a MEMBER to the given workspace (and optionally a project)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--username", default="codex_bot", help="Unique username for the bot")
        parser.add_argument("--email", default="codex@plane.local", help="Email for the bot (used on creation only)")
        parser.add_argument("--display-name", default="Codex", help="Display name shown in the UI")
        parser.add_argument("--workspace", required=True, help="Workspace slug to join")
        parser.add_argument("--project", help="Project id (UUID) to join, in addition to the workspace")
        parser.add_argument("--role", type=int, choices=[5, 15], default=15, help="Workspace/project role (5=guest, 15=member)")
        parser.add_argument("--label", default="Codex API Token", help="Label for the issued API token")

    def handle(self, *args, **options):
        workspace = Workspace.objects.filter(slug=options["workspace"]).first()
        if workspace is None:
            raise CommandError(f"Workspace with slug '{options['workspace']}' does not exist")

        user, created = User.objects.get_or_create(
            username=options["username"],
            defaults={
                "email": options["email"],
                "display_name": options["display_name"],
                "first_name": options["display_name"],
                "last_name": "",
                "is_bot": True,
                "bot_type": BotTypeEnum.CODEX,
                "password": make_password(uuid.uuid4().hex),
                "is_password_autoset": True,
            },
        )
        user.is_bot = True
        user.bot_type = BotTypeEnum.CODEX
        user.display_name = options["display_name"]
        user.is_active = True
        user.save()

        WorkspaceMember.objects.update_or_create(
            workspace=workspace,
            member=user,
            defaults={"role": options["role"], "is_active": True},
        )

        project = None
        if options["project"]:
            project = Project.objects.filter(id=options["project"], workspace=workspace).first()
            if project is None:
                raise CommandError(f"Project '{options['project']}' does not exist in workspace '{workspace.slug}'")
            ProjectMember.objects.update_or_create(
                project=project,
                workspace=workspace,
                member=user,
                defaults={"role": options["role"], "is_active": True},
            )

        api_token = APIToken.objects.create(
            user=user,
            user_type=1,
            label=options["label"],
            description="API token for the Codex bot (runner automation)",
            workspace=workspace,
        )

        self.stdout.write(self.style.SUCCESS(f"Codex bot ready: {user.username} ({user.id})"))
        self.stdout.write(f"  workspace: {workspace.slug}" + (f"  project: {project.id}" if project else ""))
        self.stdout.write(self.style.WARNING(f"  API token (store it once, it is not shown again): {api_token.token}"))
