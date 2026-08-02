/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "@plane/i18n";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";
import { interpolateNodes } from "./helpers/i18n";

type TIssueLinkActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueLinkActivity = observer(function IssueLinkActivity(props: TIssueLinkActivity) {
  const { activityId, showIssue = false, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const { t } = useTranslation();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<MessageSquare size={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      {interpolateNodes(
        t,
        showIssue
          ? activity.verb === "created"
            ? "issue_activity.link.added_to_issue"
            : activity.verb === "updated"
              ? "issue_activity.link.updated_from_issue"
              : "issue_activity.link.removed_from_issue"
          : activity.verb === "created"
            ? "issue_activity.link.added"
            : activity.verb === "updated"
              ? "issue_activity.link.updated"
              : "issue_activity.link.removed",
        {
          link: (
            <a
              href={activity.verb === "created" ? `${activity.new_value}` : `${activity.old_value}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              {t("issue_activity.link_word")}
            </a>
          ),
          issue: showIssue ? <IssueLink activityId={activityId} /> : undefined,
        }
      )}
      {t("issue_activity.period")}
    </IssueActivityBlockComponent>
  );
});
