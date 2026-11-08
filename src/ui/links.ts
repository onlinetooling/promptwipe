// External links shown on the pages and in the tool. GitHub only: no other
// third party is linked from the tool.
const REPO = 'https://github.com/onlinetooling/promptwipe';

export const LINKS = {
  repo: REPO,
  /** Feature and format requests (design §1). */
  discussions: `${REPO}/discussions`,
  /** Bug report form that asks for the diagnostic (.github/ISSUE_TEMPLATE/bug_report.yml). */
  bugReport: `${REPO}/issues/new?template=bug_report.yml`,
} as const;
