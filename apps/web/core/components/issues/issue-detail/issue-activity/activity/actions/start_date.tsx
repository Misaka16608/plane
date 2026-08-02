/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { CalendarDays } from "lucide-react";
import { useTranslation } from "@plane/i18n";
// hooks
import { renderFormattedDate } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";
import { interpolateNodes } from "./helpers/i18n";
// helpers

type TIssueStartDateActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueStartDateActivity = observer(function IssueStartDateActivity(props: TIssueStartDateActivity) {
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
      icon={<CalendarDays size={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      {interpolateNodes(
        t,
        showIssue
          ? activity.new_value
            ? "issue_activity.start_date.set_for_issue"
            : "issue_activity.start_date.removed_from_issue"
          : activity.new_value
            ? "issue_activity.start_date.set"
            : "issue_activity.start_date.removed",
        {
          date: activity.new_value ? (
            <span className="font-medium text-primary">{renderFormattedDate(activity.new_value)}</span>
          ) : undefined,
          issue: showIssue ? <IssueLink activityId={activityId} /> : undefined,
        }
      )}
      {t("issue_activity.period")}
    </IssueActivityBlockComponent>
  );
});
