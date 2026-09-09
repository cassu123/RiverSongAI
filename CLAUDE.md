# Working notes for Claude

Deliberately short. This file is loaded into context every session, so
anything added here costs tokens on every turn — keep it to things that
change behaviour, not documentation. Architecture belongs in `docs/`.

## Don't check GitHub

Standing rule, no expiry. Do not read GitHub for any reason on your own
initiative: no PR activity subscriptions, no polling CI, no checking merge
or review status, no reading comments, issues, checks or Actions logs, no
`gh`/MCP GitHub calls to see how something landed. Not at the end of a task,
not as a courtesy check, not to confirm a push arrived.

This is on by default in the web/remote environment — creating a PR
auto-subscribes the session, and every CodeRabbit comment, review and CI
event is then delivered into context in full. A single review round costs
more than the change under review. If a PR is already being watched,
unsubscribe.

Chris says when something has merged or needs attention.

Only exception: if Chris asks outright to check something on GitHub, check
it **once**, report, and stop. One look — not a re-check, not a follow-up,
not a watch. The permission covers that single request and expires with it;
the next check needs a new ask.

`git push` is not "checking GitHub" and stays fine.

## Don't open a PR unless asked

Push to the working branch and say it is pushed. Opening the PR is Chris's
call, partly for the reason above.
