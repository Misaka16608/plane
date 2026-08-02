/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { LabelPropertyIcon } from "@plane/propel/icons";
import { useTranslation } from "@plane/i18n";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useLabel } from "@/hooks/store/use-label";
// components
import { IssueActivityBlockComponent, IssueLink, LabelActivityChip } from "./";
import { interpolateNodes } from "./helpers/i18n";

type TIssueLabelActivity = { activityId: string; showIssue?: boolean; ends: "top" | "bottom" | undefined };

export const IssueLabelActivity = observer(function IssueLabelActivity(props: TIssueLabelActivity) {
  const { activityId, showIssue = true, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const { getLabelById } = useLabel();
  const { t } = useTranslation();

  const activity = getActivityById(activityId);
  const oldLabelColor = getLabelById(activity?.old_identifier ?? "")?.color;
  const newLabelColor = getLabelById(activity?.new_identifier ?? "")?.color;

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<LabelPropertyIcon height={14} width={14} className="text-secondary" />}
      activityId={activityId}
      ends={ends}
    >
      {interpolateNodes(
        t,
        showIssue
          ? activity.old_value === ""
            ? "issue_activity.label.added_to_issue"
            : "issue_activity.label.removed_from_issue"
          : activity.old_value === ""
            ? "issue_activity.label.added"
            : "issue_activity.label.removed",
        {
          label: (
            <LabelActivityChip
              name={activity.old_value === "" ? activity.new_value : activity.old_value}
              color={activity.old_value === "" ? newLabelColor : oldLabelColor}
            />
          ),
          issue: showIssue ? <IssueLink activityId={activityId} /> : undefined,
        }
      )}
    </IssueActivityBlockComponent>
  );
});
