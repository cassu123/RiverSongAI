# Working notes for Claude

Deliberately short. This file is loaded into context every session, so
anything added here costs tokens on every turn — keep it to things that
change behaviour, not documentation. Architecture belongs in `docs/`.

## Don't watch pull requests

Do not subscribe to PR activity, poll CI, or check merge status. This is
on by default in the web/remote environment — creating a PR auto-subscribes
the session, and every CodeRabbit comment, review and CI event is then
delivered into context in full. A single review round costs more than the
change under review.

If a PR is already being watched, unsubscribe. Chris says when something
has merged or needs attention.

Exception: if asked outright to check a PR, check it once and stop.

## Don't open a PR unless asked

Push to the working branch and say it is pushed. Opening the PR is Chris's
call, partly for the reason above.
