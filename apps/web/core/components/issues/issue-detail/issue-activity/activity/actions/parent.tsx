/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { ParentPropertyIcon } from "@plane/propel/icons";
import { useTranslation } from "@plane/i18n";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";
import { interpolateNodes } from "./helpers/i18n";

type TIssueParentActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueParentActivity = observer(function IssueParentActivity(props: TIssueParentActivity) {
  const { activityId, showIssue = true, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const { t } = useTranslation();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<ParentPropertyIcon className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      {interpolateNodes(
        t,
        showIssue
          ? activity.new_value
            ? "issue_activity.parent.set_for_issue"
            : "issue_activity.parent.removed_from_issue"
          : activity.new_value
            ? "issue_activity.parent.set"
            : "issue_activity.parent.removed",
        {
          parent: <span className="font-medium text-primary">{activity.new_value || activity.old_value}</span>,
          issue: showIssue ? <IssueLink activityId={activityId} /> : undefined,
        }
      )}
      {t("issue_activity.period")}
    </IssueActivityBlockComponent>
  );
});
