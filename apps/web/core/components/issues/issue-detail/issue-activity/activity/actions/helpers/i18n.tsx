/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment } from "react";

export type TTranslationFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * Interpolates React nodes into a translated sentence.
 *
 * The i18n wrapper only returns strings, so node placeholders are injected as
 * marker tokens (e.g. `{{issue}}` -> `@@issue@@`), the translated string is
 * split on the markers, and each marker position is replaced with the node.
 * This lets each locale keep its natural word order.
 */
export function interpolateNodes(
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
