/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// store hooks
// icons
import {
  TagIcon,
  CopyPlus,
  Calendar,
  Link2Icon,
  Users2Icon,
  ArchiveIcon,
  PaperclipIcon,
  TriangleIcon,
  LayoutGridIcon,
  SignalMediumIcon,
  MessageSquareIcon,
  UsersIcon,
} from "lucide-react";
import {
  BlockedIcon,
  BlockerIcon,
  CycleIcon,
  EpicIcon,
  IntakeIcon,
  ModuleIcon,
  RelatedIcon,
  WorkItemsIcon,
} from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import type { IIssueActivity } from "@plane/types";
import { useTranslation } from "@plane/i18n";
import { renderFormattedDate, generateWorkItemLink, capitalizeFirstLetter } from "@plane/utils";
// helpers
import { useLabel } from "@/hooks/store/use-label";
import { usePlatformOS } from "@/hooks/use-platform-os";
// types

export function IssueLink({ activity }: { activity: IIssueActivity }) {
  // router params
  const { workspaceSlug } = useParams();
  const { isMobile } = usePlatformOS();
  const { t } = useTranslation();

  const workItemLink = generateWorkItemLink({
    workspaceSlug: workspaceSlug?.toString() ?? activity.workspace_detail?.slug,
    projectId: activity?.project,
    issueId: activity?.issue,
    projectIdentifier: activity?.project_detail?.identifier,
    sequenceId: activity?.issue_detail?.sequence_id,
  });

  return (
    <Tooltip
      tooltipContent={
        activity?.issue_detail ? activity.issue_detail.name : t("issue_activity.work_item_deleted_tooltip")
      }
      isMobile={isMobile}
    >
      {activity?.issue_detail ? (
        <a
          aria-disabled={activity.issue === null}
          href={workItemLink}
          target={activity.issue === null ? "_self" : "_blank"}
          rel={activity.issue === null ? "" : "noopener noreferrer"}
          className="inline items-center gap-1 font-medium text-primary hover:underline"
        >
          <span className="whitespace-nowrap">{`${activity.project_detail.identifier}-${activity.issue_detail.sequence_id}`}</span>{" "}
          <span className="font-regular break-all">{activity.issue_detail?.name}</span>
        </a>
      ) : (
        <span className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-primary">
          {t("issue_activity.work_item_deleted")}{" "}
        </span>
      )}
    </Tooltip>
  );
}

