/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssueActivity } from "@plane/types";

export const getRelationActivityContent = (activity: TIssueActivity | undefined): string | undefined => {
  if (!activity) return;

  switch (activity.field) {
    case "blocking":
      return activity.old_value === ""
        ? "issue_activity.blocking.added_this_work_item"
        : "issue_activity.blocking.removed";
    case "blocked_by":
      return activity.old_value === ""
        ? "issue_activity.blocked_by.added_this_work_item"
        : "issue_activity.blocked_by.removed_this_work_item";
    case "duplicate":
      return activity.old_value === ""
        ? "issue_activity.duplicate.added_this_work_item"
        : "issue_activity.duplicate.removed_this_work_item";
    case "relates_to":
      return activity.old_value === ""
        ? "issue_activity.relates_to.added_this_work_item"
        : "issue_activity.relates_to.removed";
  }

  return;
};
