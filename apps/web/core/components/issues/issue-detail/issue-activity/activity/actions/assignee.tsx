/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// icons
import { MembersPropertyIcon } from "@plane/propel/icons";
import { useTranslation } from "@plane/i18n";
// hooks;
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";
import { interpolateNodes } from "./helpers/i18n";

type TIssueAssigneeActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueAssigneeActivity = observer(function IssueAssigneeActivity(props: TIssueAssigneeActivity) {
  const { activityId, ends, showIssue = true } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const { t } = useTranslation();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<MembersPropertyIcon className="h-3.5 w-3.5 flex-shrink-0 text-secondary" />}
      activityId={activityId}
      ends={ends}
    >
      {interpolateNodes(
        t,
        showIssue
          ? activity.old_value === ""
            ? "issue_activity.assignee.added_to_issue"
            : "issue_activity.assignee.removed_from_issue"
          : activity.old_value === ""
            ? "issue_activity.assignee.added"
            : "issue_activity.assignee.removed",
        {
          user: (
            <a
              href={`/${activity.workspace_detail?.slug}/profile/${activity.new_identifier ?? activity.old_identifier}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center font-medium text-primary capitalize hover:underline"
            >
              {activity.new_value && activity.new_value !== "" ? activity.new_value : activity.old_value}
            </a>
          ),
          issue: showIssue ? <IssueLink activityId={activityId} /> : undefined,
        }
      )}
      {t("issue_activity.period")}
    </IssueActivityBlockComponent>
  );
});