function UserLink({ activity }: { activity: IIssueActivity }) {
  // router params
  const { workspaceSlug } = useParams();

  return (
    <a
      href={`/${workspaceSlug ?? activity.workspace_detail?.slug}/profile/${
        activity.new_identifier ?? activity.old_identifier
      }`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center font-medium text-primary hover:underline"
    >
      {activity.new_value && activity.new_value !== "" ? activity.new_value : activity.old_value}
    </a>
  );
}

const LabelPill = observer(function LabelPill({ labelId, workspaceSlug }: { labelId: string; workspaceSlug: string }) {
  // store hooks
  const { workspaceLabels, fetchWorkspaceLabels } = useLabel();

  useEffect(() => {
    if (!workspaceLabels) fetchWorkspaceLabels(workspaceSlug);
  }, [fetchWorkspaceLabels, workspaceLabels, workspaceSlug]);

  return (
    <span
      className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
      style={{
        backgroundColor: workspaceLabels?.find((l) => l.id === labelId)?.color ?? "#000000",
      }}
      aria-hidden="true"
    />
  );
});

type TTranslationFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * Interpolates React nodes into a translated sentence.
 *
 * The i18n wrapper only returns strings, so node placeholders are injected as
 * marker tokens (e.g. `{{issue}}` -> `@@issue@@`), the translated string is
 * split on the markers, and each marker position is replaced with the node.
 * This lets each locale keep its natural word order (e.g. Chinese puts the
 * assignee before the verb while English does not).
 */
function interpolateNodes(
  t: TTranslationFn,
  key: string,
  nodes: Record<string, React.ReactNode> = {},
  values: Record<string, unknown> = {}
): React.ReactNode {
  // i18next-icu leaves `{{name}}` placeholders untouched (ICU uses single
  // braces), so interpolation is done manually instead of passing params to t().
  let str = t(key);
  Object.entries(values).forEach(([name, value]) => {
    str = str.split(`{{${name}}}`).join(value == null ? "" : String(value));
  });
  Object.keys(nodes).forEach((name) => {
    str = str.split(`{{${name}}}`).join(`@@${name}@@`);
  });
  const parts = str.split(/@@([a-z_]+)@@/);
  return parts.map((part, index) => (
    // oxlint-disable-next-line no-array-index-key
    <Fragment key={`${index}-${part}`}>{index % 2 === 1 ? nodes[part] : part}</Fragment>
  ));
}

const getInboxUserActivityMessage = (t: TTranslationFn, activity: IIssueActivity, showIssue: boolean) => {
  switch (activity.verb) {
    case "-1":
      return t(showIssue ? "issue_activity.inbox.declined_show" : "issue_activity.inbox.declined_no_issue");
    case "0":
      return t(showIssue ? "issue_activity.inbox.snoozed_show" : "issue_activity.inbox.snoozed_no_issue");
    case "1":
      return t(showIssue ? "issue_activity.inbox.accepted_show" : "issue_activity.inbox.accepted_no_issue");
    case "2":
      return t(showIssue ? "issue_activity.inbox.duplicate_show" : "issue_activity.inbox.duplicate_no_issue");
    default:
      return t("issue_activity.inbox.updated");
  }
};

const activityLinkNode = (href: string, t: TTranslationFn) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
  >
    {t("issue_activity.link_word")}
  </a>
);

const activityCycleNode = (href: string, value: string) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline items-center gap-1 font-medium text-primary hover:underline"
  >
    <span className="break-all">{value}</span>
  </a>
);

const activityModuleNode = (href: string, value: string) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline items-center gap-1 font-medium text-primary hover:underline"
  >
    <span className="break-all">{value}</span>
  </a>
);

