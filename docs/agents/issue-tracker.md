# Issue tracker: GitHub

Issues and PRDs for this repository live in GitHub Issues:

https://github.com/3274375092/nnplayer/issues

Use the `gh` CLI for issue operations. Infer the repository from `git remote -v`.

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --body "..."`
- Add a label: `gh issue edit <number> --add-label "..."`
- Remove a label: `gh issue edit <number> --remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Use a body file or shell-supported multiline input for longer issue descriptions.

## Pull requests as a triage surface

**PRs as a request surface: no.**

External pull requests are not included in the issue triage queue. This flag can be changed to `yes` later if the repository begins treating external PRs as feature requests.

GitHub shares one number space across issues and pull requests. When `#42` is ambiguous, try `gh pr view 42` and then `gh issue view 42`.

## Skill terminology

When a skill says “publish to the issue tracker”, create a GitHub issue.

When a skill says “fetch the relevant ticket”, run:

`gh issue view <number> --comments`

## Wayfinding operations

- A map is one issue labelled `wayfinder:map`.
- Child tickets use `wayfinder:<type>`, where type is `research`, `prototype`, `grilling`, or `task`.
- Prefer GitHub sub-issues for parent/child relationships.
- Prefer GitHub native issue dependencies for blocking relationships.
- If those features are unavailable, use task lists and a `Blocked by: #<number>` line.
- Claim work with `gh issue edit <number> --add-assignee @me`.
- Resolve work by commenting with the result and then closing the issue.
