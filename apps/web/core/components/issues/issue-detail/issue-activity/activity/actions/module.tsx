/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// hooks
import { ModuleIcon } from "@plane/propel/icons";
import { useTranslation } from "@plane/i18n";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent } from "./";
import { interpolateNodes } from "./helpers/i18n";
// icons

type TIssueModuleActivity = { activityId: string; ends: "top" | "bottom" | undefined };

export const IssueModuleActivity = observer(function IssueModuleActivity(props: TIssueModuleActivity) {
  const { activityId, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const { t } = useTranslation();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<ModuleIcon className="h-4 w-4 flex-shrink-0 text-secondary" />}
      activityId={activityId}
      ends={ends}
    >
      {activity.verb === "created"
        ? interpolateNodes(t, "issue_activity.module.added_this_work_item", {
            module: (
              <a
                href={`/${activity.workspace_detail?.slug}/projects/${activity.project}/modules/${activity.new_identifier}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 truncate font-medium text-primary hover:underline"
              >
                <span className="truncate">{activity.new_value}</span>
              </a>
            ),
          })
        : activity.verb === "updated"
          ? interpolateNodes(t, "issue_activity.module.set", {
              module: (
                <a
                  href={`/${activity.workspace_detail?.slug}/projects/${activity.project}/modules/${activity.new_identifier}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 truncate font-medium text-primary hover:underline"
                >
                  <span className="truncate">{activity.new_value}</span>
                </a>
              ),
            })
          : interpolateNodes(t, "issue_activity.module.removed_this_work_item", {
              module: (
                <a
                  href={`/${activity.workspace_detail?.slug}/projects/${activity.project}/modules/${activity.old_identifier}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 truncate font-medium text-primary hover:underline"
                >
                  <span className="truncate">{activity.old_value}</span>
                </a>
              ),
            })}
    </IssueActivityBlockComponent>
  );
});