const activityDetails: {
  [key: string]: {
    message: (
      activity: IIssueActivity,
      showIssue: boolean,
      workspaceSlug: string,
      t: TTranslationFn
    ) => React.ReactNode;
    icon: React.ReactNode;
  };
} = {
  assignees: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      const user = <UserLink activity={activity} />;
      if (activity.old_value === "")
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.assignee.added_to_issue" : "issue_activity.assignee.added",
          {
            user,
            issue: <IssueLink activity={activity} />,
          }
        );
      return interpolateNodes(
        t,
        showIssue ? "issue_activity.assignee.removed_from_issue" : "issue_activity.assignee.removed",
        {
          user,
          issue: <IssueLink activity={activity} />,
        }
      );
    },
    icon: <Users2Icon size={12} className="text-secondary" aria-hidden="true" />,
  },
  archived_at: {
    message: (activity, _showIssue, _workspaceSlug, t) =>
      interpolateNodes(t, activity.new_value === "restore" ? "issue_activity.restored" : "issue_activity.archived", {
        issue: <IssueLink activity={activity} />,
      }),
    icon: <ArchiveIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  attachment: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      if (activity.verb === "created")
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.attachment.uploaded_to_issue" : "issue_activity.attachment.uploaded",
          { issue: <IssueLink activity={activity} /> }
        );
      return interpolateNodes(
        t,
        showIssue ? "issue_activity.attachment.removed_from_issue" : "issue_activity.attachment.removed",
        {
          issue: <IssueLink activity={activity} />,
        }
      );
    },
    icon: <PaperclipIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  description: {
    message: (activity, showIssue, _workspaceSlug, t) =>
      interpolateNodes(
        t,
        showIssue ? "issue_activity.description.updated_of_issue" : "issue_activity.description.updated",
        {
          issue: <IssueLink activity={activity} />,
        }
      ),
    icon: <MessageSquareIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  estimate_point: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      if (!activity.new_value)
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.estimate.removed_from_issue" : "issue_activity.estimate.removed",
          {
            issue: <IssueLink activity={activity} />,
          }
        );
      return interpolateNodes(
        t,
        showIssue ? "issue_activity.estimate.set_for_issue" : "issue_activity.estimate.set",
        { issue: <IssueLink activity={activity} /> },
        { value: activity.new_value }
      );
    },
    icon: <TriangleIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  issue: {
    message: (activity, _showIssue, _workspaceSlug, t) => {
      if (activity.verb === "created")
        return interpolateNodes(t, "issue_activity.issue.created", { issue: <IssueLink activity={activity} /> });
      if (activity.verb === "converted")
        return interpolateNodes(t, "issue_activity.issue.converted_to_epic", {
          issue: <IssueLink activity={activity} />,
        });
      return interpolateNodes(t, "issue_activity.issue.deleted", { issue: <IssueLink activity={activity} /> });
    },
    icon: <WorkItemsIcon width={12} height={12} className="text-secondary" aria-hidden="true" />,
  },
  epic: {
    message: (activity, _showIssue, _workspaceSlug, t) => {
      if (activity.verb === "created")
        return interpolateNodes(t, "issue_activity.issue.created", { issue: <IssueLink activity={activity} /> });
      if (activity.verb === "converted")
        return interpolateNodes(t, "issue_activity.epic.converted_to_work_item", {
          issue: <IssueLink activity={activity} />,
        });
      return interpolateNodes(t, "issue_activity.issue.deleted", { issue: <IssueLink activity={activity} /> });
    },
    icon: <EpicIcon width={12} height={12} className="text-secondary" aria-hidden="true" />,
  },
  labels: {
    message: (activity, showIssue, workspaceSlug, t) => {
      const labelNode = (labelId: string, value: string) => (
        <span className="inline-flex items-center gap-2 rounded-full border border-strong px-2 py-0.5 text-11">
          <LabelPill labelId={labelId} workspaceSlug={workspaceSlug} />
          <span className="line-clamp-1 flex-shrink font-medium break-all text-primary">{value}</span>
        </span>
      );
      if (activity.old_value === "")
        return interpolateNodes(t, showIssue ? "issue_activity.label.added_to_issue" : "issue_activity.label.added", {
          label: labelNode(activity.new_identifier ?? "", activity.new_value ?? ""),
          issue: <IssueLink activity={activity} />,
        });
      return interpolateNodes(
        t,
        showIssue ? "issue_activity.label.removed_from_issue" : "issue_activity.label.removed",
        {
          label: labelNode(activity.old_identifier ?? "", activity.old_value ?? ""),
          issue: <IssueLink activity={activity} />,
        }
      );
    },
    icon: <TagIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  link: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      if (activity.verb === "created")
        return interpolateNodes(t, showIssue ? "issue_activity.link.added_to_issue" : "issue_activity.link.added", {
          link: activityLinkNode(activity.new_value ?? "", t),
          issue: <IssueLink activity={activity} />,
        });
      if (activity.verb === "updated")
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.link.updated_from_issue" : "issue_activity.link.updated",
          {
            link: activityLinkNode(activity.old_value ?? "", t),
            issue: <IssueLink activity={activity} />,
          }
        );
      return interpolateNodes(t, showIssue ? "issue_activity.link.removed_from_issue" : "issue_activity.link.removed", {
        link: activityLinkNode(activity.old_value ?? "", t),
        issue: <IssueLink activity={activity} />,
      });
    },
    icon: <Link2Icon size={12} className="text-secondary" aria-hidden="true" />,
  },
  cycles: {
    message: (activity, showIssue, workspaceSlug, t) => {
      if (activity.verb === "created")
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.cycle.added" : "issue_activity.cycle.added_this_work_item",
          {
            issue: <IssueLink activity={activity} />,
            cycle: activityCycleNode(
              `/${workspaceSlug}/projects/${activity.project}/cycles/${activity.new_identifier}`,
              activity.new_value ?? ""
            ),
          }
        );
      if (activity.verb === "updated")
        return interpolateNodes(t, "issue_activity.cycle.set", {
          cycle: activityCycleNode(
            `/${workspaceSlug}/projects/${activity.project}/cycles/${activity.new_identifier}`,
            activity.new_value ?? ""
          ),
        });
      return interpolateNodes(t, "issue_activity.cycle.removed", {
        issue: <IssueLink activity={activity} />,
        cycle: activityCycleNode(
          `/${workspaceSlug}/projects/${activity.project}/cycles/${activity.old_identifier}`,
          activity.old_value ?? ""
        ),
      });
    },
    icon: <CycleIcon height={12} width={12} className="text-secondary" aria-hidden="true" />,
  },
  modules: {
    message: (activity, showIssue, workspaceSlug, t) => {
      if (activity.verb === "created")
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.module.added" : "issue_activity.module.added_this_work_item",
          {
            issue: <IssueLink activity={activity} />,
            module: activityModuleNode(
              `/${workspaceSlug}/projects/${activity.project}/modules/${activity.new_identifier}`,
              activity.new_value ?? ""
            ),
          }
        );
      if (activity.verb === "updated")
        return interpolateNodes(t, "issue_activity.module.set", {
          module: activityModuleNode(
            `/${workspaceSlug}/projects/${activity.project}/modules/${activity.new_identifier}`,
            activity.new_value ?? ""
          ),
        });
      return interpolateNodes(t, "issue_activity.module.removed", {
        issue: <IssueLink activity={activity} />,
        module: activityModuleNode(
          `/${workspaceSlug}/projects/${activity.project}/modules/${activity.old_identifier}`,
          activity.old_value ?? ""
        ),
      });
    },
    icon: <ModuleIcon className="h-3 w-3 !text-secondary" aria-hidden="true" />,
  },
  name: {
    message: (activity, showIssue, _workspaceSlug, t) =>
      interpolateNodes(
        t,
        showIssue ? "issue_activity.title.set_of_issue" : "issue_activity.title.set",
        { issue: <IssueLink activity={activity} /> },
        { title: activity.new_value ?? "" }
      ),
    icon: <MessageSquareIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  parent: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      if (!activity.new_value)
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.parent.removed_from_issue" : "issue_activity.parent.removed",
          { issue: <IssueLink activity={activity} /> },
          { parent: activity.old_value ?? "" }
        );
      return interpolateNodes(
        t,
        showIssue ? "issue_activity.parent.set_for_issue" : "issue_activity.parent.set",
        { issue: <IssueLink activity={activity} /> },
        { parent: activity.new_value ?? "" }
      );
    },
    icon: <UsersIcon className="h-3 w-3 !text-secondary" aria-hidden="true" />,
  },
  priority: {
    message: (activity, showIssue, _workspaceSlug, t) =>
      interpolateNodes(
        t,
        showIssue ? "issue_activity.priority.set_for_issue" : "issue_activity.priority.set",
        { issue: <IssueLink activity={activity} /> },
        { priority: activity.new_value ? capitalizeFirstLetter(activity.new_value) : t("issue_activity.priority.none") }
      ),
    icon: <SignalMediumIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  relates_to: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      if (activity.old_value === "")
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.relates_to.added" : "issue_activity.relates_to.added_this_work_item",
          { issue: <IssueLink activity={activity} /> },
          { value: activity.new_value ?? "" }
        );
      return interpolateNodes(t, "issue_activity.relates_to.removed", {}, { value: activity.old_value ?? "" });
    },
    icon: <RelatedIcon height="12" width="12" className="text-secondary" />,
  },
  blocking: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      if (activity.old_value === "")
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.blocking.added" : "issue_activity.blocking.added_this_work_item",
          { issue: <IssueLink activity={activity} /> },
          { value: activity.new_value ?? "" }
        );
      return interpolateNodes(t, "issue_activity.blocking.removed", {}, { value: activity.old_value ?? "" });
    },
    icon: <BlockerIcon height="12" width="12" className="text-secondary" />,
  },
  blocked_by: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      if (activity.old_value === "")
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.blocked_by.added" : "issue_activity.blocked_by.added_this_work_item",
          { issue: <IssueLink activity={activity} /> },
          { value: activity.new_value ?? "" }
        );
      return interpolateNodes(
        t,
        showIssue ? "issue_activity.blocked_by.removed" : "issue_activity.blocked_by.removed_this_work_item",
        { issue: <IssueLink activity={activity} /> },
        { value: activity.old_value ?? "" }
      );
    },
    icon: <BlockedIcon height="12" width="12" className="text-secondary" />,
  },
  duplicate: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      if (activity.old_value === "")
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.duplicate.added" : "issue_activity.duplicate.added_this_work_item",
          { issue: <IssueLink activity={activity} /> },
          { value: activity.new_value ?? "" }
        );
      return interpolateNodes(
        t,
        showIssue ? "issue_activity.duplicate.removed" : "issue_activity.duplicate.removed_this_work_item",
        { issue: <IssueLink activity={activity} /> },
        { value: activity.old_value ?? "" }
      );
    },
    icon: <CopyPlus size={12} className="text-secondary" />,
  },
  state: {
    message: (activity, showIssue, _workspaceSlug, t) =>
      interpolateNodes(
        t,
        showIssue ? "issue_activity.state.set_for_issue" : "issue_activity.state.set",
        { issue: <IssueLink activity={activity} /> },
        { state: activity.new_value ?? "" }
      ),
    icon: <LayoutGridIcon size={12} className="text-secondary" aria-hidden="true" />,
  },
  start_date: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      if (!activity.new_value)
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.start_date.removed_from_issue" : "issue_activity.start_date.removed",
          { issue: <IssueLink activity={activity} /> }
        );
      return interpolateNodes(
        t,
        showIssue ? "issue_activity.start_date.set_for_issue" : "issue_activity.start_date.set",
        { issue: <IssueLink activity={activity} /> },
        { date: renderFormattedDate(activity.new_value) }
      );
    },
    icon: <Calendar size={12} className="text-secondary" aria-hidden="true" />,
  },
  target_date: {
    message: (activity, showIssue, _workspaceSlug, t) => {
      if (!activity.new_value)
        return interpolateNodes(
          t,
          showIssue ? "issue_activity.target_date.removed_from_issue" : "issue_activity.target_date.removed",
          { issue: <IssueLink activity={activity} /> }
        );
      return interpolateNodes(
        t,
        showIssue ? "issue_activity.target_date.set_for_issue" : "issue_activity.target_date.set",
        { issue: <IssueLink activity={activity} /> },
        { date: renderFormattedDate(activity.new_value) }
      );
    },
    icon: <Calendar size={12} className="text-secondary" aria-hidden="true" />,
  },
  inbox: {
    message: (activity, showIssue, _workspaceSlug, t) => (
      <>
        {getInboxUserActivityMessage(t, activity, showIssue)}
        {showIssue && <IssueLink activity={activity} />}
        {activity.verb === "2" && showIssue && t("issue_activity.inbox.duplicate_suffix")}
      </>
    ),
    icon: <IntakeIcon className="size-3 text-secondary" aria-hidden="true" />,
  },
};

export function ActivityIcon({ activity }: { activity: IIssueActivity }) {
  return <>{activityDetails[activity.field as keyof typeof activityDetails]?.icon}</>;
}

type ActivityMessageProps = {
  activity: IIssueActivity;
  showIssue?: boolean;
};

export function ActivityMessage({ activity, showIssue = false }: ActivityMessageProps) {
  // router params
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const activityField = activity.field ?? "issue";

  return (
    <>
      {activityDetails[activityField as keyof typeof activityDetails]?.message(
        activity,
        showIssue,
        workspaceSlug ? workspaceSlug.toString() : (activity.workspace_detail?.slug ?? ""),
        t
      )}
    </>
  );
}
