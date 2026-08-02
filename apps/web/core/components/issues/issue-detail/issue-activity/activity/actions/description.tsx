/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlignLeft } from "lucide-react";
import { useTranslation } from "@plane/i18n";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent, IssueLink } from "./";
import { interpolateNodes } from "./helpers/i18n";

type TIssueDescriptionActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueDescriptionActivity = observer(function IssueDescriptionActivity(props: TIssueDescriptionActivity) {
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
      icon={<AlignLeft size={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      {interpolateNodes(
        t,
        showIssue ? "issue_activity.description.updated_of_issue" : "issue_activity.description.updated",
        { issue: showIssue ? <IssueLink activityId={activityId} /> : undefined }
      )}
      {t("issue_activity.period")}
    </IssueActivityBlockComponent>
  );
});
