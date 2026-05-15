#!/bin/bash
# Pre-commit hook to prevent accidental commit of data files.

STAGED_DATA_FILES=$(git diff --cached --name-only | grep "^data/.*\.db$\|^data/.*\.sqlite\|^data/.*\.json$")

if [ -n "$STAGED_DATA_FILES" ]; then
    echo "ERROR: You are attempting to commit sensitive data files:"
    echo "$STAGED_DATA_FILES"
    echo "These files are ignored by .gitignore and should NOT be committed."
    echo "If you really need to commit one, use --no-verify (but don't)."
    exit 1
fi

exit 0
